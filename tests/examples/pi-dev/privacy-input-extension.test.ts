import { describe, expect, it, vi } from 'vitest';
import { registerPrivacyInputExtension } from '../../../examples/pi-dev/extensions/privacy-input/index.js';
import {
  PrivacyInputRuntime,
  type PrivacyInputCandidateLike,
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

const inputHandlerFrom = (pi: FakePi): Handler => {
  const handlers = pi.handlers.get('input') ?? [];
  expect(handlers).toHaveLength(1);
  return handlers[0]!;
};

const createRuntime = () => {
  const detect = vi.fn(async () => ({ candidates: [] as PrivacyInputCandidateLike[] }));
  const classifier = { classify: vi.fn(async () => ({ decisions: [] })) };
  const redactor = { redact: vi.fn(async () => ({ text: 'unused', redactions: [] })) };
  const notifications = { notify: vi.fn() };
  const runtime = new PrivacyInputRuntime({
    detect,
    classifier,
    redactor,
    policy: { uncertainPolicy: 'block' },
    userId: 'user-1',
    notifications,
  });
  return { runtime, detect, classifier, redactor, notifications };
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
    const { runtime, detect, classifier, redactor } = createRuntime();

    await expect(
      runtime.handleInput({ text: 'ordinary input', source: 'interactive' }),
    ).resolves.toEqual({
      action: 'continue',
    });

    expect(detect).toHaveBeenCalledExactlyOnceWith('ordinary input');
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(redactor.redact).not.toHaveBeenCalled();
  });

  it('fails closed for detected candidates until redaction composition handles them', async () => {
    const { runtime, detect, classifier, redactor, notifications } = createRuntime();
    detect.mockResolvedValueOnce({
      candidates: [
        {
          candidateId: 'candidate-0001',
          sourceSpan: { start: 6, end: 12 },
        },
      ],
    });

    await expect(
      runtime.handleInput({ text: 'token secret', source: 'interactive' }),
    ).resolves.toEqual({
      action: 'handled',
    });

    expect(classifier.classify).not.toHaveBeenCalled();
    expect(redactor.redact).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.not.stringContaining('secret'),
      'warning',
    );
  });

  it('fails closed for detected candidates even if injected user ID resolution would fail', async () => {
    const detect = vi.fn(async () => ({
      candidates: [{ candidateId: 'candidate-0001', sourceSpan: { start: 6, end: 12 } }],
    }));
    const classifier = { classify: vi.fn(async () => ({ decisions: [] })) };
    const redactor = { redact: vi.fn(async () => ({ text: 'unused', redactions: [] })) };
    const runtime = new PrivacyInputRuntime({
      detect,
      classifier,
      redactor,
      userId: () => {
        throw new Error('missing user');
      },
    });

    await expect(
      runtime.handleInput({ text: 'token secret', source: 'interactive' }),
    ).resolves.toEqual({ action: 'handled' });
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
