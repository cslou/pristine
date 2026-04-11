// ---------------------------------------------------------------------------
// Message & Conversation
// ---------------------------------------------------------------------------

export type MessageRole = 'system' | 'user' | 'assistant';

export interface Message {
  readonly role: MessageRole;
  readonly content: string;
  readonly userId?: string;
  readonly timestamp?: string;
}

// ---------------------------------------------------------------------------
// Temporal
// ---------------------------------------------------------------------------

export type TemporalConfidence = 'explicit' | 'inferred' | 'implied' | 'none';

export interface TemporalValidationOptions {
  readonly referenceTimestamp: string;
  readonly minimumDate?: string;
}

export interface TemporalValidationResult {
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly temporalConfidence?: TemporalConfidence;
  readonly metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Fact & Extraction
// ---------------------------------------------------------------------------

export interface Fact {
  readonly id?: string;
  readonly text: string;
  readonly sourceConversationId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly temporalConfidence?: TemporalConfidence;
}

export interface ExtractionResult {
  readonly facts: Fact[];
}

// ---------------------------------------------------------------------------
// Memory & Store
// ---------------------------------------------------------------------------

export interface Memory {
  readonly id: string;
  readonly userId: string;
  readonly text: string;
  readonly embedding: number[];
  readonly contentHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastAccessed: string;
  readonly sourceConversationId?: string;
  readonly metadata: Record<string, unknown>;
  readonly isDeleted: boolean;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly supersededBy?: string;
  readonly supersedes?: string;
  readonly supersessionReason?: string;
}

export interface AddMemoryInput {
  readonly userId: string;
  readonly text: string;
  readonly embedding: number[];
  readonly contentHash: string;
  readonly sourceConversationId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly validFrom?: string;
  readonly validUntil?: string;
}

export interface UpdateMemoryInput {
  readonly text?: string;
  readonly embedding?: number[];
  readonly contentHash?: string;
  readonly metadata?: Record<string, unknown>;
  readonly validFrom?: string;
  readonly validUntil?: string;
}

export interface SupersedeMemoryResult {
  readonly oldMemory: Memory;
  readonly newMemory: Memory;
}

export type TemporalMode = 'current' | 'as_of' | 'full';

export interface SearchParams {
  readonly embedding: number[];
  readonly limit: number;
  readonly userId: string;
  readonly temporalMode?: TemporalMode;
  readonly asOf?: string;
}

// ---------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------

export type ConsolidationAction = 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP' | 'SUPERSEDE';

export interface ConsolidationResult {
  readonly action: ConsolidationAction;
  readonly mergedText?: string;
  readonly targetMemoryId?: string;
  readonly supersessionReason?: string;
  readonly validUntil?: string;
  readonly factIndex: number;
}

export interface ConsolidationBatchResult {
  readonly results: ConsolidationResult[];
  readonly idRemap: ReadonlyMap<string, string>;
}

export interface ConsolidationRequest {
  readonly newFact: Fact;
  readonly similarMemories: readonly Fact[];
}

// ---------------------------------------------------------------------------
// Classification & Sensitivity
// ---------------------------------------------------------------------------

export type SensitivitySource = 'llm' | 'deterministic';

export type SensitivityType = string;

export interface DetectedEntity {
  readonly type: SensitivityType;
  readonly source: SensitivitySource;
  readonly confidence: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface SensitivityReport {
  readonly entities: readonly DetectedEntity[];
  readonly hasSensitiveContent: boolean;
  readonly warnings?: readonly string[];
}

export interface LlmSensitivityFinding {
  readonly type: string;
  readonly confidence: number;
  readonly reasoning: string;
  readonly text: string;
}

export interface LlmClassifierConfig {
  readonly model?: string;
  readonly maxTokens?: number;
  readonly confidenceThreshold?: number;
  readonly systemPrompt?: string;
}

export type LlmFailureMode = 'block' | 'degrade';
export type PrivacyBlockReason = 'safety_scan' | 'ungroundable_llm_finding';

export interface RedactionPlaceholder {
  readonly id: string;
  readonly type: string;
  readonly label?: string;
  readonly originalText: string;
  readonly start: number;
  readonly end: number;
}

export interface RedactionResult {
  readonly redactedText: string;
  readonly placeholders: readonly RedactionPlaceholder[];
}

export interface RevealResult {
  readonly text: string;
  readonly revealedValues: readonly string[];
}

export interface ClassificationPipelineResult {
  readonly report: SensitivityReport;
  readonly redaction: RedactionResult | null;
  readonly safetyViolations: readonly DetectedEntity[];
  readonly blockedReason?: PrivacyBlockReason;
  readonly blockedWarnings?: readonly string[];
}

export type SecureAndRedactResult =
  | {
      readonly ok: true;
      readonly redactedText: string;
      readonly placeholderIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly redactedText: string;
      readonly reason: PrivacyBlockReason;
      readonly warnings?: readonly string[];
      readonly safetyViolations: readonly DetectedEntity[];
    };

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------

export interface SensitiveField {
  readonly id: string;
  readonly type: string;
  readonly description: string;
  readonly status: 'requires_approval';
}

export interface SanitizedMemory {
  readonly text: string;
  readonly sensitiveFields: readonly SensitiveField[];
}

export interface SensitivePlaceholderMatch {
  readonly placeholder: string;
  readonly type: string;
  readonly id: string;
}

export interface ApprovalRequestPayload {
  readonly requestId: string;
  readonly placeholders: readonly SensitivePlaceholderMatch[];
}

export interface ApprovalDecision {
  readonly id: string;
  readonly approved: boolean;
  readonly value?: string;
}

export interface ApprovalDecisionPayload {
  readonly requestId: string;
  readonly challengeSuccess: boolean;
  readonly decisions: readonly ApprovalDecision[];
}

export interface ResolveInput {
  readonly approvedValues?: ReadonlyMap<string, string> | Record<string, string>;
  readonly approvalCallback?: (request: ApprovalRequestPayload) => Promise<ApprovalDecisionPayload>;
  readonly approvalTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Vault & Encryption
// ---------------------------------------------------------------------------

export type VaultEncryptionMode = 'client_v2';

export interface VaultEntry {
  readonly id: string;
  readonly memoryId?: string;
  readonly userId?: string;
  readonly placeholderId?: string;
  readonly sensitiveType: string;
  readonly encryptedValue: Buffer;
  readonly iv: Buffer;
  readonly authTag: Buffer;
  readonly createdAt: string;
  readonly encryptionMode?: VaultEncryptionMode;
  readonly encryptionMetadata?: ZkV2EncryptedValueMetadata;
}

export type KeyWrappingScheme = 'rsa-oaep-256' | 'aes-256-kw+rsa-oaep-256';

export interface ZkV2EncryptedValue {
  readonly scheme: 'zk-v2';
  readonly algorithm: 'aes-256-gcm';
  readonly keyWrapping: KeyWrappingScheme;
  readonly keyId: string;
  readonly sensitiveType: string;
  readonly ciphertext: string;
  readonly iv: string;
  readonly authTag: string;
  readonly wrappedDek: string;
  readonly aad: string;
  readonly recoveryWrappedDek?: string;
}

export interface ZkV2EncryptedValueMetadata {
  readonly scheme: 'zk-v2';
  readonly algorithm: 'aes-256-gcm';
  readonly keyWrapping: KeyWrappingScheme;
  readonly keyId: string;
  readonly wrappedDek: string;
  readonly aad: string;
  readonly recoveryWrappedDek?: string;
}

export interface ZkV2EncryptedVaultEntryInput {
  readonly userId: string;
  readonly placeholderId: string;
  readonly sensitiveType: string;
  readonly encrypted: ZkV2EncryptedValue;
  readonly entryId?: string;
}

export type VaultEntryInput = ZkV2EncryptedVaultEntryInput;

// ---------------------------------------------------------------------------
// Retriever & Search
// ---------------------------------------------------------------------------

export interface RankedMemory {
  readonly memory: Memory;
  readonly score: number;
}

export interface RetrieveFilters {
  readonly userId: string;
  readonly temporalMode?: TemporalMode;
  readonly asOf?: string;
}

export interface RetrieveOptions {
  readonly topK?: number;
  readonly temporalMode?: TemporalMode;
  readonly asOf?: string;
  readonly sources?: readonly ('facts' | 'keywords' | 'episodes' | 'graph')[];
}

export interface RetrieveResult {
  readonly query: AnalyzedQuery;
  readonly memories: RankedMemory[];
  readonly metadata: {
    readonly totalFound: number;
    readonly topK: number;
  };
}

// ---------------------------------------------------------------------------
// Query Analysis
// ---------------------------------------------------------------------------

export type QueryIntent = 'factual_lookup' | 'contextual_search' | 'temporal_query';

export interface AnalyzedQuery {
  readonly intent: QueryIntent;
  readonly filters: {
    readonly topic?: string;
    readonly timeRange?: {
      readonly start?: string;
      readonly end?: string;
    };
    readonly agentScope?: string;
  };
  readonly suggestedTopK: number;
  readonly rewrittenQuery: string;
}

export interface QueryContext {
  readonly conversationHistory?: readonly Message[];
  readonly userId?: string;
}

// ---------------------------------------------------------------------------
// Orchestrator & Pipeline
// ---------------------------------------------------------------------------

export interface PipelineContext {
  [key: string]: unknown;
}

export interface PipelineStep {
  readonly name: string;
  execute(context: PipelineContext): Promise<PipelineContext>;
}

export interface StepError {
  readonly step: string;
  readonly error: string;
}

export interface IngestResult {
  readonly facts: Fact[];
  readonly decisions: ConsolidationResult[];
  readonly memoryIds: string[];
  readonly errors: StepError[];
}

export interface IngestOptions {
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Episodes (new — not in source repo)
// ---------------------------------------------------------------------------

export interface Episode {
  readonly id: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly messages: readonly Message[];
  readonly summary?: string;
  readonly summaryEmbedding?: number[];
  readonly participantCount?: number;
  readonly messageCount: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly storageTier: 'hot' | 'warm' | 'cold';
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

export interface EpisodeInput {
  readonly userId: string;
  readonly conversationId: string;
  readonly messages: readonly Message[];
  readonly summary?: string;
  readonly summaryEmbedding?: number[];
  readonly participantCount?: number;
  readonly messageCount: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly metadata?: Record<string, unknown>;
}

export interface RankedEpisode {
  readonly episode: Episode;
  readonly score: number;
}

// ---------------------------------------------------------------------------
// Entity & Graph (new — not in source repo)
// ---------------------------------------------------------------------------

export type EntityType = 'PERSON' | 'ORGANIZATION' | 'LOCATION' | 'EVENT' | 'PRODUCT' | 'OTHER';

export interface Entity {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly type: EntityType;
  readonly aliases: readonly string[];
  readonly summary?: string;
  readonly embedding?: number[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EntityInput {
  readonly userId: string;
  readonly name: string;
  readonly type: EntityType;
  readonly aliases?: readonly string[];
  readonly summary?: string;
  readonly embedding?: number[];
}

export interface Relationship {
  readonly id: string;
  readonly userId: string;
  readonly sourceEntityId: string;
  readonly targetEntityId: string;
  readonly relation: string;
  readonly fact?: string;
  readonly sourceMemoryId?: string;
  readonly embedding?: number[];
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly isInvalid: boolean;
  readonly createdAt: string;
}

export interface RelationshipInput {
  readonly userId: string;
  readonly sourceEntityId: string;
  readonly targetEntityId: string;
  readonly relation: string;
  readonly fact?: string;
  readonly sourceMemoryId?: string;
  readonly embedding?: number[];
  readonly validFrom?: string;
  readonly validUntil?: string;
}

export interface TraversalResult {
  readonly entity: Entity;
  readonly relation: string;
  readonly depth: number;
}

export interface RankedRelationship {
  readonly relationship: Relationship;
  readonly score: number;
}

// ---------------------------------------------------------------------------
// Key Management
// ---------------------------------------------------------------------------

export interface KeyPairWithStatus {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly created: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PromptConfig {
  readonly classifier?: string;
  readonly extractor?: string;
  readonly consolidator?: string;
  readonly episodeSummary?: string;
  readonly entityExtractor?: string;
}

export interface LocalConfig {
  readonly embedModel?: string;
  readonly dataDir?: string;
  readonly prompts?: PromptConfig;
}

// ---------------------------------------------------------------------------
// JSON Schema (for LlmClient.generate<T>())
// ---------------------------------------------------------------------------

export type JsonSchema = Record<string, unknown>;
