/**
 * CLI script: search conversations by keyword, date range, or user.
 *
 * Uses createLite() — pure SQL, no Ollama. Exits in <0.5s.
 *
 * Usage:
 *   npx tsx scripts/search-conversations.ts --user-id <userId>
 *     [--keyword <keyword>] [--date-from <ISO>] [--date-to <ISO>]
 *     [--limit <n>] [--db-path <path>]
 */
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../src/core/database.js';
import { PristineLocal } from '../src/index.js';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export interface SearchConversationsArgs {
  readonly userId: string;
  readonly keyword?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly limit?: number;
  readonly dbPath?: string;
}

export function parseSearchConversationsArgs(argv: string[]): SearchConversationsArgs {
  let userId: string | undefined;
  let keyword: string | undefined;
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  let limit: number | undefined;
  let dbPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--user-id' && i + 1 < argv.length) {
      userId = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--keyword' && i + 1 < argv.length) {
      keyword = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--date-from' && i + 1 < argv.length) {
      dateFrom = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--date-to' && i + 1 < argv.length) {
      dateTo = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--limit' && i + 1 < argv.length) {
      limit = parseInt(argv[i + 1], 10);
      i += 1;
    } else if (argv[i] === '--db-path' && i + 1 < argv.length) {
      dbPath = argv[i + 1];
      i += 1;
    }
  }

  if (!userId) {
    process.stderr.write(
      'Usage: search-conversations.ts --user-id <userId> [--keyword <keyword>] [--date-from <ISO>] [--date-to <ISO>] [--limit <n>] [--db-path <path>]\n',
    );
    process.exit(1);
  }

  return {
    userId,
    keyword,
    dateFrom,
    dateTo,
    limit: limit !== undefined && !isNaN(limit) && limit > 0 ? limit : undefined,
    dbPath,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function main(argv: string[]): void {
  const args = parseSearchConversationsArgs(argv);

  const client = args.dbPath
    ? PristineLocal.createLite({ db: createDatabase(args.dbPath) })
    : PristineLocal.createLite();

  const results = client.searchConversations({
    userId: args.userId,
    keyword: args.keyword,
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
    limit: args.limit,
  });

  process.stdout.write(JSON.stringify({ conversations: results }) + '\n');
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
