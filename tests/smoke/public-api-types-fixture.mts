import type {
  DeleteSourceChunksOptions,
  DeleteSourceChunksResult,
  DeterministicClassifierConfig,
  Embedder,
  IndexedSourceChunk,
  IndexSourceChunksOptions,
  PristineLocalConfig,
  RevealResult,
  SearchSourceChunksOptions,
  SecureAndRedactResult,
  SourceChunkInput,
  SourceChunkMetadata,
  SourceChunkNormalizeOptions,
  SourceChunkSearchHit,
  SourceChunkSearchOptions,
  SourceChunkStoreOptions,
  StoredSourceChunk,
} from '@pristine/shield-local';

type PublicRootTypes = [
  DeleteSourceChunksOptions,
  DeleteSourceChunksResult,
  DeterministicClassifierConfig,
  Embedder,
  IndexedSourceChunk,
  IndexSourceChunksOptions,
  PristineLocalConfig,
  RevealResult,
  SearchSourceChunksOptions,
  SecureAndRedactResult,
  SourceChunkInput,
  SourceChunkMetadata,
  SourceChunkNormalizeOptions,
  SourceChunkSearchHit,
  SourceChunkSearchOptions,
  SourceChunkStoreOptions,
  StoredSourceChunk,
];

const publicRootTypesFixture: PublicRootTypes | null = null;
void publicRootTypesFixture;
