import type {
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
  RedactPrimitive,
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
  RedactPrimitive,
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
void detectPrimitiveFixture;
void classifyPrimitiveFixture;
void redactPrimitiveFixture;
void canonicalPublicRootTypesFixture;
void deprecatedCompatibilityTypesFixture;
void removedSecureAndRedactResultFixture;
