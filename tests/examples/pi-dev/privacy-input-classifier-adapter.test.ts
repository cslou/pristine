import { describe, expect, it, vi } from 'vitest';
import {
  buildPrivacyInputClassifierTask,
  createPrivacyInputClassifierCallback,
  parsePrivacyInputClassifierResponse,
  PrivacyInputClassifierError,
  sanitizeClassifierLabel,
  type PrivacyInputClassifierTransport,
} from '../../../examples/pi-dev/extensions/privacy-input/lib/classifier-adapter.js';
import { PrivacyInputRuntime } from '../../../examples/pi-dev/extensions/privacy-input/lib/runtime.js';
import type {
  PrivacyInputCandidateLike,
  PrivacyInputClassifierRequestLike,
  PrivacyInputClassifyDecisionLike,
} from '../../../examples/pi-dev/extensions/privacy-input/lib/runtime.js';

const riskyValues = {
  rawSecret: 'sk-proj-abcdefghijklmnopqrstuvwxyz123456',
  rawPrefix: 'custom-prefix-1234567890',
  jwtPayloadValue: 'lou@example.com',
  urlPassword: 'dbPassSecret123',
  querySecret: 'querySecret456',
  seedWord: 'mango',
};

const requestFixture = (): PrivacyInputClassifierRequestLike => ({
  sanitizedContext:
    'Authorization: Bearer [CANDIDATE:request-candidate-0001]\nurl=postgres://user:[CANDIDATE:request-candidate-0002]@example.com/db\nseed phrase: [CANDIDATE:request-candidate-0003]',
  candidates: [
    {
      candidateId: 'request-candidate-0001',
      marker: '[CANDIDATE:request-candidate-0001]',
      kind: 'known_provider_prefix',
      ruleId: 'known-provider.openai',
      sourceSpan: { start: 22, end: 62 },
      valueLength: riskyValues.rawSecret.length,
      hint: {
        suggestedType: 'api_key',
        provider: 'openai',
        prefixFamily: 'sk-proj',
        rawPrefix: riskyValues.rawPrefix,
        decodedPayload: riskyValues.jwtPayloadValue,
      },
    },
    {
      candidateId: 'request-candidate-0002',
      marker: '[CANDIDATE:request-candidate-0002]',
      kind: 'credential_url',
      ruleId: 'url.password',
      sourceSpan: { start: 83, end: 98 },
      valueLength: riskyValues.urlPassword.length,
      location: { line: 2, column: 21, rawPassword: riskyValues.urlPassword },
      hint: {
        suggestedType: 'password',
        positiveSignals: ['credential_url_context'],
        querySecret: riskyValues.querySecret,
      },
    },
    {
      candidateId: 'request-candidate-0003',
      marker: '[CANDIDATE:request-candidate-0003]',
      kind: 'recovery_or_seed_phrase',
      ruleId: 'seed.phrase',
      sourceSpan: { start: 130, end: 200 },
      valueLength: 70,
      hint: { suggestedType: 'seed_phrase', seedPreview: riskyValues.seedWord },
    },
  ],
});

describe('privacy input classifier adapter', () => {
  it('builds sanitized classifier tasks without raw secret values', () => {
    const task = buildPrivacyInputClassifierTask(requestFixture());
    const serialized = JSON.stringify(task);

    expect(serialized).toContain('[CANDIDATE:request-candidate-0001]');
    expect(serialized).toContain('sourceSpan');
    expect(serialized).toContain('hint');
    for (const value of Object.values(riskyValues)) {
      expect(serialized).not.toContain(value);
    }
  });

  it('parses valid decisions and preserves safe labels', () => {
    const result = parsePrivacyInputClassifierResponse(
      JSON.stringify({
        decisions: [
          {
            candidateId: 'request-candidate-0001',
            verdict: 'secret',
            type: 'api_key',
            label: ' Primary key ',
            confidence: 0.9,
            rationale: 'provider marker',
          },
          { candidateId: 'request-candidate-0002', verdict: 'not_secret' },
          { candidateId: 'request-candidate-0003', verdict: 'uncertain', label: 'seed phrase' },
        ],
      }),
      ['request-candidate-0001', 'request-candidate-0002', 'request-candidate-0003'],
    );

    expect(result.decisions[0]).toMatchObject({
      candidateId: 'request-candidate-0001',
      verdict: 'secret',
      type: 'api_key',
      label: 'Primary key',
    });
    expect(result.decisions[2]?.label).toBe('seed phrase');
  });

  it.each([
    ['malformed JSON', '{'],
    ['missing decisions', JSON.stringify({})],
    [
      'duplicate candidate',
      JSON.stringify({
        decisions: [
          { candidateId: 'request-candidate-0001', verdict: 'not_secret' },
          { candidateId: 'request-candidate-0001', verdict: 'uncertain' },
        ],
      }),
    ],
    [
      'unknown candidate',
      JSON.stringify({ decisions: [{ candidateId: 'unknown', verdict: 'not_secret' }] }),
    ],
    [
      'secret without type',
      JSON.stringify({ decisions: [{ candidateId: 'request-candidate-0001', verdict: 'secret' }] }),
    ],
    [
      'bad confidence',
      JSON.stringify({
        decisions: [{ candidateId: 'request-candidate-0001', verdict: 'uncertain', confidence: 2 }],
      }),
    ],
    [
      'non-string label',
      JSON.stringify({
        decisions: [{ candidateId: 'request-candidate-0001', verdict: 'uncertain', label: 123 }],
      }),
    ],
  ])('rejects invalid classifier output: %s', (_name, response) => {
    expect(() => parsePrivacyInputClassifierResponse(response, ['request-candidate-0001'])).toThrow(
      PrivacyInputClassifierError,
    );
  });

  it('rejects unsafe labels before alias storage', () => {
    expect(sanitizeClassifierLabel('safe label-1')).toBe('safe label-1');
    expect(() => sanitizeClassifierLabel('raw\nsecret')).toThrow(PrivacyInputClassifierError);
    expect(() => sanitizeClassifierLabel('x'.repeat(100))).toThrow(PrivacyInputClassifierError);
  });

  it('passes adapter labels through runtime redaction details without raw values', async () => {
    const rawSecret = 'raw-value-123';
    const candidate: PrivacyInputCandidateLike = {
      candidateId: 'candidate-0001',
      sourceSpan: { start: 6, end: 19 },
      hint: { suggestedType: 'api_key' },
    };
    const classifierCallback = createPrivacyInputClassifierCallback({
      classify: async () =>
        JSON.stringify({
          decisions: [
            {
              candidateId: 'request-candidate-0001',
              verdict: 'secret',
              type: 'api_key',
              label: 'Primary key',
            },
          ],
        }),
    });
    const runtime = new PrivacyInputRuntime({
      detect: async () => ({ candidates: [candidate] }),
      classify: async (_text, _candidates, callback) => {
        const callbackResult = await callback({
          sanitizedContext: 'token [CANDIDATE:request-candidate-0001]',
          candidates: [
            { candidateId: 'request-candidate-0001', marker: '[CANDIDATE:request-candidate-0001]' },
          ],
        });
        return {
          decisions: callbackResult.decisions.map(
            (decision): PrivacyInputClassifyDecisionLike => ({
              ...decision,
              candidateId: candidate.candidateId,
              sourceSpan: candidate.sourceSpan,
            }),
          ),
        };
      },
      classifierCallback,
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

    const result = await runtime.handleInput({ text: `token ${rawSecret}`, source: 'interactive' });

    expect(result).toMatchObject({
      action: 'transform',
      details: { redactions: [{ label: 'Primary key', sensitiveRef: 'ref-1' }] },
    });
    expect(JSON.stringify(result)).not.toContain(rawSecret);
  });

  it('creates a replaceable callback around a host transport', async () => {
    const classify = vi.fn<PrivacyInputClassifierTransport['classify']>(async () =>
      JSON.stringify({
        decisions: [{ candidateId: 'request-candidate-0001', verdict: 'not_secret' }],
      }),
    );
    const callback = createPrivacyInputClassifierCallback({ classify });

    await expect(
      callback({
        sanitizedContext: 'value [CANDIDATE:request-candidate-0001]',
        candidates: [
          { candidateId: 'request-candidate-0001', marker: '[CANDIDATE:request-candidate-0001]' },
        ],
      }),
    ).resolves.toEqual({
      decisions: [{ candidateId: 'request-candidate-0001', verdict: 'not_secret' }],
    });
    expect(classify.mock.calls[0]?.[0].userPrompt).toContain('[CANDIDATE:request-candidate-0001]');
  });
});
