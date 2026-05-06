import {
  createPiJsonlIndexRuntime,
  type PiExtensionContextLike,
} from './src/extension-runtime.js';

interface PiExtensionApiLike {
  on(event: 'agent_end' | 'session_start', handler: (event: unknown, ctx: unknown) => Promise<void>): void;
}

const isContextLike = (ctx: unknown): ctx is PiExtensionContextLike =>
  typeof ctx === 'object' && ctx !== null && 'sessionManager' in ctx;

export default function jsonlIndexExtension(pi: PiExtensionApiLike): void {
  const runtime = createPiJsonlIndexRuntime();

  pi.on('agent_end', async (_event, ctx) => {
    if (!isContextLike(ctx)) return;
    await runtime.indexAfterAgentEnd(ctx);
  });

  pi.on('session_start', async (event, ctx) => {
    if (!isContextLike(ctx)) return;
    const reason =
      typeof event === 'object' && event !== null && 'reason' in event
        ? String((event as { readonly reason?: unknown }).reason ?? 'startup')
        : 'startup';
    await runtime.reconcileOnSessionStart(ctx, reason);
  });
}
