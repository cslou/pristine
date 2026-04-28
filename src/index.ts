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

// IngestQueue (class), IngestTask (type), and IngestQueueConfig (type) were
// previously re-exported here. Removed in sprint-018 Story 4 — they're
// internal-only plumbing the consumer-facing surface (storeAsync,
// drainEmbedQueue, buildSessionVector) encapsulates. IngestQueueError stays
// exported from the errors block (consumers catch it on storeAsync).

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
