import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { registerSessionRelayExtension } from '../../../examples/pi-dev/extensions/session-relay/index.js';
import {
  createPiSessionRelayRuntime,
  type PiSessionRelayContextLike,
} from '../../../examples/pi-dev/extensions/session-relay/lib/extension-runtime.js';
import { SqliteSessionMetadataStore } from '../../../examples/pi-dev/extensions/session-relay/lib/session-store.js';
import { MEMORY_SESSIONS_TABLE } from '../../../examples/pi-dev/shared/lib/session-relay-schema.js';

const fixturePath = 'tests/fixtures/pi-jsonl/mixed-session.jsonl';
const forbiddenSessionRelayDependencies = [
  '@huggingface/transformers',
  'sqlite-vec',
  'jsonl-index',
  'search-memory',
  'local-embedder',
];
const sessionRelaySourceFiles = [
  'examples/pi-dev/extensions/session-relay/index.ts',
  'examples/pi-dev/extensions/session-relay/lib/extension-runtime.ts',
  'examples/pi-dev/extensions/session-relay/lib/session-store.ts',
];

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'pristine-session-relay-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

const makeCtx = (sessionFile: string, notifications?: string[]): PiSessionRelayContextLike => ({
  sessionManager: {
    getSessionFile: () => sessionFile,
  },
  ui: {
    notify: (message, level) => notifications?.push(`${level ?? 'info'}:${message}`),
  },
});

const resolveTypeScriptImport = (fromFile: string, specifier: string): string => {
  const basePath = resolve(dirname(fromFile), specifier);
  const candidate = basePath.endsWith('.js') ? basePath.replace(/\.js$/, '.ts') : basePath;
  if (!statSync(candidate).isFile()) {
    throw new Error(`Unable to resolve ${specifier} from ${fromFile}`);
  }
  return candidate;
};

const collectLocalImportGraph = (
  entryPath: string,
  visited: Set<string> = new Set(),
): ReadonlyMap<string, string> => {
  const absolutePath = resolve(entryPath);
  if (visited.has(absolutePath)) return new Map();
  visited.add(absolutePath);

  const source = readFileSync(absolutePath, 'utf8');
  const graph = new Map<string, string>([[absolutePath, source]]);
  const importSpecifiers = [
    ...source.matchAll(/import(?:\s+type)?(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g),
    ...source.matchAll(/export(?:\s+type)?[\s\S]*?from\s+['"]([^'"]+)['"]/g),
  ]
    .map((match) => match[1])
    .filter(
      (specifier): specifier is string => specifier !== undefined && specifier.startsWith('.'),
    );

  for (const specifier of importSpecifiers) {
    const nestedGraph = collectLocalImportGraph(
      resolveTypeScriptImport(absolutePath, specifier),
      visited,
    );
    for (const [filePath, fileSource] of nestedGraph) graph.set(filePath, fileSource);
  }
  return graph;
};

describe('Pi session relay metadata extension reference', () => {
  it('records one memory_sessions row from visible Pi session metadata', async () => {
    const db = new Database(join(await makeTempDir(), 'pristine.db'));
    const store = new SqliteSessionMetadataStore({ db });
    const runtime = createPiSessionRelayRuntime({
      store,
      now: () => new Date('2026-05-06T10:00:09.000Z'),
    });

    const result = await runtime.recordActiveSession(makeCtx(fixturePath), 'agent_end');

    expect(result).toEqual({ ok: true, sessionFile: fixturePath, upserted: true });
    const row = db.prepare(`SELECT * FROM ${MEMORY_SESSIONS_TABLE}`).get() as
      | {
          readonly source_harness: string;
          readonly source_uri: string;
          readonly cwd: string;
          readonly first_message_at: string;
          readonly last_message_at: string;
          readonly visible_message_count: number;
          readonly updated_at: string;
        }
      | undefined;
    expect(row).toEqual({
      source_harness: 'pi',
      source_uri: fixturePath,
      cwd: '/Users/lou/projects/test-pristine',
      first_message_at: '2026-05-06T10:00:01.000Z',
      last_message_at: '2026-05-06T10:00:04.000Z',
      visible_message_count: 3,
      updated_at: '2026-05-06T10:00:09.000Z',
    });
  });

  it('upserts the same Pi session idempotently without duplicate rows', async () => {
    const db = new Database(join(await makeTempDir(), 'pristine.db'));
    const store = new SqliteSessionMetadataStore({ db });
    const runtime = createPiSessionRelayRuntime({
      store,
      now: () => new Date('2026-05-06T10:00:09.000Z'),
    });

    await runtime.recordActiveSession(makeCtx(fixturePath), 'agent_end');
    await runtime.recordActiveSession(makeCtx(fixturePath), 'session_start:resume');

    expect(db.prepare(`SELECT count(*) AS count FROM ${MEMORY_SESSIONS_TABLE}`).get()).toEqual({
      count: 1,
    });
    expect(
      db.prepare(`SELECT source_harness, source_uri FROM ${MEMORY_SESSIONS_TABLE}`).all(),
    ).toEqual([{ source_harness: 'pi', source_uri: fixturePath }]);
  });

  it('keeps session-relay independent from vector, embedder, and semantic search internals', () => {
    const importGraph = new Map<string, string>();
    for (const sourceFile of sessionRelaySourceFiles) {
      for (const [filePath, fileSource] of collectLocalImportGraph(sourceFile)) {
        importGraph.set(filePath, fileSource);
      }
    }

    for (const [filePath, source] of importGraph) {
      const relativePath = filePath.replace(`${process.cwd()}/`, '');
      expect(relativePath).not.toContain('extensions/jsonl-index');
      expect(relativePath).not.toContain('extensions/search-memory');
      for (const forbiddenDependency of forbiddenSessionRelayDependencies) {
        expect(source).not.toContain(forbiddenDependency);
      }
    }
  });

  it('registers metadata lifecycle handlers without requiring jsonl-index', async () => {
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void> | void>();
    const calls: string[] = [];
    registerSessionRelayExtension(
      {
        on: (event, handler) => handlers.set(event, handler),
      },
      () => ({
        recordActiveSession: async (_ctx, trigger) => {
          calls.push(trigger);
          return { ok: true, upserted: false };
        },
        close: () => calls.push('session_shutdown'),
      }),
    );

    await handlers.get('agent_end')?.({}, makeCtx(fixturePath));
    await handlers.get('session_start')?.({ reason: 'resume' }, makeCtx(fixturePath));
    handlers.get('session_shutdown')?.({}, makeCtx(fixturePath));

    expect(calls).toEqual(['agent_end', 'session_start:resume', 'session_shutdown']);
  });
});
