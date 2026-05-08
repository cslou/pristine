/**
 * # Pristine — local-first privacy and source-pointer memory SDK
 *
 * Pristine indexes source-owned text chunks with local embeddings and returns
 * semantic search hits containing snippets plus optional source pointers. Raw
 * transcripts remain in the harness/source system; Pristine stores only the
 * semantic index, source metadata, and privacy vault data. No server; no user
 * data leaves the device by default. The default embedder may download model
 * files on first use unless pre-cached or configured offline.
 */

export { PristineLocal } from './client.js';
export type {
  IndexedSourceChunk,
  IndexSourceChunksOptions,
  PristineLocalConfig,
  SearchSourceChunksOptions,
  SourceChunkSearchHit,
} from './client.js';

export type {
  RevealResult,
  SecureAndRedactResult,
  SourceChunkInput,
  SourceChunkMetadata,
} from './core/types.js';

export type { Embedder } from './core/interfaces.js';

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

export type { DeterministicClassifierConfig } from './privacy/classifier/deterministic/index.js';

export { AppError, ConfigError, EmbedderError, InvalidArgumentError } from './core/errors.js';

export { createDatabase } from './core/database.js';
