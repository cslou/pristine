import type {
  DeleteSensitiveResult,
  DeterministicClassifierConfig,
  Embedder,
  ForgetOptions,
  ForgetResult,
  ListSensitiveOptions,
  PristineConfig,
  RecalledMemory,
  RecallOptions,
  RevealResult,
  SecureAndRedactResult,
  SensitiveRef,
  SensitiveSummary,
  SourceChunkInput,
  SourceChunkMetadata,
  SourceChunkNormalizeOptions,
  SourceChunkSearchOptions,
  SourceChunkStoreOptions,
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
  DeleteSensitiveResult,
  DeterministicClassifierConfig,
  Embedder,
  ForgetOptions,
  ForgetResult,
  ListSensitiveOptions,
  PristineConfig,
  RecalledMemory,
  RecallOptions,
  RevealResult,
  SecureAndRedactResult,
  SensitiveRef,
  SensitiveSummary,
  SourceChunkInput,
  SourceChunkMetadata,
  SourceChunkNormalizeOptions,
  SourceChunkSearchOptions,
  SourceChunkStoreOptions,
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

const canonicalPublicRootTypesFixture: CanonicalPublicRootTypes | null = null;
const deprecatedCompatibilityTypesFixture: DeprecatedCompatibilityTypes | null = null;
void canonicalPublicRootTypesFixture;
void deprecatedCompatibilityTypesFixture;
