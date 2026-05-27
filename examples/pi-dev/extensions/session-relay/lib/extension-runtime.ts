import { existsSync } from 'node:fs';
import { resolvePiPristineDbPath } from '../../../shared/lib/db-path.js';
import {
  activeEntryIdsFromBranchEntries,
  deriveActiveEntryIdsFromPiSessionFile,
  summarizePiSessionJsonlFile,
} from '../../../shared/lib/pi-jsonl-session.js';
import { createSqliteSessionMetadataStore } from './session-store.js';
import type {
  MemorySessionMetadata,
  PiSessionRelayContextLike,
  SessionMetadataWriter,
} from './types.js';

export type PiSessionRelayLifecycleReason = 'startup' | 'reload' | 'resume' | 'new' | 'fork' | string;

export interface PiSessionRelayRuntimeConfig {
  readonly dbPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly store?: SessionMetadataWriter;
  readonly now?: () => Date;
}

export interface PiSessionRelayRuntimeResult {
  readonly ok: boolean;
  readonly sessionFile?: string;
  readonly upserted: boolean;
  readonly skippedReason?: 'missing-session-file' | 'unpersisted-session' | 'no-visible-messages';
  readonly error?: string;
}

export type { PiSessionRelayContextLike } from './types.js';

const notify = (
  ctx: PiSessionRelayContextLike,
  message: string,
  level: 'info' | 'success' | 'warning' | 'error',
): void => {
  try {
    ctx.ui?.notify(message, level);
  } catch (error: unknown) {
    void error;
  }
};

const metadataFromSession = async (
  sessionFile: string,
  now: () => Date,
  activeEntryIds?: ReadonlySet<string>,
): Promise<MemorySessionMetadata | null> => {
  const summary = await summarizePiSessionJsonlFile(sessionFile, { activeEntryIds });
  if (summary.visibleMessageCount === 0) return null;

  return {
    sourceHarness: 'pi',
    sourceUri: sessionFile,
    cwd: summary.cwd ?? '',
    firstMessageAt: summary.firstMessageAt ?? '',
    lastMessageAt: summary.lastMessageAt ?? '',
    visibleMessageCount: summary.visibleMessageCount,
    updatedAt: now().toISOString(),
  };
};

export interface PiSessionRelayRuntimeLike {
  recordActiveSession(
    ctx: PiSessionRelayContextLike,
    trigger: string,
  ): Promise<PiSessionRelayRuntimeResult>;
  close(): void;
}

export class PiSessionRelayRuntime implements PiSessionRelayRuntimeLike {
  private readonly store: SessionMetadataWriter;
  private readonly now: () => Date;

  public constructor(config: PiSessionRelayRuntimeConfig = {}) {
    this.store =
      config.store ??
      createSqliteSessionMetadataStore({
        dbPath: resolvePiPristineDbPath({
          explicitPath: config.dbPath,
          env: config.env,
          homeDir: config.homeDir,
        }),
      });
    this.now = config.now ?? (() => new Date());
  }

  public async recordActiveSession(
    ctx: PiSessionRelayContextLike,
    trigger: string,
  ): Promise<PiSessionRelayRuntimeResult> {
    let sessionFile: string | undefined;
    try {
      sessionFile = ctx.sessionManager.getSessionFile();
      if (sessionFile === undefined) {
        return { ok: true, upserted: false, skippedReason: 'unpersisted-session' };
      }
      if (!existsSync(sessionFile)) {
        return {
          ok: true,
          sessionFile,
          upserted: false,
          skippedReason: 'missing-session-file',
        };
      }

      const contextEntryIds = activeEntryIdsFromBranchEntries(ctx.sessionManager.getBranch?.());
      const activeEntryIds =
        contextEntryIds !== undefined && contextEntryIds.size === 0
          ? await deriveActiveEntryIdsFromPiSessionFile(sessionFile)
          : contextEntryIds;
      const metadata = await metadataFromSession(sessionFile, this.now, activeEntryIds);
      if (metadata === null) {
        return {
          ok: true,
          sessionFile,
          upserted: false,
          skippedReason: 'no-visible-messages',
        };
      }

      this.store.upsertSession(metadata);
      return { ok: true, sessionFile, upserted: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      notify(ctx, `Pristine session relay metadata failed (${trigger}): ${message}`, 'warning');
      return { ok: false, sessionFile, upserted: false, error: message };
    }
  }

  public close(): void {
    this.store.close?.();
  }
}

export const createPiSessionRelayRuntime = (
  config: PiSessionRelayRuntimeConfig = {},
): PiSessionRelayRuntime => new PiSessionRelayRuntime(config);
