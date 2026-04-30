/**
 * Manual e2e smoke for sprint-016 storeAsync rewire.
 *
 * Drives the spec-005 Phase-3 indexer pipeline through the public SDK
 * surface — Pristine.create({...}).storeAsync(...) — exactly as a
 * downstream consumer would. Demonstrates the rewire shipped in
 * sprint-016 Story 1: storeAsync now composes addEmptyConversation +
 * indexer.ingest, the embed-worker drains the queue with the real Nomic
 * embedder, and vec_windows / window_messages / messages_fts populate
 * end-to-end.
 *
 * Replaces the sprint-015 indexer-direct smoke with the SDK-level path.
 *
 * Usage:
 *   npx tsx scripts/smoke-indexer.ts
 */
import { existsSync, rmSync } from 'node:fs';

import { PristineLocal } from '../src/client.js';
import { createDatabase } from '../src/core/database.js';
import { LocalEmbedder } from '../src/embedder/local/index.js';
import { buildSessionVector } from '../src/memory/indexer/session-vector.js';

const DB_PATH = '/tmp/pristine-smoke.db';

const log = (msg: string): void => {
  // eslint-disable-next-line no-console
  console.log(msg);
};

const main = async (): Promise<void> => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${DB_PATH}${suffix}`;
    if (existsSync(p)) rmSync(p);
  }
  log(`smoke: fresh DB at ${DB_PATH}`);

  const db = createDatabase({ path: DB_PATH, loadSqliteVec: true });
  const embedder = new LocalEmbedder();

  const client = await PristineLocal.create({
    db,
    embedder,
  });

  const userId = 'smoke-user';
  const projectId = 'smoke-project';
  const turns = [
    { role: 'user', content: 'turn one — talking about indexing' },
    { role: 'assistant', content: 'turn two — asking about retrieval' },
    { role: 'user', content: 'turn three — explaining sliding windows' },
    { role: 'assistant', content: 'turn four — clarifying the overlap' },
    { role: 'user', content: 'turn five — wrapping up' },
    { role: 'assistant', content: 'turn six — final answer' },
  ];

  const conversationId = client.storeAsync(turns, userId, projectId);
  log(`smoke: storeAsync → conversationId=${conversationId}`);
  log(`smoke: pending tasks before drain: ${client.pendingEmbedTasks}`);

  log('smoke: embed-worker draining (Nomic loads on first call — slow)...');
  const t0 = Date.now();
  const processed = await client.drainEmbedQueue();
  log(`smoke: embed-worker processed ${processed} task(s) in ${Date.now() - t0} ms`);

  // storeAsync does NOT auto-build the session vector (sprint-015 §5
  // Technical Notes: explicit consumer demand only). Build it inline so
  // the smoke captures the vec_sessions row count too — the same shape
  // sprint-016+ retrieval consumers will rely on.
  log('smoke: buildSessionVector ...');
  await buildSessionVector(db, embedder, conversationId);
  log('smoke: buildSessionVector → ok');

  const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  const counts = {
    messages: count('SELECT COUNT(*) AS n FROM messages'),
    vec_windows: count('SELECT COUNT(*) AS n FROM vec_windows'),
    window_messages: count('SELECT COUNT(*) AS n FROM window_messages'),
    vec_sessions: count('SELECT COUNT(*) AS n FROM vec_sessions'),
    messages_fts: count('SELECT COUNT(*) AS n FROM messages_fts'),
    completed_tasks: count(
      "SELECT COUNT(*) AS n FROM pending_ingest_tasks WHERE status = 'completed'",
    ),
    failed_tasks: count("SELECT COUNT(*) AS n FROM pending_ingest_tasks WHERE status = 'failed'"),
  };

  // Post-rewire counts: 6 turns → 6 messages, 6 embed tasks (one per
  // message, no seed). Window math unchanged (windowSize=3, overlap=1,
  // stride=2: windows [0..2], [2..4], [3..5] tail-slid → 3 windows ×
  // 3 messages each = 9 window_messages). Session vector built
  // explicitly above → 1 vec_sessions row.
  const expected = {
    messages: 6,
    vec_windows: 3,
    window_messages: 9,
    vec_sessions: 1,
    messages_fts: 6,
    completed_tasks: 6,
    failed_tasks: 0,
  };

  log('');
  log('smoke: populated-corpus counts (expected → actual):');
  let allOk = true;
  for (const [k, exp] of Object.entries(expected)) {
    const act = counts[k as keyof typeof counts];
    const ok = act === exp;
    if (!ok) allOk = false;
    log(`  ${ok ? 'OK ' : 'FAIL'}  ${k.padEnd(18)} ${String(exp).padStart(3)} → ${act}`);
  }

  // -------------------------------------------------------------------
  // Sprint-016 Story 2 — searcher.vectorSearch two-project leak check.
  // Seed a SECOND project with deliberately overlapping content; query
  // project-A; assert zero hits leak from project-B. Pins the
  // filter-first project-isolation contract end-to-end against the
  // real Nomic embedder (not just the stub used in unit tests).
  // -------------------------------------------------------------------
  log('');
  log('smoke: seeding second project for vectorSearch leak check ...');
  const otherProjectId = 'smoke-project-b';
  client.storeAsync(
    [
      { role: 'user', content: 'turn one — talking about indexing' },
      { role: 'assistant', content: 'turn two — asking about retrieval' },
      { role: 'user', content: 'turn three — explaining sliding windows' },
      { role: 'assistant', content: 'turn four — clarifying the overlap' },
    ],
    'smoke-user-b',
    otherProjectId,
  );
  const processedB = await client.drainEmbedQueue();
  log(`smoke: drained second project — ${processedB} tasks`);

  if (client.searcher === null) {
    log('smoke: FAIL — pristine.searcher is null on full client; should be exposed');
    process.exit(1);
  }
  const hitsA = await client.searcher.vectorSearch('sliding windows', { projectId }, 10);
  log(`smoke: vectorSearch in ${projectId} → ${hitsA.length} hits`);
  const stmt = db.prepare('SELECT project_id FROM conversations WHERE id = ?');
  let leaks = 0;
  for (const hit of hitsA) {
    const row = stmt.get(hit.conversationId) as { project_id: string } | undefined;
    if (row === undefined) {
      log(`smoke: FAIL — hit conversationId ${hit.conversationId} not found in DB`);
      leaks++;
      continue;
    }
    if (row.project_id !== projectId) leaks++;
  }
  const leakOk = leaks === 0;
  log(`  ${leakOk ? 'OK ' : 'FAIL'}  cross-project leak count   0 → ${leaks}`);
  if (!leakOk) allOk = false;

  // -------------------------------------------------------------------
  // Sprint-016 Story 3 — searcher.ftsSearch error-code lookup round-trip.
  // Seed a conversation containing a unique error-code-shaped string,
  // search for it via FTS5 phrase query, assert exactly one hit
  // belonging to the seeded conversation. Demonstrates literal-keyword
  // recall that would defeat semantic vector search.
  // -------------------------------------------------------------------
  log('');
  log('smoke: ftsSearch error-code lookup round-trip ...');
  const ftsConversationId = client.storeAsync(
    [
      { role: 'user', content: 'I hit error PRSTN-9001 on startup' },
      { role: 'assistant', content: 'That looks like a vault initialization problem' },
      { role: 'user', content: 'Should I delete my keystore?' },
      { role: 'assistant', content: 'No — try restarting first' },
    ],
    'smoke-user-fts',
    'smoke-project-fts',
  );
  await client.drainEmbedQueue();

  const ftsHits = await client.searcher.ftsSearch(
    '"PRSTN-9001"',
    { projectId: 'smoke-project-fts' },
    10,
  );
  log(`smoke: ftsSearch '"PRSTN-9001"' → ${ftsHits.length} hits`);
  const ftsOk = ftsHits.length === 1 && ftsHits[0].conversationId === ftsConversationId;
  log(`  ${ftsOk ? 'OK ' : 'FAIL'}  fts error-code recall      1 → ${ftsHits.length}`);
  if (ftsHits.length === 1) {
    log(`        score: ${ftsHits[0].score.toFixed(4)} (higher = more relevant)`);
    log(`        snippet: ${ftsHits[0].snippet ?? '<empty>'}`);
  }
  if (!ftsOk) allOk = false;

  // -------------------------------------------------------------------
  // Sprint-016 Story 4 — searcher.hybridSearch RRF fusion round-trip.
  // Query for "PRSTN-9001" — the literal error code — and observe both
  // the FTS leg (literal match on the user message) AND the vector
  // leg (topical match on the windows around the error) surface, then
  // get fused via RRF. Exercises end-to-end with real Nomic.
  // -------------------------------------------------------------------
  log('');
  log('smoke: hybridSearch RRF fusion round-trip ...');
  const hybridHits = await client.searcher.hybridSearch(
    '"PRSTN-9001"',
    { projectId: 'smoke-project-fts' },
    5,
  );
  log(`smoke: hybridSearch '"PRSTN-9001"' → ${hybridHits.length} hits`);
  for (const hit of hybridHits) {
    const kind =
      hit.kind === 'window'
        ? `window(${hit.windowIndex})`
        : hit.kind === 'message'
          ? `message(${hit.messageId})`
          : `session(${hit.conversationId.slice(0, 8)})`;
    log(`        ${kind} score=${hit.score.toFixed(4)} source=${hit.source}`);
  }
  const hybridOk = hybridHits.length >= 1;
  log(`  ${hybridOk ? 'OK ' : 'FAIL'}  hybrid hits >= 1            ≥1 → ${hybridHits.length}`);
  if (!hybridOk) allOk = false;

  // -------------------------------------------------------------------
  // Sprint-016 Story 5 — 3-source hybrid fan-out round-trip.
  // Build session vectors for all seeded conversations and re-run the
  // hybrid query — the session leg now contributes alongside vector
  // and FTS. Demonstrates cross-conversation reference recall (a
  // conversation thematically related but without strong per-window
  // matches still surfaces via its session vector).
  // -------------------------------------------------------------------
  log('');
  log('smoke: 3-source hybrid (session vectors built) ...');
  await buildSessionVector(db, embedder, conversationId);
  await buildSessionVector(db, embedder, ftsConversationId);
  log('smoke: built session vectors for both seeded conversations');

  const triHits = await client.searcher.hybridSearch('sliding windows', { projectId }, 10);
  log(`smoke: 3-source hybridSearch in ${projectId} → ${triHits.length} hits`);
  let sessionCount = 0;
  for (const hit of triHits) {
    const kind =
      hit.kind === 'window'
        ? `window(${hit.windowIndex})`
        : hit.kind === 'message'
          ? `message(${hit.messageId})`
          : `session(${hit.conversationId.slice(0, 8)})`;
    log(`        ${kind} score=${hit.score.toFixed(4)} source=${hit.source}`);
    if (hit.kind === 'session') sessionCount++;
  }
  const triOk = sessionCount >= 1;
  log(`  ${triOk ? 'OK ' : 'FAIL'}  session hits >= 1           ≥1 → ${sessionCount}`);
  if (!triOk) allOk = false;

  await client.dispose();

  if (!allOk) {
    log('');
    log('smoke: FAIL — actual counts diverged from expected');
    process.exit(1);
  }
  log('');
  log('smoke: PASS — storeAsync pipeline matches expected behavior');
};

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('smoke: failed:', err);
  process.exit(1);
});
