import {
  AppError,
  ConfigError,
  EmbedderError,
  InvalidArgumentError,
  SOURCE_CHUNK_METADATA_JSON_LIMIT,
  SOURCE_CHUNK_TEXT_LIMIT,
  SourceChunkStore,
  buildSourceChunkVectorDdl,
  createDatabase,
  initSourceChunkTables,
  normalizeSourceChunkInput,
  Pristine,
} from '@pristine/sdk';
import type {
  Embedder,
  ForgetResult,
  PristineConfig,
  RecalledMemory,
  SourceChunkInput,
  SourceChunkMetadata,
  SourceChunkNormalizeOptions,
  SourceChunkSearchOptions,
  SourceChunkStoreOptions,
  StoredMemory,
  StoredSourceChunk,
  StoreOptions,
} from '@pristine/sdk';

type PublicApiTypes = [
  Embedder,
  ForgetResult,
  PristineConfig,
  RecalledMemory,
  SourceChunkInput,
  SourceChunkMetadata,
  SourceChunkNormalizeOptions,
  SourceChunkSearchOptions,
  SourceChunkStoreOptions,
  StoredMemory,
  StoredSourceChunk,
  StoreOptions,
];

type PublicApiValues = [
  typeof AppError,
  typeof ConfigError,
  typeof EmbedderError,
  typeof InvalidArgumentError,
  typeof SOURCE_CHUNK_METADATA_JSON_LIMIT,
  typeof SOURCE_CHUNK_TEXT_LIMIT,
  typeof SourceChunkStore,
  typeof buildSourceChunkVectorDdl,
  typeof createDatabase,
  typeof initSourceChunkTables,
  typeof normalizeSourceChunkInput,
  typeof Pristine,
];

// @ts-expect-error Privacy APIs are intentionally removed from the public package.
import { secureAndRedact } from '@pristine/sdk';
// @ts-expect-error Privacy types are intentionally removed from the public package.
type RemovedPrivacyType = import('@pristine/sdk').SecureAndRedactResult;

const embedder: Embedder = {
  dim: 768,
  async embed(): Promise<number[]> {
    return Array.from({ length: 768 }, () => 0);
  },
  async embedBatch(texts: readonly string[]): Promise<number[][]> {
    return texts.map(() => Array.from({ length: 768 }, () => 0));
  },
};

const chunk: SourceChunkInput = {
  chunkId: 'memory-1',
  text: 'Project memory stays local.',
  sourceKind: 'fixture',
  sourceUri: 'fixture://memory',
  metadata: { durable: true },
};

const pristine = await Pristine.create({ embedder });
const stored: readonly StoredMemory[] = await pristine.store([chunk], { projectId: 'fixture' });
const recalled: readonly RecalledMemory[] = await pristine.recall('project memory', {
  projectId: 'fixture',
  limit: 1,
});
const forgotten: ForgetResult = pristine.forget([stored[0]!.chunkId], { projectId: 'fixture' });
const publicApiTypes: PublicApiTypes | null = null;
const publicApiValues: PublicApiValues | null = null;

void recalled;
void forgotten;
void secureAndRedact;
void (null as unknown as RemovedPrivacyType);
void publicApiTypes;
void publicApiValues;
await pristine.dispose();
