import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { PristineLocal } from '../../src/client.js';
import { createDatabase } from '../../src/core/database.js';
import type { Embedder } from '../../src/core/interfaces.js';

export const vector = (first: number, second = 0): number[] => [
  first,
  second,
  ...Array.from({ length: 766 }, () => 0),
];

const sourceChunkRowCount = (db: Database.Database, projectId = 'project-a'): number => {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM source_chunks WHERE project_id = ?')
    .get(projectId) as { count: number };
  return row.count;
};

const sourceVectorRowCount = (db: Database.Database, projectId = 'project-a'): number => {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM vec_source_chunks WHERE project_id = ?')
    .get(projectId) as { count: number };
  return row.count;
};

export const expectSourceIndexRowCounts = (
  db: Database.Database,
  expected: number,
  projectId = 'project-a',
): void => {
  expect(sourceChunkRowCount(db, projectId)).toBe(expected);
  expect(sourceVectorRowCount(db, projectId)).toBe(expected);
};

export const mockFetchResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  }) as Response;

const createMockEmbedder = (): Embedder & { dispose: ReturnType<typeof vi.fn> } => ({
  dim: 768,
  embed: vi.fn(async () => vector(1)),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => vector(Math.random()))),
  dispose: vi.fn(async () => undefined),
});

export const createSourceMemoryTestDeps = (): {
  db: Database.Database;
  embedder: Embedder & { dispose: ReturnType<typeof vi.fn> };
} => ({
  db: createDatabase(':memory:'),
  embedder: createMockEmbedder(),
});

export const withSourceMemoryClient = (): {
  getDeps: () => ReturnType<typeof createSourceMemoryTestDeps>;
} => {
  let deps: ReturnType<typeof createSourceMemoryTestDeps>;

  beforeEach(() => {
    deps = createSourceMemoryTestDeps();
  });

  afterEach(() => {
    deps.db.close();
  });

  return { getDeps: () => deps };
};

export const createClient = async (
  deps: ReturnType<typeof createSourceMemoryTestDeps>,
): Promise<PristineLocal> => PristineLocal.create({ db: deps.db, embedder: deps.embedder });
