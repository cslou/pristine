// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export { PristineLocal } from './client.js';
export type { PristineLocalConfig, PristineLiteConfig } from './client.js';

// ---------------------------------------------------------------------------
// Core types (consumer-facing)
// ---------------------------------------------------------------------------

export type {
  AnalyzedQuery,
  ConversationDetail,
  ConversationSearchResult,
  Fact,
  IngestOptions,
  IngestResult,
  Memory,
  Message,
  MessageRole,
  PipelineStep,
  SecureAndRedactResult,
  RevealResult,
  RankedMemory,
  RetrieveOptions,
  RetrieveResult,
  SearchOptions,
} from './core/types.js';

// ---------------------------------------------------------------------------
// Interfaces (for DI, custom implementations, and test mocks)
// ---------------------------------------------------------------------------

export type { Embedder, Extractor, LlmClient, Orchestrator, Store } from './core/interfaces.js';

export type { LlmClients } from './engine/index.js';

// ---------------------------------------------------------------------------
// Extractor prompt (exported so callers can compose on top of the default
// instead of replacing it wholesale via ExtractorConfig.systemPrompt)
// ---------------------------------------------------------------------------

export { buildExtractionPrompt } from './memory/extractor/prompts.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export {
  AppError,
  ConfigError,
  EmbedderError,
  IngestQueueError,
  OrchestratorError,
} from './core/errors.js';

// ---------------------------------------------------------------------------
// Database (for provider integrations that need file-backed DBs)
// ---------------------------------------------------------------------------

export { createDatabase } from './core/database.js';

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export { IngestQueue } from './queue/ingest-queue.js';
export type { IngestTask, IngestQueueConfig } from './queue/ingest-queue.js';
