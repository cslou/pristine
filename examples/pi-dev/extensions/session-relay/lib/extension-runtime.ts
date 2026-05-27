import { existsSync } from 'node:fs';
import { resolvePiPristineDbPath } from '../../../shared/lib/db-path.js';
import { parsePiSessionJsonlFile } from '../../../shared/lib/pi-jsonl-session.js';
import {
  createSqliteSessionMetadataStore,
  type MemorySessionMetadata,
  type SessionMetadataStore,
} from './session-store.js';

export type PiSessionRelayLifecycleReason = 'startup' | 'reload' | 'resume' | 'new' | 'fork' | string;

export interface PiSessionRelayRuntimeConfig {
  readonly dbPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly store?: SessionMetadataStore;
  readonly now?: () => Date;
}

export interface PiSessionRelayRuntimeResult {
  readonly ok: boolean;
  readonly sessionFile?: string;
  readonly upserted: boolean;
  readonly skippedReason?: 'missing-session-file' | 'unpersisted-session' | 'no-visible-messages';
  readonly error?: string;
}

interface PiSessionManagerLike {
  getSessionFile(): string | undefined;
}

interface PiUiLike {
  notify(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void;
}

export interface PiSessionRelayContextLike {
  readonly sessionManager: PiSessionManagerLike;
  readonly ui?: PiUiLike;
}

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
): Promise<MemorySessionMetadata | null> => {
  const messages = await parsePiSessionJsonlFile(sessionFile);
  if (messages.length === 0) return null;

  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];
  if (firstMessage === undefined || lastMessage === undefined) return null;

  return {
    sourceHarness: 'pi',
    sourceUri: sessionFile,
    cwd: lastMessage.pointer.cwd ?? firstMessage.pointer.cwd ?? '',
    firstMessageAt: firstMessage.pointer.timestamp ?? '',
    lastMessageAt: lastMessage.pointer.timestamp ?? '',
    visibleMessageCount: messages.length,
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
  private readonly store: SessionMetadataStore;
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

      const metadata = await metadataFromSession(sessionFile, this.now);
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
