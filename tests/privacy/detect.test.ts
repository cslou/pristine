import { describe, expect, it } from 'vitest';
import { detect } from '../../src/privacy/detector/index.js';
import type { DetectCandidate, DetectorRule, SourceSurface } from '../../src/core/types.js';

const validJwt =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

const expectOnlySafeCandidateFields = (candidate: DetectCandidate): void => {
  expect(candidate).not.toHaveProperty('rawValue');
  expect(candidate).not.toHaveProperty('text');
  expect(candidate).not.toHaveProperty('matchedText');
  expect(candidate).not.toHaveProperty('value');
};

const firstCandidate = (text: string, options?: Parameters<typeof detect>[1]): DetectCandidate => {
  const result = detect(text, options);
  expect(result.candidates.length).toBeGreaterThan(0);
  return result.candidates[0]!;
};

describe('detect privacy primitive', () => {
  it.each([
    {
      label: 'private key block',
      text: 'key:\n-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----',
      kind: 'private_key_block',
      ruleId: 'private-key.pem-block',
      suggestedType: 'private_key',
      signal: 'private_key_block',
    },
    {
      label: 'sensitive key assignment',
      text: 'OPENAI_API_KEY=internalSecret1234567890',
      kind: 'key_value_assignment',
      ruleId: 'assignment.sensitive-key',
      suggestedType: 'api_key',
      signal: 'sensitive_key_name',
    },
    {
      label: 'auth header',
      text: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
      kind: 'auth_header',
      ruleId: 'header.authorization-bearer',
      suggestedType: 'auth_token',
      signal: 'auth_header_context',
    },
    {
      label: 'known provider prefix',
      text: 'Use sk-proj-abcdefghijklmnopqrstuvwxyz123456',
      kind: 'known_provider_prefix',
      ruleId: 'provider.openai-project-key',
      suggestedType: 'api_key',
      signal: 'known_provider_prefix',
      prefixFamily: 'sk-proj',
      provider: 'openai',
    },
    {
      label: 'JWT structured token',
      text: `jwt ${validJwt}`,
      kind: 'structured_token',
      ruleId: 'structured.jwt',
      suggestedType: 'auth_token',
      signal: 'structured_token',
    },
    {
      label: 'PASETO structured token',
      text: 'paseto v4.local.abcdefghijklmnopqrstuvwxyz1234567890',
      kind: 'structured_token',
      ruleId: 'structured.paseto',
      suggestedType: 'auth_token',
      signal: 'structured_token',
    },
    {
      label: 'credential-bearing URL',
      text: 'postgres://dbuser:verySecret123@example.com/app',
      kind: 'credential_url',
      ruleId: 'url.credential-password',
      suggestedType: 'password',
      signal: 'credential_url_context',
    },
    {
      label: 'cookie/session token',
      text: 'Cookie: sessionid=abcdef1234567890abcdef',
      kind: 'cookie_or_session',
      ruleId: 'cookie.session-token',
      suggestedType: 'auth_token',
      signal: 'cookie_context',
    },
    {
      label: 'signed URL query secret',
      text: 'https://example.test/file?X-Amz-Signature=abcdef1234567890abcdef1234567890',
      kind: 'signed_url_or_query_secret',
      ruleId: 'query.signed-url-secret',
      suggestedType: 'auth_token',
      signal: 'query_secret_param',
    },
    {
      label: 'cloud credential block',
      text: 'AWS_SECRET_ACCESS_KEY=abcdEFGH1234abcdEFGH1234abcdEFGH1234abcd',
      kind: 'cloud_credential_block',
      ruleId: 'cloud.aws-secret-access-key',
      suggestedType: 'api_key',
      signal: 'cloud_credential_block',
      provider: 'aws',
    },
    {
      label: 'recovery phrase',
      text: 'seed phrase: alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima',
      kind: 'recovery_or_seed_phrase',
      ruleId: 'seed.recovery-phrase',
      suggestedType: 'recovery_phrase',
      signal: 'recovery_phrase_context',
    },
    {
      label: 'opaque generated-looking value',
      text: 'Opaque abcdefghijklmnopqrstuvwxyz1234567890TOKEN',
      kind: 'opaque_generated_value',
      ruleId: 'opaque.generated-looking-value',
      suggestedType: 'secret',
      signal: 'opaque_generated_value',
      sensitivity: 'broad' as const,
    },
  ])(
    'detects $label without exposing raw values',
    ({ text, kind, ruleId, suggestedType, signal, prefixFamily, provider, sensitivity }) => {
      const candidate = firstCandidate(text, { sensitivity });
      expect(candidate.kind).toBe(kind);
      expect(candidate.ruleId).toBe(ruleId);
      expect(candidate.sourceSpan.start).toBeGreaterThanOrEqual(0);
      expect(candidate.sourceSpan.end).toBeGreaterThan(candidate.sourceSpan.start);
      expect(candidate.valueLength).toBe(candidate.sourceSpan.end - candidate.sourceSpan.start);
      expect(candidate.location?.line).toBeGreaterThanOrEqual(1);
      expect(candidate.location?.column).toBeGreaterThanOrEqual(1);
      expect(candidate.hint.suggestedType).toBe(suggestedType);
      expect(candidate.hint.positiveSignals).toContain(signal);
      if (prefixFamily) expect(candidate.hint.prefixFamily).toBe(prefixFamily);
      if (provider) expect(candidate.hint.provider).toBe(provider);
      expect(candidate.candidateId).toMatch(/^candidate-\d{4}$/);
      expectOnlySafeCandidateFields(candidate);
    },
  );

  it('computes capture-group source spans when repeated text appears earlier in a match', () => {
    const text = 'postgres://repeat:repeat@example.com/app';
    const candidate = firstCandidate(text);

    expect(candidate.kind).toBe('credential_url');
    expect(text.slice(candidate.sourceSpan.start, candidate.sourceSpan.end)).toBe('repeat');
    expect(candidate.sourceSpan.start).toBe(text.indexOf(':repeat@') + 1);
  });

  it('supports rule enable/disable, custom rules, sensitivity presets, and source surfaces', () => {
    const providerText = 'Token ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ';
    expect(detect(providerText).candidates).toHaveLength(1);
    expect(
      detect(providerText, { disabledRuleIds: ['provider.github-token'] }).candidates,
    ).toHaveLength(0);
    expect(
      detect(providerText, { enabledRuleIds: ['provider.github-token'] }).candidates,
    ).toHaveLength(1);

    const customText = 'custom secret acme_tk_ABC12345';
    const customRule: DetectorRule = {
      ruleId: 'custom.acme-token',
      kind: 'known_provider_prefix',
      findCandidates: (text) => {
        const value = 'acme_tk_ABC12345';
        const start = text.indexOf(value);
        return [
          {
            sourceSpan: { start, end: start + value.length },
            valueLength: value.length,
            hint: {
              suggestedType: 'api_key',
              provider: 'acme',
              prefixFamily: 'acme_tk',
              positiveSignals: ['custom_rule'],
              features: { bucket: 'short_lived' },
            },
          },
        ];
      },
    };
    const customCandidate = firstCandidate(customText, { customRules: [customRule] });
    expect(customCandidate.ruleId).toBe('custom.acme-token');
    expect(customCandidate.hint.provider).toBe('acme');
    expectOnlySafeCandidateFields(customCandidate);

    const leakyCustomRule: DetectorRule = {
      ruleId: 'custom.leaky-token',
      kind: 'known_provider_prefix',
      findCandidates: (text) => {
        const value = 'leaky_tk_ABC12345';
        const start = text.indexOf(value);
        return [
          {
            sourceSpan: { start, end: start + value.length },
            valueLength: value.length,
            hint: {
              suggestedType: 'api_key',
              provider: value,
              prefixFamily: value,
              positiveSignals: [value, 'custom_rule'],
              features: { leaked: value, safe: 'metadata_only' },
            },
          },
        ];
      },
    };
    const leakyCandidate = firstCandidate('custom secret leaky_tk_ABC12345', {
      customRules: [leakyCustomRule],
    });
    expect(JSON.stringify(leakyCandidate)).not.toContain('leaky_tk_ABC12345');
    expect(leakyCandidate.hint.positiveSignals).toEqual(['custom_rule']);
    expect(leakyCandidate.hint.features).toEqual({ safe: 'metadata_only' });

    const opaque = 'abcdefghijklmnopqrstuvwxyz1234567890TOKEN';
    expect(detect(opaque, { sensitivity: 'broad' }).candidates).toHaveLength(1);
    expect(detect(opaque, { sensitivity: 'balanced' }).candidates).toHaveLength(0);
    expect(detect(opaque, { sensitivity: 'strict' }).candidates).toHaveLength(0);

    const sourceSurface: SourceSurface = {
      kind: 'user_message',
      uri: 'session://local',
      metadata: { turn: 7 },
    };
    expect(detect(providerText, { sourceSurface }).sourceSurface).toEqual(sourceSurface);
  });

  it.each([
    ['commit sha', '0123456789abcdef0123456789abcdef01234567', 'looks_like_commit_sha'],
    [
      'hex hash',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'looks_like_hash',
    ],
    ['uuid', '123e4567-e89b-12d3-a456-426614174000', 'looks_like_uuid'],
    ['public id', 'pk_abcdefghijklmnopqrstuvwxyz1234567890', 'looks_like_public_id'],
    ['placeholder', 'API_KEY=your_api_key_here', 'looks_like_placeholder'],
  ])('marks noisy broad candidates for %s with negative signals', (_label, text, signal) => {
    const result = detect(text, { sensitivity: 'broad' });
    expect(result.candidates[0]?.hint.negativeSignals).toContain(signal);
  });

  it('does not emit candidates for package versions', () => {
    expect(detect('version 1.2.3', { sensitivity: 'broad' }).candidates).toHaveLength(0);
  });

  it('normalizes overlapping auth-header and provider-prefix matches', () => {
    const result = detect('Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      kind: 'auth_header',
      ruleId: 'header.authorization-bearer',
    });
    expect(
      new Set(result.candidates.map((candidate) => JSON.stringify(candidate.sourceSpan))).size,
    ).toBe(result.candidates.length);
  });
});
