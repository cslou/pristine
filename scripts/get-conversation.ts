/**
 * CLI script: retrieve a full conversation by ID.
 *
 * Uses createLite() — pure SQL, no Ollama. Exits in <0.5s.
 *
 * Usage:
 *   npx tsx scripts/get-conversation.ts <conversationId> [--db-path <path>]
 */
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../src/core/database.js';
import { PristineLocal } from '../src/index.js';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export interface GetConversationArgs {
  readonly conversationId: string;
  readonly dbPath?: string;
}

export function parseGetConversationArgs(argv: string[]): GetConversationArgs {
  let conversationId: string | undefined;
  let dbPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db-path' && i + 1 < argv.length) {
      dbPath = argv[i + 1];
      i += 1;
    } else if (!argv[i].startsWith('--')) {
      conversationId = argv[i];
    }
  }

  if (!conversationId) {
    process.stderr.write('Usage: get-conversation.ts <conversationId> [--db-path <path>]\n');
    process.exit(1);
  }

  return { conversationId, dbPath };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function main(argv: string[]): void {
  const args = parseGetConversationArgs(argv);

  const client = args.dbPath
    ? PristineLocal.createLite({ db: createDatabase(args.dbPath) })
    : PristineLocal.createLite();

  const conversation = client.getConversation(args.conversationId);

  if (!conversation) {
    process.stderr.write(`Error: conversation "${args.conversationId}" not found\n`);
    process.exit(1);
  }

  process.stdout.write(JSON.stringify(conversation) + '\n');
}

// Entry point
const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/^.*[\\/]/, ''));

if (isDirectRun) {
  try {
    main(process.argv.slice(2));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(JSON.stringify({ error: msg }) + '\n');
    process.exit(1);
  }
}
