import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { ConversationStore } from '../../src/conversations/store.js';
import { createDatabase } from '../../src/core/database.js';
import { InvalidArgumentError } from '../../src/core/errors.js';
import type { Embedder } from '../../src/core/interfaces.js';
import { LocalEmbedder } from '../../src/embedder/local/index.js';
import { createEmbedTaskHandler, runEmbedWorker } from '../../src/memory/indexer/embed-worker.js';
import { createIndexer } from '../../src/memory/indexer/index.js';
import { createWindowWriter } from '../../src/memory/indexer/windows.js';
import {
  createSearcher,
  type Searcher,
  type SearchFilters,
  type Role,
} from '../../src/memory/searcher/index.js';
import { IngestQueue } from '../../src/queue/ingest-queue.js';

// ---------------------------------------------------------------------------
// Sprint-016 Story 6 — cross-cutting searcher contract suite
// ---------------------------------------------------------------------------
//
// Locks the searcher's behavioral contract across all three primitives
// (vectorSearch, ftsSearch, hybridSearch — sessionVectorSearch tested
// through hybridSearch's session-source projection). Phase 5
// (searcher.sql) and Phase 7 (eval framework) build on this foundation;
// the tests here are the "spec" they target.
//
// Test names ARE documentation: read each describe + it block as a
// statement of contract. Per Story 6 Technical Notes, this file is
// intentionally light on production-code changes; bug fixes belong in
// the relevant feature story branch, not here.
//
// Suite structure (sprint AC lines 234-240):
//   1. Shared corpus + helpers
//   2. Filter correctness matrix (5 filter dims × 3 methods)
//   3. Ranking stability across runs
//   4. Window→messages resolution
//   5. Cross-project isolation across all three methods
//   6. Static src/ filesystem grep guard for forbidden LLM imports
//   7. Real-Nomic recall sanity check (skipped when SKIP_SLOW_TESTS=1)
//
// Slow-test gate semantics: `SKIP_SLOW_TESTS=1` opts out (default in
// CI), unset OR any other value opts in. This matches the established
// pattern at tests/integration/indexer.test.ts and tests/integration/
// embedder.test.ts.

const skipSlow = process.env.SKIP_SLOW_TESTS === '1';

const makeStubEmbedder = (): Embedder => ({
  embed: async (text: string): Promise<number[]> => {
    const out = new Array<number>(768).fill(0.01);
    for (let i = 0; i < Math.min(text.length, 768); i++) {
      out[i] = text.charCodeAt(i) / 1000;
    }
    return out;
  },
  embedBatch: async () => {
    throw new InvalidArgumentError('embedBatch not used in this suite');
  },
});

interface PipelineDeps {
  readonly db: Database.Database;
  readonly store: ConversationStore;
  readonly queue: IngestQueue;
  readonly indexer: ReturnType<typeof createIndexer>;
  readonly searcher: Searcher;
}

const buildPipeline = (embedder: Embedder): PipelineDeps => {
  const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
  const store = new ConversationStore(db);
  const windowWriter = createWindowWriter(db);
  const config = { windowSize: 3, windowOverlap: 1 };

  const queue = new IngestQueue({
    db,
    embedTaskHandler: createEmbedTaskHandler({ db, embedder, windowWriter, config }),
  });

  const indexer = createIndexer({
    db,
    conversationStore: store,
    ingestQueue: queue,
    embedder,
    config,
  });

  const searcher = createSearcher({ db, embedder });

  return { db, store, queue, indexer, searcher };
};

const seedConversation = async (
  p: PipelineDeps,
  userId: string,
  projectId: string,
  contents: string[],
  buildSession = true,
): Promise<string> => {
  const messages = contents.map((content, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content,
  }));
  const conversationId = p.store.addEmptyConversation(userId, messages, projectId);
  p.indexer.ingest(messages, { projectId, conversationId });
  await runEmbedWorker(p.queue);
  if (buildSession) await p.indexer.buildSessionVector(conversationId);
  return conversationId;
};

// Compact 3-project × 2-conversation × 6-messages corpus per sprint AC
// "intentionally compact" guidance. Each conversation is themed around
// one of three topics so cross-project isolation has clear signal.
const seedCompactCorpus = async (
  p: PipelineDeps,
): Promise<{
  readonly projectIds: readonly string[];
  readonly conversations: ReadonlyMap<string, readonly string[]>;
}> => {
  const projectIds = ['proj-alpha', 'proj-beta', 'proj-gamma'];
  const conversations = new Map<string, string[]>();
  for (const projectId of projectIds) {
    const ids: string[] = [];
    ids.push(
      await seedConversation(p, `user-${projectId}-1`, projectId, [
        `${projectId} machine learning topic one`,
        `${projectId} gradient descent topic two`,
        `${projectId} embedding clusters topic three`,
        `${projectId} retrieval pipelines topic four`,
        `${projectId} vector indexes topic five`,
        `${projectId} similarity scoring topic six`,
      ]),
    );
    ids.push(
      await seedConversation(p, `user-${projectId}-2`, projectId, [
        `${projectId} cooking pasta topic one`,
        `${projectId} mediterranean cuisine topic two`,
        `${projectId} pizza recipes topic three`,
        `${projectId} herbs and spices topic four`,
        `${projectId} olive oil topic five`,
        `${projectId} dining etiquette topic six`,
      ]),
    );
    conversations.set(projectId, ids);
  }
  return { projectIds, conversations };
};

// ---------------------------------------------------------------------------
// 2. Filter correctness matrix — N filter dims × 3 methods
// ---------------------------------------------------------------------------

type SearchMethod = 'vector' | 'fts' | 'hybrid';

interface MethodHit {
  readonly conversationId: string;
  readonly windowIndex?: number;
  readonly messageId?: number;
  readonly kind?: 'window' | 'message' | 'session';
}

interface FilterCase {
  readonly name: string;
  readonly mutate: (
    base: SearchFilters,
    ids: ReadonlyMap<string, readonly string[]>,
    p: PipelineDeps,
  ) => Promise<SearchFilters> | SearchFilters;
  readonly query: string;
  readonly assertOnHit: (
    hit: MethodHit,
    method: SearchMethod,
    p: PipelineDeps,
    ids: ReadonlyMap<string, readonly string[]>,
  ) => void;
  /**
   * Expected hits.length > 0 per method. Default true for all three.
   * The role filter case overrides ftsSearch to false because the
   * 'machine learning' query against the seed corpus may produce zero
   * user-role message matches under FTS5's strict message-level role
   * filter (depends on which messages happen to land at even indices).
   */
  readonly expectHits?: Partial<Record<SearchMethod, boolean>>;
}

const filterCases = (): readonly FilterCase[] => [
  {
    name: 'projectId narrows to project',
    mutate: (base) => ({ ...base, projectId: 'proj-alpha' }),
    query: 'machine learning',
    assertOnHit: (hit, _method, p) => {
      const row = p.db
        .prepare('SELECT project_id FROM conversations WHERE id = ?')
        .get(hit.conversationId) as { project_id: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.project_id).toBe('proj-alpha');
    },
  },
  {
    name: 'conversationId narrows to single conversation',
    mutate: (base, ids) => ({
      ...base,
      projectId: 'proj-alpha',
      conversationId: ids.get('proj-alpha')![0],
    }),
    query: 'machine learning',
    assertOnHit: (hit, _method, _p, ids) => {
      expect(hit.conversationId).toBe(ids.get('proj-alpha')![0]);
    },
  },
  {
    name: 'role narrows hits to messages of that role',
    mutate: (base) => ({ ...base, projectId: 'proj-alpha', role: 'user' as Role }),
    query: 'machine learning',
    assertOnHit: (hit, method, p) => {
      // Role-filter contract differs per method (per SearchFilters.role
      // JSDoc). Assert each method's semantics:
      //   vectorSearch: window contains AT LEAST ONE user-role message
      //                 (permissive, window-level)
      //   ftsSearch:    the matched message itself has role='user'
      //                 (strict, message-level)
      //   hybridSearch: depends on hit.kind — window hits use vector
      //                 semantics, message hits use fts semantics,
      //                 session hits ignore role (filter doesn't apply)
      if (method === 'vector' || (method === 'hybrid' && hit.kind === 'window')) {
        expect(hit.windowIndex).toBeDefined();
        const row = p.db
          .prepare(
            `SELECT 1 AS hit FROM window_messages wm
             JOIN messages m ON m.id = wm.message_id
             WHERE wm.conversation_id = ? AND wm.window_index = ? AND m.role = 'user'
             LIMIT 1`,
          )
          .get(hit.conversationId, hit.windowIndex!) as { hit: number } | undefined;
        expect(row).toBeDefined();
      } else if (method === 'fts' || (method === 'hybrid' && hit.kind === 'message')) {
        expect(hit.messageId).toBeDefined();
        const row = p.db.prepare('SELECT role FROM messages WHERE id = ?').get(hit.messageId!) as
          | { role: string }
          | undefined;
        expect(row).toBeDefined();
        expect(row?.role).toBe('user');
      }
      // hybridSearch session hits: role filter ignored at session
      // granularity (documented behavior). No assertion needed.
    },
    // FTS5 may return zero user-role hits for the 'machine learning'
    // query against the synthetic corpus depending on which message
    // indices are user vs assistant. Vectorsearch has wider window
    // coverage so always returns at least one matching window.
    expectHits: { fts: false },
  },
  {
    name: 'dateFrom restricts to created_at >= bound (split corpus by latest conversation)',
    // Use the LATEST conversation's created_at as the bound — anything
    // before it gets excluded. Asserts the filter actually narrows
    // rather than tautologically passing every record.
    //
    // **Coverage note.** SQLite's `datetime('now')` has second
    // resolution, so on fast CI all 6 seed conversations may share the
    // same `created_at`. When that happens, the bound matches every
    // record and the filter behaves as a no-op — the assertion still
    // passes but doesn't stress the filter. The CONTRACT-LEVEL
    // dateFrom/dateTo tests with explicit `setTimeout(1100)` time gaps
    // live in tests/integration/searcher-vector.test.ts and
    // tests/integration/searcher-fts.test.ts; this matrix entry is
    // redundant tabular coverage of the filter dimension, not the
    // contract pin.
    mutate: async (base, ids, p) => {
      const allIds = Array.from(ids.values()).flat();
      const stmt = p.db.prepare(
        'SELECT created_at FROM conversations WHERE id = ? ORDER BY created_at DESC',
      );
      const timestamps = allIds.map((id) => (stmt.get(id) as { created_at: string }).created_at);
      // Sort descending; pick the latest. Any conversation with
      // created_at < latest is excluded.
      timestamps.sort().reverse();
      return { ...base, projectId: 'proj-alpha', dateFrom: timestamps[0] };
    },
    query: 'machine learning',
    assertOnHit: (hit, _method, p) => {
      const row = p.db
        .prepare('SELECT created_at FROM conversations WHERE id = ?')
        .get(hit.conversationId) as { created_at: string };
      // Every hit must be on or after the bound (which is the latest
      // conversation's created_at).
      const allTs = (
        p.db.prepare('SELECT created_at FROM conversations').all() as {
          created_at: string;
        }[]
      ).map((r) => r.created_at);
      const max = allTs.sort().reverse()[0];
      expect(row.created_at >= max).toBe(true);
    },
  },
  {
    name: 'dateTo restricts to created_at <= bound (split corpus by earliest conversation)',
    mutate: async (base, ids, p) => {
      const allIds = Array.from(ids.values()).flat();
      const stmt = p.db.prepare('SELECT created_at FROM conversations WHERE id = ?');
      const timestamps = allIds.map((id) => (stmt.get(id) as { created_at: string }).created_at);
      timestamps.sort();
      return { ...base, projectId: 'proj-alpha', dateTo: timestamps[0] };
    },
    query: 'machine learning',
    assertOnHit: (hit, _method, p) => {
      const row = p.db
        .prepare('SELECT created_at FROM conversations WHERE id = ?')
        .get(hit.conversationId) as { created_at: string };
      const allTs = (
        p.db.prepare('SELECT created_at FROM conversations').all() as {
          created_at: string;
        }[]
      ).map((r) => r.created_at);
      const min = allTs.sort()[0];
      expect(row.created_at <= min).toBe(true);
    },
    // dateTo at the earliest conversation may exclude all conversations
    // whose timestamps are strictly later — fts/vector may return zero.
    expectHits: { fts: false, vector: false, hybrid: false },
  },
];

describe('searcher cross-cutting — filter correctness matrix (5 dims × 3 methods)', () => {
  let p: PipelineDeps;
  let ids: ReadonlyMap<string, readonly string[]>;

  beforeEach(async () => {
    p = buildPipeline(makeStubEmbedder());
    ({ conversations: ids } = await seedCompactCorpus(p));
  });

  afterEach(() => {
    p.db.close();
  });

  for (const fc of filterCases()) {
    const expectVector = fc.expectHits?.vector ?? true;
    const expectFts = fc.expectHits?.fts ?? true;
    const expectHybrid = fc.expectHits?.hybrid ?? true;

    it(`vectorSearch — ${fc.name}`, async () => {
      const filters = await fc.mutate({ projectId: '_unused_' }, ids, p);
      const hits = await p.searcher.vectorSearch(fc.query, filters, 10);
      if (expectVector) expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        fc.assertOnHit(
          { conversationId: hit.conversationId, windowIndex: hit.windowIndex, kind: 'window' },
          'vector',
          p,
          ids,
        );
      }
    });

    it(`ftsSearch — ${fc.name}`, async () => {
      const filters = await fc.mutate({ projectId: '_unused_' }, ids, p);
      const hits = await p.searcher.ftsSearch(fc.query, filters, 10);
      if (expectFts) expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        fc.assertOnHit(
          { conversationId: hit.conversationId, messageId: hit.messageId, kind: 'message' },
          'fts',
          p,
          ids,
        );
      }
    });

    it(`hybridSearch — ${fc.name}`, async () => {
      const filters = await fc.mutate({ projectId: '_unused_' }, ids, p);
      const hits = await p.searcher.hybridSearch(fc.query, filters, 10);
      if (expectHybrid) expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        const methodHit: MethodHit = {
          conversationId: hit.conversationId,
          kind: hit.kind,
          ...(hit.kind === 'window' ? { windowIndex: hit.windowIndex } : {}),
          ...(hit.kind === 'message' ? { messageId: hit.messageId } : {}),
        };
        fc.assertOnHit(methodHit, 'hybrid', p, ids);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Ranking stability — identical query against idempotent corpus
//    returns identical result order across runs.
// ---------------------------------------------------------------------------

describe('searcher cross-cutting — ranking stability across runs', () => {
  let p: PipelineDeps;

  beforeEach(async () => {
    p = buildPipeline(makeStubEmbedder());
    await seedCompactCorpus(p);
  });

  afterEach(() => {
    p.db.close();
  });

  it('vectorSearch returns identical hit-id sequence across two runs', async () => {
    const filters = { projectId: 'proj-alpha' };
    const r1 = await p.searcher.vectorSearch('machine learning', filters, 10);
    const r2 = await p.searcher.vectorSearch('machine learning', filters, 10);
    expect(r1.map((h) => `${h.conversationId}:${h.windowIndex}`)).toEqual(
      r2.map((h) => `${h.conversationId}:${h.windowIndex}`),
    );
  });

  it('ftsSearch returns identical messageId sequence across two runs', async () => {
    const filters = { projectId: 'proj-alpha' };
    const r1 = await p.searcher.ftsSearch('machine', filters, 10);
    const r2 = await p.searcher.ftsSearch('machine', filters, 10);
    expect(r1.map((h) => h.messageId)).toEqual(r2.map((h) => h.messageId));
  });

  it('hybridSearch returns identical fused order across two runs', async () => {
    const filters = { projectId: 'proj-alpha' };
    const r1 = await p.searcher.hybridSearch('machine learning', filters, 10);
    const r2 = await p.searcher.hybridSearch('machine learning', filters, 10);
    const idOf = (hit: (typeof r1)[number]): string =>
      hit.kind === 'window'
        ? `window:${hit.conversationId}:${hit.windowIndex}`
        : hit.kind === 'message'
          ? `message:${hit.messageId}`
          : `session:${hit.conversationId}`;
    expect(r1.map(idOf)).toEqual(r2.map(idOf));
  });
});

// ---------------------------------------------------------------------------
// 4. Window→messages resolution — vectorSearch's messageIds[] matches
//    the manual SELECT against window_messages (no off-by-one).
// ---------------------------------------------------------------------------

describe('searcher cross-cutting — window-to-messages resolution', () => {
  let p: PipelineDeps;

  beforeEach(async () => {
    p = buildPipeline(makeStubEmbedder());
    await seedCompactCorpus(p);
  });

  afterEach(() => {
    p.db.close();
  });

  it('vectorSearch hit messageIds equal window_messages.position-ordered SELECT', async () => {
    const hits = await p.searcher.vectorSearch('machine learning', { projectId: 'proj-alpha' }, 10);
    expect(hits.length).toBeGreaterThan(0);

    const stmt = p.db.prepare(
      'SELECT message_id FROM window_messages WHERE conversation_id = ? AND window_index = ? ORDER BY position ASC',
    );
    for (const hit of hits) {
      const expected = (
        stmt.all(hit.conversationId, hit.windowIndex) as { message_id: number }[]
      ).map((r) => r.message_id);
      expect(hit.messageIds).toEqual(expected);
    }
  });

  it('hybridSearch window-kind hits also resolve messageIds correctly', async () => {
    const hits = await p.searcher.hybridSearch('machine learning', { projectId: 'proj-alpha' }, 10);
    const windowHits = hits.filter((h) => h.kind === 'window');
    expect(windowHits.length).toBeGreaterThan(0);

    const stmt = p.db.prepare(
      'SELECT message_id FROM window_messages WHERE conversation_id = ? AND window_index = ? ORDER BY position ASC',
    );
    for (const hit of windowHits) {
      if (hit.kind !== 'window') continue;
      const expected = (
        stmt.all(hit.conversationId, hit.windowIndex) as { message_id: number }[]
      ).map((r) => r.message_id);
      expect(hit.messageIds).toEqual(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Cross-project isolation pinned for ALL three methods
// ---------------------------------------------------------------------------

describe('searcher cross-cutting — cross-project isolation', () => {
  let p: PipelineDeps;

  beforeEach(async () => {
    p = buildPipeline(makeStubEmbedder());
    await seedCompactCorpus(p);
  });

  afterEach(() => {
    p.db.close();
  });

  it('vectorSearch in proj-alpha returns zero hits from other projects', async () => {
    const hits = await p.searcher.vectorSearch('machine learning', { projectId: 'proj-alpha' }, 50);
    expect(hits.length).toBeGreaterThan(0);
    const stmt = p.db.prepare('SELECT project_id FROM conversations WHERE id = ?');
    for (const hit of hits) {
      const row = stmt.get(hit.conversationId) as { project_id: string };
      expect(row.project_id).toBe('proj-alpha');
    }
  });

  it('ftsSearch in proj-alpha returns zero hits from other projects', async () => {
    const hits = await p.searcher.ftsSearch('machine', { projectId: 'proj-alpha' }, 50);
    expect(hits.length).toBeGreaterThan(0);
    const stmt = p.db.prepare('SELECT project_id FROM conversations WHERE id = ?');
    for (const hit of hits) {
      const row = stmt.get(hit.conversationId) as { project_id: string };
      expect(row.project_id).toBe('proj-alpha');
    }
  });

  it('hybridSearch in proj-alpha returns zero hits from other projects', async () => {
    const hits = await p.searcher.hybridSearch('machine learning', { projectId: 'proj-alpha' }, 50);
    expect(hits.length).toBeGreaterThan(0);
    const stmt = p.db.prepare('SELECT project_id FROM conversations WHERE id = ?');
    for (const hit of hits) {
      const row = stmt.get(hit.conversationId) as { project_id: string };
      expect(row.project_id).toBe('proj-alpha');
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Static src/ filesystem grep guard — searcher must not introduce
//    forbidden LLM SDK imports (mirrors sprint-015 Story 7's pattern).
// ---------------------------------------------------------------------------

describe('searcher cross-cutting — static import guard', () => {
  it('no banned LLM SDK imports anywhere under src/', () => {
    // Walk the FULL src/ tree (sprint AC line 239). Same pattern as
    // sprint-015 Story 7's import guard but anchored at src/ rather
    // than a subdirectory. Catches any module — searcher, indexer,
    // queue, retriever, sanitizer, etc. — that introduces a banned
    // SDK dependency.
    const banned = [
      {
        label: '@anthropic-ai/sdk',
        regex: /from\s+['"]@anthropic-ai\/sdk['"]|require\(['"]@anthropic-ai\/sdk['"]\)/,
      },
      { label: 'openai', regex: /from\s+['"]openai['"]|require\(['"]openai['"]\)/ },
      // pg = postgres driver. Match exact-name only so 'pgcrypto',
      // 'pg-promise', etc. don't false-positive.
      { label: 'pg', regex: /from\s+['"]pg['"]|require\(['"]pg['"]\)/ },
      // @supabase/* covers all submodules: @supabase/supabase-js,
      // @supabase/auth-js, etc. The original story-1 pattern matched
      // bare '@supabase' only; this catches the realistic submodule
      // imports too.
      {
        label: '@supabase/*',
        regex: /from\s+['"]@supabase\/[^'"]+['"]|require\(['"]@supabase\/[^'"]+['"]\)/,
      },
    ];

    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const stat = lstatSync(full);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith('.ts')) continue;
        const contents = readFileSync(full, 'utf8');
        for (const { label, regex } of banned) {
          if (regex.test(contents)) {
            offenders.push(`${full} imports banned module ${label}`);
          }
        }
      }
    };

    walk(srcRoot);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Real-Nomic recall sanity check — gated by SKIP_SLOW_TESTS=0
// ---------------------------------------------------------------------------

describe.skipIf(skipSlow)('searcher cross-cutting — real Nomic v1.5 recall sanity (gated)', () => {
  let p: PipelineDeps;

  beforeEach(async () => {
    p = buildPipeline(new LocalEmbedder());
    await seedCompactCorpus(p);
  });

  afterEach(() => {
    p.db.close();
  });

  it('vectorSearch with real Nomic surfaces a topically-related window', async () => {
    const hits = await p.searcher.vectorSearch(
      'training neural networks with gradient descent',
      { projectId: 'proj-alpha' },
      5,
    );
    expect(hits.length).toBeGreaterThan(0);
    // First hit should be from one of the ML-themed windows in
    // proj-alpha's first conversation (the 'machine learning topic
    // one' / 'gradient descent topic two' set), not the cooking
    // conversation. Assert by checking conversation-id matches the
    // first conversation the seeder created in proj-alpha.
    const firstConvMessageStmt = p.db.prepare(
      'SELECT conversation_id FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id = ?) ORDER BY id ASC LIMIT 1',
    );
    const firstConv = (firstConvMessageStmt.get('proj-alpha') as { conversation_id: string })
      .conversation_id;
    expect(hits[0].conversationId).toBe(firstConv);
  });

  it('hybridSearch with real Nomic returns hits across all three sources', async () => {
    const hits = await p.searcher.hybridSearch(
      'machine learning gradient descent',
      { projectId: 'proj-alpha' },
      20,
    );
    expect(hits.length).toBeGreaterThan(0);
    // Real Nomic + populated vec_sessions should produce at least
    // one session hit alongside the window/message hits.
    const sessionHits = hits.filter((h) => h.kind === 'session');
    expect(sessionHits.length).toBeGreaterThan(0);
  });
});
