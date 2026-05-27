import type { PiJsonlBranchEntryLike } from '../../../shared/lib/pi-jsonl-session.js';
import type { MemorySessionRow, MemorySessionSourceHarness } from '../../../shared/lib/session-relay-schema.js';

export interface MemorySessionMetadata {
  readonly sourceHarness: MemorySessionSourceHarness;
  readonly sourceUri: string;
  readonly cwd: string;
  readonly firstMessageAt: string;
  readonly lastMessageAt: string;
  readonly visibleMessageCount: number;
  readonly updatedAt: string;
}

export interface SessionMetadataStore {
  upsertSession(metadata: MemorySessionMetadata): void;
  getSession(sourceHarness: MemorySessionSourceHarness, sourceUri: string): MemorySessionRow | null;
  close?(): void;
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
