import {
  createPiSessionRelayRuntime,
  type PiSessionRelayContextLike,
  type PiSessionRelayLifecycleReason,
  type PiSessionRelayRuntimeLike,
} from './lib/extension-runtime.js';
export { createPiSessionRelayRuntime } from './lib/extension-runtime.js';

interface PiExtensionApiLike {
  on(
    event: 'agent_end' | 'session_start' | 'before_agent_start' | 'session_shutdown',
    handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown,
  ): void;
}

const isContextLike = (ctx: unknown): ctx is PiSessionRelayContextLike =>
  typeof ctx === 'object' && ctx !== null && 'sessionManager' in ctx;

const notifyInitFailure = (ctx: PiSessionRelayContextLike, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    ctx.ui?.notify(`Pristine session relay failed to initialize: ${message}`, 'error');
  } catch (notifyError: unknown) {
    void notifyError;
  }
};

const lifecycleReasonFrom = (event: unknown): PiSessionRelayLifecycleReason =>
  typeof event === 'object' && event !== null && 'reason' in event
    ? String((event as { readonly reason?: unknown }).reason ?? 'startup')
    : 'startup';

export const registerSessionRelayExtension = (
  pi: PiExtensionApiLike,
  runtimeFactory: () => PiSessionRelayRuntimeLike = createPiSessionRelayRuntime,
): void => {
  let runtime: PiSessionRelayRuntimeLike | null = null;
  const getRuntime = (ctx: PiSessionRelayContextLike): PiSessionRelayRuntimeLike | null => {
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
    await activeRuntime.recordActiveSession(ctx, 'agent_end');
  });

  pi.on('session_start', async (event, ctx) => {
    if (!isContextLike(ctx)) return;
    const activeRuntime = getRuntime(ctx);
    if (activeRuntime === null) return;
    await activeRuntime.recordActiveSession(ctx, `session_start:${lifecycleReasonFrom(event)}`);
  });

  pi.on('before_agent_start', async (event, ctx) => {
    if (!isContextLike(ctx)) return;
    const activeRuntime = getRuntime(ctx);
    if (activeRuntime === null) return;
    const result = await activeRuntime.injectPriorSessionRelay(ctx, event as { readonly systemPromptOptions?: { readonly cwd?: string } });
    if (result.message !== undefined) return { message: result.message };
    return undefined;
  });

  pi.on('session_shutdown', () => {
    runtime?.close();
    runtime = null;
  });
};

export default function sessionRelayExtension(pi: PiExtensionApiLike): void {
  registerSessionRelayExtension(pi);
}
