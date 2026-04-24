import type {
  ClassificationPipelineResult,
  IngestOptions,
  IngestResult,
  JsonSchema,
  KeyPairWithStatus,
  Message,
  PipelineStep,
  RetrieveOptions,
  RetrieveResult,
  SearchOptions,
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
  deleteEntriesByMemoryId(memoryId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface Orchestrator {
  ingest(
    conversation: readonly Message[],
    userId: string,
    options?: IngestOptions,
  ): Promise<IngestResult>;
  retrieve(query: string, userId: string, options?: RetrieveOptions): Promise<RetrieveResult>;
  store(conversation: readonly Message[], userId: string): Promise<IngestResult>;
  search(query: string, userId: string, options?: SearchOptions): Promise<RetrieveResult>;
  readonly ingestSteps: readonly PipelineStep[];
  readonly retrieveSteps: readonly PipelineStep[];
  registerIngestStep(step: PipelineStep): void;
  registerRetrieveStep(step: PipelineStep): void;
}
