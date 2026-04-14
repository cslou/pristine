// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export { PristineLocal } from './client.js';
export type { PristineLocalConfig } from './client.js';

// ---------------------------------------------------------------------------
// Core types (consumer-facing)
// ---------------------------------------------------------------------------

export type {
  AnalyzedQuery,
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
} from './core/types.js';

// ---------------------------------------------------------------------------
// Interfaces (for DI, custom implementations, and test mocks)
// ---------------------------------------------------------------------------

export type { Embedder, Extractor, LlmClient, Orchestrator, Store } from './core/interfaces.js';

export type { LlmClients } from './engine/index.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export { AppError, ConfigError, EmbedderError, OrchestratorError } from './core/errors.js';
