export type { SourceChunkInput, SourceChunkMetadata } from '../../core/types.js';

export interface StoredSourceChunk {
  readonly chunkId: string;
  readonly projectId: string;
  readonly text: string;
  readonly sourceKind: string | null;
  readonly sourceUri: string | null;
  readonly entryId: string | null;
  readonly parentId: string | null;
  readonly lineNumber: number | null;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
  readonly timestamp: string | null;
  readonly metadataJson: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SourceChunkNormalizeOptions {
  readonly projectId: string;
}

export interface SourceChunkStoreOptions extends SourceChunkNormalizeOptions {
  readonly embedding: readonly number[];
}
