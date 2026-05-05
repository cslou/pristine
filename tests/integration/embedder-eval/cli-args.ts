import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
export const DEFAULT_REPORTS_DIR = join(REPO_ROOT, 'docs', 'research', 'embedder-eval-runs');

export interface ParsedArgs {
  readonly candidate: string;
  readonly baseline: string;
  readonly reportsDir: string;
}

const requireValue = (flag: string, idx: number, argv: readonly string[]): string => {
  const v = argv[idx];
  if (v === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return v;
};

/**
 * Parse the eval CLI arg list. `--candidate` is required; `--baseline`
 * defaults to `nomic-v1.5`; `--reports-dir` defaults to the in-tree
 * `docs/research/embedder-eval-runs/`. Each flag's value is required —
 * passing `--baseline` as the last token now throws rather than
 * silently keeping the default (the prior `?? default` behavior hid
 * mistyped invocations).
 */
export const parseArgs = (argv: readonly string[]): ParsedArgs => {
  let candidate: string | undefined;
  let baseline = 'nomic-v1.5';
  let reportsDir = DEFAULT_REPORTS_DIR;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--candidate') {
      candidate = requireValue('--candidate', ++i, argv);
    } else if (a === '--baseline') {
      baseline = requireValue('--baseline', ++i, argv);
    } else if (a === '--reports-dir') {
      reportsDir = requireValue('--reports-dir', ++i, argv);
    }
  }

  if (candidate === undefined) {
    throw new Error(
      'Usage: npx tsx tests/integration/embedder-eval/cli.ts --candidate <name> [--baseline nomic-v1.5] [--reports-dir <path>]',
    );
  }
  return { candidate, baseline, reportsDir };
};

/**
 * Confine `--reports-dir` to either the repo tree or the OS tmpdir.
 * Without this, a typo or hostile invocation could write files anywhere
 * the maintainer process can reach (`/etc/cron.d`, parent directories
 * via `..`, etc.). Both allowed roots are realpath-resolved and the
 * input is rejected if it escapes both.
 */
export const confineReportsDir = (input: string): string => {
  const resolved = resolve(input);
  const allowedRoots = [resolve(REPO_ROOT), resolve(tmpdir())];
  for (const root of allowedRoots) {
    if (resolved === root || resolved.startsWith(root + '/') || resolved.startsWith(root + '\\')) {
      return resolved;
    }
  }
  throw new Error(
    `--reports-dir must resolve under the repo tree or the OS tmpdir. Got: ${resolved}; allowed roots: ${allowedRoots.join(', ')}`,
  );
};
