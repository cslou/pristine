import { describe, expect, it } from 'vitest';
import { classify } from '../../src/privacy/classifier/index.js';
import { detect } from '../../src/privacy/detector/index.js';
import type {
  ClassifierCallbackResult,
  ClassifierRequest,
  DetectCandidate,
} from '../../src/core/types.js';

const candidateFor = (
  text: string,
  value: string,
  overrides: Partial<DetectCandidate> = {},
): DetectCandidate => {
  const start = text.indexOf(value);
  if (start < 0) throw new Error('test fixture value not found');
  return {
    candidateId: overrides.candidateId ?? 'candidate-0001',
    kind: overrides.kind ?? 'known_provider_prefix',
    ruleId: overrides.ruleId ?? 'test.rule',
    sourceSpan: overrides.sourceSpan ?? { start, end: start + value.length },
    valueLength: overrides.valueLength ?? value.length,
    location: overrides.location,
    hint: overrides.hint ?? {},
  };
};

const serializedRequest = async (
  text: string,
  candidates: readonly DetectCandidate[],
  contextWindow?: number,
): Promise<{ request: ClassifierRequest; serialized: string }> => {
  let request: ClassifierRequest | undefined;
  await classify(
    text,
    candidates,
    async (classifierRequest) => {
      request = classifierRequest;
      return {
        decisions: classifierRequest.candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          verdict: 'uncertain' as const,
        })),
      };
    },
    {
      requestId: 'request-test',
      sourceSurface: { kind: 'user_message', uri: 'session://one' },
      contextWindow,
    },
  );

  if (!request) throw new Error('classifier callback was not invoked');
  return { request, serialized: JSON.stringify(request) };
};

describe('classify privacy primitive', () => {
  it('builds a raw-value-free multi-candidate classifier request with markers', async () => {
    const apiKey = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
    const urlPassword = 'verySecret123';
    const text = `Use ${apiKey} and postgres://dbuser:${urlPassword}@example.com/app`;
    const detected = detect(text, {
      sourceSurface: { kind: 'user_message', uri: 'session://one' },
    });
    const candidates = detected.candidates.filter(
      (candidate) =>
        text.slice(candidate.sourceSpan.start, candidate.sourceSpan.end) === apiKey ||
        text.slice(candidate.sourceSpan.start, candidate.sourceSpan.end) === urlPassword,
    );

    expect(candidates).toHaveLength(2);
    const { request, serialized } = await serializedRequest(text, candidates);

    expect(request.requestId).toBe('request-test');
    expect(request.sourceSurface).toEqual({ kind: 'user_message' });
    for (const candidate of request.candidates) {
      expect(candidate.marker).toBe(`[CANDIDATE:${candidate.candidateId}]`);
      expect(candidate.candidateId).toMatch(/^request-candidate-\d{4}$/);
      expect(request.sanitizedContext).toContain(candidate.marker);
      expect(candidate.sourceSpan).toEqual(
        candidates.find((source) => source.sourceSpan.start === candidate.sourceSpan.start)
          ?.sourceSpan,
      );
    }
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(urlPassword);
  });

  it('includes the documented classifier request shape without raw hint leakage', async () => {
    const secret = 'custom-prefix-1234567890';
    const text = `token=${secret}`;
    const candidate = candidateFor(text, secret, {
      candidateId: 'candidate-shape',
      kind: 'key_value_assignment',
      ruleId: 'assignment.secret',
      location: { line: 1, column: 7 },
      hint: {
        suggestedType: 'api_key',
        provider: 'custom-provider',
        prefixFamily: 'custom-family',
        nearbyName: 'TOKEN',
        signals: ['1234567890', 'known_provider_prefix'],
        positiveSignals: ['assignment_context'],
        negativeSignals: ['example_like'],
        features: { entropyBucket: 'high', leaked: secret, suffix1234567890: 'high' },
      },
    });

    const { request, serialized } = await serializedRequest(text, [candidate]);

    expect(request).toMatchObject({
      requestId: 'request-test',
      sourceSurface: { kind: 'user_message' },
      sanitizedContext: 'token=[CANDIDATE:request-candidate-0001]',
      candidates: [
        {
          candidateId: 'request-candidate-0001',
          marker: '[CANDIDATE:request-candidate-0001]',
          kind: 'key_value_assignment',
          ruleId: 'assignment.secret',
          sourceSpan: candidate.sourceSpan,
          valueLength: secret.length,
          location: { line: 1, column: 7 },
          hint: {
            suggestedType: 'api_key',
            nearbyName: 'TOKEN',
            features: { entropyBucket: 'high' },
          },
        },
      ],
    });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('1234567890');
    expect(serialized).not.toContain('custom-provider');
    expect(serialized).not.toContain('custom-family');
  });

  it('preserves safe provider prefix-family hints but drops arbitrary raw-derived prefixes', async () => {
    const text = [
      'openai sk-proj-abcdefghijklmnopqrstuvwxyz123456',
      'github ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
      'aws AKIAABCDEFGHIJKLMNOP',
      'unknown xyz_abcdefghijklmnopqrstuvwxyz123456',
    ].join('\n');
    const candidates = [
      candidateFor(text, 'sk-proj-abcdefghijklmnopqrstuvwxyz123456', {
        candidateId: 'openai',
        hint: { provider: 'openai', prefixFamily: 'sk-proj' },
      }),
      candidateFor(text, 'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ', {
        candidateId: 'github',
        hint: { provider: 'github', prefixFamily: 'ghp_' },
      }),
      candidateFor(text, 'AKIAABCDEFGHIJKLMNOP', {
        candidateId: 'aws',
        hint: { provider: 'aws', prefixFamily: 'AKIA' },
      }),
      candidateFor(text, 'xyz_abcdefghijklmnopqrstuvwxyz123456', {
        candidateId: 'unknown',
        hint: { provider: 'xyz_', prefixFamily: 'xyz_' },
      }),
    ];

    const { request } = await serializedRequest(text, candidates);
    const byOriginalOrder = request.candidates;

    expect(byOriginalOrder[0]?.hint.prefixFamily).toBe('sk-proj');
    expect(byOriginalOrder[1]?.hint.prefixFamily).toBe('ghp_');
    expect(byOriginalOrder[2]?.hint.prefixFamily).toBe('AKIA');
    expect(byOriginalOrder[3]?.hint.provider).toBeUndefined();
    expect(byOriginalOrder[3]?.hint.prefixFamily).toBeUndefined();
  });

  it('does not expose raw-derived candidate IDs or encoded feature values', async () => {
    const secret = 'custom-secret-123456';
    const text = `token=${secret}`;
    const candidate = candidateFor(text, secret, {
      candidateId: secret,
      hint: {
        features: {
          hasAssignmentContext: true,
          entropyBucket: 'high',
          tokenFormat: 'jwt',
          encodedChars: [99, 117, 115, 116, 111, 109],
        },
      },
    });

    const { request, serialized } = await serializedRequest(text, [candidate]);

    expect(request.candidates[0]?.candidateId).toBe('request-candidate-0001');
    expect(request.sanitizedContext).toBe('token=[CANDIDATE:request-candidate-0001]');
    expect(request.candidates[0]?.hint.features).toEqual({
      hasAssignmentContext: true,
      entropyBucket: 'high',
      tokenFormat: 'jwt',
    });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('encodedChars');
  });

  it('does not send decoded JWT payloads, query secrets, URL passwords, or seed words', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsb3UifQ.signatureabcdefghijklmnopqrstuvwxyz';
    const urlPassword = 'dbPassSecret123';
    const querySecret = 'querySecret456';
    const seedWords = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mango';
    const text = [
      `Authorization: Bearer ${jwt}`,
      `db=postgres://user:${urlPassword}@example.com/app`,
      `url=https://example.com/download?X-Amz-Signature=${querySecret}`,
      `seed phrase: ${seedWords}`,
    ].join('\n');
    const detected = detect(text);
    const candidates = detected.candidates.filter((candidate) =>
      [jwt, urlPassword, querySecret, seedWords].includes(
        text.slice(candidate.sourceSpan.start, candidate.sourceSpan.end),
      ),
    );

    expect(candidates).toHaveLength(4);
    const { serialized } = await serializedRequest(text, candidates);

    expect(serialized).not.toContain(jwt);
    expect(serialized).not.toContain('lou');
    expect(serialized).not.toContain(urlPassword);
    expect(serialized).not.toContain(querySecret);
    for (const word of seedWords.split(' ')) {
      expect(serialized).not.toContain(word);
    }
  });

  it('honors context windows and does not invoke callbacks for empty candidate lists', async () => {
    let emptyCallbackInvoked = false;
    await expect(
      classify('raw text without candidates', [], async () => {
        emptyCallbackInvoked = true;
        return { decisions: [] };
      }),
    ).resolves.toEqual({ decisions: [] });
    expect(emptyCallbackInvoked).toBe(false);

    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
    const text = `prefix that should be trimmed before ${secret} after text that should be trimmed`;
    const candidate = candidateFor(text, secret, { candidateId: 'windowed' });
    const { request } = await serializedRequest(text, [candidate], 6);

    expect(request.sanitizedContext).toBe('efore [CANDIDATE:request-candidate-0001] after');
    expect(request.sanitizedContext).not.toContain('prefix that should be trimmed');
    expect(request.sanitizedContext).not.toContain('text that should be trimmed');
  });

  it('normalizes valid callback decisions back to original source spans', async () => {
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
    const text = `token=${secret}`;
    const candidate = candidateFor(text, secret, {
      hint: { suggestedType: 'api_key', provider: 'openai', prefixFamily: 'sk-proj' },
    });

    const result = await classify(text, [candidate], async (request) => ({
      decisions: [
        {
          candidateId: request.candidates[0]!.candidateId,
          verdict: 'secret',
          type: 'api_key',
          label: 'primary key',
          confidence: 0.97,
          rationale: 'provider prefix',
        },
      ],
    }));

    expect(result.decisions).toEqual([
      {
        candidateId: candidate.candidateId,
        verdict: 'secret',
        type: 'api_key',
        label: 'primary key',
        confidence: 0.97,
        rationale: 'provider prefix',
        sourceSpan: candidate.sourceSpan,
      },
    ]);
  });

  it.each([
    [
      'duplicate decision',
      [
        { candidateId: 'request-candidate-0001', verdict: 'uncertain' },
        { candidateId: 'request-candidate-0001', verdict: 'not_secret' },
      ],
    ],
    ['unknown decision', [{ candidateId: 'unknown', verdict: 'uncertain' }]],
    ['missing decision', []],
    ['invalid verdict', [{ candidateId: 'request-candidate-0001', verdict: 'safe' }]],
    ['secret without type', [{ candidateId: 'request-candidate-0001', verdict: 'secret' }]],
    ['empty type', [{ candidateId: 'request-candidate-0001', verdict: 'secret', type: '' }]],
    [
      'invalid confidence',
      [{ candidateId: 'request-candidate-0001', verdict: 'uncertain', confidence: 1.5 }],
    ],
    ['invalid label', [{ candidateId: 'request-candidate-0001', verdict: 'uncertain', label: '' }]],
  ])('fails loudly for malformed callback output: %s', async (_name, decisions) => {
    const text = 'token=secret1234567890';
    const candidate = candidateFor(text, 'secret1234567890');

    await expect(
      classify(
        text,
        [candidate],
        async () => ({ decisions }) as unknown as ClassifierCallbackResult,
      ),
    ).rejects.toThrow(/classify:/);
  });
});
