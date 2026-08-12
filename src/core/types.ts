export type SourceChunkMetadata = Readonly<Record<string, unknown>>;

export interface SourceChunkInput {
  readonly text: string;
  readonly chunkId?: string;
  readonly sourceKind?: string;
  readonly sourceUri?: string;
  readonly entryId?: string;
  readonly parentId?: string;
  readonly lineNumber?: number;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly timestamp?: string;
  readonly metadata?: SourceChunkMetadata;
}
