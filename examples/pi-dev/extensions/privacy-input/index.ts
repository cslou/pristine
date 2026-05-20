import {
  createPrivacyInputRuntime,
  type PrivacyInputEventLike,
  type PrivacyInputRuntimeConfig,
  type PrivacyInputRuntimeLike,
} from './lib/runtime.js';

interface PiInputContextLike {
  readonly ui?: {
    notify(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void;
  };
}

interface PiExtensionApiLike {
  on(
    event: 'input' | 'session_shutdown',
    handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown,
  ): void;
}

const isInputEventLike = (event: unknown): event is PrivacyInputEventLike =>
  typeof event === 'object' &&
  event !== null &&
  'text' in event &&
  typeof (event as { readonly text?: unknown }).text === 'string';

const notifyInitFailure = (ctx: unknown, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  if (typeof ctx !== 'object' || ctx === null) return;
  const maybeContext = ctx as PiInputContextLike;
  maybeContext.ui?.notify(`Pristine privacy input failed to initialize: ${message}`, 'error');
};

export const registerPrivacyInputExtension = (
  pi: PiExtensionApiLike,
  runtimeFactory: (ctx: unknown) => PrivacyInputRuntimeLike | Promise<PrivacyInputRuntimeLike>,
): void => {
  let runtime: PrivacyInputRuntimeLike | null = null;
  const getRuntime = async (ctx: unknown): Promise<PrivacyInputRuntimeLike | null> => {
    if (runtime !== null) return runtime;
    try {
      runtime = await runtimeFactory(ctx);
      return runtime;
    } catch (error: unknown) {
      notifyInitFailure(ctx, error);
      return null;
    }
  };

  pi.on('input', async (event, ctx) => {
    if (!isInputEventLike(event)) return { action: 'continue' };
    if (event.source === 'extension') return { action: 'continue' };
    const activeRuntime = await getRuntime(ctx);
    if (activeRuntime === null) return { action: 'handled' };
    return activeRuntime.handleInput(event);
  });

  pi.on('session_shutdown', () => {
    runtime?.close();
    runtime = null;
  });
};

export const createDefaultPrivacyInputRuntimeFactory =
  (
    config: PrivacyInputRuntimeConfig,
  ): ((ctx: unknown) => PrivacyInputRuntimeLike | Promise<PrivacyInputRuntimeLike>) =>
  () =>
    createPrivacyInputRuntime(config);

export default function privacyInputExtension(pi: PiExtensionApiLike): void {
  registerPrivacyInputExtension(pi, () => {
    throw new Error(
      'Configure the Pristine privacy-input runtime with detector, classifier, redactor, policy, and user ID dependencies before enabling this reference extension.',
    );
  });
}
