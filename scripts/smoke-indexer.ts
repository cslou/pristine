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
import type { LlmClient } from '../src/core/interfaces.js';
import { runEmbedWorker } from '../src/memory/indexer/embed-worker.js';
import { buildSessionVector } from '../src/memory/indexer/session-vector.js';

const DB_PATH = '/tmp/pristine-smoke.db';

const log = (msg: string): void => {
  // eslint-disable-next-line no-console
  console.log(msg);
};

// Lazy-stub LlmClient — storeAsync does not exercise the LLM path, but
// Pristine.create requires LlmClients in its DI shape. The stub never
// gets called.
const stubLlmClient: LlmClient = {
  generate: (async () => {
    throw new Error('smoke: LlmClient.generate not exercised by storeAsync');
  }) as LlmClient['generate'],
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
    llmClients: { privacyClient: stubLlmClient, memoryClient: stubLlmClient },
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
  log(`smoke: pending tasks before drain: ${client.ingestQueue.pending}`);

  log('smoke: embed-worker draining (Nomic loads on first call — slow)...');
  const t0 = Date.now();
  const processed = await runEmbedWorker(client.ingestQueue);
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
