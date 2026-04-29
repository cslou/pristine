/**
 * CLI script: store a conversation and enqueue per-message embed tasks.
 *
 * Reads conversation JSON from stdin, hands it to
 * `Pristine.create({...}).storeAsync(...)`, spawns a detached
 * embed-worker to drain the queue, and exits immediately. The
 * embedder + LLM clients construct lazily — no model load happens on
 * the synchronous path, so startup stays under the agent-integration
 * <0.5s budget.
 *
 * Usage:
 *   echo '{"messages":[...]}' | npx tsx scripts/store.ts --user-id <userId> [--db-path <path>]
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../src/core/database.js';
import { LocalEmbedder } from '../src/embedder/local/index.js';
import { PristineLocal } from '../src/index.js';
import type { Message } from '../src/core/types.js';

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
  const workerScript = join(__dirname, 'embed-worker.ts');
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

  // Pass-through DI keeps the synchronous-startup contract: LocalEmbedder
  // lazy-loads on first call (embed), not on construction.
  const db = args.dbPath ? createDatabase(args.dbPath) : undefined;
  const client = await PristineLocal.create({
    ...(db !== undefined ? { db } : {}),
    embedder: new LocalEmbedder(),
  });

  const messages: Message[] = parsed.messages.map((m) => ({
    role:
      m.role === 'system' || m.role === 'user' || m.role === 'assistant'
        ? (m.role as Message['role'])
        : 'user',
    content: m.content,
    ...(m.timestamp ? { timestamp: m.timestamp } : {}),
  }));

  let conversationId: string;
  try {
    conversationId = client.storeAsync(messages, args.userId);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(JSON.stringify({ error: msg }) + '\n');
    process.exit(1);
  }

  process.stdout.write(JSON.stringify({ status: 'stored', conversationId }) + '\n');

  spawnWorker(args.dbPath);
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
