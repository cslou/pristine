export {
  SOURCE_CHUNK_METADATA_JSON_LIMIT,
  SOURCE_CHUNK_TEXT_LIMIT,
  SourceChunkStore,
  buildSourceChunkVectorDdl,
  initSourceChunkTables,
  normalizeSourceChunkInput,
} from './schema.js';
export type {
  SourceChunkInput,
  SourceChunkMetadata,
  SourceChunkNormalizeOptions,
  SourceChunkSearchHit,
  SourceChunkSearchOptions,
  SourceChunkStoreOptions,
  StoredSourceChunk,
} from './types.js';
