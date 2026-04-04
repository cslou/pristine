import type {
  AddMemoryInput,
  AnalyzedQuery,
  ConsolidationBatchResult,
  ConsolidationRequest,
  ConsolidationResult,
  Entity,
  EntityInput,
  Episode,
  EpisodeInput,
  ExtractionResult,
  Fact,
  IngestOptions,
  IngestResult,
  JsonSchema,
  Memory,
  Message,
  PipelineStep,
  QueryContext,
  RankedEpisode,
  RankedRelationship,
  Relationship,
  RelationshipInput,
  RetrieveOptions,
  RetrieveResult,
  SearchParams,
  SensitivityReport,
  SupersedeMemoryResult,
  TraversalResult,
  UpdateMemoryInput,
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
// Extraction
// ---------------------------------------------------------------------------

export interface Extractor {
  extract(conversation: readonly Message[], referenceTimestamp?: string): Promise<ExtractionResult>;
}

// ---------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------

export interface Consolidator {
  consolidate(newFact: Fact, similarMemories: readonly Fact[]): Promise<ConsolidationResult>;
  consolidateBatch(requests: ConsolidationRequest[]): Promise<ConsolidationBatchResult>;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface SensitivityClassifier {
  classify(text: string): Promise<SensitivityReport>;
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
// Episodes
// ---------------------------------------------------------------------------

export interface EpisodeStore {
  addEpisode(episode: EpisodeInput): Promise<Episode>;
  searchByEmbedding(embedding: number[], topK: number, userId: string): Promise<RankedEpisode[]>;
  linkMemory(memoryId: string, episodeId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Entity Graph
// ---------------------------------------------------------------------------

export interface EntityStore {
  addEntity(entity: EntityInput): Promise<Entity>;
  resolve(name: string, type: string, userId: string, embedding?: number[]): Promise<Entity | null>;
  getEntity(id: string, userId: string): Promise<Entity | null>;
}

export interface RelationshipStore {
  addRelationship(rel: RelationshipInput): Promise<Relationship>;
  traverse(entityId: string, userId: string, maxDepth: number): Promise<TraversalResult[]>;
  searchByEmbedding(
    embedding: number[],
    topK: number,
    userId: string,
  ): Promise<RankedRelationship[]>;
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export interface Retriever {
  retrieve(query: string, userId: string, options?: RetrieveOptions): Promise<RetrieveResult>;
}

// ---------------------------------------------------------------------------
// Query Analysis
// ---------------------------------------------------------------------------

export interface QueryAnalyzer {
  analyzeQuery(query: string, context?: QueryContext): Promise<AnalyzedQuery>;
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
  readonly ingestSteps: PipelineStep[];
  readonly retrieveSteps: PipelineStep[];
  registerIngestStep(step: PipelineStep): void;
  registerRetrieveStep(step: PipelineStep): void;
}
