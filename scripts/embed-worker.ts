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
 *   npx tsx scripts/embed-worker.ts [--db-path <path>]
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
}

const parseArgs = (argv: string[]): EmbedWorkerArgs => {
  let dbPath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db-path' && i + 1 < argv.length) {
      dbPath = argv[i + 1];
      i += 1;
    }
  }
  return { dbPath };
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
  const tempQueue = new IngestQueue({ db, orchestrator: null, conversationStore });
  const indexer = createIndexer({
    db,
    conversationStore,
    ingestQueue: tempQueue,
  });
  const config = indexer.config;

  const queue = new IngestQueue({
    db,
    orchestrator: null,
    conversationStore,
    embedTaskHandler: createEmbedTaskHandler({
      db,
      embedder,
      windowWriter,
      config,
    }),
  });

  const processed = await runEmbedWorker(queue);
  // eslint-disable-next-line no-console
  console.log(`embed-worker: processed ${processed} task(s); idle, exiting.`);
  db.close();
};

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('embed-worker failed:', err);
  process.exit(1);
});
