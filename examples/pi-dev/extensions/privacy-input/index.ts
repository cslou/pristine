import {
  createPrivacyInputRuntime,
  type PrivacyInputEventLike,
  type PrivacyInputRuntimeConfig,
  type PrivacyInputRuntimeLike,
  type PrivacyInputToolCallEventLike,
  type PrivacyInputToolResultEventLike,
} from './lib/runtime.js';
import { containsSensitivePlaceholder } from './lib/tool-boundary.js';

interface PiInputContextLike {
  readonly ui?: {
    notify(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void;
  };
}

interface PiExtensionApiLike {
  on(
    event: 'input' | 'session_shutdown' | 'tool_call' | 'tool_result',
    handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown,
  ): void;
}

const isRecordLike = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const isInputEventLike = (event: unknown): event is PrivacyInputEventLike =>
  isRecordLike(event) && 'text' in event && typeof event.text === 'string';

const isToolCallEventLike = (event: unknown): event is PrivacyInputToolCallEventLike =>
  isRecordLike(event) &&
  typeof event.toolCallId === 'string' &&
  typeof event.toolName === 'string' &&
  isRecordLike(event.input) &&
  !Array.isArray(event.input);

const isToolResultEventLike = (event: unknown): event is PrivacyInputToolResultEventLike =>
  isRecordLike(event) &&
  typeof event.toolCallId === 'string' &&
  typeof event.toolName === 'string' &&
  isRecordLike(event.input) &&
  !Array.isArray(event.input) &&
  Array.isArray(event.content) &&
  typeof event.isError === 'boolean';

const notifyInitFailure = (ctx: unknown, error: unknown): void => {
  void error;
  if (typeof ctx !== 'object' || ctx === null) return;
  const maybeContext = ctx as PiInputContextLike;
  maybeContext.ui?.notify(
    'Pristine privacy input failed to initialize safely. Check local extension configuration.',
    'error',
  );
};

export const registerPrivacyInputExtension = (
  pi: PiExtensionApiLike,
  runtimeFactory: (ctx: unknown) => PrivacyInputRuntimeLike | Promise<PrivacyInputRuntimeLike>,
): void => {
  let runtime: PrivacyInputRuntimeLike | null = null;
  let runtimePromise: Promise<PrivacyInputRuntimeLike | null> | null = null;
  let runtimeGeneration = 0;

  const getRuntime = async (ctx: unknown): Promise<PrivacyInputRuntimeLike | null> => {
    if (runtime !== null) return runtime;
    if (runtimePromise !== null) return runtimePromise;

    const generation = runtimeGeneration;
    runtimePromise = (async () => {
      try {
        const initializedRuntime = await runtimeFactory(ctx);
        if (generation !== runtimeGeneration) {
          initializedRuntime.close();
          return null;
        }
        runtime = initializedRuntime;
        return initializedRuntime;
      } catch (error: unknown) {
        if (generation === runtimeGeneration) notifyInitFailure(ctx, error);
        return null;
      } finally {
        if (generation === runtimeGeneration) runtimePromise = null;
      }
    })();
    return runtimePromise;
  };

  pi.on('input', async (event, ctx) => {
    if (!isInputEventLike(event)) return { action: 'continue' };
    if (event.source === 'extension') return { action: 'continue' };
    const activeRuntime = await getRuntime(ctx);
    if (activeRuntime === null) return { action: 'handled' };
    return activeRuntime.handleInput(event);
  });

  pi.on('tool_call', async (event, ctx) => {
    if (!isToolCallEventLike(event)) return undefined;
    const activeRuntime = await getRuntime(ctx);
    if (activeRuntime === null) {
      if (!containsSensitivePlaceholder(event.input)) return undefined;
      return {
        block: true,
        reason: 'Pristine blocked this tool call because privacy runtime initialization failed.',
      };
    }
    return activeRuntime.handleToolCall?.(event);
  });

  pi.on('tool_result', async (event, ctx) => {
    if (!isToolResultEventLike(event)) return undefined;
    const activeRuntime = await getRuntime(ctx);
    if (activeRuntime === null) return undefined;
    return activeRuntime.handleToolResult?.(event);
  });

  pi.on('session_shutdown', () => {
    runtimeGeneration += 1;
    runtimePromise = null;
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
