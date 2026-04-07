import { describe, expect, it } from 'vitest';
import {
  findSafetyViolations,
  replacePlaceholdersWithWhitespace,
  scrubStructuredSensitivePatterns,
} from '../../src/privacy/safety-scan.js';

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
    const text = 'Reach me at alice@example.com or use password=supersecret.';
    const violations = findSafetyViolations(text);

    expect(violations.map((violation) => violation.type)).toEqual(['email_address', 'secret']);
  });

  it('detects phone numbers and ssns but does not confuse ISO dates for phones', () => {
    const text = 'Phone 555-867-5309, SSN 123-45-6789, date 2024-01-15.';
    const violations = findSafetyViolations(text);

    expect(violations.map((violation) => violation.type)).toEqual([
      'phone_number',
      'identity_number',
    ]);
    expect(violations.some((violation) => violation.text === '2024-01-15')).toBe(false);
  });

  it('uses luhn validation for card-like values', () => {
    const valid = findSafetyViolations('Card 4111 1111 1111 1111');
    const invalid = findSafetyViolations('Card 4111 1111 1111 1112');

    expect(valid.map((violation) => violation.type)).toEqual(['credit_card']);
    expect(invalid).toHaveLength(0);
  });

  it('scrubs structured sensitive patterns from text', () => {
    const text = 'Card 4111 1111 1111 1111 and api_key=supersecret';
    const scrubbed = scrubStructuredSensitivePatterns(text);

    expect(scrubbed).not.toContain('4111 1111 1111 1111');
    expect(scrubbed).not.toContain('api_key=supersecret');
  });
});
