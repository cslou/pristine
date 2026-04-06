import { describe, expect, it } from 'vitest';
import { sanitizeText } from '../../src/privacy/sanitizer/index.js';

describe('sanitizer', () => {
  describe('sanitizeText', () => {
    it('returns original text when no placeholders', () => {
      const result = sanitizeText('Hello world, no secrets here');
      expect(result.text).toBe('Hello world, no secrets here');
      expect(result.sensitiveFields).toHaveLength(0);
    });

    it('replaces identity_number placeholder with natural text', () => {
      const input = 'User NRIC is [SENSITIVE:identity_number:a1b2c3d4-e5f6-7890-abcd-ef1234567890]';
      const result = sanitizeText(input);

      expect(result.text).toBe('User NRIC is [Identity number]');
      expect(result.sensitiveFields).toHaveLength(1);
      expect(result.sensitiveFields[0]!.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(result.sensitiveFields[0]!.type).toBe('identity_number');
      expect(result.sensitiveFields[0]!.description).toBe('Identity number');
    });

    it('replaces bank_account placeholder', () => {
      const input = 'Account: [SENSITIVE:bank_account:00000000-0000-0000-0000-000000000001]';
      const result = sanitizeText(input);

      expect(result.text).toBe('Account: [Bank account number]');
      expect(result.sensitiveFields[0]!.type).toBe('bank_account');
    });

    it('replaces credit_card placeholder', () => {
      const input = 'Card: [SENSITIVE:credit_card:00000000-0000-0000-0000-000000000002]';
      const result = sanitizeText(input);

      expect(result.text).toBe('Card: [Credit card number]');
      expect(result.sensitiveFields[0]!.type).toBe('credit_card');
    });

    it('replaces phone_number placeholder', () => {
      const input = 'Call [SENSITIVE:phone_number:00000000-0000-0000-0000-000000000003]';
      const result = sanitizeText(input);

      expect(result.text).toBe('Call [Phone number]');
      expect(result.sensitiveFields[0]!.type).toBe('phone_number');
    });

    it('replaces email_address placeholder', () => {
      const input = 'Email: [SENSITIVE:email_address:00000000-0000-0000-0000-000000000004]';
      const result = sanitizeText(input);

      expect(result.text).toBe('Email: [Email address]');
      expect(result.sensitiveFields[0]!.type).toBe('email_address');
    });

    it('replaces physical_address placeholder', () => {
      const input = 'Lives at [SENSITIVE:physical_address:00000000-0000-0000-0000-000000000005]';
      const result = sanitizeText(input);

      expect(result.text).toBe('Lives at [Address]');
      expect(result.sensitiveFields[0]!.type).toBe('physical_address');
    });

    it('replaces health placeholder', () => {
      const input = 'Has [SENSITIVE:health:00000000-0000-0000-0000-000000000006]';
      const result = sanitizeText(input);

      expect(result.text).toBe('Has [Health information]');
      expect(result.sensitiveFields[0]!.type).toBe('health');
    });

    it('replaces financial placeholder', () => {
      const input = 'Earns [SENSITIVE:financial:00000000-0000-0000-0000-000000000007]';
      const result = sanitizeText(input);

      expect(result.text).toBe('Earns [Financial information]');
      expect(result.sensitiveFields[0]!.type).toBe('financial');
    });

    it('replaces relationship placeholder', () => {
      const input = 'Is [SENSITIVE:relationship:00000000-0000-0000-0000-000000000008]';
      const result = sanitizeText(input);

      expect(result.text).toBe('Is [Relationship information]');
      expect(result.sensitiveFields[0]!.type).toBe('relationship');
    });

    it('replaces legal placeholder', () => {
      const input = 'Has [SENSITIVE:legal:00000000-0000-0000-0000-000000000009]';
      const result = sanitizeText(input);

      expect(result.text).toBe('Has [Legal information]');
      expect(result.sensitiveFields[0]!.type).toBe('legal');
    });

    it('replaces other placeholder', () => {
      const input = 'Has [SENSITIVE:other:00000000-0000-0000-0000-00000000000a]';
      const result = sanitizeText(input);

      expect(result.text).toBe('Has [Sensitive information]');
      expect(result.sensitiveFields[0]!.type).toBe('other');
    });

    it('handles multiple placeholders', () => {
      const input =
        'User [SENSITIVE:identity_number:00000000-0000-0000-0000-000000000001] lives at [SENSITIVE:physical_address:00000000-0000-0000-0000-000000000002] and can be reached at [SENSITIVE:phone_number:00000000-0000-0000-0000-000000000003]';
      const result = sanitizeText(input);

      expect(result.text).toBe(
        'User [Identity number] lives at [Address] and can be reached at [Phone number]',
      );
      expect(result.sensitiveFields).toHaveLength(3);
      expect(result.sensitiveFields[0]!.type).toBe('identity_number');
      expect(result.sensitiveFields[1]!.type).toBe('physical_address');
      expect(result.sensitiveFields[2]!.type).toBe('phone_number');
    });

    it('orders multi-sensitive fields deterministically by field id', () => {
      const input =
        'User [SENSITIVE:bank_account:00000000-0000-0000-0000-000000000002] and [SENSITIVE:identity_number:00000000-0000-0000-0000-000000000001]';
      const result = sanitizeText(input);

      expect(result.text).toBe('User [Bank account number] and [Identity number]');
      expect(result.sensitiveFields).toHaveLength(2);
      expect(result.sensitiveFields.map((entry) => entry.id)).toEqual([
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
      ]);
    });

    it('normalizes duplicate sensitive ids into stable, unique IDs', () => {
      const input =
        'Repeated [SENSITIVE:identity_number:00000000-0000-0000-0000-000000000001] and [SENSITIVE:bank_account:00000000-0000-0000-0000-000000000001]';
      const result = sanitizeText(input);

      expect(result.sensitiveFields).toHaveLength(2);
      expect(result.sensitiveFields.map((entry) => entry.id)).toEqual([
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001-2',
      ]);
      expect(new Set(result.sensitiveFields.map((entry) => entry.id)).size).toBe(2);
    });

    it('handles unknown type gracefully', () => {
      const input = 'Has [SENSITIVE:unknown_type:00000000-0000-0000-0000-000000000001]';
      const result = sanitizeText(input);

      expect(result.text).toBe('Has [Sensitive information]');
      expect(result.sensitiveFields[0]!.type).toBe('unknown_type');
      expect(result.sensitiveFields[0]!.description).toBe('Sensitive information');
    });

    it('does not match malformed placeholders (missing id)', () => {
      const input = 'Has [SENSITIVE:identity_number:]';
      const result = sanitizeText(input);

      expect(result.text).toBe('Has [SENSITIVE:identity_number:]');
      expect(result.sensitiveFields).toHaveLength(0);
    });

    it('does not match malformed placeholders (unclosed bracket)', () => {
      const input = 'Has [SENSITIVE:identity_number:00000000-0000-0000-0000-000000000001';
      const result = sanitizeText(input);

      expect(result.text).toBe(
        'Has [SENSITIVE:identity_number:00000000-0000-0000-0000-000000000001',
      );
      expect(result.sensitiveFields).toHaveLength(0);
    });

    it('does not match user-typed fake placeholder with uppercase type', () => {
      const input = 'User typed [SENSITIVE:IDENTITY:abc-123]';
      const result = sanitizeText(input);

      expect(result.text).toBe('User typed [SENSITIVE:IDENTITY:abc-123]');
      expect(result.sensitiveFields).toHaveLength(0);
    });

    it('does not match user-typed fake placeholder with invalid id format', () => {
      const input = 'User typed [SENSITIVE:identity_number:not-hex-chars!@#]';
      const result = sanitizeText(input);

      expect(result.text).toBe('User typed [SENSITIVE:identity_number:not-hex-chars!@#]');
      expect(result.sensitiveFields).toHaveLength(0);
    });

    it('handles 20+ sensitive fields', () => {
      const parts: string[] = [];
      for (let i = 0; i < 25; i += 1) {
        const hex = i.toString(16).padStart(12, '0');
        parts.push(`Field [SENSITIVE:identity_number:00000000-0000-0000-0000-${hex}]`);
      }
      const input = parts.join(' ');
      const result = sanitizeText(input);

      expect(result.sensitiveFields).toHaveLength(25);
      const ids = new Set(result.sensitiveFields.map((f) => f.id));
      expect(ids.size).toBe(25);
    });

    it('reads naturally after sanitization', () => {
      const input =
        'User has NRIC [SENSITIVE:identity_number:00000000-0000-0000-0000-000000000001] and email [SENSITIVE:email_address:00000000-0000-0000-0000-000000000002]';
      const result = sanitizeText(input);

      expect(result.text).toBe('User has NRIC [Identity number] and email [Email address]');
    });
  });
});
