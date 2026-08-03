import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../../src/core/database.js';
import { InvalidArgumentError } from '../../../src/core/errors.js';
import {
  SOURCE_CHUNK_METADATA_JSON_LIMIT,
  SOURCE_CHUNK_TEXT_LIMIT,
  SourceChunkStore,
} from '../../../src/memory/source-index/index.js';
import type { StoredSourceChunk } from '../../../src/memory/source-index/index.js';

const testEmbedding = Array.from({ length: 64 }, (_, index) => index / 100);
const vector64 = (first: number, second = 0): number[] => [
  first,
  second,
  ...Array.from({ length: 62 }, () => 0),
];

const readTableSql = (db: ReturnType<typeof createDatabase>, tableName: string): string => {
  const row = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(tableName) as
    | { sql: string }
    | undefined;
  if (row === undefined) throw new Error(`missing table ${tableName}`);
  return row.sql;
};

const sourceChunkRowCount = (
  db: ReturnType<typeof createDatabase>,
  projectId = 'project-a',
): number => {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM source_chunks WHERE project_id = ?')
    .get(projectId) as { count: number };
  return row.count;
};

const sourceVectorRowCount = (
  db: ReturnType<typeof createDatabase>,
  projectId = 'project-a',
): number => {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM vec_source_chunks WHERE project_id = ?')
    .get(projectId) as { count: number };
  return row.count;
};

const expectSourceIndexRowCounts = (
  db: ReturnType<typeof createDatabase>,
  expected: number,
  projectId = 'project-a',
): void => {
  expect(sourceChunkRowCount(db, projectId)).toBe(expected);
  expect(sourceVectorRowCount(db, projectId)).toBe(expected);
};

describe('SourceChunkStore schema', () => {
  it('persists source and vector rows across file-backed database reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pristine-source-index-'));
    const dbPath = join(dir, 'source-index.db');

    try {
      const db = createDatabase({ path: dbPath, loadSqliteVec: true, runIntegrityCheck: false });
      const store = new SourceChunkStore(db, 64);
      store.put(
        { text: 'durable source pointer', chunkId: 'durable-1', sourceUri: '/tmp/source.jsonl' },
        { projectId: 'project-a', embedding: testEmbedding },
      );
      db.close();

      const reopened = createDatabase({
        path: dbPath,
        loadSqliteVec: true,
        runIntegrityCheck: false,
      });
      const reopenedStore = new SourceChunkStore(reopened, 64);

      expect(
        reopened
          .prepare(
            'SELECT text, source_uri FROM source_chunks WHERE project_id = ? AND chunk_id = ?',
          )
          .get('project-a', 'durable-1'),
      ).toEqual({ text: 'durable source pointer', source_uri: '/tmp/source.jsonl' });
      expect(
        reopened
          .prepare('SELECT chunk_id FROM vec_source_chunks WHERE project_id = ? AND chunk_id = ?')
          .get('project-a', 'durable-1'),
      ).toEqual({ chunk_id: 'durable-1' });
      expect(
        reopenedStore.search(testEmbedding, { projectId: 'project-a', limit: 1 })[0],
      ).toMatchObject({
        chunk: { chunkId: 'durable-1', projectId: 'project-a' },
      });
      reopened.close();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('creates source chunk tables with configured vector dimension and nullable metadata columns', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    new SourceChunkStore(db, 1024);

    expect(readTableSql(db, 'vec_source_chunks')).toContain('embedding float[1024]');
    const chunksDdl = readTableSql(db, 'source_chunks');
    expect(chunksDdl).toContain('source_kind TEXT');
    expect(chunksDdl).toContain('source_uri TEXT');
    expect(chunksDdl).toContain('entry_id TEXT');
    expect(chunksDdl).toContain('metadata_json TEXT');
  });

  it('rejects invalid vector dimensions before DDL interpolation without dropping existing tables', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    db.exec(
      'CREATE TABLE source_chunks (chunk_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, text TEXT NOT NULL);',
    );

    expect(() => new SourceChunkStore(db, 8192)).toThrow(InvalidArgumentError);
    expect(readTableSql(db, 'source_chunks')).toContain('chunk_id TEXT PRIMARY KEY');
  });

  it('rejects existing source-index vector tables with a mismatched dimension without dropping schema', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    new SourceChunkStore(db, 64);

    expect(() => new SourceChunkStore(db, 128)).toThrow(InvalidArgumentError);
    expect(readTableSql(db, 'source_chunks')).toContain('PRIMARY KEY (project_id, chunk_id)');
    expect(readTableSql(db, 'vec_source_chunks')).toContain('embedding float[64]');
  });

  it('rejects file-backed source-index reopen with mismatched dimension without dropping schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pristine-source-index-dim-'));
    const dbPath = join(dir, 'source-index.db');

    try {
      const db = createDatabase({ path: dbPath, loadSqliteVec: true, runIntegrityCheck: false });
      new SourceChunkStore(db, 64).put(
        { text: 'dimension mismatch persists', chunkId: 'dim-1' },
        { projectId: 'project-a', embedding: testEmbedding },
      );
      db.close();

      const reopened = createDatabase({
        path: dbPath,
        loadSqliteVec: true,
        runIntegrityCheck: false,
      });
      expect(() => new SourceChunkStore(reopened, 128)).toThrow(
        /configured embedder dim=128.*float\[64\]/,
      );
      expect(readTableSql(reopened, 'source_chunks')).toContain(
        'PRIMARY KEY (project_id, chunk_id)',
      );
      expect(readTableSql(reopened, 'vec_source_chunks')).toContain('embedding float[64]');
      expect(
        reopened
          .prepare('SELECT chunk_id FROM source_chunks WHERE project_id = ? AND chunk_id = ?')
          .get('project-a', 'dim-1'),
      ).toEqual({ chunk_id: 'dim-1' });
      reopened.close();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects compatible-key source_chunks tables missing current pointer columns before writes', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    db.exec(`
      CREATE TABLE source_chunks (
        project_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, chunk_id)
      );
    `);

    expect(() => new SourceChunkStore(db, 64)).toThrow(
      /source_chunks.*missing columns.*source_kind/,
    );
    expect(readTableSql(db, 'source_chunks')).toContain('PRIMARY KEY (project_id, chunk_id)');
  });

  it('rejects vec_source_chunks tables missing project/chunk columns before writes', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    db.exec(`
      CREATE TABLE source_chunks (
        project_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        text TEXT NOT NULL,
        source_kind TEXT,
        source_uri TEXT,
        entry_id TEXT,
        parent_id TEXT,
        line_number INTEGER,
        line_start INTEGER,
        line_end INTEGER,
        timestamp TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, chunk_id)
      );
      CREATE VIRTUAL TABLE vec_source_chunks USING vec0(
        chunk_key TEXT PRIMARY KEY,
        embedding float[64]
      );
    `);

    expect(() => new SourceChunkStore(db, 64)).toThrow(
      /vec_source_chunks.*missing columns.*project_id.*chunk_id/,
    );
    expect(readTableSql(db, 'vec_source_chunks')).toContain('chunk_key TEXT PRIMARY KEY');
  });

  it('rejects non-vec0 vec_source_chunks tables before search can fail later', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    db.exec(`
      CREATE TABLE source_chunks (
        project_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        text TEXT NOT NULL,
        source_kind TEXT,
        source_uri TEXT,
        entry_id TEXT,
        parent_id TEXT,
        line_number INTEGER,
        line_start INTEGER,
        line_end INTEGER,
        timestamp TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, chunk_id)
      );
      CREATE TABLE vec_source_chunks (
        chunk_key TEXT PRIMARY KEY,
        project_id TEXT,
        chunk_id TEXT,
        embedding float[64]
      );
    `);

    expect(() => new SourceChunkStore(db, 64)).toThrow(/not a sqlite-vec virtual table/);
    expect(readTableSql(db, 'vec_source_chunks')).toContain('embedding float[64]');
  });

  it('rejects malformed vec_source_chunks DDL missing embedding dimension', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    db.exec(`
      CREATE TABLE source_chunks (
        project_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        text TEXT NOT NULL,
        source_kind TEXT,
        source_uri TEXT,
        entry_id TEXT,
        parent_id TEXT,
        line_number INTEGER,
        line_start INTEGER,
        line_end INTEGER,
        timestamp TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, chunk_id)
      );
      CREATE TABLE vec_source_chunks (
        chunk_key TEXT PRIMARY KEY,
        project_id TEXT,
        chunk_id TEXT
      );
    `);

    expect(() => new SourceChunkStore(db, 64)).toThrow(/missing embedding float\[N\]/);
    expect(readTableSql(db, 'vec_source_chunks')).toContain('chunk_key TEXT PRIMARY KEY');
  });

  it('rejects incompatible draft source-index tables with mismatched vectors without dropping schema', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    db.exec(`
      CREATE TABLE source_chunks (
        chunk_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        text TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE vec_source_chunks USING vec0(
        chunk_id TEXT PRIMARY KEY,
        project_id TEXT,
        embedding float[64]
      );
    `);

    expect(() => new SourceChunkStore(db, 128)).toThrow(/configured embedder dim=128.*float\[64\]/);
    expect(readTableSql(db, 'source_chunks')).toContain('chunk_id TEXT PRIMARY KEY');
    expect(readTableSql(db, 'vec_source_chunks')).toContain('embedding float[64]');
  });

  it('rebuilds incompatible draft source-index tables on init', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    db.exec(`
      CREATE TABLE source_chunks (
        chunk_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        text TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE vec_source_chunks USING vec0(
        chunk_id TEXT PRIMARY KEY,
        project_id TEXT,
        embedding float[64]
      );
    `);

    new SourceChunkStore(db, 64);

    expect(readTableSql(db, 'source_chunks')).toContain('PRIMARY KEY (project_id, chunk_id)');
    expect(readTableSql(db, 'vec_source_chunks')).toContain('chunk_key TEXT PRIMARY KEY');
  });
});

describe('SourceChunkStore validation and storage', () => {
  it('stores full source pointer metadata', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);

    const stored = store.put(
      {
        text: 'remember sqlite-vec source pointer architecture',
        chunkId: 'chunk-full',
        sourceKind: 'pi-jsonl',
        sourceUri: '/tmp/session.jsonl',
        entryId: 'entry-1',
        parentId: 'parent-1',
        lineNumber: 12,
        lineStart: 10,
        lineEnd: 14,
        timestamp: '2026-05-08T00:00:00.000Z',
        metadata: {
          cwd: '/tmp/project',
          branch: 'main',
          observedAt: new Date('2026-05-08T00:00:00.000Z'),
          observedAgain: new Date('2026-05-08T00:00:00.000Z'),
        },
      },
      { projectId: 'project-a', embedding: testEmbedding },
    );

    expect(stored).toMatchObject({
      chunkId: 'chunk-full',
      projectId: 'project-a',
      sourceKind: 'pi-jsonl',
      sourceUri: '/tmp/session.jsonl',
      entryId: 'entry-1',
      parentId: 'parent-1',
      lineNumber: 12,
      lineStart: 10,
      lineEnd: 14,
      timestamp: '2026-05-08T00:00:00.000Z',
    });
    expect(stored.metadataJson).toBe(
      JSON.stringify({
        cwd: '/tmp/project',
        branch: 'main',
        observedAt: '2026-05-08T00:00:00.000Z',
        observedAgain: '2026-05-08T00:00:00.000Z',
      }),
    );
  });

  it('stores partial metadata and no metadata beyond text', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);

    const partial = store.put(
      { text: 'partial metadata chunk', chunkId: 'chunk-partial', sourceUri: '/tmp/source' },
      { projectId: 'project-a', embedding: testEmbedding },
    );
    const minimal = store.put(
      { text: 'minimal metadata chunk' },
      { projectId: 'project-a', embedding: testEmbedding },
    );

    expect(partial).toMatchObject({
      chunkId: 'chunk-partial',
      sourceUri: '/tmp/source',
      sourceKind: null,
      metadataJson: null,
    });
    expect(minimal.chunkId).toHaveLength(36);
    expect(minimal.sourceUri).toBeNull();
    expect(minimal.metadataJson).toBeNull();
  });

  it('searches known vectors with deterministic order, scores, isolation, and limits', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);

    store.putMany(
      [
        { text: 'exact match', chunkId: 'exact' },
        { text: 'near match', chunkId: 'near' },
        { text: 'far match', chunkId: 'far' },
      ],
      { projectId: 'project-a', embeddings: [vector64(1), vector64(0.5), vector64(0, 1)] },
    );
    store.put(
      { text: 'other project exact', chunkId: 'other-exact' },
      { projectId: 'project-b', embedding: vector64(1) },
    );

    const hits = store.search(vector64(1), { projectId: 'project-a', limit: 2 });

    expect(hits.map((hit) => hit.chunk.chunkId)).toEqual(['exact', 'near']);
    expect(hits[0]?.score).toBe(1);
    expect(hits.every((hit) => hit.score > 0 && hit.score <= 1)).toBe(true);
    expect(store.search(vector64(1), { projectId: 'project-b', limit: 10 })).toHaveLength(1);
  });

  it('rejects invalid search inputs without mutating storage', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);
    store.put(
      { text: 'stable searchable chunk', chunkId: 'stable-search' },
      { projectId: 'project-a', embedding: vector64(1) },
    );
    expectSourceIndexRowCounts(db, 1);

    const invalidSearches: Array<() => readonly unknown[]> = [
      () => store.search(vector64(1), null as unknown as { projectId: string; limit: number }),
      () => store.search(vector64(1), { projectId: '', limit: 1 }),
      () => store.search(vector64(1), { projectId: 'project-a', limit: 0 }),
      () => store.search(vector64(1), { projectId: 'project-a', limit: -1 }),
      () => store.search(vector64(1), { projectId: 'project-a', limit: 1.5 }),
      () => store.search(vector64(1), { projectId: 'project-a', limit: 1001 }),
      () => store.search([1, 2], { projectId: 'project-a', limit: 1 }),
      () =>
        store.search('not-a-vector' as unknown as readonly number[], {
          projectId: 'project-a',
          limit: 1,
        }),
      () =>
        store.search([Number.NaN, ...vector64(0).slice(1)], { projectId: 'project-a', limit: 1 }),
      () => store.search([Infinity, ...vector64(0).slice(1)], { projectId: 'project-a', limit: 1 }),
    ];

    for (const invalidSearch of invalidSearches) {
      expect(invalidSearch).toThrow(InvalidArgumentError);
      expectSourceIndexRowCounts(db, 1);
    }
  });

  it('writes multiple chunks through putMany and putStoredMany', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);

    const putManyStored = store.putMany(
      [
        { text: 'first batch chunk', chunkId: 'batch-1' },
        { text: 'second batch chunk', chunkId: 'batch-2', sourceKind: 'fixture' },
      ],
      { projectId: 'project-a', embeddings: [vector64(1), vector64(0, 1)] },
    );
    const normalized = store.validateMany(
      [
        { text: 'first stored chunk', chunkId: 'stored-1' },
        { text: 'second stored chunk', chunkId: 'stored-2', sourceUri: '/tmp/source' },
      ],
      { projectId: 'project-a' },
    );
    const putStoredManyStored = store.putStoredMany(normalized, [vector64(0.5), vector64(0.25)]);

    expect(putManyStored.map((chunk) => chunk.chunkId)).toEqual(['batch-1', 'batch-2']);
    expect(putManyStored[1]).toMatchObject({ sourceKind: 'fixture', projectId: 'project-a' });
    expect(putStoredManyStored).toEqual(
      normalized.map((chunk) => ({ ...chunk, updatedAt: expect.any(String) })),
    );
    expectSourceIndexRowCounts(db, 4);
  });

  it('rejects invalid putStoredMany batches without partial rows', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);
    const validStored = store.validateMany([{ text: 'valid stored', chunkId: 'valid-stored' }], {
      projectId: 'project-a',
    })[0]!;
    const invalidStoredChunks: Array<readonly StoredSourceChunk[]> = [
      [],
      [{ ...validStored, chunkId: '' }],
      [{ ...validStored, projectId: '' }],
      [{ ...validStored, text: '   ' }],
      [
        {
          ...validStored,
          metadataJson: 'x'.repeat(SOURCE_CHUNK_METADATA_JSON_LIMIT + 1),
        },
      ],
    ];

    expect(() => store.putStoredMany([validStored], [])).toThrow(InvalidArgumentError);
    expectSourceIndexRowCounts(db, 0);
    expect(() => store.putStoredMany([validStored], [vector64(1), vector64(2)])).toThrow(
      InvalidArgumentError,
    );
    expectSourceIndexRowCounts(db, 0);
    expect(() => store.putStoredMany([validStored], [[1, 2]])).toThrow(InvalidArgumentError);
    expectSourceIndexRowCounts(db, 0);
    expect(() =>
      store.putStoredMany([validStored], [[Number.NaN, ...vector64(0).slice(1)]]),
    ).toThrow(InvalidArgumentError);
    expectSourceIndexRowCounts(db, 0);
    expect(() => store.putStoredMany([validStored], [[Infinity, ...vector64(0).slice(1)]])).toThrow(
      InvalidArgumentError,
    );
    expectSourceIndexRowCounts(db, 0);

    for (const invalidStoredChunk of invalidStoredChunks) {
      expect(() => store.putStoredMany(invalidStoredChunk, [vector64(1)])).toThrow(
        InvalidArgumentError,
      );
      expectSourceIndexRowCounts(db, 0);
    }
  });

  it('deletes chunks and vectors atomically by project id and chunk ids', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);

    store.put(
      { text: 'delete me', chunkId: 'same' },
      { projectId: 'project-a', embedding: testEmbedding },
    );
    store.put(
      { text: 'keep me', chunkId: 'same' },
      { projectId: 'project-b', embedding: testEmbedding },
    );

    expect(store.deleteMany('project-a', ['same'])).toBe(1);
    expect(
      db.prepare('SELECT chunk_id FROM source_chunks WHERE project_id = ?').all('project-a'),
    ).toEqual([]);
    expect(
      db.prepare('SELECT chunk_id FROM vec_source_chunks WHERE project_id = ?').all('project-a'),
    ).toEqual([]);
    expect(
      db.prepare('SELECT chunk_id FROM source_chunks WHERE project_id = ?').all('project-b'),
    ).toEqual([{ chunk_id: 'same' }]);
    expect(() => store.deleteMany('project-a', [])).toThrow(InvalidArgumentError);
  });

  it('reports delete edge-case counts and rejects invalid delete inputs without mutation', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);

    store.putMany(
      [
        { text: 'delete edge one', chunkId: 'delete-1' },
        { text: 'delete edge two', chunkId: 'delete-2' },
        { text: 'delete edge three', chunkId: 'delete-3' },
      ],
      { projectId: 'project-a', embeddings: [vector64(1), vector64(2), vector64(3)] },
    );
    expectSourceIndexRowCounts(db, 3);

    expect(store.deleteMany('project-a', ['missing'])).toBe(0);
    expectSourceIndexRowCounts(db, 3);
    expect(store.deleteMany('project-a', ['delete-1', 'missing'])).toBe(1);
    expectSourceIndexRowCounts(db, 2);
    expect(store.deleteMany('project-a', ['delete-2', 'delete-2'])).toBe(1);
    expectSourceIndexRowCounts(db, 1);

    const invalidDeletes: Array<() => number> = [
      () => store.deleteMany('project-a', 'delete-3' as unknown as readonly string[]),
      () => store.deleteMany('project-a', [42 as unknown as string]),
      () => store.deleteMany('project-a', ['']),
      () => store.deleteMany('', ['delete-3']),
    ];

    for (const invalidDelete of invalidDeletes) {
      expect(invalidDelete).toThrow(InvalidArgumentError);
      expectSourceIndexRowCounts(db, 1);
    }
  });

  it('updates an existing chunk id within one project without colliding across projects', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);

    store.put(
      { text: 'before', chunkId: 'stable' },
      { projectId: 'project-a', embedding: testEmbedding },
    );
    store.put(
      { text: 'after', chunkId: 'stable', sourceKind: 'fixture' },
      { projectId: 'project-a', embedding: testEmbedding },
    );

    store.put(
      { text: 'other project', chunkId: 'stable', sourceKind: 'fixture-b' },
      { projectId: 'project-b', embedding: testEmbedding },
    );
    store.put(
      { text: 'separator case 1', chunkId: 'b\u0000c' },
      { projectId: 'a', embedding: testEmbedding },
    );
    store.put(
      { text: 'separator case 2', chunkId: 'c' },
      { projectId: 'a\u0000b', embedding: testEmbedding },
    );

    const rows = db
      .prepare(
        'SELECT project_id, text, source_kind FROM source_chunks WHERE chunk_id = ? ORDER BY project_id',
      )
      .all('stable');
    expect(rows).toEqual([
      { project_id: 'project-a', text: 'after', source_kind: 'fixture' },
      { project_id: 'project-b', text: 'other project', source_kind: 'fixture-b' },
    ]);
    const vectorRows = db
      .prepare(
        'SELECT project_id, chunk_id FROM vec_source_chunks WHERE chunk_id = ? ORDER BY project_id',
      )
      .all('stable');
    expect(vectorRows).toEqual([
      { project_id: 'project-a', chunk_id: 'stable' },
      { project_id: 'project-b', chunk_id: 'stable' },
    ]);
    db.prepare(
      'INSERT INTO vec_source_chunks(chunk_key, project_id, chunk_id, embedding) VALUES (?, ?, ?, ?)',
    ).run(
      'project-a\u0000stable',
      'project-a',
      'stable',
      Buffer.from(new Float32Array(testEmbedding).buffer),
    );
    store.put(
      { text: 'after stale key', chunkId: 'stable' },
      { projectId: 'project-a', embedding: testEmbedding },
    );
    const staleKeyRows = db
      .prepare('SELECT chunk_key FROM vec_source_chunks WHERE project_id = ? AND chunk_id = ?')
      .all('project-a', 'stable');
    expect(staleKeyRows).toHaveLength(1);

    const separatorRows = db
      .prepare(
        'SELECT project_id, chunk_id FROM vec_source_chunks WHERE chunk_id IN (?, ?) ORDER BY project_id',
      )
      .all('b\u0000c', 'c');
    expect(separatorRows).toEqual([
      { project_id: 'a', chunk_id: 'b\u0000c' },
      { project_id: 'a\u0000b', chunk_id: 'c' },
    ]);
  });

  it('rejects invalid text, project ids, metadata, and optional integers', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);

    expect(() =>
      store.put(null as unknown as never, { projectId: 'project-a', embedding: testEmbedding }),
    ).toThrow(InvalidArgumentError);
    expect(() => store.put({ text: 'ok' }, null as unknown as never)).toThrow(InvalidArgumentError);
    expect(() =>
      store.put({ text: '   ' }, { projectId: 'project-a', embedding: testEmbedding }),
    ).toThrow(InvalidArgumentError);
    expect(() => store.put({ text: 'ok' }, { projectId: '', embedding: testEmbedding })).toThrow(
      InvalidArgumentError,
    );
    expect(() =>
      store.put(
        { text: 'ok', metadata: [] as unknown as Record<string, unknown> },
        { projectId: 'p', embedding: testEmbedding },
      ),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      store.put({ text: 'ok', lineNumber: 1.5 }, { projectId: 'p', embedding: testEmbedding }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      store.put(
        { text: 'ok', metadata: 'primitive' as unknown as Record<string, unknown> },
        { projectId: 'p', embedding: testEmbedding },
      ),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      store.put(
        { text: 'ok', metadata: { dropped: undefined } as unknown as Record<string, unknown> },
        { projectId: 'p', embedding: testEmbedding },
      ),
    ).toThrow(InvalidArgumentError);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      store.put({ text: 'ok', metadata: cyclic }, { projectId: 'p', embedding: testEmbedding }),
    ).toThrow(InvalidArgumentError);
    const recursiveJson: { toJSON?: () => unknown } = {};
    recursiveJson.toJSON = () => recursiveJson;
    expect(() =>
      store.put(
        { text: 'ok', metadata: { recursiveJson } },
        { projectId: 'p', embedding: testEmbedding },
      ),
    ).toThrow(InvalidArgumentError);
  });

  it('writes vector rows atomically with chunk metadata and validates embedding dimension', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);

    store.put(
      { text: 'vector-backed chunk', chunkId: 'vector-chunk' },
      { projectId: 'p', embedding: testEmbedding },
    );

    const rows = db
      .prepare('SELECT chunk_id, project_id FROM vec_source_chunks WHERE chunk_id = ?')
      .all('vector-chunk');
    expect(rows).toEqual([{ chunk_id: 'vector-chunk', project_id: 'p' }]);
    expect(() =>
      store.put(
        { text: 'bad vector', chunkId: 'bad-vector' },
        { projectId: 'p', embedding: [1, 2] },
      ),
    ).toThrow(InvalidArgumentError);
    const missingRows = db
      .prepare('SELECT chunk_id FROM source_chunks WHERE chunk_id = ?')
      .all('bad-vector');
    expect(missingRows).toEqual([]);
  });

  it('accepts exact-dimension finite vectors and rejects vector boundary violations', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);

    store.put(
      { text: 'valid vector boundary', chunkId: 'valid-vector-boundary' },
      { projectId: 'p', embedding: vector64(1) },
    );
    expectSourceIndexRowCounts(db, 1, 'p');

    const invalidVectorWrites = [
      () =>
        store.put(
          { text: 'wrong dimension vector', chunkId: 'wrong-dim-vector' },
          { projectId: 'p', embedding: [1, 2] },
        ),
      () =>
        store.put(
          { text: 'non-array vector', chunkId: 'non-array-vector' },
          { projectId: 'p', embedding: 'not-a-vector' as unknown as readonly number[] },
        ),
      () =>
        store.put(
          { text: 'nan vector', chunkId: 'nan-vector' },
          { projectId: 'p', embedding: [Number.NaN, ...vector64(0).slice(1)] },
        ),
      () =>
        store.put(
          { text: 'infinite vector', chunkId: 'infinite-vector' },
          { projectId: 'p', embedding: [Infinity, ...vector64(0).slice(1)] },
        ),
    ];

    for (const invalidVectorWrite of invalidVectorWrites) {
      expect(invalidVectorWrite).toThrow(InvalidArgumentError);
      expectSourceIndexRowCounts(db, 1, 'p');
    }
  });

  it('accepts exact text and metadata byte limits and rejects one byte over', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);
    const metadataJsonOverhead = Buffer.byteLength(JSON.stringify({ large: '' }), 'utf8');
    const exactMetadata = {
      large: 'x'.repeat(SOURCE_CHUNK_METADATA_JSON_LIMIT - metadataJsonOverhead),
    };
    const exactMultibyteMetadata = {
      large: 'é'.repeat((SOURCE_CHUNK_METADATA_JSON_LIMIT - metadataJsonOverhead) / 2),
    };
    const multibyteExactText = 'é'.repeat(SOURCE_CHUNK_TEXT_LIMIT / 2);

    const exactMetadataJson = store.put(
      { text: 'metadata exact limit', chunkId: 'metadata-exact', metadata: exactMetadata },
      { projectId: 'p', embedding: testEmbedding },
    ).metadataJson;
    expect(Buffer.byteLength(exactMetadataJson ?? '', 'utf8')).toBe(
      SOURCE_CHUNK_METADATA_JSON_LIMIT,
    );
    const exactMultibyteMetadataJson = store.put(
      {
        text: 'metadata multibyte exact limit',
        chunkId: 'metadata-multibyte-exact',
        metadata: exactMultibyteMetadata,
      },
      { projectId: 'p', embedding: testEmbedding },
    ).metadataJson;
    expect(Buffer.byteLength(exactMultibyteMetadataJson ?? '', 'utf8')).toBe(
      SOURCE_CHUNK_METADATA_JSON_LIMIT,
    );
    expect(
      store.put(
        { text: 'x'.repeat(SOURCE_CHUNK_TEXT_LIMIT), chunkId: 'text-exact' },
        { projectId: 'p', embedding: testEmbedding },
      ).text,
    ).toHaveLength(SOURCE_CHUNK_TEXT_LIMIT);
    expect(
      store.put(
        { text: multibyteExactText, chunkId: 'text-multibyte-exact' },
        { projectId: 'p', embedding: testEmbedding },
      ).text,
    ).toBe(multibyteExactText);

    expect(() =>
      store.put(
        { text: 'x'.repeat(SOURCE_CHUNK_TEXT_LIMIT + 1) },
        { projectId: 'p', embedding: testEmbedding },
      ),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      store.put({ text: `${multibyteExactText}x` }, { projectId: 'p', embedding: testEmbedding }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      store.put(
        { text: 'ok', metadata: { large: 'x'.repeat(SOURCE_CHUNK_METADATA_JSON_LIMIT) } },
        { projectId: 'p', embedding: testEmbedding },
      ),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      store.put(
        {
          text: 'ok',
          metadata: {
            large: `${'é'.repeat((SOURCE_CHUNK_METADATA_JSON_LIMIT - metadataJsonOverhead) / 2)}x`,
          },
        },
        { projectId: 'p', embedding: testEmbedding },
      ),
    ).toThrow(InvalidArgumentError);
  });

  it('round-trips valid nested metadata and supported toJSON values', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);
    const metadata = {
      nested: { tags: ['alpha', 'beta'], values: [1, true, null] },
      custom: { toJSON: () => ({ serialized: 'value' }) },
    };

    const stored = store.put(
      { text: 'valid nested metadata', chunkId: 'nested-metadata', metadata },
      { projectId: 'p', embedding: testEmbedding },
    );

    expect(JSON.parse(stored.metadataJson ?? '')).toEqual({
      nested: { tags: ['alpha', 'beta'], values: [1, true, null] },
      custom: { serialized: 'value' },
    });
  });

  it('rejects nested non-JSON metadata values', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);
    const invalidValues = [Number.NaN, Infinity, () => 'nope', Symbol('nope'), BigInt(1)] as const;

    for (const invalidValue of invalidValues) {
      expect(() =>
        store.put(
          { text: 'invalid nested metadata', metadata: { nested: { invalidValue } } },
          { projectId: 'p', embedding: testEmbedding },
        ),
      ).toThrow(InvalidArgumentError);
    }
  });
});
