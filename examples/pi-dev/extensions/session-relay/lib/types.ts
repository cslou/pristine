import type { PiJsonlBranchEntryLike } from '../../../shared/lib/pi-jsonl-session.js';
import type { MemorySessionRow, MemorySessionSourceHarness } from '../../../shared/lib/session-relay-schema.js';

export interface MemorySessionMetadata {
  readonly sourceHarness: MemorySessionSourceHarness;
  readonly sourceUri: string;
  readonly cwd: string;
  readonly firstMessageAt: string;
  readonly lastMessageAt: string;
  readonly visibleMessageCount: number;
  readonly activeEntryIds?: readonly string[];
  readonly updatedAt: string;
}

export interface HistoricalSessionQuery {
  readonly sourceHarness: MemorySessionSourceHarness;
  readonly cwd: string;
  readonly excludeSourceUri?: string;
}

export interface HistoricalSession {
  readonly sourceHarness: MemorySessionSourceHarness;
  readonly sourceUri: string;
  readonly cwd: string;
  readonly lastMessageAt: string;
  readonly activeEntryIds?: readonly string[];
}

export interface SessionMetadataWriter {
  upsertSession(metadata: MemorySessionMetadata): void;
  close?(): void;
}

export interface PriorSessionLookup {
  findLatestPriorSession(query: HistoricalSessionQuery): HistoricalSession | null;
}

export interface SessionMetadataStore extends SessionMetadataWriter, PriorSessionLookup {
  getSession(sourceHarness: MemorySessionSourceHarness, sourceUri: string): MemorySessionRow | null;
}

export interface PiSessionManagerLike {
  getSessionFile(): string | undefined;
  getBranch?(): readonly PiJsonlBranchEntryLike[];
}

export interface PiUiLike {
  notify(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void;
}

export interface PiSessionRelayContextLike {
  readonly sessionManager: PiSessionManagerLike;
  readonly ui?: PiUiLike;
}
