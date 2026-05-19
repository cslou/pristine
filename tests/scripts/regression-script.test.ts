import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const regressionScript = join(repoRoot, '.checks/regression.sh');
const preCommitScript = join(repoRoot, '.checks/pre-commit.sh');
const prePushScript = join(repoRoot, '.checks/pre-push.sh');
const preMergeScript = join(repoRoot, '.checks/pre-merge.sh');

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly log: readonly string[];
}

const createStubBin = (): {
  readonly binDir: string;
  readonly logPath: string;
  cleanup: () => void;
} => {
  const dir = mkdtempSync(join(tmpdir(), 'pristine-regression-test-'));
  const binDir = join(dir, 'bin');
  const logPath = join(dir, 'commands.log');
  writeFileSync(logPath, '');
  mkdirSync(binDir);

  writeFileSync(
    join(binDir, 'pnpm'),
    `#!/usr/bin/env bash
set -euo pipefail
echo "pnpm|$*|SKIP=\${SKIP_SLOW_TESTS:-}" >> "${logPath}"
if [[ "\${FAIL_PNPM_MATCH:-}" != "" && "$*" == *"\${FAIL_PNPM_MATCH}"* ]]; then
  exit 42
fi
exit 0
`,
  );
  writeFileSync(
    join(binDir, 'npx'),
    `#!/usr/bin/env bash
set -euo pipefail
echo "npx|$*|SKIP=\${SKIP_SLOW_TESTS:-}" >> "${logPath}"
exit 0
`,
  );
  writeFileSync(
    join(binDir, 'node'),
    `#!/usr/bin/env bash
set -euo pipefail
echo "node|$*|SKIP=\${SKIP_SLOW_TESTS:-}" >> "${logPath}"
exit 0
`,
  );
  chmodSync(join(binDir, 'pnpm'), 0o755);
  chmodSync(join(binDir, 'npx'), 0o755);
  chmodSync(join(binDir, 'node'), 0o755);

  return {
    binDir,
    logPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
};

const runWithStubs = (
  args: readonly string[],
  options: { readonly script?: string; readonly failPnpmMatch?: string } = {},
): RunResult => {
  const stub = createStubBin();
  try {
    const env = {
      ...process.env,
      PATH: `${stub.binDir}:${process.env.PATH ?? ''}`,
      SKIP_SLOW_TESTS: '',
      ...(options.failPnpmMatch === undefined ? {} : { FAIL_PNPM_MATCH: options.failPnpmMatch }),
    };
    const result = spawnSync(options.script ?? regressionScript, args, {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
    });
    const logText = readFileSync(stub.logPath, 'utf8').trim();
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      log: logText.length === 0 ? [] : logText.split('\n'),
    };
  } finally {
    stub.cleanup();
  }
};

describe('regression.sh tier contract', () => {
  it('rejects invalid tiers with exit code 2', () => {
    const result = runWithStubs(['--tier=not-a-tier']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Invalid tier: not-a-tier');
    expect(result.log).toEqual([]);
  });

  it('maps quick, standard, deep, and full tiers to the expected commands', () => {
    expect(runWithStubs(['--tier=quick']).log).toEqual([
      'pnpm|run lint|SKIP=',
      'pnpm|run typecheck|SKIP=',
    ]);

    expect(runWithStubs(['--tier=standard']).log).toEqual([
      'pnpm|run lint|SKIP=',
      'pnpm|run typecheck|SKIP=',
      'pnpm|run test:unit|SKIP=',
    ]);

    expect(runWithStubs(['--tier=deep']).log).toEqual([
      'pnpm|run lint|SKIP=',
      'pnpm|run typecheck|SKIP=',
      'pnpm|run test:unit|SKIP=',
      'pnpm|run build|SKIP=',
      'pnpm|run test:smoke|SKIP=',
      'pnpm|run test:integration|SKIP=1',
      'pnpm|run test:e2e|SKIP=',
    ]);

    expect(runWithStubs(['--tier=full']).log).toEqual([
      'pnpm|run lint|SKIP=',
      'pnpm|run typecheck|SKIP=',
      'pnpm|run test:unit|SKIP=',
      'pnpm|run build|SKIP=',
      'pnpm|run test:smoke|SKIP=',
      'pnpm|run test:integration|SKIP=1',
      'pnpm|run test:e2e|SKIP=',
      'pnpm|run test:integration|SKIP=',
      'pnpm|run test:smoke:local-model|SKIP=',
    ]);
  });

  it('reports routine as intentionally empty without running commands', () => {
    const result = runWithStubs(['--tier=routine']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Routine checks: none configured');
    expect(result.stdout).toContain('Regression status: yellow');
    expect(result.stdout).toContain('Regression score: 3/5');
    expect(result.log).toEqual([]);
  });

  it('propagates command failures through a red regression report', () => {
    const result = runWithStubs(['--tier=standard'], { failPnpmMatch: 'run typecheck' });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Regression status: red');
    expect(result.stdout).toContain('FAIL | Static / local checks | typecheck');
  });

  it('pre-* wrappers delegate to the configured regression tiers', () => {
    expect(runWithStubs([], { script: preCommitScript }).log).toEqual([
      'pnpm|run lint|SKIP=',
      'pnpm|run typecheck|SKIP=',
    ]);
    expect(runWithStubs([], { script: prePushScript }).log).toEqual([
      'pnpm|run lint|SKIP=',
      'pnpm|run typecheck|SKIP=',
      'pnpm|run test:unit|SKIP=',
    ]);
    expect(runWithStubs([], { script: preMergeScript }).log).toEqual([
      'pnpm|run lint|SKIP=',
      'pnpm|run typecheck|SKIP=',
      'pnpm|run test:unit|SKIP=',
      'pnpm|run build|SKIP=',
      'pnpm|run test:smoke|SKIP=',
      'pnpm|run test:integration|SKIP=1',
      'pnpm|run test:e2e|SKIP=',
    ]);
  });
});
