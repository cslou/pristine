import { existsSync } from 'node:fs';
import { resolvePiPristineDbPath } from '../../../shared/lib/db-path.js';
import {
  activeEntryIdsFromBranchEntries,
  deriveActiveEntryIdsFromPiSessionFile,
  parsePiSessionJsonlFile,
  type PiJsonlBranchEntryLike,
} from '../../../shared/lib/pi-jsonl-session.js';
import { LocalNomicEmbedder } from './local-embedder.js';
import {
  createSqlitePiJsonlSourceIndexer,
  type PiJsonlIndexResult,
  type PiJsonlSourceIndexer,
} from './source-index.js';

export type PiLifecycleReason = 'startup' | 'reload' | 'resume' | 'new' | 'fork' | string;

export interface PiJsonlIndexRuntimeConfig {
  readonly dbPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly indexer?: PiJsonlSourceIndexer;
}

export interface PiJsonlIndexRuntimeResult {
  readonly ok: boolean;
  readonly sessionFile?: string;
  readonly indexed: number;
  readonly skippedDuplicate: number;
  readonly error?: string;
}

interface PiSessionManagerLike {
  getSessionFile(): string | undefined;
  getBranch?(): readonly PiJsonlBranchEntryLike[];
}

interface PiUiLike {
  notify(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void;
}

export interface PiExtensionContextLike {
  readonly sessionManager: PiSessionManagerLike;
  readonly ui?: PiUiLike;
}

const activeEntryIdsFrom = (ctx: PiExtensionContextLike): ReadonlySet<string> | undefined =>
  activeEntryIdsFromBranchEntries(ctx.sessionManager.getBranch?.());

const notify = (
  ctx: PiExtensionContextLike,
  message: string,
  level: 'info' | 'success' | 'warning' | 'error',
): void => {
  try {
    ctx.ui?.notify(message, level);
  } catch (error: unknown) {
    void error;
    // Pi can mark event contexts stale during non-interactive session replacement.
    // Indexing should not fail only because the optional UI notification could not render.
  }
};

export interface PiJsonlIndexRuntimeLike {
  indexAfterAgentEnd(ctx: PiExtensionContextLike): Promise<PiJsonlIndexRuntimeResult>;
  reconcileOnSessionStart(
    ctx: PiExtensionContextLike,
    reason: PiLifecycleReason,
  ): Promise<PiJsonlIndexRuntimeResult>;
  close(): void;
}

export class PiJsonlIndexRuntime implements PiJsonlIndexRuntimeLike {
  private readonly indexer: PiJsonlSourceIndexer;

  public constructor(config: PiJsonlIndexRuntimeConfig = {}) {
    this.indexer =
      config.indexer ??
      createSqlitePiJsonlSourceIndexer({
        dbPath: resolvePiPristineDbPath({
          explicitPath: config.dbPath,
          env: config.env,
          homeDir: config.homeDir,
        }),
        embedder: new LocalNomicEmbedder(),
      });
  }

  public async indexAfterAgentEnd(ctx: PiExtensionContextLike): Promise<PiJsonlIndexRuntimeResult> {
    return this.indexActiveSession(ctx, 'agent_end');
  }

  public async reconcileOnSessionStart(
    ctx: PiExtensionContextLike,
    reason: PiLifecycleReason,
  ): Promise<PiJsonlIndexRuntimeResult> {
    return this.indexActiveSession(ctx, `session_start:${reason}`);
  }

  private async indexActiveSession(
    ctx: PiExtensionContextLike,
    trigger: string,
  ): Promise<PiJsonlIndexRuntimeResult> {
    let sessionFile: string | undefined;
    try {
      sessionFile = ctx.sessionManager.getSessionFile();
      if (sessionFile === undefined) {
        notify(
          ctx,
          `Pristine Pi JSONL index skipped (${trigger}): active session is not persisted`,
          'info',
        );
        return { ok: true, indexed: 0, skippedDuplicate: 0 };
      }
      if (!existsSync(sessionFile) && trigger === 'session_start:startup') {
        notify(
          ctx,
          `Pristine Pi JSONL index skipped (${trigger}): session file is not created yet`,
          'info',
        );
        return { ok: true, sessionFile, indexed: 0, skippedDuplicate: 0 };
      }

      const contextEntryIds = activeEntryIdsFrom(ctx);
      const activeEntryIds =
        contextEntryIds !== undefined && contextEntryIds.size === 0
          ? await deriveActiveEntryIdsFromPiSessionFile(sessionFile)
          : contextEntryIds;
      if (activeEntryIds !== undefined && activeEntryIds.size > 0) {
        this.indexer.reconcileActiveEntries?.(sessionFile, activeEntryIds);
      }
      const parsed = await parsePiSessionJsonlFile(sessionFile, {
        activeEntryIds,
      });
      const result: PiJsonlIndexResult = await this.indexer.indexMessages(parsed);
      notify(
        ctx,
        `Pristine indexed ${result.indexed} Pi JSONL entries (${result.skippedDuplicate} already indexed)`,
        'success',
      );
      return {
        ok: true,
        sessionFile,
        indexed: result.indexed,
        skippedDuplicate: result.skippedDuplicate,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      notify(ctx, `Pristine Pi JSONL index failed (${trigger}): ${message}`, 'error');
      return { ok: false, sessionFile, indexed: 0, skippedDuplicate: 0, error: message };
    }
  }
  public close(): void {
    this.indexer.close?.();
  }
}

export const createPiJsonlIndexRuntime = (
  config: PiJsonlIndexRuntimeConfig = {},
): PiJsonlIndexRuntime => new PiJsonlIndexRuntime(config);
