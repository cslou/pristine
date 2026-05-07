export const PI_JSONL_CHUNKS_TABLE = 'pi_jsonl_chunks';
export const PI_JSONL_VECTOR_TABLE = 'vec_pi_jsonl_chunks';

export const PI_JSONL_INDEX_TABLES = [PI_JSONL_CHUNKS_TABLE, PI_JSONL_VECTOR_TABLE] as const;

export const PI_JSONL_CHUNK_COLUMNS = [
  'chunk_id',
  'source_kind',
  'source_uri',
  'entry_id',
  'parent_id',
  'line_number',
  'timestamp',
  'cwd',
  'snippet',
  'metadata_json',
] as const;

export interface PiJsonlIndexChunkRow {
  readonly chunk_id: string;
  readonly source_kind: 'pi-jsonl';
  readonly source_uri: string;
  readonly entry_id: string | null;
  readonly parent_id: string | null;
  readonly line_number: number | bigint;
  readonly timestamp: string | null;
  readonly cwd: string | null;
  readonly snippet: string;
}

export const piJsonlChunkSelectList = (alias = 'c'): string =>
  [
    'chunk_id',
    'source_kind',
    'source_uri',
    'entry_id',
    'parent_id',
    'line_number',
    'timestamp',
    'cwd',
    'snippet',
  ]
    .map((column) => `${alias}.${column}`)
    .join(',\n                ');
