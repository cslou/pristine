import { describe, expect, it, vi } from 'vitest';
import { createPrivacyInputClassifierCallback } from '../../../examples/pi-dev/extensions/privacy-input/lib/classifier-adapter.js';
import {
  createPiModelClassifierTransport,
  type PiModelCompleteSimple,
  type PiModelLike,
  type PiModelRegistryLike,
} from '../../../examples/pi-dev/extensions/privacy-input/lib/pi-model-classifier-transport.js';
import { PrivacyInputRuntime } from '../../../examples/pi-dev/extensions/privacy-input/lib/runtime.js';
import type {
  PrivacyInputCandidateLike,
  PrivacyInputClassifyDecisionLike,
} from '../../../examples/pi-dev/extensions/privacy-input/lib/runtime.js';

const configuredModel: PiModelLike = { provider: 'openai-codex', id: 'gpt-5.5' };
const fallbackModel: PiModelLike = { provider: 'anthropic', id: 'claude-sonnet-4-6' };

const classifierJson = JSON.stringify({
  decisions: [{ candidateId: 'request-candidate-0001', verdict: 'secret', type: 'api_key' }],
});

const createRegistry = (overrides?: {
  readonly foundModel?: PiModelLike;
  readonly auth?: Awaited<ReturnType<PiModelRegistryLike['getApiKeyAndHeaders']>>;
}): PiModelRegistryLike => ({
  find: vi.fn((_provider: string, _id: string) =>
    overrides !== undefined && 'foundModel' in overrides ? overrides.foundModel : configuredModel,
  ),
  getApiKeyAndHeaders: vi.fn(
    async () => overrides?.auth ?? { ok: true, headers: { authorization: 'Bearer oauth-token' } },
  ),
});

const createCompleteSimple = (responseText = classifierJson): PiModelCompleteSimple =>
  vi.fn(async () => ({ content: [{ type: 'text', text: responseText }] }));

const sanitizedRequest = {
  sanitizedContext: 'token [CANDIDATE:request-candidate-0001]',
  candidates: [
    {
      candidateId: 'request-candidate-0001',
      marker: '[CANDIDATE:request-candidate-0001]',
      kind: 'known_provider_prefix',
      ruleId: 'known-provider.openai',
      sourceSpan: { start: 6, end: 46 },
      valueLength: 42,
      hint: {
        suggestedType: 'api_key',
        provider: 'openai',
        rawPrefix: 'sk-proj-raw-prefix-that-must-not-leak',
      },
    },
  ],
};

describe('Pi model privacy-input classifier transport', () => {
  it('selects configured model preferences and accepts header-only OAuth auth', async () => {
    const registry = createRegistry();
    const completeSimple = createCompleteSimple();
    const transport = createPiModelClassifierTransport({
      modelRegistry: registry,
      currentModel: fallbackModel,
      preferences: [{ provider: 'openai-codex', id: 'gpt-5.5' }],
      completeSimple,
    });

    await expect(
      transport.classify({
        systemPrompt: 'system prompt',
        userPrompt: '{"safe":true}',
        allowedCandidateIds: ['request-candidate-0001'],
      }),
    ).resolves.toBe(classifierJson);

    expect(registry.find).toHaveBeenCalledWith('openai-codex', 'gpt-5.5');
    expect(registry.getApiKeyAndHeaders).toHaveBeenCalledWith(configuredModel);
    expect(completeSimple).toHaveBeenCalledWith(
      configuredModel,
      expect.objectContaining({ systemPrompt: 'system prompt' }),
      expect.objectContaining({ headers: { authorization: 'Bearer oauth-token' } }),
    );
  });

  it('falls back to the current model when configured preferences are unavailable', async () => {
    const registry = createRegistry({ foundModel: undefined });
    const completeSimple = createCompleteSimple();
    const transport = createPiModelClassifierTransport({
      modelRegistry: registry,
      currentModel: fallbackModel,
      completeSimple,
    });

    await transport.classify({
      systemPrompt: 'system prompt',
      userPrompt: '{}',
      allowedCandidateIds: ['request-candidate-0001'],
    });

    expect(registry.getApiKeyAndHeaders).toHaveBeenCalledWith(fallbackModel);
    expect(completeSimple).toHaveBeenCalledWith(
      fallbackModel,
      expect.anything(),
      expect.objectContaining({ reasoning: 'minimal', maxTokens: 2048 }),
    );
  });

  it('sends only sanitized classifier prompts to the Pi model call', async () => {
    const rawValues = [
      'sk-proj-abcdefghijklmnopqrstuvwxyz123456',
      'sk-proj-raw-prefix-that-must-not-leak',
    ];
    const registry = createRegistry();
    const completeSimple = createCompleteSimple();
    const callback = createPrivacyInputClassifierCallback(
      createPiModelClassifierTransport({ modelRegistry: registry, completeSimple }),
    );

    await callback(sanitizedRequest);

    const serializedRequest = JSON.stringify(vi.mocked(completeSimple).mock.calls[0]);
    expect(serializedRequest).toContain('[CANDIDATE:request-candidate-0001]');
    expect(serializedRequest).toContain('sourceSpan');
    for (const value of rawValues) {
      expect(serializedRequest).not.toContain(value);
    }
  });

  it('rejects unavailable models, registry errors, unusable auth, empty responses, bad stops, throws, and aborts', async () => {
    await expect(
      createPiModelClassifierTransport({
        modelRegistry: createRegistry({ foundModel: undefined }),
        completeSimple: createCompleteSimple(),
      }).classify({ systemPrompt: 'system', userPrompt: '{}', allowedCandidateIds: [] }),
    ).rejects.toThrow('privacy-input classifier: no usable Pi classifier model');

    await expect(
      createPiModelClassifierTransport({
        modelRegistry: {
          find: vi.fn(() => {
            throw new Error('registry unavailable');
          }),
          getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: 'unused' })),
        },
        completeSimple: createCompleteSimple(),
      }).classify({ systemPrompt: 'system', userPrompt: '{}', allowedCandidateIds: [] }),
    ).rejects.toThrow('privacy-input classifier: Pi model classifier failed: registry unavailable');

    await expect(
      createPiModelClassifierTransport({
        modelRegistry: createRegistry({ auth: { ok: true } }),
        completeSimple: createCompleteSimple(),
      }).classify({ systemPrompt: 'system', userPrompt: '{}', allowedCandidateIds: [] }),
    ).rejects.toThrow('privacy-input classifier: no usable Pi classifier model');

    await expect(
      createPiModelClassifierTransport({
        modelRegistry: createRegistry(),
        completeSimple: createCompleteSimple(''),
      }).classify({ systemPrompt: 'system', userPrompt: '{}', allowedCandidateIds: [] }),
    ).rejects.toThrow('privacy-input classifier: Pi model response was empty');

    await expect(
      createPiModelClassifierTransport({
        modelRegistry: createRegistry(),
        completeSimple: vi.fn(async () => ({
          content: [{ type: 'text', text: '{}' }],
          stopReason: 'length',
        })),
      }).classify({ systemPrompt: 'system', userPrompt: '{}', allowedCandidateIds: [] }),
    ).rejects.toThrow('privacy-input classifier: Pi model response was truncated');

    await expect(
      createPiModelClassifierTransport({
        modelRegistry: createRegistry(),
        completeSimple: vi.fn(async () => ({
          content: [{ type: 'text', text: '{}' }],
          stopReason: 'error',
        })),
      }).classify({ systemPrompt: 'system', userPrompt: '{}', allowedCandidateIds: [] }),
    ).rejects.toThrow('privacy-input classifier: Pi model response stopped with error');

    await expect(
      createPiModelClassifierTransport({
        modelRegistry: createRegistry(),
        completeSimple: vi.fn(async () => {
          throw new Error('provider down');
        }),
      }).classify({ systemPrompt: 'system', userPrompt: '{}', allowedCandidateIds: [] }),
    ).rejects.toThrow('privacy-input classifier: Pi model classifier failed: provider down');

    await expect(
      createPiModelClassifierTransport({
        modelRegistry: createRegistry(),
        timeoutMs: 1,
        completeSimple: vi.fn<PiModelCompleteSimple>(
          async () =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ content: [{ type: 'text', text: '{}' }] }), 50);
            }),
        ),
      }).classify({ systemPrompt: 'system', userPrompt: '{}', allowedCandidateIds: [] }),
    ).rejects.toThrow('privacy-input classifier: Pi model classifier timed out or was aborted');

    const controller = new AbortController();
    controller.abort();
    const completeAfterPreAbort = createCompleteSimple();
    await expect(
      createPiModelClassifierTransport({
        modelRegistry: createRegistry(),
        signal: controller.signal,
        completeSimple: completeAfterPreAbort,
      }).classify({ systemPrompt: 'system', userPrompt: '{}', allowedCandidateIds: [] }),
    ).rejects.toThrow('privacy-input classifier: Pi model classifier timed out or was aborted');
    expect(completeAfterPreAbort).not.toHaveBeenCalled();
  });

  it('wires through callback parsing and runtime fail-closed handling', async () => {
    const rawSecret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
    const candidate: PrivacyInputCandidateLike = {
      candidateId: 'candidate-0001',
      sourceSpan: { start: 6, end: 46 },
      hint: { suggestedType: 'api_key' },
    };
    const callback = createPrivacyInputClassifierCallback(
      createPiModelClassifierTransport({
        modelRegistry: createRegistry(),
        completeSimple: createCompleteSimple(),
      }),
    );
    const runtime = new PrivacyInputRuntime({
      detect: async () => ({ candidates: [candidate] }),
      classify: async (_text, _candidates, classifierCallback) => {
        const result = await classifierCallback(sanitizedRequest);
        return {
          decisions: result.decisions.map(
            (decision): PrivacyInputClassifyDecisionLike => ({
              ...decision,
              candidateId: candidate.candidateId,
              sourceSpan: candidate.sourceSpan,
            }),
          ),
        };
      },
      classifierCallback: callback,
      redact: async (_text, confirmed) => ({
        text: 'token [SENSITIVE:api_key:ref-1]',
        redactions: confirmed.map((confirmedSecret) => ({
          candidateId: confirmedSecret.candidateId,
          sensitiveRef: 'ref-1',
          placeholder: '[SENSITIVE:api_key:ref-1]',
          type: confirmedSecret.type,
          label: confirmedSecret.label,
          redactedSpan: { start: 6, end: 31 },
        })),
      }),
      userId: 'user-1',
    });

    const transformed = await runtime.handleInput({ text: `token ${rawSecret}` });
    expect(transformed).toMatchObject({ action: 'transform' });
    expect(JSON.stringify(transformed)).not.toContain(rawSecret);

    const failingRuntime = new PrivacyInputRuntime({
      detect: async () => ({ candidates: [candidate] }),
      classify: async (_text, _candidates, classifierCallback) => {
        await classifierCallback(sanitizedRequest);
        return { decisions: [] };
      },
      classifierCallback: createPrivacyInputClassifierCallback(
        createPiModelClassifierTransport({
          modelRegistry: createRegistry(),
          completeSimple: createCompleteSimple('{'),
        }),
      ),
      redact: async () => ({ text: '', redactions: [] }),
      userId: 'user-1',
    });

    await expect(failingRuntime.handleInput({ text: `token ${rawSecret}` })).resolves.toMatchObject(
      {
        action: 'handled',
      },
    );
  });
});
