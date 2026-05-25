import { describe, expect, it, vi } from 'vitest';
import {
  PrivacyInputRuntime,
  type PrivacyInputCandidateLike,
  type PrivacyInputClassifyDecisionLike,
  type PrivacyInputRedactionLike,
} from '../../../examples/pi-dev/extensions/privacy-input/lib/runtime.js';

const createRuntime = (overrides?: {
  readonly detect?: ReturnType<typeof vi.fn>;
  readonly classify?: ReturnType<typeof vi.fn>;
  readonly redact?: ReturnType<typeof vi.fn>;
  readonly setStatus?: ReturnType<typeof vi.fn>;
}) => {
  const secret = 'sk-proj-status-secret-abcdefghijklmnopqrstuvwxyz';
  const text = `token=${secret}`;
  const sourceSpan = { start: text.indexOf(secret), end: text.indexOf(secret) + secret.length };
  const candidate: PrivacyInputCandidateLike = {
    candidateId: 'candidate-status',
    sourceSpan,
  };
  const decision: PrivacyInputClassifyDecisionLike = {
    candidateId: 'candidate-status',
    verdict: 'secret',
    sourceSpan,
    type: 'api_key',
  };
  const redaction: PrivacyInputRedactionLike = {
    candidateId: 'candidate-status',
    sensitiveRef: '11111111-1111-4111-8111-111111111111',
    placeholder: '[SENSITIVE:api_key:11111111-1111-4111-8111-111111111111]',
    type: 'api_key',
    redactedSpan: { start: text.indexOf(secret), end: text.indexOf(secret) + 58 },
  };
  const detect = overrides?.detect ?? vi.fn(async () => ({ candidates: [candidate] }));
  const classify = overrides?.classify ?? vi.fn(async () => ({ decisions: [decision] }));
  const redact =
    overrides?.redact ??
    vi.fn(async () => ({
      text: `token=${redaction.placeholder}`,
      redactions: [redaction],
    }));
  const setStatus = overrides?.setStatus ?? vi.fn();
  const notify = vi.fn();
  const runtime = new PrivacyInputRuntime({
    detect,
    classify,
    classifierCallback: vi.fn(async () => ({ decisions: [] })),
    redact,
    userId: 'status-user',
    notifications: { notify, setStatus },
  });

  return { runtime, text, secret, detect, classify, redact, notify, setStatus };
};

describe('privacy-input status lifecycle', () => {
  it('reports generic scanning, classification, and redaction status while handling sensitive input', async () => {
    const { runtime, text, secret, setStatus } = createRuntime();

    await expect(runtime.handleInput({ text, source: 'interactive' })).resolves.toMatchObject({
      action: 'transform',
    });

    expect(setStatus).toHaveBeenNthCalledWith(
      1,
      'pristine-privacy-input',
      'Pristine: scanning input…',
    );
    expect(setStatus).toHaveBeenCalledWith(
      'pristine-privacy-input',
      'Pristine: checking sensitive input…',
    );
    expect(setStatus).toHaveBeenCalledWith(
      'pristine-privacy-input',
      'Pristine: redacting locally…',
    );
    expect(setStatus).toHaveBeenLastCalledWith('pristine-privacy-input', undefined);
    expect(
      setStatus.mock.calls.some((call) => call.some((value) => String(value).includes(secret))),
    ).toBe(false);
  });

  it('clears status when detection fails closed', async () => {
    const setStatus = vi.fn();
    const { runtime, text } = createRuntime({
      detect: vi.fn(async () => {
        throw new Error('detector unavailable');
      }),
      setStatus,
    });

    await expect(runtime.handleInput({ text, source: 'interactive' })).resolves.toEqual({
      action: 'handled',
    });

    expect(setStatus).toHaveBeenCalledWith('pristine-privacy-input', 'Pristine: scanning input…');
    expect(setStatus).toHaveBeenLastCalledWith('pristine-privacy-input', undefined);
  });

  it('clears status when no candidates are detected', async () => {
    const setStatus = vi.fn();
    const { runtime, text } = createRuntime({
      detect: vi.fn(async () => ({ candidates: [] })),
      setStatus,
    });

    await expect(runtime.handleInput({ text, source: 'interactive' })).resolves.toEqual({
      action: 'continue',
    });

    expect(setStatus).toHaveBeenCalledWith('pristine-privacy-input', 'Pristine: scanning input…');
    expect(setStatus).toHaveBeenLastCalledWith('pristine-privacy-input', undefined);
  });

  it('clears status when uncertain classification blocks the input', async () => {
    const setStatus = vi.fn();
    const secret = 'sk-proj-status-secret-abcdefghijklmnopqrstuvwxyz';
    const sourceSpan = { start: `token=${secret}`.indexOf(secret), end: `token=${secret}`.length };
    const { runtime, text } = createRuntime({
      classify: vi.fn(async () => ({
        decisions: [
          {
            candidateId: 'candidate-status',
            verdict: 'uncertain',
            sourceSpan,
          },
        ],
      })),
      setStatus,
    });

    await expect(runtime.handleInput({ text, source: 'interactive' })).resolves.toMatchObject({
      action: 'handled',
    });

    expect(setStatus).toHaveBeenCalledWith(
      'pristine-privacy-input',
      'Pristine: checking sensitive input…',
    );
    expect(setStatus).toHaveBeenLastCalledWith('pristine-privacy-input', undefined);
  });

  it('clears status when classification fails closed', async () => {
    const setStatus = vi.fn();
    const { runtime, text } = createRuntime({
      classify: vi.fn(async () => {
        throw new Error('classifier unavailable');
      }),
      setStatus,
    });

    await expect(runtime.handleInput({ text, source: 'interactive' })).resolves.toMatchObject({
      action: 'handled',
    });

    expect(setStatus).toHaveBeenCalledWith(
      'pristine-privacy-input',
      'Pristine: checking sensitive input…',
    );
    expect(setStatus).toHaveBeenLastCalledWith('pristine-privacy-input', undefined);
  });

  it('clears status when redaction fails closed', async () => {
    const setStatus = vi.fn();
    const { runtime, text } = createRuntime({
      redact: vi.fn(async () => {
        throw new Error('redactor unavailable');
      }),
      setStatus,
    });

    await expect(runtime.handleInput({ text, source: 'interactive' })).resolves.toMatchObject({
      action: 'handled',
    });

    expect(setStatus).toHaveBeenCalledWith(
      'pristine-privacy-input',
      'Pristine: redacting locally…',
    );
    expect(setStatus).toHaveBeenLastCalledWith('pristine-privacy-input', undefined);
  });

  it('ignores status sink failures without changing privacy handling', async () => {
    const setStatus = vi.fn(() => {
      throw new Error('status sink unavailable');
    });
    const { runtime, text } = createRuntime({ setStatus });

    await expect(runtime.handleInput({ text, source: 'interactive' })).resolves.toMatchObject({
      action: 'transform',
    });
  });

  it('does not set status for extension-injected messages', async () => {
    const { runtime, text, setStatus } = createRuntime();

    await expect(runtime.handleInput({ text, source: 'extension' })).resolves.toEqual({
      action: 'continue',
    });

    expect(setStatus).not.toHaveBeenCalled();
  });
});
