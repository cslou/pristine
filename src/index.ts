/** Local-first source-pointer memory SDK. */
export { Pristine } from './client.js';
export type {
  ForgetOptions,
  ForgetResult,
  PristineConfig,
  RecalledMemory,
  RecallOptions,
  StoredMemory,
  StoreOptions,
} from './client.js';
export type { SourceChunkInput, SourceChunkMetadata } from './core/types.js';
export type { Embedder } from './core/interfaces.js';
export { AppError, ConfigError, EmbedderError, InvalidArgumentError } from './core/errors.js';
export { createDatabase } from './core/database.js';
export {
  SOURCE_CHUNK_METADATA_JSON_LIMIT,
  SOURCE_CHUNK_TEXT_LIMIT,
  SourceChunkStore,
  buildSourceChunkVectorDdl,
  initSourceChunkTables,
  normalizeSourceChunkInput,
} from './memory/source-index/index.js';
export type {
  SourceChunkNormalizeOptions,
  SourceChunkSearchOptions,
  SourceChunkStoreOptions,
  StoredSourceChunk,
} from './memory/source-index/index.js';
