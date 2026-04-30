/**
 * Sprint-016 Story 7 ad-hoc retrieval-quality demo.
 *
 * Seeds a realistic 2-project corpus and runs a battery of queries
 * through vectorSearch + ftsSearch + hybridSearch so a human can
 * eyeball retrieval behavior. Not a benchmark — no recall metrics or
 * baseline comparisons. Just concrete inputs → outputs the way a
 * downstream consumer would see them.
 *
 * Project A — backend codebase (auth, migrations, debugging)
 * Project B — frontend codebase (components, layout, build tooling)
 *
 * Both projects share some surface vocabulary (e.g. "deployment",
 * "configuration") so the project-isolation filter has actual signal.
 *
 * Usage:
 *   npx tsx scripts/demo-search.ts
 */
import { existsSync, rmSync } from 'node:fs';

import { PristineLocal } from '../src/client.js';
import { createDatabase } from '../src/core/database.js';
import { LocalEmbedder } from '../src/embedder/local/index.js';
import { buildSessionVector } from '../src/memory/indexer/session-vector.js';

const DB_PATH = '/tmp/pristine-demo.db';

const log = (msg: string): void => {
  // eslint-disable-next-line no-console
  console.log(msg);
};

// ---------------------------------------------------------------------------
// Realistic synthetic corpus
// ---------------------------------------------------------------------------

interface DemoConversation {
  readonly project: string;
  readonly title: string;
  readonly turns: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[];
}

const corpus: readonly DemoConversation[] = [
  {
    project: 'project-backend',
    title: 'auth-flow-design',
    turns: [
      { role: 'user', content: 'How do we structure session tokens for the auth service?' },
      {
        role: 'assistant',
        content:
          'Use signed JWT tokens with a 15-minute expiry. Include user_id, role, and issued_at in the payload. Sign with RS256 using the rotating private key.',
      },
      {
        role: 'user',
        content: 'Where should the refresh token live? Cookie or local storage?',
      },
      {
        role: 'assistant',
        content:
          'HttpOnly secure cookies for the refresh token. Local storage exposes it to XSS. The access token can stay in memory and be re-fetched via /auth/refresh.',
      },
      { role: 'user', content: 'What about CSRF on the refresh endpoint?' },
      {
        role: 'assistant',
        content:
          'Use SameSite=Strict on the refresh cookie plus a CSRF token bound to the session. Verify both on every refresh.',
      },
    ],
  },
  {
    project: 'project-backend',
    title: 'database-migration-strategy',
    turns: [
      { role: 'user', content: 'We need to add a not-null column to a 50M-row table.' },
      {
        role: 'assistant',
        content:
          'Three-step migration: (1) add nullable column with a default, (2) backfill in batches of 10k rows with throttling, (3) flip to NOT NULL once backfill completes. Avoid table rewrites by using ALTER COLUMN SET NOT NULL after backfill instead of changing the original DDL.',
      },
      { role: 'user', content: 'How do we handle concurrent writes during the backfill?' },
      {
        role: 'assistant',
        content:
          'Use SELECT FOR UPDATE SKIP LOCKED on each batch so writers can interleave. Also configure a trigger that populates the new column for any INSERT happening during the migration window.',
      },
      {
        role: 'user',
        content: "Can we deploy this without downtime?",
      },
      {
        role: 'assistant',
        content:
          'Yes — the migration is online if you sequence it correctly. Step 1 takes a brief AccessExclusiveLock; steps 2 and 3 run with normal application traffic. Roll out the trigger before step 2 begins.',
      },
    ],
  },
  {
    project: 'project-backend',
    title: 'production-debugging-session',
    turns: [
      { role: 'user', content: 'Production is throwing ECONNREFUSED on every Redis call.' },
      {
        role: 'assistant',
        content:
          'Likely the Redis pod restarted and the connection pool is holding stale sockets. Run kubectl get pods -n cache to confirm. If the pod is healthy, restart your service to drop the pool.',
      },
      { role: 'user', content: 'The Redis pod is up. The connections still fail.' },
      {
        role: 'assistant',
        content:
          'Check the network policy. If you recently changed namespace labels, the NetworkPolicy selectors may have stopped matching. Run kubectl describe networkpolicy in both namespaces.',
      },
      { role: 'user', content: 'Found it — a label was renamed last week.' },
      {
        role: 'assistant',
        content:
          'Update the NetworkPolicy podSelector to match the new label, then restart any service still pointed at the old name. Add a CI check that flags label renames going forward.',
      },
    ],
  },
  {
    project: 'project-frontend',
    title: 'react-component-architecture',
    turns: [
      { role: 'user', content: 'Should the SearchBar own its own state or lift it to the parent?' },
      {
        role: 'assistant',
        content:
          'Lift it. The parent already needs the query for the results list, and a controlled SearchBar makes that explicit. Use useState in the parent and pass value + onChange to SearchBar.',
      },
      { role: 'user', content: 'What about debouncing? Does that go in the parent too?' },
      {
        role: 'assistant',
        content:
          'Debounce in a custom hook (useDebouncedValue) inside the parent, before the search effect fires. Keeps SearchBar dumb and reusable.',
      },
      { role: 'user', content: 'How do we test the debounce timing?' },
      {
        role: 'assistant',
        content:
          'Use vi.useFakeTimers in vitest. Render the parent, type into the SearchBar, advance timers by 300ms, then assert the search effect ran exactly once.',
      },
    ],
  },
  {
    project: 'project-frontend',
    title: 'css-grid-layout-debugging',
    turns: [
      { role: 'user', content: "Grid items aren't aligning when one row has fewer columns." },
      {
        role: 'assistant',
        content:
          'Set grid-auto-flow: dense to let items backfill empty cells. Or pin the column count with grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)) so partial rows still align.',
      },
      { role: 'user', content: "I'm seeing a stray gap on the last row." },
      {
        role: 'assistant',
        content:
          'That gap usually comes from align-content: stretch with grid-template-rows defined. Switch align-content to start, or remove the explicit row template and let auto rows size themselves.',
      },
      { role: 'user', content: 'Does this behavior differ between Chrome and Firefox?' },
      {
        role: 'assistant',
        content:
          'In subgrid scenarios yes — Firefox shipped subgrid first, Chrome 117+ caught up. For non-subgrid grids both browsers behave identically.',
      },
    ],
  },
  {
    project: 'project-frontend',
    title: 'vite-build-tooling',
    turns: [
      { role: 'user', content: 'Vite build is suddenly throwing ECONNREFUSED on dependency fetch.' },
      {
        role: 'assistant',
        content:
          "That's npm registry, not Vite. Check if your VPN or proxy is blocking the registry. Run npm ping and curl https://registry.npmjs.org/vite to isolate.",
      },
      { role: 'user', content: 'Ping works. Build still fails.' },
      {
        role: 'assistant',
        content:
          'Clear your node_modules and the npm cache (npm cache clean --force). Lockfile drift between dependencies can also trigger this — try rm package-lock.json && npm install.',
      },
      { role: 'user', content: 'Cleared the cache and reinstalled. Now it works.' },
      {
        role: 'assistant',
        content:
          'Stale cache entries from a partial download. Worth pinning your registry to a specific version of npm in CI to reduce surface area.',
      },
    ],
  },
];

interface Query {
  readonly label: string;
  readonly q: string;
  readonly project: string;
  readonly intent: string;
}

const queries: readonly Query[] = [
  {
    label: '1. Literal error code (FTS5 should excel)',
    q: '"ECONNREFUSED"',
    project: 'project-backend',
    intent: 'Should hit project-backend/production-debugging — the actual ECONNREFUSED message.',
  },
  {
    label: '2. Cross-project literal — same token, different project',
    q: '"ECONNREFUSED"',
    project: 'project-frontend',
    intent: 'Same token also appears in project-frontend/vite-build. Project filter should NOT cross.',
  },
  {
    label: '3. Semantic topic — auth design (no literal match)',
    q: 'how should we structure secure token storage for users',
    project: 'project-backend',
    intent: 'Vector should rank auth-flow-design highly even though query phrasing is different.',
  },
  {
    label: '4. Cross-conversation thematic recall (session lift)',
    q: 'safe schema changes on a busy production database',
    project: 'project-backend',
    intent: 'database-migration-strategy — uses different vocabulary ("not-null column", "backfill") but is the right conversation. Session vector should help if window-level matches are weak.',
  },
  {
    label: '5. Topic misses — query about cooking',
    q: 'best way to cook a pizza',
    project: 'project-backend',
    intent: 'Backend project has zero food content. Vector should still return SOMETHING (KNN always returns k results), but scores should be low and content irrelevant.',
  },
  {
    label: '6. Boolean FTS — debug AND NOT redis',
    q: 'debug NOT redis',
    project: 'project-backend',
    intent: 'Should match production-debugging messages that mention debugging concepts but exclude any with "redis".',
  },
  {
    label: '7. Frontend-side semantic — react testing',
    q: 'how do I test a debounced input field',
    project: 'project-frontend',
    intent: 'react-component-architecture turn 6 talks about vi.useFakeTimers + debounce. Vector should rank that turn first.',
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${DB_PATH}${suffix}`;
    if (existsSync(p)) rmSync(p);
  }

  const db = createDatabase({ path: DB_PATH, loadSqliteVec: true });
  const embedder = new LocalEmbedder();
  const client = await PristineLocal.create({
    db,
    embedder,
  });

  log('=== Sprint-016 ad-hoc retrieval demo ===');
  log(`DB: ${DB_PATH} (Nomic v1.5 loads on first embed call)`);
  log('');

  // Seed all conversations
  log('Seeding corpus...');
  const conversationIds = new Map<string, string>();
  for (const conv of corpus) {
    const id = client.storeAsync(conv.turns, `user-${conv.project}`, conv.project);
    conversationIds.set(`${conv.project}/${conv.title}`, id);
    log(`  ${conv.project}/${conv.title} → ${id.slice(0, 8)} (${conv.turns.length} turns)`);
  }

  log('');
  log('Draining embed-worker (this is the slow part — Nomic loads + embeds each message)...');
  const t0 = Date.now();
  const processed = await client.drainEmbedQueue();
  log(`Drained ${processed} embed tasks in ${Date.now() - t0} ms`);

  log('');
  log('Building session vectors for cross-conversation reference recall...');
  for (const id of conversationIds.values()) {
    await buildSessionVector(db, embedder, id);
  }
  log(`Built ${conversationIds.size} session vectors`);

  // Helpers to print results
  const messageContent = (messageId: number): string => {
    const row = db
      .prepare('SELECT content FROM messages WHERE id = ?')
      .get(messageId) as { content: string } | undefined;
    return row?.content ?? '<missing>';
  };

  const conversationLabel = (cid: string): string => {
    for (const [label, id] of conversationIds.entries()) {
      if (id === cid) return label;
    }
    return `<unknown:${cid.slice(0, 8)}>`;
  };

  const truncate = (s: string, n: number): string =>
    s.length <= n ? s : `${s.slice(0, n - 1)}…`;

  // Run queries
  for (const query of queries) {
    log('');
    log('─'.repeat(78));
    log(`QUERY ${query.label}`);
    log(`  q:       ${query.q}`);
    log(`  scope:   projectId=${query.project}`);
    log(`  intent:  ${query.intent}`);
    log('');

    // Vector
    try {
      const vHits = await client.searcher.vectorSearch(query.q, { projectId: query.project }, 5);
      log(`  vectorSearch → ${vHits.length} hits`);
      for (const h of vHits) {
        const firstMsg = messageContent(h.messageIds[0]);
        log(
          `    [${h.score.toFixed(4)}] ${conversationLabel(h.conversationId)} window(${h.windowIndex}) — ${truncate(firstMsg, 60)}`,
        );
      }
    } catch (err) {
      log(`  vectorSearch ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }

    // FTS
    try {
      const fHits = await client.searcher.ftsSearch(query.q, { projectId: query.project }, 5);
      log(`  ftsSearch    → ${fHits.length} hits`);
      for (const h of fHits) {
        log(
          `    [${h.score.toFixed(4)}] ${conversationLabel(h.conversationId)} message(${h.messageId}) — ${truncate(h.snippet ?? messageContent(h.messageId), 60)}`,
        );
      }
    } catch (err) {
      log(`  ftsSearch ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Hybrid (3-source)
    try {
      const hHits = await client.searcher.hybridSearch(query.q, { projectId: query.project }, 5);
      log(`  hybridSearch → ${hHits.length} hits (RRF fused)`);
      for (const h of hHits) {
        const detail =
          h.kind === 'window'
            ? `window(${h.windowIndex}) — ${truncate(messageContent(h.messageIds[0]), 50)}`
            : h.kind === 'message'
              ? `message(${h.messageId}) — ${truncate(h.snippet ?? messageContent(h.messageId), 50)}`
              : `session — ${conversationLabel(h.conversationId)}`;
        log(`    [${h.score.toFixed(4)}] (${h.source}) ${conversationLabel(h.conversationId)} ${detail}`);
      }
    } catch (err) {
      log(`  hybridSearch ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log('');
  log('─'.repeat(78));
  log('Demo complete. Read each query block: do the top hits look like the intent?');

  await client.dispose();
};

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('demo failed:', err);
  process.exit(1);
});
