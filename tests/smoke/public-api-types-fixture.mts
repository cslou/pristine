import {
  classify,
  detect,
  redact,
  type BuiltInDetectCandidateKind,
  type ClassifierCallback,
  type ClassifierCallbackDecision,
  type ClassifierCallbackResult,
  type ClassifierRequest,
  type ClassifierRequestCandidate,
  type ClassifierVerdict,
  type ClassifyDecision,
  type ClassifyOptions,
  type ClassifyResult,
  type DeleteSensitiveResult,
  type DetectCandidate,
  type DetectCandidateKind,
  type DetectHint,
  type DetectOptions,
  type DetectResult,
  type DetectSensitivityPreset,
  type DeterministicClassifierConfig,
  type Embedder,
  type ForgetOptions,
  type ForgetResult,
  type ListSensitiveOptions,
  type PrivacyClassifier,
  type PrivacyDetector,
  type PrivacyHintFeatures,
  type PrivacyHintFeatureValue,
  type PrivacyRedactor,
  type PristineConfig,
  type RecalledMemory,
  type RecallOptions,
  type RedactConfirmedSecret,
  type RedactOptions,
  type RedactResult,
  type RedactResultRedaction,
  type RevealResult,
  type SensitiveRef,
  type SensitiveSummary,
  type SourceChunkInput,
  type SourceChunkMetadata,
  type SourceChunkNormalizeOptions,
  type SourceChunkSearchOptions,
  type SourceChunkStoreOptions,
  type SourceLocation,
  type SourceSpan,
  type SourceSurface,
  type SourceSurfaceMetadata,
  type StoredMemory,
  type StoredSourceChunk,
  type StoreOptions,
  type UpdateSensitiveInput,
} from '@pristine/sdk';

// Deprecated compatibility exports for the pre-store/recall/forget memory API.
// They stay importable for existing consumers, but new code should prefer the
// canonical verb-oriented types above.
import type {
  DeleteSourceChunksOptions,
  DeleteSourceChunksResult,
  IndexedSourceChunk,
  IndexSourceChunksOptions,
  SearchSourceChunksOptions,
  SourceChunkSearchHit,
} from '@pristine/sdk';

type CanonicalPublicRootTypes = [
  BuiltInDetectCandidateKind,
  ClassifierCallback,
  ClassifierCallbackDecision,
  ClassifierCallbackResult,
  ClassifierRequest,
  ClassifierRequestCandidate,
  ClassifierVerdict,
  ClassifyDecision,
  ClassifyOptions,
  ClassifyResult,
  DeleteSensitiveResult,
  DetectCandidate,
  DetectCandidateKind,
  DetectHint,
  DetectOptions,
  DetectResult,
  DetectSensitivityPreset,
  DeterministicClassifierConfig,
  Embedder,
  ForgetOptions,
  ForgetResult,
  ListSensitiveOptions,
  PrivacyClassifier,
  PrivacyDetector,
  PrivacyHintFeatures,
  PrivacyHintFeatureValue,
  PrivacyRedactor,
  PristineConfig,
  RecalledMemory,
  RecallOptions,
  RedactConfirmedSecret,
  RedactOptions,
  RedactResult,
  RedactResultRedaction,
  RevealResult,
  SensitiveRef,
  SensitiveSummary,
  SourceChunkInput,
  SourceChunkMetadata,
  SourceChunkNormalizeOptions,
  SourceChunkSearchOptions,
  SourceChunkStoreOptions,
  SourceLocation,
  SourceSpan,
  SourceSurface,
  SourceSurfaceMetadata,
  StoredMemory,
  StoredSourceChunk,
  StoreOptions,
  UpdateSensitiveInput,
];

type DeprecatedCompatibilityTypes = [
  DeleteSourceChunksOptions,
  DeleteSourceChunksResult,
  IndexedSourceChunk,
  IndexSourceChunksOptions,
  SearchSourceChunksOptions,
  SourceChunkSearchHit,
];

// @ts-expect-error SecureAndRedactResult is intentionally removed from the root public type surface.
type RemovedSecureAndRedactResult = import('@pristine/sdk').SecureAndRedactResult;

const detectResult = detect('no secrets here');
const primitiveFunctionFixture = [detect, classify, redact] as const;
const canonicalPublicRootTypesFixture: CanonicalPublicRootTypes | null = null;
const deprecatedCompatibilityTypesFixture: DeprecatedCompatibilityTypes | null = null;
const removedSecureAndRedactResultFixture: RemovedSecureAndRedactResult | null = null;
void detectResult;
void primitiveFunctionFixture;
void canonicalPublicRootTypesFixture;
void deprecatedCompatibilityTypesFixture;
void removedSecureAndRedactResultFixture;
