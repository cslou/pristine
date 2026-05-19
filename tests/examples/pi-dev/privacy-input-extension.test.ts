import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Pristine } from '../../../src/client.js';
import { createDatabase } from '../../../src/core/database.js';
import type { Embedder } from '../../../src/core/interfaces.js';
import { classify } from '../../../src/privacy/classifier/index.js';
import { detect } from '../../../src/privacy/detector/index.js';
import { registerPrivacyInputExtension } from '../../../examples/pi-dev/extensions/privacy-input/index.js';
import {
  PrivacyInputRuntime,
  type PrivacyInputCandidateLike,
  type PrivacyInputClassifyDecisionLike,
  type PrivacyInputRedactionLike,
} from '../../../examples/pi-dev/extensions/privacy-input/lib/runtime.js';

type Handler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;

class FakePi {
  public readonly handlers = new Map<string, Handler[]>();

  public on(event: 'input' | 'session_shutdown', handler: Handler): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }
}

const vector = (first: number, second = 0): number[] => [
  first,
  second,
  ...Array.from({ length: 766 }, () => 0),
];

const createMockEmbedder = (): Embedder => ({
  dim: 768,
  embed: vi.fn(async () => vector(1)),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => vector(1))),
});

const inputHandlerFrom = (pi: FakePi): Handler => {
  const handlers = pi.handlers.get('input') ?? [];
  expect(handlers).toHaveLength(1);
  return handlers[0]!;
};

const createRuntime = () => {
  const detect = vi.fn(async () => ({ candidates: [] as PrivacyInputCandidateLike[] }));
  const classifyDependency = vi.fn(async () => ({
    decisions: [] as PrivacyInputClassifyDecisionLike[],
  }));
  const classifierCallback = vi.fn(async () => ({ decisions: [] }));
  const redact = vi.fn(async () => ({
    text: 'unused',
    redactions: [] as PrivacyInputRedactionLike[],
  }));
  const notifications = { notify: vi.fn() };
  const runtime = new PrivacyInputRuntime({
    detect,
    classify: classifyDependency,
    classifierCallback,
    redact,
    policy: { uncertainPolicy: 'block' },
    userId: 'user-1',
    notifications,
  });
  return { runtime, detect, classifyDependency, classifierCallback, redact, notifications };
};

describe('privacy-input Pi extension scaffold', () => {
  it('registers exactly one input handler and delegates user input to the runtime', async () => {
    const pi = new FakePi();
    const runtime = {
      handleInput: vi.fn(async () => ({ action: 'continue' as const })),
      close: vi.fn(),
    };
    registerPrivacyInputExtension(pi, () => runtime);

    expect(pi.handlers.get('input')).toHaveLength(1);
    expect(pi.handlers.get('session_shutdown')).toHaveLength(1);

    await expect(
      inputHandlerFrom(pi)({ text: 'hello', source: 'interactive' }, {}),
    ).resolves.toEqual({ action: 'continue' });
    expect(runtime.handleInput).toHaveBeenCalledExactlyOnceWith({
      text: 'hello',
      source: 'interactive',
    });
  });

  it('skips extension-injected messages without constructing or calling the runtime', async () => {
    const pi = new FakePi();
    const runtimeFactory = vi.fn(() => ({
      handleInput: vi.fn(async () => ({ action: 'continue' as const })),
      close: vi.fn(),
    }));
    registerPrivacyInputExtension(pi, runtimeFactory);

    await expect(
      inputHandlerFrom(pi)({ text: 'already transformed', source: 'extension' }, {}),
    ).resolves.toEqual({ action: 'continue' });
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it('continues no-candidate input without classifier or redactor calls', async () => {
    const { runtime, detect, classifyDependency, redact } = createRuntime();

    await expect(
      runtime.handleInput({ text: 'ordinary input', source: 'interactive' }),
    ).resolves.toEqual({
      action: 'continue',
    });

    expect(detect).toHaveBeenCalledExactlyOnceWith('ordinary input');
    expect(classifyDependency).not.toHaveBeenCalled();
    expect(redact).not.toHaveBeenCalled();
  });

  it('redacts confirmed secret decisions and records safe details', async () => {
    const { runtime, detect, classifyDependency, classifierCallback, redact, notifications } =
      createRuntime();
    detect.mockResolvedValueOnce({
      candidates: [
        {
          candidateId: 'candidate-0001',
          sourceSpan: { start: 6, end: 12 },
        },
      ],
    });

    classifyDependency.mockResolvedValueOnce({
      decisions: [
        {
          candidateId: 'candidate-0001',
          verdict: 'secret',
          sourceSpan: { start: 6, end: 12 },
          type: 'api_key',
          label: 'primary key',
        },
      ],
    });
    redact.mockResolvedValueOnce({
      text: 'token [SENSITIVE:api_key:ref-1]',
      redactions: [
        {
          candidateId: 'candidate-0001',
          sensitiveRef: 'ref-1',
          placeholder: '[SENSITIVE:api_key:ref-1]',
          type: 'api_key',
          label: 'primary key',
          redactedSpan: { start: 6, end: 31 },
        },
      ],
    });

    const result = await runtime.handleInput({
      text: 'token raw-value-123',
      source: 'interactive',
    });

    expect(result).toEqual({
      action: 'transform',
      text: 'token [SENSITIVE:api_key:ref-1]',
      details: {
        decisions: [
          {
            candidateId: 'candidate-0001',
            verdict: 'secret',
            type: 'api_key',
            label: 'primary key',
          },
        ],
        redactions: [
          {
            candidateId: 'candidate-0001',
            sensitiveRef: 'ref-1',
            placeholder: '[SENSITIVE:api_key:ref-1]',
            type: 'api_key',
            label: 'primary key',
            redactedSpan: { start: 6, end: 31 },
          },
        ],
      },
    });
    expect(classifyDependency).toHaveBeenCalledExactlyOnceWith(
      'token raw-value-123',
      [{ candidateId: 'candidate-0001', sourceSpan: { start: 6, end: 12 } }],
      classifierCallback,
    );
    expect(redact).toHaveBeenCalledExactlyOnceWith(
      'token raw-value-123',
      [
        {
          candidateId: 'candidate-0001',
          sourceSpan: { start: 6, end: 12 },
          type: 'api_key',
          label: 'primary key',
        },
      ],
      'user-1',
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      'Pristine privacy input redacted 1 confirmed value(s).',
      'success',
    );
    expect(JSON.stringify(result)).not.toContain('raw-value-123');
  });

  it('uses real primitives to transform and reveal a confirmed secret', async () => {
    const keysDir = mkdtempSync(join(tmpdir(), 'pristine-pi-privacy-input-'));
    const db = createDatabase(':memory:');
    try {
      const client = await Pristine.create({ db, embedder: createMockEmbedder(), keysDir });
      const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
      const text = `token ${secret}`;
      let serializedClassifierRequest = '';
      const runtime = new PrivacyInputRuntime({
        detect: (inputText) => detect(inputText),
        classify: (inputText, candidates, callback) =>
          classify(
            inputText,
            candidates as Parameters<typeof classify>[1],
            callback as Parameters<typeof classify>[2],
          ),
        classifierCallback: async (request) => {
          serializedClassifierRequest = JSON.stringify(request);
          return {
            decisions: request.candidates.map((candidate) => ({
              candidateId: candidate.candidateId,
              verdict: 'secret' as const,
              type: 'api_key',
              label: 'primary key',
            })),
          };
        },
        redact: (inputText, confirmed, userId) =>
          client.redact(inputText, confirmed as Parameters<typeof client.redact>[1], userId),
        userId: 'user-real',
      });

      const result = await runtime.handleInput({ text, source: 'interactive' });

      expect(result.action).toBe('transform');
      if (result.action !== 'transform') throw new Error('expected transform');
      expect(result.text).not.toContain(secret);
      expect(result.text).toContain('[SENSITIVE:api_key:');
      expect(result.details?.redactions[0]?.redactedSpan).toBeDefined();
      expect(serializedClassifierRequest).toContain('[CANDIDATE:request-candidate-0001]');
      expect(serializedClassifierRequest).not.toContain(secret);
      await expect(client.reveal(result.text, 'user-real')).resolves.toMatchObject({ text });
      await client.dispose();
    } finally {
      db.close();
      rmSync(keysDir, { force: true, recursive: true });
    }
  });

  it.each([
    [
      'classifier throw',
      async () => {
        throw new Error('boom');
      },
    ],
    [
      'malformed classifier response',
      async () => {
        throw new Error('privacy-input classifier: response is not valid JSON');
      },
    ],
    [
      'unknown candidate ID',
      async () => {
        throw new Error('privacy-input classifier: unknown candidateId unknown');
      },
    ],
    [
      'duplicate candidate ID',
      async () => {
        throw new Error('privacy-input classifier: duplicate candidateId candidate-0001');
      },
    ],
  ])('blocks classification failure: %s', async (_name, classifyImpl) => {
    const { runtime, detect, classifyDependency, redact, notifications } = createRuntime();
    detect.mockResolvedValueOnce({
      candidates: [{ candidateId: 'candidate-0001', sourceSpan: { start: 6, end: 19 } }],
    });
    classifyDependency.mockImplementationOnce(classifyImpl);

    await expect(
      runtime.handleInput({ text: 'token raw-value-123', source: 'interactive' }),
    ).resolves.toEqual({ action: 'handled' });

    expect(redact).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.not.stringContaining('raw-value-123'),
      'error',
    );
  });

  it('blocks classifier timeout with one safe notification', async () => {
    const detect = vi.fn(async () => ({
      candidates: [{ candidateId: 'candidate-0001', sourceSpan: { start: 6, end: 19 } }],
    }));
    const classifyDependency = vi.fn(
      () => new Promise<never>((resolve) => setTimeout(resolve, 50)),
    );
    const classifierCallback = vi.fn(async () => ({ decisions: [] }));
    const redact = vi.fn(async () => ({
      text: 'unused',
      redactions: [] as PrivacyInputRedactionLike[],
    }));
    const notifications = { notify: vi.fn() };
    const runtime = new PrivacyInputRuntime({
      detect,
      classify: classifyDependency,
      classifierCallback,
      redact,
      userId: 'user-1',
      notifications,
      classifierTimeoutMs: 1,
    });

    await expect(
      runtime.handleInput({ text: 'token raw-value-123', source: 'interactive' }),
    ).resolves.toEqual({ action: 'handled' });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.not.stringContaining('raw-value-123'),
      'error',
    );
    expect(redact).not.toHaveBeenCalled();
  });

  it('blocks uncertain decisions by default without raw values', async () => {
    const { runtime, detect, classifyDependency, redact, notifications } = createRuntime();
    detect.mockResolvedValueOnce({
      candidates: [{ candidateId: 'candidate-0001', sourceSpan: { start: 6, end: 19 } }],
    });
    classifyDependency.mockResolvedValueOnce({
      decisions: [
        {
          candidateId: 'candidate-0001',
          verdict: 'uncertain',
          sourceSpan: { start: 6, end: 19 },
        },
      ],
    });

    const result = await runtime.handleInput({
      text: 'token raw-value-123',
      source: 'interactive',
    });

    expect(result.action).toBe('handled');
    expect(redact).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.not.stringContaining('raw-value-123'),
      'warning',
    );
    expect(JSON.stringify(result)).not.toContain('raw-value-123');
  });

  it('redacts uncertain decisions when explicitly configured', async () => {
    const { detect, classifyDependency, classifierCallback, redact } = createRuntime();
    const runtime = new PrivacyInputRuntime({
      detect,
      classify: classifyDependency,
      classifierCallback,
      redact,
      policy: { uncertainPolicy: 'redact' },
      userId: 'user-1',
    });
    detect.mockResolvedValueOnce({
      candidates: [
        {
          candidateId: 'candidate-0001',
          sourceSpan: { start: 6, end: 19 },
          hint: { suggestedType: 'api_key' },
        },
      ],
    });
    classifyDependency.mockResolvedValueOnce({
      decisions: [
        {
          candidateId: 'candidate-0001',
          verdict: 'uncertain',
          sourceSpan: { start: 6, end: 19 },
        },
      ],
    });
    redact.mockResolvedValueOnce({
      text: 'token [SENSITIVE:api_key:ref-1]',
      redactions: [
        {
          candidateId: 'candidate-0001',
          sensitiveRef: 'ref-1',
          placeholder: '[SENSITIVE:api_key:ref-1]',
          type: 'api_key',
          redactedSpan: { start: 6, end: 31 },
        },
      ],
    });

    await expect(
      runtime.handleInput({ text: 'token raw-value-123', source: 'interactive' }),
    ).resolves.toMatchObject({ action: 'transform', text: 'token [SENSITIVE:api_key:ref-1]' });
    expect(redact).toHaveBeenCalledExactlyOnceWith(
      'token raw-value-123',
      [{ candidateId: 'candidate-0001', sourceSpan: { start: 6, end: 19 }, type: 'api_key' }],
      'user-1',
    );
  });

  it('allows uncertain decisions only when explicitly configured', async () => {
    const { detect, classifyDependency, classifierCallback, redact } = createRuntime();
    const runtime = new PrivacyInputRuntime({
      detect,
      classify: classifyDependency,
      classifierCallback,
      redact,
      policy: { uncertainPolicy: 'allow' },
      userId: 'user-1',
    });
    detect.mockResolvedValueOnce({
      candidates: [{ candidateId: 'candidate-0001', sourceSpan: { start: 6, end: 19 } }],
    });
    classifyDependency.mockResolvedValueOnce({
      decisions: [
        {
          candidateId: 'candidate-0001',
          verdict: 'uncertain',
          sourceSpan: { start: 6, end: 19 },
        },
      ],
    });

    const result = await runtime.handleInput({
      text: 'token raw-value-123',
      source: 'interactive',
    });

    expect(result).toMatchObject({
      action: 'continue',
      details: {
        decisions: [{ candidateId: 'candidate-0001', verdict: 'uncertain' }],
        redactions: [],
      },
    });
    expect(JSON.stringify(result)).not.toContain('raw-value-123');
    expect(redact).not.toHaveBeenCalled();
  });

  it('blocks malformed secret decisions without redaction', async () => {
    const { runtime, detect, classifyDependency, redact, notifications } = createRuntime();
    detect.mockResolvedValueOnce({
      candidates: [{ candidateId: 'candidate-0001', sourceSpan: { start: 6, end: 19 } }],
    });
    classifyDependency.mockResolvedValueOnce({
      decisions: [
        {
          candidateId: 'candidate-0001',
          verdict: 'secret',
          sourceSpan: { start: 6, end: 19 },
        },
      ],
    });

    await expect(
      runtime.handleInput({ text: 'token raw-value-123', source: 'interactive' }),
    ).resolves.toMatchObject({ action: 'handled' });
    expect(redact).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.not.stringContaining('raw-value-123'),
      'error',
    );
  });

  it('blocks when local redaction setup fails after a confirmed decision', async () => {
    const { detect, classifyDependency, classifierCallback, redact } = createRuntime();
    const runtime = new PrivacyInputRuntime({
      detect,
      classify: classifyDependency,
      classifierCallback,
      redact,
      userId: () => {
        throw new Error('missing user');
      },
    });
    detect.mockResolvedValueOnce({
      candidates: [{ candidateId: 'candidate-0001', sourceSpan: { start: 6, end: 19 } }],
    });
    classifyDependency.mockResolvedValueOnce({
      decisions: [
        {
          candidateId: 'candidate-0001',
          verdict: 'secret',
          sourceSpan: { start: 6, end: 19 },
          type: 'api_key',
        },
      ],
    });

    await expect(
      runtime.handleInput({ text: 'token raw-value-123', source: 'interactive' }),
    ).resolves.toMatchObject({ action: 'handled' });
    expect(redact).not.toHaveBeenCalled();
  });

  it('passes through not-secret decisions without redaction', async () => {
    const { runtime, detect, classifyDependency, redact } = createRuntime();
    detect.mockResolvedValueOnce({
      candidates: [{ candidateId: 'candidate-0001', sourceSpan: { start: 6, end: 12 } }],
    });
    classifyDependency.mockResolvedValueOnce({
      decisions: [
        {
          candidateId: 'candidate-0001',
          verdict: 'not_secret',
          sourceSpan: { start: 6, end: 12 },
        },
      ],
    });

    await expect(
      runtime.handleInput({ text: 'token raw-value-123', source: 'interactive' }),
    ).resolves.toMatchObject({ action: 'continue' });
    expect(redact).not.toHaveBeenCalled();
  });

  it('does not resolve user ID when there are no confirmed secrets', async () => {
    const detect = vi.fn(async () => ({
      candidates: [{ candidateId: 'candidate-0001', sourceSpan: { start: 6, end: 12 } }],
    }));
    const classifyDependency = vi.fn(async () => ({
      decisions: [] as PrivacyInputClassifyDecisionLike[],
    }));
    const classifierCallback = vi.fn(async () => ({ decisions: [] }));
    const redact = vi.fn(async () => ({
      text: 'unused',
      redactions: [] as PrivacyInputRedactionLike[],
    }));
    const runtime = new PrivacyInputRuntime({
      detect,
      classify: classifyDependency,
      classifierCallback,
      redact,
      userId: () => {
        throw new Error('missing user');
      },
    });

    await expect(
      runtime.handleInput({ text: 'token raw-value-123', source: 'interactive' }),
    ).resolves.toEqual({ action: 'continue', details: { decisions: [], redactions: [] } });
    expect(redact).not.toHaveBeenCalled();
  });

  it('continues safely and notifies when runtime initialization fails', async () => {
    const pi = new FakePi();
    const notify = vi.fn();
    registerPrivacyInputExtension(pi, () => {
      throw new Error('missing config');
    });

    await expect(
      inputHandlerFrom(pi)({ text: 'hello', source: 'interactive' }, { ui: { notify } }),
    ).resolves.toEqual({
      action: 'continue',
    });

    expect(notify).toHaveBeenCalledWith(
      'Pristine privacy input failed to initialize: missing config',
      'error',
    );
  });

  it('continues safely when runtime initialization fails without a context object', async () => {
    const pi = new FakePi();
    registerPrivacyInputExtension(pi, () => {
      throw new Error('missing config');
    });

    await expect(
      inputHandlerFrom(pi)({ text: 'hello', source: 'interactive' }, null),
    ).resolves.toEqual({
      action: 'continue',
    });
  });

  it('closes the active runtime on session shutdown', async () => {
    const pi = new FakePi();
    const runtime = {
      handleInput: vi.fn(async () => ({ action: 'continue' as const })),
      close: vi.fn(),
    };
    registerPrivacyInputExtension(pi, () => runtime);

    await inputHandlerFrom(pi)({ text: 'hello', source: 'interactive' }, {});
    pi.handlers.get('session_shutdown')![0]!(undefined, undefined);

    expect(runtime.close).toHaveBeenCalledOnce();
  });
});
