import type {
  ClassificationPipelineResult,
  ClassifierCallback,
  ClassifyOptions,
  ClassifyResult,
  DetectCandidate,
  DetectOptions,
  DetectResult,
  DeleteSensitiveResult,
  PublicKeyWithStatus,
  ListSensitiveOptions,
  RedactConfirmedSecret,
  RedactOptions,
  RedactResult,
  SensitivityReport,
  SensitiveRef,
  SensitiveSummary,
  UpdateSensitiveInput,
  VaultEntry,
  VaultEntryInput,
} from './types.js';

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

export interface Embedder {
  /**
   * Vector dimensionality this embedder produces. Pinned at construction —
   * a single SDK instance writes at exactly this dim, and source-index
   * vector DDL is templated to match. Cross-dim migration of an
   * existing on-disk index is unsupported: `vec0` virtual tables don't
   * support `ALTER`, so changing dim after writes have landed requires
   * `DROP + CREATE` + corpus re-embedding (out of scope for the SDK).
   */
  readonly dim: number;
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

export interface PrivacyDetector {
  detect(text: string, options?: DetectOptions): DetectResult;
}

export interface PrivacyClassifier {
  classify(
    text: string,
    candidates: readonly DetectCandidate[],
    classifierCallback: ClassifierCallback,
    options?: ClassifyOptions,
  ): Promise<ClassifyResult>;
}

export interface PrivacyRedactor {
  redact(
    text: string,
    confirmed: readonly RedactConfirmedSecret[],
    userId: string,
    options?: RedactOptions,
  ): Promise<RedactResult>;
}

// ---------------------------------------------------------------------------
// Key Management
// ---------------------------------------------------------------------------

export interface KeyManager {
  getOrCreatePublicKey(userId: string): Promise<PublicKeyWithStatus>;
  unwrap(userId: string, wrappedValue: Buffer): Promise<Buffer>;
  prepareKeyPairRotation(userId: string): Promise<{
    readonly publicKey: string;
    commit(): Promise<void>;
    rollback(): Promise<void>;
  }>;
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

export interface VaultStore {
  addEntries(entries: VaultEntryInput[]): Promise<VaultEntry[]>;
  getEntriesByPlaceholderIds(userId: string, placeholderIds: string[]): Promise<VaultEntry[]>;
  listEntries(userId: string, options?: ListSensitiveOptions): Promise<readonly SensitiveSummary[]>;
  getEntry(userId: string, sensitiveRef: SensitiveRef): Promise<SensitiveSummary | null>;
  updateEntry(
    userId: string,
    sensitiveRef: SensitiveRef,
    input: UpdateSensitiveInput,
  ): Promise<SensitiveSummary>;
  deleteEntries(
    userId: string,
    sensitiveRefs: readonly SensitiveRef[],
  ): Promise<DeleteSensitiveResult>;
}
