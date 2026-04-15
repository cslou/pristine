/**
 * CLI script: store a conversation for background extraction.
 *
 * Reads conversation JSON from stdin, enqueues via createLite(), spawns
 * a detached extract-worker, and exits immediately (<0.5s).
 *
 * Usage:
 *   echo '{"messages":[...]}' | npx tsx scripts/store.ts --user-id <userId> [--db-path <path>]
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../src/core/database.js';
import { PristineLocal } from '../src/index.js';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export interface StoreArgs {
  readonly userId: string;
  readonly dbPath?: string;
}

export function parseStoreArgs(argv: string[]): StoreArgs {
  let userId: string | undefined;
  let dbPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--user-id' && i + 1 < argv.length) {
      userId = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--db-path' && i + 1 < argv.length) {
      dbPath = argv[i + 1];
      i += 1;
    }
  }

  if (!userId) {
    process.stderr.write('Usage: store.ts --user-id <userId> [--db-path <path>]\n');
    process.exit(1);
  }

  return { userId, dbPath };
}

// ---------------------------------------------------------------------------
// Stdin reader
// ---------------------------------------------------------------------------

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

// ---------------------------------------------------------------------------
// Worker spawner
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

export function spawnWorker(dbPath?: string): void {
  const workerScript = join(__dirname, 'extract-worker.ts');
  const args = ['tsx', workerScript];
  if (dbPath) {
    args.push('--db-path', dbPath);
  }

  const child = spawn('npx', args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<void> {
  const args = parseStoreArgs(argv);

  const raw = await readStdin();
  if (!raw) {
    process.stderr.write('Error: no input on stdin\n');
    process.exit(1);
  }

  let parsed: { messages: { role: string; content: string; timestamp?: string }[] };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    process.stderr.write('Error: invalid JSON on stdin\n');
    process.exit(1);
  }

  if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
    process.stderr.write('Error: stdin must contain {"messages": [...]}\n');
    process.exit(1);
  }

  const client = args.dbPath
    ? PristineLocal.createLite({ db: createDatabase(args.dbPath) })
    : PristineLocal.createLite();

  const taskId = client.storeAsync(parsed.messages, args.userId);

  if (taskId === '') {
    process.stdout.write(JSON.stringify({ status: 'duplicate', taskId: null }) + '\n');
  } else {
    process.stdout.write(JSON.stringify({ status: 'enqueued', taskId }) + '\n');
  }

  spawnWorker(args.dbPath);
}

// Entry point
main(process.argv.slice(2)).catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : 'unknown error';
  process.stderr.write(JSON.stringify({ error: msg }) + '\n');
  process.exit(1);
});
