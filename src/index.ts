// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export { PristineLocal } from './client.js';
export type { PristineLocalConfig, PristineLiteConfig } from './client.js';

// ---------------------------------------------------------------------------
// Core types (consumer-facing)
// ---------------------------------------------------------------------------

export type {
  ConversationDetail,
  ConversationSearchResult,
  Memory,
  Message,
  MessageRole,
  SecureAndRedactResult,
  RevealResult,
} from './core/types.js';

// ---------------------------------------------------------------------------
// Interfaces (for DI, custom implementations, and test mocks)
// ---------------------------------------------------------------------------

export type { Embedder, LlmClient } from './core/interfaces.js';

export type { LlmClients } from './engine/index.js';

export type { DeterministicClassifierConfig } from './privacy/classifier/deterministic/index.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export { AppError, ConfigError, EmbedderError, IngestQueueError } from './core/errors.js';

// ---------------------------------------------------------------------------
// Database (for provider integrations that need file-backed DBs)
// ---------------------------------------------------------------------------

export { createDatabase } from './core/database.js';

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export { IngestQueue } from './queue/ingest-queue.js';
export type { IngestTask, IngestQueueConfig } from './queue/ingest-queue.js';

// ---------------------------------------------------------------------------
// Searcher (spec-005 Phase 4 retrieval primitive)
// ---------------------------------------------------------------------------

export type {
  Searcher,
  SearchFilters,
  WindowHit,
  MessageHit,
  SessionHit,
  HybridHit,
  HybridSource,
  Role,
} from './memory/searcher/index.js';
