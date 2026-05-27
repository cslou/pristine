import { existsSync } from 'node:fs';
import { resolvePiPristineDbPath } from '../../../shared/lib/db-path.js';
import {
  activeEntryIdsFromBranchEntries,
  deriveActiveEntryIdsFromPiSessionFile,
  summarizePiSessionJsonlFile,
} from '../../../shared/lib/pi-jsonl-session.js';
import { loadBoundedPiPriorSessionMessages } from './prior-session.js';
import { generatePriorSessionHandoff, type RelaySummarizer } from './relay-generator.js';
import { createSqliteSessionMetadataStore } from './session-store.js';
import type {
  MemorySessionMetadata,
  PiSessionRelayContextLike,
  SessionMetadataStore,
} from './types.js';

export type PiSessionRelayLifecycleReason = 'startup' | 'reload' | 'resume' | 'new' | 'fork' | string;

export interface PiSessionRelayRuntimeConfig {
  readonly dbPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly store?: SessionMetadataStore;
  readonly now?: () => Date;
  readonly summarizer?: RelaySummarizer;
  readonly relayCharBudget?: number;
}

export interface PiSessionRelayRuntimeResult {
  readonly ok: boolean;
  readonly sessionFile?: string;
  readonly upserted: boolean;
  readonly skippedReason?: 'missing-session-file' | 'unpersisted-session' | 'no-visible-messages';
  readonly error?: string;
}

export interface PiBeforeAgentStartEventLike {
  readonly systemPromptOptions?: {
    readonly cwd?: string;
  };
}

export interface PiCustomContextMessageLike {
  readonly customType: string;
  readonly content: string;
  readonly display: boolean;
}

export interface PiSessionRelayInjectionResult {
  readonly ok: boolean;
  readonly injected: boolean;
  readonly message?: PiCustomContextMessageLike;
  readonly warning?: string;
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
    ...(activeEntryIds !== undefined ? { activeEntryIds: [...activeEntryIds] } : {}),
    updatedAt: now().toISOString(),
  };
};

export interface PiSessionRelayRuntimeLike {
  recordActiveSession(
    ctx: PiSessionRelayContextLike,
    trigger: string,
  ): Promise<PiSessionRelayRuntimeResult>;
  injectPriorSessionRelay(
    ctx: PiSessionRelayContextLike,
    event: PiBeforeAgentStartEventLike,
  ): Promise<PiSessionRelayInjectionResult>;
  close(): void;
}

export class PiSessionRelayRuntime implements PiSessionRelayRuntimeLike {
  private readonly store: SessionMetadataStore;
  private readonly now: () => Date;
  private readonly summarizer?: RelaySummarizer;
  private readonly relayCharBudget: number;
  private readonly injectedSessionFiles = new Set<string>();

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
    this.summarizer = config.summarizer;
    this.relayCharBudget = config.relayCharBudget ?? 12000;
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

  public async injectPriorSessionRelay(
    ctx: PiSessionRelayContextLike,
    event: PiBeforeAgentStartEventLike,
  ): Promise<PiSessionRelayInjectionResult> {
    const currentSessionFile = ctx.sessionManager.getSessionFile();
    if (currentSessionFile === undefined || this.injectedSessionFiles.has(currentSessionFile)) {
      return { ok: true, injected: false };
    }

    try {
      const cwd = event.systemPromptOptions?.cwd;
      if (cwd === undefined || cwd.trim().length === 0 || this.summarizer === undefined) {
        return { ok: true, injected: false };
      }
      const priorSession = this.store.findLatestPriorSession({
        sourceHarness: 'pi',
        cwd,
        excludeSourceUri: currentSessionFile,
      });
      if (priorSession === null) return { ok: true, injected: false };

      const loaded = await loadBoundedPiPriorSessionMessages({
        session: priorSession,
        charBudget: this.relayCharBudget,
      });
      const generated = await generatePriorSessionHandoff({
        session: priorSession,
        messages: loaded.messages,
        summarizer: this.summarizer,
      });
      if (!generated.ok) {
        const warning = `Pristine session relay skipped: ${generated.error}`;
        notify(ctx, warning, 'warning');
        return { ok: false, injected: false, warning, error: generated.error };
      }

      this.injectedSessionFiles.add(currentSessionFile);
      return {
        ok: true,
        injected: true,
        message: {
          customType: 'pristine-session-relay',
          content: generated.content,
          display: false,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const warning = `Pristine session relay skipped: ${message}`;
      notify(ctx, warning, 'warning');
      return { ok: false, injected: false, warning, error: message };
    }
  }

  public close(): void {
    this.store.close?.();
  }
}

export const createPiSessionRelayRuntime = (
  config: PiSessionRelayRuntimeConfig = {},
): PiSessionRelayRuntime => new PiSessionRelayRuntime(config);
