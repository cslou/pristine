import {
  PrivacyInputClassifierError,
  type PrivacyInputClassifierTask,
  type PrivacyInputClassifierTransport,
} from './classifier-adapter.js';

export interface PiModelPreference {
  readonly provider: string;
  readonly id: string;
}

export interface PiModelLike {
  readonly provider?: string;
  readonly id?: string;
  readonly [key: string]: unknown;
}

export interface PiModelAuthLike {
  readonly ok: boolean;
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
  readonly error?: string;
}

export interface PiModelRegistryLike {
  find(provider: string, id: string): PiModelLike | undefined;
  getApiKeyAndHeaders(model: PiModelLike): Promise<PiModelAuthLike>;
}

export interface PiModelCompleteMessage {
  readonly role: 'user';
  readonly content: readonly [{ readonly type: 'text'; readonly text: string }];
  readonly timestamp: number;
}

export interface PiModelCompleteResponse {
  readonly content: readonly PiModelCompleteResponseContent[];
  readonly stopReason?: string;
}

export type PiModelCompleteResponseContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: string; readonly [key: string]: unknown };

export type PiModelCompleteSimple = (
  model: PiModelLike,
  request: {
    readonly systemPrompt: string;
    readonly messages: readonly PiModelCompleteMessage[];
  },
  options: {
    readonly apiKey?: string;
    readonly headers?: Record<string, string>;
    readonly maxTokens: number;
    readonly reasoning?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<PiModelCompleteResponse>;

export interface PiModelClassifierTransportOptions {
  readonly modelRegistry: PiModelRegistryLike;
  readonly currentModel?: PiModelLike;
  readonly preferences?: readonly PiModelPreference[];
  readonly maxTokens?: number;
  readonly reasoning?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly diagnostics?: (message: string) => void;
  readonly completeSimple?: PiModelCompleteSimple;
}

interface SelectedPiModel {
  readonly model: PiModelLike;
  readonly auth: PiModelAuthLike;
}

const DEFAULT_MODEL_PREFERENCES: readonly PiModelPreference[] = [
  { provider: 'openai-codex', id: 'gpt-5.5' },
];

const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_REASONING = 'minimal';

const hasNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const hasUsableHeaders = (headers: unknown): headers is Record<string, string> =>
  typeof headers === 'object' &&
  headers !== null &&
  !Array.isArray(headers) &&
  Object.values(headers).some(hasNonEmptyString);

const isUsableAuth = (auth: PiModelAuthLike): boolean =>
  auth.ok && (hasNonEmptyString(auth.apiKey) || hasUsableHeaders(auth.headers));

const modelName = (model: PiModelLike): string => {
  const provider = hasNonEmptyString(model.provider) ? model.provider : 'unknown-provider';
  const id = hasNonEmptyString(model.id) ? model.id : 'unknown-model';
  return `${provider}/${id}`;
};

const loadCompleteSimple = async (): Promise<PiModelCompleteSimple> => {
  const moduleName = '@mariozechner/pi-ai';
  const moduleValue = (await import(moduleName)) as Record<string, unknown>;
  const completeSimple = moduleValue.completeSimple;
  if (typeof completeSimple !== 'function') {
    throw new PrivacyInputClassifierError('Pi completeSimple is unavailable');
  }
  return completeSimple as PiModelCompleteSimple;
};

const selectModel = async (
  modelRegistry: PiModelRegistryLike,
  preferences: readonly PiModelPreference[],
  currentModel: PiModelLike | undefined,
  diagnosticsSink: ((message: string) => void) | undefined,
): Promise<SelectedPiModel> => {
  const diagnostics: string[] = [];

  for (const preference of preferences) {
    const model = modelRegistry.find(preference.provider, preference.id);
    if (model === undefined) {
      const diagnostic = `configured model not found: ${preference.provider}/${preference.id}`;
      diagnostics.push(diagnostic);
      diagnosticsSink?.(diagnostic);
      continue;
    }

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (isUsableAuth(auth)) return { model, auth };
    const diagnostic = `configured model unavailable: ${preference.provider}/${preference.id} (${auth.ok ? 'no usable API key or headers' : (auth.error ?? 'auth failed')})`;
    diagnostics.push(diagnostic);
    diagnosticsSink?.(diagnostic);
  }

  if (currentModel !== undefined) {
    const auth = await modelRegistry.getApiKeyAndHeaders(currentModel);
    if (isUsableAuth(auth)) return { model: currentModel, auth };
    const diagnostic = `current model unavailable: ${modelName(currentModel)} (${auth.ok ? 'no usable API key or headers' : (auth.error ?? 'auth failed')})`;
    diagnostics.push(diagnostic);
    diagnosticsSink?.(diagnostic);
  }

  throw new PrivacyInputClassifierError(
    `no usable Pi classifier model (${diagnostics.at(-1) ?? 'no configured or current model'})`,
  );
};

const textFromResponse = (response: PiModelCompleteResponse): string =>
  response.content
    .filter(
      (content): content is { readonly type: 'text'; readonly text: string } =>
        content.type === 'text' && typeof content.text === 'string',
    )
    .map((content) => content.text)
    .join('\n')
    .trim();

const createCompositeSignal = (
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { readonly signal?: AbortSignal; readonly cleanup: () => void } => {
  if (timeoutMs === undefined) return { signal, cleanup: () => undefined };
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timeout = setTimeout(abort, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    },
  };
};

const awaitWithAbort = async <T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> => {
  if (signal === undefined) return operation;
  if (signal.aborted) {
    throw new PrivacyInputClassifierError('Pi model classifier timed out or was aborted');
  }

  let removeAbortListener = (): void => undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    const rejectOnAbort = (): void => {
      reject(new PrivacyInputClassifierError('Pi model classifier timed out or was aborted'));
    };
    signal.addEventListener('abort', rejectOnAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', rejectOnAbort);
  });

  try {
    return await Promise.race([operation, abortPromise]);
  } finally {
    removeAbortListener();
  }
};

const assertSuccessfulStopReason = (stopReason: string | undefined): void => {
  if (stopReason === undefined) return;
  if (stopReason === 'length') {
    throw new PrivacyInputClassifierError('Pi model response was truncated');
  }
  if (['error', 'aborted', 'abort', 'cancelled', 'canceled'].includes(stopReason)) {
    throw new PrivacyInputClassifierError(`Pi model response stopped with ${stopReason}`);
  }
};

export const createPiModelClassifierTransport = (
  options: PiModelClassifierTransportOptions,
): PrivacyInputClassifierTransport => ({
  async classify(task: PrivacyInputClassifierTask): Promise<string> {
    const compositeSignal = createCompositeSignal(options.signal, options.timeoutMs);

    try {
      const { model, auth } = await selectModel(
        options.modelRegistry,
        options.preferences ?? DEFAULT_MODEL_PREFERENCES,
        options.currentModel,
        options.diagnostics,
      );
      const completeSimple = options.completeSimple ?? (await loadCompleteSimple());
      const response = await awaitWithAbort(
        completeSimple(
          model,
          {
            systemPrompt: task.systemPrompt,
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: task.userPrompt }],
                timestamp: Date.now(),
              },
            ],
          },
          {
            apiKey: auth.apiKey,
            headers: auth.headers,
            maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
            reasoning: options.reasoning ?? DEFAULT_REASONING,
            signal: compositeSignal.signal,
          },
        ),
        compositeSignal.signal,
      );

      assertSuccessfulStopReason(response.stopReason);

      const responseText = textFromResponse(response);
      if (responseText.length === 0) {
        throw new PrivacyInputClassifierError('Pi model response was empty');
      }
      return responseText;
    } catch (error: unknown) {
      if (error instanceof PrivacyInputClassifierError) throw error;
      if (compositeSignal.signal?.aborted) {
        throw new PrivacyInputClassifierError('Pi model classifier timed out or was aborted');
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new PrivacyInputClassifierError(`Pi model classifier failed: ${message}`);
    } finally {
      compositeSignal.cleanup();
    }
  },
});
