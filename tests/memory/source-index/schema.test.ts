import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../../src/core/database.js';
import { InvalidArgumentError } from '../../../src/core/errors.js';
import {
  SOURCE_CHUNK_METADATA_JSON_LIMIT,
  SOURCE_CHUNK_TEXT_LIMIT,
  SourceChunkStore,
} from '../../../src/memory/source-index/index.js';

const testEmbedding = Array.from({ length: 64 }, (_, index) => index / 100);

const readTableSql = (db: ReturnType<typeof createDatabase>, tableName: string): string => {
  const row = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(tableName) as
    | { sql: string }
    | undefined;
  if (row === undefined) throw new Error(`missing table ${tableName}`);
  return row.sql;
};

describe('SourceChunkStore schema', () => {
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

  it('rejects invalid vector dimensions before DDL interpolation', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    expect(() => new SourceChunkStore(db, 8192)).toThrow(InvalidArgumentError);
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

  it('rejects oversized text and metadata JSON', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 64);

    expect(() =>
      store.put(
        { text: 'x'.repeat(SOURCE_CHUNK_TEXT_LIMIT + 1) },
        { projectId: 'p', embedding: testEmbedding },
      ),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      store.put(
        { text: 'ok', metadata: { large: 'x'.repeat(SOURCE_CHUNK_METADATA_JSON_LIMIT) } },
        { projectId: 'p', embedding: testEmbedding },
      ),
    ).toThrow(InvalidArgumentError);
  });
});
