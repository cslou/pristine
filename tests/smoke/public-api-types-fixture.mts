import {
  classify,
  detect,
  redact,
  type BuiltInDetectCandidateKind,
  ClassifierCallback,
  ClassifierCallbackDecision,
  ClassifierCallbackResult,
  ClassifierRequest,
  ClassifierRequestCandidate,
  ClassifierVerdict,
  ClassifyDecision,
  ClassifyOptions,
  ClassifyPrimitive,
  ClassifyResult,
  DeleteSensitiveResult,
  DetectCandidate,
  DetectCandidateKind,
  DetectHint,
  DetectOptions,
  DetectPrimitive,
  DetectResult,
  DetectSensitivityPreset,
  DeterministicClassifierConfig,
  Embedder,
  ForgetOptions,
  ForgetResult,
  ListSensitiveOptions,
  NonSecretClassifierCallbackDecision,
  NonSecretClassifyDecision,
  PrivacyClassifier,
  PrivacyDetector,
  PrivacyHintFeatures,
  PrivacyHintFeatureValue,
  PrivacyRedactor,
  Pristine,
  PristineConfig,
  RecalledMemory,
  RecallOptions,
  RedactConfirmedSecret,
  RedactKeyManager,
  RedactKekManager,
  RedactOptions,
  RedactPrimitive,
  RedactResult,
  RedactResultRedaction,
  RedactVaultStore,
  RevealResult,
  SecretClassifierCallbackDecision,
  SecretClassifyDecision,
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
  TextSpan,
  StoredMemory,
  StoredSourceChunk,
  StoreOptions,
  UpdateSensitiveInput,
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
  ClassifyPrimitive,
  ClassifyResult,
  DeleteSensitiveResult,
  DetectCandidate,
  DetectCandidateKind,
  DetectHint,
  DetectOptions,
  DetectPrimitive,
  DetectResult,
  DetectSensitivityPreset,
  DeterministicClassifierConfig,
  Embedder,
  ForgetOptions,
  ForgetResult,
  ListSensitiveOptions,
  NonSecretClassifierCallbackDecision,
  NonSecretClassifyDecision,
  PrivacyClassifier,
  PrivacyDetector,
  PrivacyHintFeatures,
  PrivacyHintFeatureValue,
  PrivacyRedactor,
  Pristine,
  PristineConfig,
  RecalledMemory,
  RecallOptions,
  RedactConfirmedSecret,
  RedactKeyManager,
  RedactKekManager,
  RedactOptions,
  RedactPrimitive,
  RedactResult,
  RedactResultRedaction,
  RedactVaultStore,
  RevealResult,
  SecretClassifierCallbackDecision,
  SecretClassifyDecision,
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
  TextSpan,
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

declare const pristineClient: Pristine;
// @ts-expect-error secureAndRedact is intentionally removed from the public Pristine client surface.
const removedClientSecureAndRedact = pristineClient.secureAndRedact;

const classifyResult = classify('no secrets here', [], async () => ({ decisions: [] }));
const detectResult = detect('no secrets here');
const redactResult = redact('no secrets here', [], 'user-1', {
  vaultStore: {} as RedactVaultStore,
  keyManager: {} as RedactKeyManager,
  kekManager: {} as RedactKekManager,
});
const detectPrimitiveFixture: DetectPrimitive = (_text, options) =>
  options?.sourceSurface
    ? { sourceSurface: options.sourceSurface, candidates: [] }
    : { candidates: [] };
const classifyPrimitiveFixture: ClassifyPrimitive = async (
  _text,
  _candidates,
  _classifierCallback,
  _options,
) => ({ decisions: [] });
const redactPrimitiveFixture: RedactPrimitive = async (_text, _confirmed, _userId, _options) => ({
  text: _text,
  redactions: [],
});
const canonicalPublicRootTypesFixture: CanonicalPublicRootTypes | null = null;
const deprecatedCompatibilityTypesFixture: DeprecatedCompatibilityTypes | null = null;
const removedSecureAndRedactResultFixture: RemovedSecureAndRedactResult | null = null;
void classifyResult;
void detectResult;
void redactResult;
void detectPrimitiveFixture;
void classifyPrimitiveFixture;
void redactPrimitiveFixture;
void removedClientSecureAndRedact;
void canonicalPublicRootTypesFixture;
void deprecatedCompatibilityTypesFixture;
void removedSecureAndRedactResultFixture;
