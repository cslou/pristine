import type {
  AddMemoryInput,
  IngestOptions,
  IngestResult,
  JsonSchema,
  Memory,
  Message,
  PipelineStep,
  RetrieveOptions,
  RetrieveResult,
  SearchOptions,
  SearchParams,
  ClassificationPipelineResult,
  SensitivityReport,
  SupersedeMemoryResult,
  UpdateMemoryInput,
  VaultEntry,
  VaultEntryInput,
  KeyPairWithStatus,
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
// Memory Store
// ---------------------------------------------------------------------------

export interface Store {
  addMemory(memory: AddMemoryInput): Promise<Memory>;
  getMemory(id: string, userId: string): Promise<Memory | null>;
  searchSimilar(params: SearchParams): Promise<Memory[]>;
  updateMemory(id: string, updates: UpdateMemoryInput, userId: string): Promise<Memory>;
  deleteMemory(id: string, userId: string): Promise<void>;
  supersedeMemory(
    oldId: string,
    newMemory: AddMemoryInput,
    reason: string,
    validUntil?: string,
  ): Promise<SupersedeMemoryResult>;
  getSupersessionChain(memoryId: string, userId: string): Promise<Memory[]>;
  clearAll(userId?: string): Promise<void>;
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
// Retrieval
// ---------------------------------------------------------------------------

export interface Retriever {
  retrieve(query: string, userId: string, options?: RetrieveOptions): Promise<RetrieveResult>;
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
