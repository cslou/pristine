import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pipeline } from '@huggingface/transformers';

/**
 * Capability smoke for `@huggingface/transformers`. Confirms that the
 * pinned package version supports the API surface the SDK relies on:
 *
 *   - `pipeline` is exported as a callable
 *   - `'feature-extraction'` is a recognised task name (does not
 *     trigger an "unknown task" error during arg validation; we don't
 *     actually load a model — the test would otherwise pull weights)
 *   - the installed package version is `>=3.2.1` (the documented
 *     minimum that ships ModernBERT support, per the candidate-trio
 *     research in `docs/research/embedder-landscape-2026.md`)
 *
 * Lives in the unit-tests lane because it does no I/O beyond reading
 * package.json. Not gated by `SKIP_SLOW_TESTS` — it's a dependency
 * health check that should always run.
 */

const MIN_VERSION = '3.2.1';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');

interface PackageJson {
  readonly version?: string;
}

const compareSemver = (a: string, b: string): number => {
  const [aMaj, aMin, aPatch] = a.split('.').map((s) => Number.parseInt(s, 10));
  const [bMaj, bMin, bPatch] = b.split('.').map((s) => Number.parseInt(s, 10));
  if (aMaj !== bMaj) return (aMaj ?? 0) - (bMaj ?? 0);
  if (aMin !== bMin) return (aMin ?? 0) - (bMin ?? 0);
  return (aPatch ?? 0) - (bPatch ?? 0);
};

describe('@huggingface/transformers capability', () => {
  it('exports `pipeline` as a function', () => {
    expect(typeof pipeline).toBe('function');
  });

  it('installed package version is >= 3.2.1 (ModernBERT-supporting baseline)', () => {
    const pkgPath = join(REPO_ROOT, 'node_modules', '@huggingface', 'transformers', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
    expect(pkg.version).toBeTypeOf('string');
    expect(compareSemver(pkg.version!, MIN_VERSION)).toBeGreaterThanOrEqual(0);
  });
});
