import type {
  DeterministicClassifierConfig,
  Embedder,
  ForgetOptions,
  ForgetResult,
  PristineLocalConfig,
  RecalledMemory,
  RecallOptions,
  RevealResult,
  SecureAndRedactResult,
  SourceChunkInput,
  SourceChunkMetadata,
  SourceChunkNormalizeOptions,
  SourceChunkSearchOptions,
  SourceChunkStoreOptions,
  StoredMemory,
  StoredSourceChunk,
  StoreOptions,
} from '@pristine/shield-local';

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
} from '@pristine/shield-local';

type CanonicalPublicRootTypes = [
  DeterministicClassifierConfig,
  Embedder,
  ForgetOptions,
  ForgetResult,
  PristineLocalConfig,
  RecalledMemory,
  RecallOptions,
  RevealResult,
  SecureAndRedactResult,
  SourceChunkInput,
  SourceChunkMetadata,
  SourceChunkNormalizeOptions,
  SourceChunkSearchOptions,
  SourceChunkStoreOptions,
  StoredMemory,
  StoredSourceChunk,
  StoreOptions,
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
