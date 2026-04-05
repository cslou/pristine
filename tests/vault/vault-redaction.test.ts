import { describe, expect, it } from 'vitest';
import { redactText } from '../../src/vault/redaction.js';
import type { SensitivityReport, DetectedEntity } from '../../src/core/types.js';

const entity = (
  type: string,
  start: number,
  end: number,
  text: string,
  confidence = 0.9,
): DetectedEntity => ({
  type,
  source: 'deterministic',
  confidence,
  start,
  end,
  text,
});

describe('redaction', () => {
  it('returns original text when no sensitive content', () => {
    const report: SensitivityReport = { entities: [], hasSensitiveContent: false };

    const result = redactText('Hello world', report);
    expect(result.redactedText).toBe('Hello world');
    expect(result.placeholders).toHaveLength(0);
  });

  it('replaces sensitive entity with placeholder', () => {
    const text = 'My NRIC is S1234567D';
    const report: SensitivityReport = {
      entities: [entity('identity_number', 11, 20, 'S1234567D')],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.redactedText).not.toContain('S1234567D');
    expect(result.redactedText).toMatch(/\[SENSITIVE:identity_number:[0-9a-f-]+\]/);
    expect(result.placeholders).toHaveLength(1);
    expect(result.placeholders[0]!.type).toBe('identity_number');
    expect(result.placeholders[0]!.originalText).toBe('S1234567D');
    expect(result.placeholders[0]!.label).toBe('id-4567');
  });

  it('handles multiple entities', () => {
    const text = 'Email alice@test.com and phone 555-1234';
    const report: SensitivityReport = {
      entities: [
        entity('email_address', 6, 20, 'alice@test.com'),
        entity('phone_number', 31, 39, '555-1234'),
      ],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.redactedText).not.toContain('alice@test.com');
    expect(result.redactedText).not.toContain('555-1234');
    expect(result.placeholders).toHaveLength(2);
  });

  it('preserves non-sensitive text around entities', () => {
    const text = 'Start S1234567D end';
    const report: SensitivityReport = {
      entities: [entity('identity_number', 6, 15, 'S1234567D')],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.redactedText).toMatch(/^Start \[SENSITIVE:identity_number:[0-9a-f-]+\] end$/);
  });

  it('each placeholder has unique ID', () => {
    const text = 'A S1234567D B S9876543Z C';
    const report: SensitivityReport = {
      entities: [
        entity('identity_number', 2, 11, 'S1234567D'),
        entity('identity_number', 14, 23, 'S9876543Z'),
      ],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.placeholders).toHaveLength(2);
    expect(result.placeholders[0]!.id).not.toBe(result.placeholders[1]!.id);
  });

  it('handles entirely PII message', () => {
    const text = 'S1234567D';
    const report: SensitivityReport = {
      entities: [entity('identity_number', 0, 9, 'S1234567D')],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.redactedText).toMatch(/^\[SENSITIVE:identity_number:[0-9a-f-]+\]$/);
    expect(result.placeholders).toHaveLength(1);
  });

  it('adds disambiguating label for credit card placeholders', () => {
    const text = 'Card is 4111 1111 1111 4242';
    const report: SensitivityReport = {
      entities: [entity('credit_card', 8, 27, '4111 1111 1111 4242')],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.placeholders).toHaveLength(1);
    expect(result.placeholders[0]!.label).toBe('visa-4242');
  });

  it('adds masked email label for email placeholders', () => {
    const text = 'Email alice@example.com';
    const report: SensitivityReport = {
      entities: [entity('email_address', 6, 23, 'alice@example.com')],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.placeholders).toHaveLength(1);
    expect(result.placeholders[0]!.label).toBe('a***@example.com');
  });

  it('skips overlapping entities (keeps first by sort order)', () => {
    const text = 'overlap text here';
    const report: SensitivityReport = {
      entities: [
        entity('identity_number', 0, 10, 'overlap te'),
        entity('phone_number', 5, 15, 'p text here'),
      ],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.placeholders).toHaveLength(1);
    expect(result.placeholders[0]!.type).toBe('identity_number');
  });

  it('does not redact travel date/time phrases misclassified as other', () => {
    const text = 'Flight date: 2026-03-20, hotel checkin 2026-03-20 checkout 2026-03-24';
    const first = text.indexOf('2026-03-20');
    const second = text.indexOf('2026-03-20', first + 1);
    const third = text.indexOf('2026-03-24');
    const report: SensitivityReport = {
      entities: [
        entity('other', first, first + '2026-03-20'.length, '2026-03-20'),
        entity('other', second, second + '2026-03-20'.length, '2026-03-20'),
        entity('other', third, third + '2026-03-24'.length, '2026-03-24'),
      ],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.redactedText).toBe(text);
    expect(result.placeholders).toHaveLength(0);
  });

  it('does not redact relative weekday travel phrases misclassified as other', () => {
    const text = 'next week monday to friday';
    const report: SensitivityReport = {
      entities: [entity('other', 0, text.length, text)],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.redactedText).toBe(text);
    expect(result.placeholders).toHaveLength(0);
  });

  it('does not redact long travel scheduling phrase misclassified as other', () => {
    const text =
      'I want to book a trip from MAA to Tokyo next week Monday to Friday for a short vacation';
    const report: SensitivityReport = {
      entities: [entity('other', 0, text.length, text)],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.redactedText).toBe(text);
    expect(result.placeholders).toHaveLength(0);
  });

  it('still redacts date values when context indicates DOB', () => {
    const text = 'My DOB is 1990-01-01';
    const start = text.indexOf('1990-01-01');
    const report: SensitivityReport = {
      entities: [entity('other', start, start + '1990-01-01'.length, '1990-01-01')],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.redactedText).not.toContain('1990-01-01');
    expect(result.redactedText).toMatch(/\[SENSITIVE:other:[0-9a-f-]+\]/);
    expect(result.placeholders).toHaveLength(1);
  });

  it('does not redact one-digit day dates misclassified as other', () => {
    const text = 'dates: 2026-05-20 to 2026-05-2';
    const first = text.indexOf('2026-05-20');
    const second = text.indexOf('2026-05-2');
    const report: SensitivityReport = {
      entities: [
        entity('other', first, first + '2026-05-20'.length, '2026-05-20'),
        entity('other', second, second + '2026-05-2'.length, '2026-05-2'),
      ],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.redactedText).toBe(text);
    expect(result.placeholders).toHaveLength(0);
  });

  it('does not redact city-only value misclassified as physical_address', () => {
    const text = 'arriving at tokyo';
    const start = text.indexOf('tokyo');
    const report: SensitivityReport = {
      entities: [entity('physical_address', start, start + 'tokyo'.length, 'tokyo')],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.redactedText).toBe(text);
    expect(result.placeholders).toHaveLength(0);
  });

  it('still redacts full physical addresses', () => {
    const text = 'Ship to 123 Main Street, Springfield, 90210';
    const start = text.indexOf('123');
    const value = '123 Main Street, Springfield, 90210';
    const report: SensitivityReport = {
      entities: [entity('physical_address', start, start + value.length, value)],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.redactedText).not.toContain(value);
    expect(result.redactedText).toMatch(/\[SENSITIVE:physical_address:[0-9a-f-]+\]/);
    expect(result.placeholders).toHaveLength(1);
  });

  it('redacts simple address text when explicit address context exists', () => {
    const text = 'My address is Springfield';
    const value = 'Springfield';
    const start = text.indexOf(value);
    const report: SensitivityReport = {
      entities: [entity('physical_address', start, start + value.length, value)],
      hasSensitiveContent: true,
    };

    const result = redactText(text, report);

    expect(result.redactedText).not.toContain(value);
    expect(result.redactedText).toMatch(/\[SENSITIVE:physical_address:[0-9a-f-]+\]/);
    expect(result.placeholders).toHaveLength(1);
  });
});
