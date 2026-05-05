import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
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
 * Realpath-resolve a path even if it doesn't yet exist — walk up the
 * tree until we hit an existing ancestor, realpath that, then re-attach
 * the missing tail. Without this, `realpathSync` on a not-yet-created
 * directory would throw ENOENT and the caller would have to mkdir-then-
 * realpath, with a TOCTOU race in between. Walking up + reattaching
 * gives a deterministic resolution that follows any symlinks above the
 * leaf without depending on the leaf existing.
 */
const realpathOfNearestAncestor = (input: string): string => {
  const absolute = resolve(input);
  if (existsSync(absolute)) {
    return realpathSync(absolute);
  }
  let cur = absolute;
  const tail: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) {
      // Reached filesystem root — should always exist; return the resolved
      // path even if the existsSync somehow missed it (defensive).
      return absolute;
    }
    // Use `basename` rather than `cur.slice(parent.length + 1)` because the
    // slice form is off-by-one when the parent is filesystem root (parent
    // is `/`, length 1, so slice(2) on `/foo` would yield `oo` instead of
    // `foo`). `basename` handles every parent-length case correctly.
    tail.unshift(basename(cur));
    cur = parent;
  }
  return join(realpathSync(cur), ...tail);
};

/**
 * Confine `--reports-dir` to either the repo tree or the OS tmpdir.
 * Without this, a typo or hostile invocation could write files anywhere
 * the maintainer process can reach (`/etc/cron.d`, parent directories
 * via `..`, symlinks pointing outside the allowed roots, etc.). Both
 * the input AND each allowed root are realpath-resolved before the
 * containment check so a symlink inside the allowed root pointing
 * outside cannot bypass the confinement.
 */
export const confineReportsDir = (input: string): string => {
  const resolved = realpathOfNearestAncestor(input);
  const allowedRoots = [realpathSync(REPO_ROOT), realpathSync(tmpdir())];
  for (const root of allowedRoots) {
    if (resolved === root || resolved.startsWith(root + '/') || resolved.startsWith(root + '\\')) {
      return resolved;
    }
  }
  throw new Error(
    `--reports-dir must resolve under the repo tree or the OS tmpdir. Got: ${resolved}; allowed roots: ${allowedRoots.join(', ')}`,
  );
};
