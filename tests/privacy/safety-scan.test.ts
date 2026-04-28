import { describe, expect, it } from 'vitest';
import {
  findSafetyViolations,
  replacePlaceholdersWithWhitespace,
  scrubStructuredSensitivePatterns,
} from '../../src/privacy/safety-scan.js';
import { createDeterministicPatternRuleSet } from '../../src/privacy/classifier/deterministic/index.js';

describe('safety scan', () => {
  it('ignores placeholder tokens when scanning for survivors', () => {
    const text =
      'Email [SENSITIVE:email_address:11111111-1111-1111-1111-111111111111] is already redacted.';

    const neutralized = replacePlaceholdersWithWhitespace(text);
    const violations = findSafetyViolations(text);

    expect(neutralized).toHaveLength(text.length);
    expect(violations).toHaveLength(0);
  });

  it('detects obvious structured survivors', () => {
    const text =
      'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef and password=correct-horse-battery.';
    const violations = findSafetyViolations(text);

    expect(violations.map((violation) => violation.type)).toEqual([
      'api_key',
      'private_key',
      'secret',
    ]);
  });

  it('detects private key blocks and does not confuse naked EVM hashes for private keys', () => {
    const text = [
      '-----BEGIN PRIVATE KEY-----',
      'abc123',
      '-----END PRIVATE KEY-----',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    ].join('\n');
    const violations = findSafetyViolations(text);

    expect(violations.map((violation) => violation.type)).toEqual(['private_key']);
    expect(
      violations.some((violation) =>
        violation.text.includes(
          '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        ),
      ),
    ).toBe(false);
  });

  it('validates JWT-like values', () => {
    const valid = findSafetyViolations(
      'Token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature',
    );
    const invalid = findSafetyViolations('Token eyJabc.eyJdef.signature');

    expect(valid.map((violation) => violation.type)).toEqual(['auth_token']);
    expect(invalid).toHaveLength(0);
  });

  it('scrubs structured sensitive patterns from text', () => {
    const text =
      'Key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef and password=correct-horse-battery';
    const scrubbed = scrubStructuredSensitivePatterns(text);

    expect(scrubbed).not.toContain('sk-ant-api03');
    expect(scrubbed).not.toContain('DEPLOYER_PRIVATE_KEY=');
    expect(scrubbed).not.toContain('password=');
  });

  it('uses configured custom rules for survivor scanning and scrubbing', () => {
    const ruleSet = createDeterministicPatternRuleSet({
      customPatternsPath: '/tmp/pristine-missing-redaction.json',
      customPatterns: [
        {
          id: 'acme',
          type: 'api_key',
          pattern: '\\bacme_tk_[A-Za-z0-9]{8}\\b',
          confidence: 0.95,
        },
      ],
    });

    const violations = findSafetyViolations('Leaked acme_tk_ABC12345', ruleSet.rules);
    const scrubbed = scrubStructuredSensitivePatterns('Leaked acme_tk_ABC12345', ruleSet.rules);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ type: 'api_key', text: 'acme_tk_ABC12345' });
    expect(scrubbed).not.toContain('acme_tk_ABC12345');
  });

  it('strips placeholders before stand-alone structured scrubbing', () => {
    const text = 'api_key=[SENSITIVE:secret:11111111-1111-1111-1111-111111111111]';
    const scrubbed = scrubStructuredSensitivePatterns(text);

    expect(scrubbed).not.toContain('[SENSITIVE:');
    expect(scrubbed).toBe('api_key=');
  });
});
