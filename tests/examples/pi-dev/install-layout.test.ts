import { AssertionError } from 'node:assert';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const piDevRoot = resolve(import.meta.dirname, '../../../examples/pi-dev');

const copyReferenceLayout = (targetRoot: string): void => {
  cpSync(join(piDevRoot, 'shared'), join(targetRoot, '.pi/shared'), { recursive: true });
  cpSync(
    join(piDevRoot, 'extensions/jsonl-index'),
    join(targetRoot, '.pi/extensions/jsonl-index'),
    {
      recursive: true,
    },
  );
  cpSync(
    join(piDevRoot, 'extensions/search-memory'),
    join(targetRoot, '.pi/extensions/search-memory'),
    {
      recursive: true,
    },
  );
  cpSync(
    join(piDevRoot, 'extensions/privacy-input'),
    join(targetRoot, '.pi/extensions/privacy-input'),
    {
      recursive: true,
    },
  );
  cpSync(
    join(piDevRoot, 'extensions/session-relay'),
    join(targetRoot, '.pi/extensions/session-relay'),
    {
      recursive: true,
    },
  );
  cpSync(
    join(piDevRoot, 'skills/search-session-history'),
    join(targetRoot, '.pi/skills/search-session-history'),
    { recursive: true },
  );
};

const relativeImportPattern = /from ['"](\.{1,2}\/[^'"]+)['"]/g;

const resolveTypeScriptImport = (fromFile: string, specifier: string): string => {
  const basePath = resolve(dirname(fromFile), specifier);
  const candidates = extname(basePath) === '.js' ? [basePath.replace(/\.js$/, '.ts')] : [basePath];
  const resolved = candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  if (resolved === undefined) {
    throw new AssertionError({
      message: `Unable to resolve ${specifier} from ${fromFile}`,
    });
  }
  return resolved;
};

describe('Pi dev reference install layout', () => {
  it('keeps documented copied extension imports resolvable', () => {
    const targetRoot = mkdtempSync(join(tmpdir(), 'pristine-pi-dev-install-'));
    try {
      copyReferenceLayout(targetRoot);
      const extensionFiles = [
        join(targetRoot, '.pi/extensions/jsonl-index/index.ts'),
        join(targetRoot, '.pi/extensions/jsonl-index/lib/extension-runtime.ts'),
        join(targetRoot, '.pi/extensions/jsonl-index/lib/local-embedder.ts'),
        join(targetRoot, '.pi/extensions/jsonl-index/lib/source-index.ts'),
        join(targetRoot, '.pi/extensions/search-memory/index.ts'),
        join(targetRoot, '.pi/extensions/search-memory/lib/local-embedder.ts'),
        join(targetRoot, '.pi/extensions/search-memory/lib/vector-search.ts'),
        join(targetRoot, '.pi/extensions/privacy-input/index.ts'),
        join(targetRoot, '.pi/extensions/privacy-input/lib/runtime.ts'),
        join(targetRoot, '.pi/extensions/privacy-input/lib/classifier-adapter.ts'),
        join(targetRoot, '.pi/extensions/privacy-input/lib/pi-model-classifier-transport.ts'),
        join(targetRoot, '.pi/extensions/session-relay/index.ts'),
        join(targetRoot, '.pi/extensions/session-relay/lib/extension-runtime.ts'),
        join(targetRoot, '.pi/extensions/session-relay/lib/prior-session.ts'),
        join(targetRoot, '.pi/extensions/session-relay/lib/relay-generator.ts'),
        join(targetRoot, '.pi/extensions/session-relay/lib/session-store.ts'),
      ];

      const resolvedImports = extensionFiles.flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return [...source.matchAll(relativeImportPattern)].map((match) =>
          resolveTypeScriptImport(file, match[1]),
        );
      });

      expect(resolvedImports).toContain(join(targetRoot, '.pi/shared/lib/db-path.ts'));
      expect(resolvedImports).toContain(
        join(targetRoot, '.pi/shared/lib/pi-jsonl-index-schema.ts'),
      );
      expect(resolvedImports).toContain(join(targetRoot, '.pi/shared/lib/pi-jsonl-session.ts'));
      expect(resolvedImports).toContain(join(targetRoot, '.pi/shared/lib/session-relay-schema.ts'));
    } finally {
      rmSync(targetRoot, { recursive: true, force: true });
    }
  });

  it('documents session-relay install behavior and boundaries', () => {
    const readme = readFileSync(join(piDevRoot, 'README.md'), 'utf8');

    for (const requiredText of [
      'session-relay',
      'memory_sessions',
      "source_harness = 'pi'",
      'No-history behavior is a silent no-op',
      'does not require embeddings, `sqlite-vec`, `jsonl-index`, `search-memory`, or `pristine_recall`',
      'selects the latest prior `memory_sessions` row for the same `cwd`',
      'generates a fresh six-section relay (no cache)',
      'Pi receives a non-blocking warning',
      'Pi-first. Codex and Claude adapters are deferred',
      'Pass condition',
    ]) {
      expect(readme).toContain(requiredText);
    }
  });
});
