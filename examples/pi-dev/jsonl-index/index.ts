import {
  createPiJsonlIndexRuntime,
  type PiExtensionContextLike,
  type PiJsonlIndexRuntimeLike,
} from './src/extension-runtime.js';

interface PiExtensionApiLike {
  on(
    event: 'agent_end' | 'session_start' | 'session_shutdown',
    handler: (event: unknown, ctx: unknown) => Promise<void> | void,
  ): void;
}

const isContextLike = (ctx: unknown): ctx is PiExtensionContextLike =>
  typeof ctx === 'object' && ctx !== null && 'sessionManager' in ctx;

const notifyInitFailure = (ctx: PiExtensionContextLike, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  ctx.ui?.notify(`Pristine Pi JSONL index failed to initialize: ${message}`, 'error');
};

export const registerJsonlIndexExtension = (
  pi: PiExtensionApiLike,
  runtimeFactory: () => PiJsonlIndexRuntimeLike = createPiJsonlIndexRuntime,
): void => {
  let runtime: PiJsonlIndexRuntimeLike | null = null;
  const getRuntime = (ctx: PiExtensionContextLike): PiJsonlIndexRuntimeLike | null => {
    if (runtime !== null) return runtime;
    try {
      runtime = runtimeFactory();
      return runtime;
    } catch (error: unknown) {
      notifyInitFailure(ctx, error);
      return null;
    }
  };

  pi.on('agent_end', async (_event, ctx) => {
    if (!isContextLike(ctx)) return;
    const activeRuntime = getRuntime(ctx);
    if (activeRuntime === null) return;
    await activeRuntime.indexAfterAgentEnd(ctx);
  });

  pi.on('session_start', async (event, ctx) => {
    if (!isContextLike(ctx)) return;
    const activeRuntime = getRuntime(ctx);
    if (activeRuntime === null) return;
    const reason =
      typeof event === 'object' && event !== null && 'reason' in event
        ? String((event as { readonly reason?: unknown }).reason ?? 'startup')
        : 'startup';
    await activeRuntime.reconcileOnSessionStart(ctx, reason);
  });

  pi.on('session_shutdown', () => {
    runtime?.close();
    runtime = null;
  });
};

export default function jsonlIndexExtension(pi: PiExtensionApiLike): void {
  registerJsonlIndexExtension(pi);
}
