import type {
  ClassificationPipelineResult,
  KeyPairWithStatus,
  SensitivityReport,
  VaultEntry,
  VaultEntryInput,
} from './types.js';

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

export interface Embedder {
  /**
   * Vector dimensionality this embedder produces. Pinned at construction —
   * a single SDK instance writes at exactly this dim, and `vec_windows` /
   * `vec_sessions` DDL is templated to match. Cross-dim migration of an
   * existing on-disk corpus is unsupported: `vec0` virtual tables don't
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
