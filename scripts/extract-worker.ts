/**
 * CLI script: background extraction worker.
 *
 * Polls the ingest queue, claims pending tasks, and runs the full
 * extraction pipeline via Ollama. Self-terminates after 30s idle.
 *
 * Usage:
 *   npx tsx scripts/extract-worker.ts [--db-path <path>] [--all] [--retry-failed]
 */
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';
import { createDatabase } from '../src/core/database.js';
import { PristineLocal } from '../src/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 2000;
const IDLE_TIMEOUT_MS = 30_000;
const QUEUE_THRESHOLDS = [10, 50, 100];

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export interface WorkerArgs {
  readonly dbPath?: string;
  readonly all: boolean;
  readonly retryFailed: boolean;
}

export function parseWorkerArgs(argv: string[]): WorkerArgs {
  let dbPath: string | undefined;
  let all = false;
  let retryFailed = false;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db-path' && i + 1 < argv.length) {
      dbPath = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--all') {
      all = true;
    } else if (argv[i] === '--retry-failed') {
      retryFailed = true;
    }
  }

  return { dbPath, all, retryFailed };
}

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------

export async function runWorker(
  client: PristineLocal,
  args: WorkerArgs,
): Promise<{ processed: number }> {
  const limit = pLimit(1);

  if (args.retryFailed) {
    client.ingestQueue.resetFailed();
  }

  let processed = 0;
  let lastActivityAt = Date.now();
  let lastWarningThreshold = 0;

  const logQueueDepth = (pending: number): void => {
    // Find the highest threshold that is exceeded
    let highest = 0;
    for (const threshold of QUEUE_THRESHOLDS) {
      if (pending >= threshold) {
        highest = threshold;
      }
    }
    // Only warn if we crossed into a new (higher) threshold band
    if (highest > lastWarningThreshold) {
      process.stderr.write(`[extract-worker] Warning: ${pending} tasks pending in queue\n`);
      lastWarningThreshold = highest;
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const task = await limit(() => client.ingestQueue.processNext());

    if (task) {
      processed += 1;
      lastActivityAt = Date.now();

      const pending = client.ingestQueue.pending;
      logQueueDepth(pending);

      continue;
    }

    // No task claimed
    if (args.all) {
      break;
    }

    const idleMs = Date.now() - lastActivityAt;
    if (idleMs >= IDLE_TIMEOUT_MS) {
      break;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }

  return { processed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<void> {
  const args = parseWorkerArgs(argv);

  const client = args.dbPath
    ? await PristineLocal.create({ db: createDatabase(args.dbPath) })
    : await PristineLocal.create();

  try {
    const result = await runWorker(client, args);
    process.stdout.write(JSON.stringify({ status: 'done', ...result }) + '\n');
  } finally {
    await client.dispose();
  }
}

// Entry point — only runs when executed directly (not when imported by tests)
const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/^.*[\\/]/, ''));

if (isDirectRun) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(JSON.stringify({ error: msg }) + '\n');
    process.exit(1);
  });
}
