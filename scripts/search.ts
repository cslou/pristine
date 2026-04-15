/**
 * CLI script: search memory for relevant facts.
 *
 * Uses full PristineLocal (Ollama embedder + SQLite vector search).
 *
 * Usage:
 *   npx tsx scripts/search.ts --user-id <userId> --query <query>
 *     [--temporal-mode current|as_of|full] [--top-k <n>] [--db-path <path>]
 */
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../src/core/database.js';
import { PristineLocal } from '../src/index.js';
import type { SearchOptions } from '../src/core/types.js';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const VALID_TEMPORAL_MODES = new Set(['current', 'as_of', 'full']);

export interface SearchArgs {
  readonly userId: string;
  readonly query: string;
  readonly temporalMode?: 'current' | 'as_of' | 'full';
  readonly topK?: number;
  readonly dbPath?: string;
}

export function parseSearchArgs(argv: string[]): SearchArgs {
  let userId: string | undefined;
  let query: string | undefined;
  let temporalMode: string | undefined;
  let topK: number | undefined;
  let dbPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--user-id' && i + 1 < argv.length) {
      userId = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--query' && i + 1 < argv.length) {
      query = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--temporal-mode' && i + 1 < argv.length) {
      temporalMode = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--top-k' && i + 1 < argv.length) {
      topK = parseInt(argv[i + 1], 10);
      i += 1;
    } else if (argv[i] === '--db-path' && i + 1 < argv.length) {
      dbPath = argv[i + 1];
      i += 1;
    }
  }

  if (!userId || !query) {
    process.stderr.write(
      'Usage: search.ts --user-id <userId> --query <query> [--temporal-mode current|as_of|full] [--top-k <n>] [--db-path <path>]\n',
    );
    process.exit(1);
  }

  if (temporalMode && !VALID_TEMPORAL_MODES.has(temporalMode)) {
    process.stderr.write(
      `Error: --temporal-mode must be one of: current, as_of, full (got "${temporalMode}")\n`,
    );
    process.exit(1);
  }

  return {
    userId,
    query,
    temporalMode: temporalMode as SearchArgs['temporalMode'],
    topK: topK && !isNaN(topK) ? topK : undefined,
    dbPath,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<void> {
  const args = parseSearchArgs(argv);

  const client = args.dbPath
    ? await PristineLocal.create({ db: createDatabase(args.dbPath) })
    : await PristineLocal.create();

  try {
    const options: SearchOptions = {
      ...(args.topK ? { topK: args.topK } : {}),
      ...(args.temporalMode ? { temporalMode: args.temporalMode } : {}),
    };

    const result = await client.search(args.query, args.userId, options);
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    await client.dispose();
  }
}

// Entry point
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
