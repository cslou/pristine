import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationStore } from '../../src/conversations/store.js';
import { createDatabase } from '../../src/core/database.js';
import type { Embedder } from '../../src/core/interfaces.js';
import { LocalEmbedder } from '../../src/embedder/local/index.js';
import { createEmbedTaskHandler, runEmbedWorker } from '../../src/memory/indexer/embed-worker.js';
import { createIndexer } from '../../src/memory/indexer/index.js';
import { createWindowWriter } from '../../src/memory/indexer/windows.js';
import { IngestQueue } from '../../src/queue/ingest-queue.js';

// ---------------------------------------------------------------------------
// Sprint-015 Story 7 — End-to-end integration tests
// ---------------------------------------------------------------------------
//
// Exercises the full Phase-3 pipeline (indexer → queue → embed-worker →
// vec_windows / window_messages / vec_sessions populated) at the surface
// sprint-016's searcher will read from. Uses a stubbed embedder for CI
// (deterministic vectors); a parallel suite gated by `SKIP_SLOW_TESTS`
// exercises the same flow against the real Nomic v1.5 model.
//
// The AC mentions `storeAsync` end-to-end, but per the Sprint-Level
// Technical Context `src/client.ts` stays untouched in sprint-015.
// `storeAsync` still calls the legacy conversation-level `enqueue`.
// Wiring `client.ts.storeAsync` to call `indexer.ingest` is sprint-016's
// concern. These integration tests therefore use `indexer.ingest`
// directly, which is the same path Story 6's worker drains against.

const skipSlow = process.env.SKIP_SLOW_TESTS === '1';

const makeMessages = (contents: string[]) =>
  contents.map((content, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content,
  }));

// Deterministic stub embedder that returns a 768-d vector keyed off the
// joined text length. Faster than the real model + suitable for CI.
const makeStubEmbedder = (): Embedder => ({
  embed: async (text: string): Promise<number[]> => {
    const seed = text.length / 1000;
    return Array.from({ length: 768 }, (_, i) => seed + i * 1e-4);
  },
  embedBatch: async (_texts: readonly string[]): Promise<number[][]> => {
    throw new Error('embedBatch not used in these integration tests');
  },
});

interface PipelineDeps {
  readonly db: ReturnType<typeof createDatabase>;
  readonly store: ConversationStore;
  readonly queue: IngestQueue;
  readonly indexer: ReturnType<typeof createIndexer>;
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

  return { db, store, queue, indexer };
};

describe('indexer end-to-end (stubbed embedder)', () => {
  let p: PipelineDeps;

  beforeEach(() => {
    p = buildPipeline(makeStubEmbedder());
  });

  afterEach(() => {
    p.db.close();
  });

  it('round-trips 3 conversations × 5 turns → expected vec_windows / window_messages / FTS counts', async () => {
    // For each of 3 conversations: pre-create the conversation row with
    // a seed message, then ingest 5 turns. The seed contributes to the
    // total message count (and therefore the windowing math).
    const ingestedCounts: Record<string, number> = {};
    const conversationIds: string[] = [];

    for (let c = 0; c < 3; c++) {
      const convId = p.store.addConversation(makeMessages([`seed-${c}`]), `user-${c}`);
      conversationIds.push(convId);
      const turns = makeMessages([`t0-${c}`, `t1-${c}`, `t2-${c}`, `t3-${c}`, `t4-${c}`]);
      const result = p.indexer.ingest(turns, { projectId: `proj-${c}`, conversationId: convId });
      ingestedCounts[convId] = result.messageIds.length;
    }

    const totalIngested = Object.values(ingestedCounts).reduce((a, b) => a + b, 0);
    expect(totalIngested).toBe(15); // 3 × 5

    const tasksProcessed = await runEmbedWorker(p.queue);
    // Each ingested message produces one embed task; seeds don't.
    expect(tasksProcessed).toBe(15);

    // Per conversation: 1 seed + 5 ingested = 6 messages. With windowSize=3,
    // overlap=1, stride=2: windows are [0..2], [2..4], [3..5] (tail-slid).
    // The worker only processes tasks for the 5 ingested messages
    // (sortOrders 1-5) — the seed (sort_order 0) has no task. Each task
    // re-runs the upsert on every window the message participates in:
    //   sort_order 1 (t0)  → window 0 [0..2]
    //   sort_order 2 (t1)  → windows 0 [0..2] and 1 [2..4]
    //   sort_order 3 (t2)  → windows 1 [2..4] and 2 [3..5]
    //   sort_order 4 (t3)  → windows 1 [2..4] and 2 [3..5]
    //   sort_order 5 (t4)  → window 2 [3..5]
    // → all 3 distinct windows are touched per conversation; idempotent
    // DELETE+INSERT in upsertWindow keeps the row count at 3.
    const windowsPerConv = 3;
    const expectedTotalWindows = 3 * windowsPerConv;
    const totalVecWindows = (
      p.db.prepare('SELECT COUNT(*) AS c FROM vec_windows').get() as { c: number }
    ).c;
    expect(totalVecWindows).toBe(expectedTotalWindows);

    // window_messages: each window has windowSize=3 message_id rows = 9
    // per conversation × 3 conversations = 27.
    const totalWindowMessages = (
      p.db.prepare('SELECT COUNT(*) AS c FROM window_messages').get() as { c: number }
    ).c;
    expect(totalWindowMessages).toBe(3 * 9);

    // FTS5 indexes EVERY message (seeds + ingested) via the AFTER INSERT
    // trigger from sprint-009. Total messages = 3 conversations × 6
    // messages each = 18.
    const totalMessages = (
      p.db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }
    ).c;
    expect(totalMessages).toBe(18);
    const totalFts = (p.db.prepare('SELECT COUNT(*) AS c FROM messages_fts').get() as { c: number })
      .c;
    expect(totalFts).toBe(totalMessages);

    // No tasks left in queue, none failed.
    const remainingTasks = (
      p.db
        .prepare(
          "SELECT COUNT(*) AS c FROM pending_ingest_tasks WHERE status IN ('pending', 'processing', 'failed')",
        )
        .get() as { c: number }
    ).c;
    expect(remainingTasks).toBe(0);
  });

  it('oversize round-trip: 12K-char prose turn → N chunks linked via parent_message_id', async () => {
    const conversationId = p.store.addConversation(makeMessages(['seed']), 'user-oversize');

    // 12K chars → 3000 tokens at the default 4-chars/token heuristic (=
    // OVERSIZE_TOKEN_THRESHOLD). Bump above threshold by going to ~13K.
    const oneParagraph = 'word '.repeat(220).trim(); // ~1100 chars per paragraph
    const paragraphs: string[] = [];
    for (let i = 0; i < 12; i++) paragraphs.push(`Paragraph ${i}: ${oneParagraph}`);
    const oversizeContent = paragraphs.join('\n\n');
    expect(oversizeContent.length).toBeGreaterThan(12000);

    const result = p.indexer.ingest([{ role: 'user', content: oversizeContent }], {
      projectId: 'proj-oversize',
      conversationId,
    });

    // result.messageIds[0] = parent (full content); rest = chunks.
    const parentId = result.messageIds[0];
    const chunkIds = result.messageIds.slice(1);
    expect(chunkIds.length).toBeGreaterThan(1);

    // Parent: parent_message_id = NULL; chunks: parent_message_id = parentId.
    // Hoist the prepared statement once and reuse it for the chunk loop —
    // avoids N+1 prepare() compilations.
    const parentRow = p.db
      .prepare('SELECT parent_message_id FROM messages WHERE id = ?')
      .get(parentId) as { parent_message_id: number | null };
    expect(parentRow.parent_message_id).toBeNull();
    const chunkParentStmt = p.db.prepare('SELECT parent_message_id FROM messages WHERE id = ?');
    for (const cid of chunkIds) {
      const row = chunkParentStmt.get(cid) as { parent_message_id: number | null };
      expect(row.parent_message_id).toBe(parentId);
    }

    // Only chunks get embed-message tasks; parent has none.
    expect(result.taskIds.length).toBe(chunkIds.length);
    const taskMessageIds = (
      p.db
        .prepare(
          "SELECT message_id FROM pending_ingest_tasks WHERE task_type = 'embed-message' AND conversation_id = ?",
        )
        .all(conversationId) as { message_id: number }[]
    ).map((r) => r.message_id);
    expect(taskMessageIds).not.toContain(parentId);

    // Drain — all chunks get embedded, contributing to vec_windows.
    const tasksProcessed = await runEmbedWorker(p.queue);
    expect(tasksProcessed).toBe(chunkIds.length);

    // Each chunk participates in window assembly; vec_windows is non-empty.
    const vecCount = (
      p.db
        .prepare('SELECT COUNT(*) AS c FROM vec_windows WHERE conversation_id = ?')
        .get(conversationId) as { c: number }
    ).c;
    expect(vecCount).toBeGreaterThan(0);

    // Phase-4 retrieval reverse-lookup: given a parent id, find all
    // chunks. Uses the `ix_messages_parent` index added in sprint-014
    // Story 1; this query exercises that index path directly (filters by
    // parent_message_id, not by primary key). Sorted both sides so the
    // assertion isn't implicitly coupled to the ingest's insertion-order
    // contract — ix_messages_parent is what's under test, not ordering.
    const chunkRows = p.db
      .prepare('SELECT id FROM messages WHERE parent_message_id = ?')
      .all(parentId) as { id: number }[];
    expect(chunkRows.map((r) => r.id).sort((a, b) => a - b)).toEqual(
      chunkIds.slice().sort((a, b) => a - b),
    );
  });

  it('crash-recovery round-trip: claim + backdate stale + drain → all complete', async () => {
    // Inline simulation of the "worker crashed mid-task" scenario.
    // Real-process-kill is out of scope (subprocess + in-memory DB don't
    // share state). The stale-claim reset path is the contract under test.
    const conversationId = p.store.addConversation(makeMessages(['seed']), 'user-crash');
    p.indexer.ingest(makeMessages(['t0', 't1', 't2', 't3', 't4']), {
      projectId: 'p',
      conversationId,
    });

    // Claim one task without processing → simulates crash before
    // markCompleted runs.
    const claimed = p.queue.claimNext();
    expect(claimed).not.toBeNull();
    const orphanId = claimed!.id;

    // Backdate started_at past the stale-claim threshold (30s) so the next
    // claimNext call's reset path picks it up.
    p.db
      .prepare(
        `UPDATE pending_ingest_tasks
         SET started_at = datetime('now', '-1 hour')
         WHERE id = ?`,
      )
      .run(orphanId);

    // Drain — stale-claim reset flips orphan back to pending, re-claims
    // it, processes normally → markCompleted. All 5 tasks end up
    // 'completed' regardless of which one was orphaned.
    const tasksProcessed = await runEmbedWorker(p.queue);
    expect(tasksProcessed).toBe(5);

    const completedCount = (
      p.db
        .prepare(
          "SELECT COUNT(*) AS c FROM pending_ingest_tasks WHERE status = 'completed' AND task_type = 'embed-message' AND conversation_id = ?",
        )
        .get(conversationId) as { c: number }
    ).c;
    expect(completedCount).toBe(5);

    const failedCount = (
      p.db
        .prepare("SELECT COUNT(*) AS c FROM pending_ingest_tasks WHERE status = 'failed'")
        .get() as { c: number }
    ).c;
    expect(failedCount).toBe(0);

    // The orphan task ended in 'completed' — no double-write to
    // vec_windows (upsertWindow's DELETE+INSERT is idempotent).
    const orphanFinalStatus = (
      p.db.prepare('SELECT status FROM pending_ingest_tasks WHERE id = ?').get(orphanId) as {
        status: string;
      }
    ).status;
    expect(orphanFinalStatus).toBe('completed');
  });

  it('does not import any LLM SDKs from any production source under src/', () => {
    // Static check: walk src/ and assert no .ts file imports a banned
    // module. The previous version of this test used `require.cache` to
    // enumerate runtime-loaded modules — that was a no-op in ESM
    // (require is undefined; require.cache resolves to undefined too,
    // and the `?? {}` fallback silenced the failure). A static AST check
    // is both more reliable and broader-coverage: it catches imports
    // that haven't been exercised by the test path.
    const banned = [
      '@anthropic-ai/sdk',
      'openai',
      '\\bpg\\b', // postgres driver, not part of bigger token
      '@supabase',
    ];
    const bannedPatterns = banned.map(
      (b) =>
        new RegExp(
          `from\\s+['"]${b.replace(/\\b/g, '')}['"]|require\\(['"]${b.replace(/\\b/g, '')}['"]\\)`,
        ),
    );

    // Anchor to the test file's location so the test doesn't depend on
    // process.cwd() — robust to vitest running from a subdirectory.
    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        // lstatSync (not statSync) — don't follow symlinks. Symlinks
        // inside src/ are unusual but a loop would crash the test with
        // a stack overflow, so just skip them.
        const stat = lstatSync(full);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith('.ts')) continue;
        const contents = readFileSync(full, 'utf8');
        for (let i = 0; i < banned.length; i++) {
          if (bannedPatterns[i].test(contents)) {
            offenders.push(`${full} imports banned module ${banned[i]}`);
          }
        }
      }
    };

    walk(srcRoot);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Real Nomic v1.5 variant — gated by SKIP_SLOW_TESTS
// ---------------------------------------------------------------------------

describe.skipIf(skipSlow)('indexer end-to-end (real Nomic v1.5)', () => {
  it('round-trips a single conversation through real embedder + worker drain', async () => {
    const embedder = new LocalEmbedder();
    try {
      const p = buildPipeline(embedder);
      try {
        const conversationId = p.store.addConversation(makeMessages(['hi']), 'user-real');
        p.indexer.ingest(makeMessages(['How was Tokyo?', 'Great, ate ramen']), {
          projectId: 'real',
          conversationId,
        });

        const tasksProcessed = await runEmbedWorker(p.queue);
        expect(tasksProcessed).toBe(2);

        const vecCount = (
          p.db
            .prepare('SELECT COUNT(*) AS c FROM vec_windows WHERE conversation_id = ?')
            .get(conversationId) as { c: number }
        ).c;
        expect(vecCount).toBeGreaterThan(0);

        // Real embedder produces normalized 768-d vectors.
        const vecRow = p.db
          .prepare(
            'SELECT embedding FROM vec_windows WHERE conversation_id = ? AND window_index = ?',
          )
          .get(conversationId, 0n) as { embedding: Buffer };
        const vec = new Float32Array(vecRow.embedding.buffer, vecRow.embedding.byteOffset, 768);
        const magnitude = Math.sqrt(Array.from(vec).reduce((s, v) => s + v * v, 0));
        expect(magnitude).toBeCloseTo(1, 1);
      } finally {
        p.db.close();
      }
    } finally {
      await embedder.dispose();
    }
  }, 300_000); // First-run downloads ~300 MB; default 15s would time out.
});
