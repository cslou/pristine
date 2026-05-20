// ---------------------------------------------------------------------------
// Source index
// ---------------------------------------------------------------------------

export type SourceChunkMetadata = Readonly<Record<string, unknown>>;

export interface SourceChunkInput {
  readonly text: string;
  readonly chunkId?: string;
  readonly sourceKind?: string;
  readonly sourceUri?: string;
  readonly entryId?: string;
  readonly parentId?: string;
  readonly lineNumber?: number;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly timestamp?: string;
  readonly metadata?: SourceChunkMetadata;
}

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

export interface ConversationDetail {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly messages: readonly Message[];
}

// ---------------------------------------------------------------------------
// Classification & Sensitivity
// ---------------------------------------------------------------------------

export type SensitivitySource = 'deterministic';

export type SensitivityType = string;

/** UTF-16 half-open [start, end) offsets into a text string. */
export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

/** UTF-16 half-open [start, end) offsets into the original source text. */
export type SourceSpan = TextSpan;

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

export type SourceSurfaceMetadata = Readonly<Record<string, unknown>>;

export interface SourceSurface {
  readonly kind?: string;
  readonly uri?: string;
  readonly entryId?: string;
  readonly parentId?: string;
  readonly lineNumber?: number;
  readonly metadata?: SourceSurfaceMetadata;
}

export type DetectSensitivityPreset = 'broad' | 'balanced' | 'strict';

export type BuiltInDetectCandidateKind =
  | 'private_key_block'
  | 'key_value_assignment'
  | 'auth_header'
  | 'known_provider_prefix'
  | 'structured_token'
  | 'credential_url'
  | 'cookie_or_session'
  | 'signed_url_or_query_secret'
  | 'cloud_credential_block'
  | 'recovery_or_seed_phrase'
  | 'opaque_generated_value';

export type DetectCandidateKind = BuiltInDetectCandidateKind | string;

export type PrivacyHintFeatureValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly boolean[];

export type PrivacyHintFeatures = Readonly<Record<string, PrivacyHintFeatureValue>>;

export interface DetectHint {
  readonly suggestedType?: SensitivityType;
  readonly provider?: string;
  readonly prefixFamily?: string;
  readonly nearbyName?: string;
  readonly signals?: readonly string[];
  readonly positiveSignals?: readonly string[];
  readonly negativeSignals?: readonly string[];
  readonly features?: PrivacyHintFeatures;
}

export interface DetectorRuleContext {
  readonly sourceSurface?: SourceSurface;
  readonly sensitivity?: DetectSensitivityPreset;
}

export interface DetectorRuleMatch {
  readonly sourceSpan: SourceSpan;
  readonly valueLength: number;
  readonly location?: SourceLocation;
  readonly hint?: DetectHint;
}

export interface DetectorRule {
  readonly ruleId: string;
  readonly kind: DetectCandidateKind;
  findCandidates(text: string, context: DetectorRuleContext): readonly DetectorRuleMatch[];
}

export interface DetectOptions {
  readonly sourceSurface?: SourceSurface;
  readonly sensitivity?: DetectSensitivityPreset;
  readonly enabledRuleIds?: readonly string[];
  readonly disabledRuleIds?: readonly string[];
  readonly customRules?: readonly DetectorRule[];
}

export interface DetectCandidate {
  readonly candidateId: string;
  readonly kind: DetectCandidateKind;
  readonly ruleId: string;
  readonly sourceSpan: SourceSpan;
  readonly valueLength: number;
  readonly location?: SourceLocation;
  readonly hint: DetectHint;
}

export interface DetectResult {
  readonly sourceSurface?: SourceSurface;
  readonly candidates: readonly DetectCandidate[];
}

export type DetectPrimitive = (text: string, options?: DetectOptions) => DetectResult;

export type ClassifierVerdict = 'secret' | 'not_secret' | 'uncertain';

export interface ClassifierRequestCandidate {
  readonly candidateId: string;
  readonly marker: string;
  readonly kind: DetectCandidateKind;
  readonly ruleId: string;
  readonly sourceSpan: SourceSpan;
  readonly valueLength: number;
  readonly location?: SourceLocation;
  readonly hint: DetectHint;
}

export interface ClassifierRequest {
  readonly requestId: string;
  readonly sourceSurface?: SourceSurface;
  readonly sanitizedContext: string;
  readonly candidates: readonly ClassifierRequestCandidate[];
}

interface ClassifierDecisionMetadata {
  readonly candidateId: string;
  readonly label?: string;
  readonly confidence?: number;
  readonly rationale?: string;
}

export interface SecretClassifierCallbackDecision extends ClassifierDecisionMetadata {
  readonly verdict: 'secret';
  readonly type: SensitivityType;
}

export interface NonSecretClassifierCallbackDecision extends ClassifierDecisionMetadata {
  readonly verdict: 'not_secret' | 'uncertain';
  readonly type?: SensitivityType;
}

export type ClassifierCallbackDecision =
  | SecretClassifierCallbackDecision
  | NonSecretClassifierCallbackDecision;

export interface ClassifierCallbackResult {
  readonly decisions: readonly ClassifierCallbackDecision[];
}

export type ClassifierCallback = (
  request: ClassifierRequest,
) => ClassifierCallbackResult | Promise<ClassifierCallbackResult>;

export interface ClassifyOptions {
  readonly requestId?: string;
  readonly sourceSurface?: SourceSurface;
  readonly contextWindow?: number;
}

interface ClassifyDecisionMetadata extends ClassifierDecisionMetadata {
  readonly sourceSpan: SourceSpan;
}

export interface SecretClassifyDecision extends ClassifyDecisionMetadata {
  readonly verdict: 'secret';
  readonly type: SensitivityType;
}

export interface NonSecretClassifyDecision extends ClassifyDecisionMetadata {
  readonly verdict: 'not_secret' | 'uncertain';
  readonly type?: SensitivityType;
}

export type ClassifyDecision = SecretClassifyDecision | NonSecretClassifyDecision;

export interface ClassifyResult {
  readonly decisions: readonly ClassifyDecision[];
}

export type ClassifyPrimitive = (
  text: string,
  candidates: readonly DetectCandidate[],
  classifierCallback: ClassifierCallback,
  options?: ClassifyOptions,
) => Promise<ClassifyResult>;

export interface RedactConfirmedSecret {
  readonly candidateId?: string;
  readonly sourceSpan: SourceSpan;
  readonly type: SensitivityType;
  readonly label?: string;
}

export interface RedactVaultStore {
  addEntries(entries: VaultEntryInput[]): Promise<VaultEntry[]>;
}

export interface RedactKeyManager {
  getOrCreateKeyPair(userId: string): Promise<KeyPairWithStatus>;
}

export interface RedactKekManager {
  getOrCreate(userId: string): Promise<Buffer>;
}

export interface RedactOptions {
  readonly sourceSurface?: SourceSurface;
  readonly vaultStore: RedactVaultStore;
  readonly keyManager: RedactKeyManager;
  readonly kekManager: RedactKekManager;
}

export interface RedactResultRedaction {
  readonly candidateId?: string;
  readonly sensitiveRef: SensitiveRef;
  readonly placeholder: string;
  readonly type: SensitivityType;
  readonly label?: string;
  readonly alias?: string;
  readonly sourceSpan: SourceSpan;
  readonly redactedSpan: TextSpan;
}

export interface RedactResult {
  readonly text: string;
  readonly redactions: readonly RedactResultRedaction[];
}

export type RedactPrimitive = (
  text: string,
  confirmed: readonly RedactConfirmedSecret[],
  userId: string,
  options: RedactOptions,
) => Promise<RedactResult>;

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

export type PrivacyBlockReason = 'safety_scan';

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
}

export type SecureAndRedactResult =
  | {
      readonly ok: true;
      readonly redactedText: string;
      readonly placeholderIds: readonly string[];
      readonly warnings?: readonly string[];
    }
  | {
      readonly ok: false;
      readonly redactedText: string;
      readonly reason: PrivacyBlockReason;
      readonly warnings?: readonly string[];
      readonly safetyViolations: readonly DetectedEntity[];
    };

export type SensitiveRef = string;

export interface SensitiveSummary {
  readonly sensitiveRef: SensitiveRef;
  readonly sensitiveType: string;
  readonly label: string;
  readonly alias?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListSensitiveOptions {
  readonly sensitiveType?: string;
  readonly limit?: number;
  readonly createdFrom?: string;
  readonly createdTo?: string;
}

export interface UpdateSensitiveInput {
  readonly alias?: string | null;
}

export interface DeleteSensitiveResult {
  readonly deletedCount: number;
  readonly missingSensitiveRefs: readonly SensitiveRef[];
}

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------

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
  readonly memoryIds: string[];
  readonly errors: StepError[];
}

export interface IngestOptions {
  readonly referenceTimestamp?: string;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Key Management
// ---------------------------------------------------------------------------

export interface KeyPairWithStatus {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly created: boolean;
}
