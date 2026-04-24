import type {
  ClassificationPipelineResult,
  IngestOptions,
  IngestResult,
  JsonSchema,
  KeyPairWithStatus,
  Message,
  PipelineStep,
  SensitivityReport,
  VaultEntry,
  VaultEntryInput,
} from './types.js';

// ---------------------------------------------------------------------------
// LLM Inference
// ---------------------------------------------------------------------------

export interface LlmClient {
  generate<T>(params: {
    readonly systemPrompt: string;
    readonly userPrompt: string;
    readonly schema: JsonSchema;
    readonly maxTokens?: number;
  }): Promise<T>;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: readonly string[]): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface SensitivityClassifier {
  classify(text: string): Promise<SensitivityReport>;
}

export interface PrivacyPipeline {
  classifyAndRedact(text: string): Promise<ClassificationPipelineResult>;
}

// ---------------------------------------------------------------------------
// Key Management
// ---------------------------------------------------------------------------

export interface KeyManager {
  getOrCreateKeyPair(userId: string): Promise<KeyPairWithStatus>;
  saveKeyPair(userId: string, keyPair: { publicKey: string; privateKey: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

export interface VaultStore {
  addEntries(entries: VaultEntryInput[]): Promise<VaultEntry[]>;
  getEntriesByPlaceholderIds(userId: string, placeholderIds: string[]): Promise<VaultEntry[]>;
}

// ---------------------------------------------------------------------------
// Orchestrator
//
// Phase-1 surface is ingest-only — IngestQueue.processNext() calls
// orchestrator.ingest() when the queue is wired to a full pipeline. All four
// retrieve/search/search-pipeline members are deferred to spec-005 Phase 2+
// (indexer + searcher primitives); re-exposing them here without a live
// implementation would be a phantom contract.
// ---------------------------------------------------------------------------

export interface Orchestrator {
  ingest(
    conversation: readonly Message[],
    userId: string,
    options?: IngestOptions,
  ): Promise<IngestResult>;
  readonly ingestSteps: readonly PipelineStep[];
  registerIngestStep(step: PipelineStep): void;
}
