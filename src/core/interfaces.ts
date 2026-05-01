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
