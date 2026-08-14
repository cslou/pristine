import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const verifier = resolve(repoRoot, 'scripts/verify-production-dependency-resolutions.mjs');

describe('production dependency resolutions', () => {
  it('uses the exact patched versions in workspace config, lockfile, and installed graph', () => {
    const result = spawnSync(process.execPath, [verifier], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('adm-zip@0.6.0');
    expect(result.stdout).toContain('protobufjs@7.6.5');
    expect(result.stdout).toContain('sharp@0.35.3');
  });
});
