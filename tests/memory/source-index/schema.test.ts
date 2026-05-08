import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../../src/core/database.js';
import { InvalidArgumentError } from '../../../src/core/errors.js';
import {
  SOURCE_CHUNK_METADATA_JSON_LIMIT,
  SOURCE_CHUNK_TEXT_LIMIT,
  SourceChunkStore,
} from '../../../src/memory/source-index/index.js';

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
});

describe('SourceChunkStore validation and storage', () => {
  it('stores full source pointer metadata', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 768);

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
        metadata: { cwd: '/tmp/project', branch: 'main' },
      },
      { projectId: 'project-a' },
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
    expect(stored.metadataJson).toBe(JSON.stringify({ cwd: '/tmp/project', branch: 'main' }));
  });

  it('stores partial metadata and no metadata beyond text', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 768);

    const partial = store.put(
      { text: 'partial metadata chunk', chunkId: 'chunk-partial', sourceUri: '/tmp/source' },
      { projectId: 'project-a' },
    );
    const minimal = store.put({ text: 'minimal metadata chunk' }, { projectId: 'project-a' });

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

  it('updates an existing chunk id instead of duplicating rows', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 768);

    store.put({ text: 'before', chunkId: 'stable' }, { projectId: 'project-a' });
    store.put(
      { text: 'after', chunkId: 'stable', sourceKind: 'fixture' },
      { projectId: 'project-a' },
    );

    const rows = db
      .prepare('SELECT text, source_kind FROM source_chunks WHERE chunk_id = ?')
      .all('stable');
    expect(rows).toEqual([{ text: 'after', source_kind: 'fixture' }]);
  });

  it('rejects invalid text, project ids, metadata, and optional integers', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 768);

    expect(() => store.put({ text: '   ' }, { projectId: 'project-a' })).toThrow(
      InvalidArgumentError,
    );
    expect(() => store.put({ text: 'ok' }, { projectId: '' })).toThrow(InvalidArgumentError);
    expect(() =>
      store.put(
        { text: 'ok', metadata: [] as unknown as Record<string, unknown> },
        { projectId: 'p' },
      ),
    ).toThrow(InvalidArgumentError);
    expect(() => store.put({ text: 'ok', lineNumber: 1.5 }, { projectId: 'p' })).toThrow(
      InvalidArgumentError,
    );
  });

  it('rejects oversized text and metadata JSON', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const store = new SourceChunkStore(db, 768);

    expect(() =>
      store.put({ text: 'x'.repeat(SOURCE_CHUNK_TEXT_LIMIT + 1) }, { projectId: 'p' }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      store.put(
        { text: 'ok', metadata: { large: 'x'.repeat(SOURCE_CHUNK_METADATA_JSON_LIMIT) } },
        { projectId: 'p' },
      ),
    ).toThrow(InvalidArgumentError);
  });
});
