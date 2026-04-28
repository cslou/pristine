/**
 * CLI script: drain pending embed-message tasks.
 *
 * Wires together the spec-005 Phase-3 dependencies (db, embedder, store,
 * indexer config, IngestQueue with embedTaskHandler) and runs
 * `runEmbedWorker` until the queue is empty. Self-terminates on idle.
 *
 * Replaces sprint-013's deleted `extract-worker.ts` (orchestrator-based);
 * the new shape consumes embed-message tasks the indexer (Story 2)
 * enqueues per inserted message.
 *
 * Usage:
 *   npx tsx scripts/embed-worker.ts [--db-path <path>] [--once]
 *
 * `--once` is a no-op alias today: the script ALREADY drains-and-exits
 * (idle = exit). The flag is accepted for explicitness — consumers
 * scripting `--once` get the documented one-shot semantics they'd
 * otherwise have to infer. Sprint-018 Story 2 added the alias as the
 * verification mechanism for `client.drainEmbedQueue` (the SDK
 * passthrough) and to leave room for a future `--watch` mode where
 * `--once` becomes the inverse.
 */
import { ConversationStore } from '../src/conversations/store.js';
import { createDatabase } from '../src/core/database.js';
import { LocalEmbedder } from '../src/embedder/local/index.js';
import {
  createEmbedTaskHandler,
  runEmbedWorker,
} from '../src/memory/indexer/embed-worker.js';
import { createIndexer } from '../src/memory/indexer/index.js';
import { createWindowWriter } from '../src/memory/indexer/windows.js';
import { IngestQueue } from '../src/queue/ingest-queue.js';

interface EmbedWorkerArgs {
  readonly dbPath?: string;
  readonly once: boolean;
}

const parseArgs = (argv: string[]): EmbedWorkerArgs => {
  let dbPath: string | undefined;
  let once = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db-path' && i + 1 < argv.length) {
      dbPath = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--once') {
      // No-op alias — script default IS one-shot. See file header.
      once = true;
    }
  }
  return { dbPath, once };
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  const db = createDatabase({
    ...(args.dbPath !== undefined ? { path: args.dbPath } : {}),
    loadSqliteVec: true,
  });

  const conversationStore = new ConversationStore(db);
  const embedder = new LocalEmbedder();
  const windowWriter = createWindowWriter(db);

  // Indexer's resolved config (defaults: windowSize=3, windowOverlap=1).
  // Constructed solely to read the resolved config — we don't ingest here.
  const tempQueue = new IngestQueue({ db });
  const indexer = createIndexer({
    db,
    conversationStore,
    ingestQueue: tempQueue,
  });
  const config = indexer.config;

  const queue = new IngestQueue({
    db,
    embedTaskHandler: createEmbedTaskHandler({
      db,
      embedder,
      windowWriter,
      config,
    }),
  });

  const processed = await runEmbedWorker(queue);
  // eslint-disable-next-line no-console
  console.log(
    `embed-worker: processed ${processed} task(s); idle, exiting${args.once ? ' (--once)' : ''}.`,
  );
  db.close();
};

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('embed-worker failed:', err);
  process.exit(1);
});
