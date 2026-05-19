/**
 * # Pristine — local-first privacy and source-pointer memory SDK
 *
 * Pristine indexes source-owned text chunks with local embeddings and returns
 * semantic search hits containing snippets plus optional source pointers. Raw
 * transcripts remain in the harness/source system; Pristine stores indexed
 * chunk text/snippets, embeddings, source metadata, and privacy vault data. No server; no user
 * data leaves the device by default. The default embedder may download model
 * files on first use unless pre-cached or configured offline.
 */

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

// Deprecated compatibility exports for the pre-`store`/`recall`/`forget` memory API.
// New code should use StoreOptions, StoredMemory, RecallOptions, RecalledMemory,
// ForgetOptions, and ForgetResult instead.
export type {
  DeleteSourceChunksOptions,
  DeleteSourceChunksResult,
  IndexedSourceChunk,
  IndexSourceChunksOptions,
  SearchSourceChunksOptions,
  SourceChunkSearchHit,
} from './client.js';

export type {
  BuiltInDetectCandidateKind,
  ClassifierCallback,
  ClassifierCallbackDecision,
  ClassifierCallbackResult,
  ClassifierRequest,
  ClassifierRequestCandidate,
  ClassifierVerdict,
  ClassifyDecision,
  ClassifyOptions,
  ClassifyPrimitive,
  ClassifyResult,
  NonSecretClassifierCallbackDecision,
  NonSecretClassifyDecision,
  SecretClassifierCallbackDecision,
  SecretClassifyDecision,
  DetectCandidate,
  DetectCandidateKind,
  DetectHint,
  DetectOptions,
  DetectPrimitive,
  DetectResult,
  DetectSensitivityPreset,
  DeleteSensitiveResult,
  ListSensitiveOptions,
  PrivacyHintFeatures,
  PrivacyHintFeatureValue,
  RedactConfirmedSecret,
  RedactOptions,
  RedactPrimitive,
  RedactResult,
  RedactResultRedaction,
  RevealResult,
  SensitiveRef,
  SensitiveSummary,
  SourceChunkInput,
  SourceChunkMetadata,
  SourceLocation,
  SourceSpan,
  SourceSurface,
  SourceSurfaceMetadata,
  TextSpan,
  UpdateSensitiveInput,
} from './core/types.js';

export type {
  Embedder,
  PrivacyClassifier,
  PrivacyDetector,
  PrivacyRedactor,
} from './core/interfaces.js';

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

export {
  AppError,
  ConfigError,
  EmbedderError,
  InvalidArgumentError,
  SensitiveNotFoundError,
} from './core/errors.js';

export { createDatabase } from './core/database.js';
