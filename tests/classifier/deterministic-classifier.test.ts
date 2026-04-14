import { describe, expect, it } from 'vitest';
import { createDeterministicClassifier } from '../../src/privacy/classifier/deterministic/index.js';

describe('deterministic classifier', () => {
  describe('credit card detection', () => {
    it('detects valid credit card with spaces', async () => {
      const classifier = createDeterministicClassifier();
      const report = await classifier.classify('My card is 4111 1111 1111 1111 thanks.');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities).toHaveLength(1);
      expect(report.entities[0]).toMatchObject({
        type: 'credit_card',
        source: 'deterministic',
        text: '4111 1111 1111 1111',
      });
    });

    it('detects valid credit card with dashes', async () => {
      const classifier = createDeterministicClassifier();
      const report = await classifier.classify('Card: 4111-1111-1111-1111');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities[0]).toMatchObject({ type: 'credit_card' });
    });

    it('rejects invalid Luhn checksum', async () => {
      const classifier = createDeterministicClassifier();
      const report = await classifier.classify('Number: 1234 5678 9012 3456');

      expect(report.hasSensitiveContent).toBe(false);
      expect(report.entities).toHaveLength(0);
    });
  });

  describe('email detection', () => {
    it('detects standard email address', async () => {
      const classifier = createDeterministicClassifier();
      const report = await classifier.classify('Contact me at alice@example.com please.');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities).toHaveLength(1);
      expect(report.entities[0]).toMatchObject({
        type: 'email_address',
        source: 'deterministic',
        text: 'alice@example.com',
      });
    });

    it('detects email with subdomains and plus addressing', async () => {
      const classifier = createDeterministicClassifier();
      const report = await classifier.classify('Send to user+tag@mail.corp.example.com');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities[0]!.type).toBe('email_address');
    });
  });

  describe('SSN detection', () => {
    it('detects US SSN format', async () => {
      const classifier = createDeterministicClassifier();
      const report = await classifier.classify('SSN: 123-45-6789');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities).toHaveLength(1);
      expect(report.entities[0]).toMatchObject({
        type: 'identity_number',
        source: 'deterministic',
        text: '123-45-6789',
      });
    });
  });

  describe('phone number detection', () => {
    it('detects US phone number with country code', async () => {
      const classifier = createDeterministicClassifier();
      const report = await classifier.classify('Call me at +1-555-867-5309');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities[0]).toMatchObject({
        type: 'phone_number',
        source: 'deterministic',
      });
    });

    it('detects phone number with parentheses', async () => {
      const classifier = createDeterministicClassifier();
      const report = await classifier.classify('Phone: (555) 867-5309');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities[0]!.type).toBe('phone_number');
    });
  });

  describe('secret detection', () => {
    it('detects secret keyword/value pairs', async () => {
      const classifier = createDeterministicClassifier();
      const report = await classifier.classify('Local config api_key=supersecret');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities).toHaveLength(1);
      expect(report.entities[0]).toMatchObject({
        type: 'secret',
        source: 'deterministic',
        text: 'api_key=supersecret',
      });
    });
  });

  describe('clean text', () => {
    it('returns no entities for non-sensitive text', async () => {
      const classifier = createDeterministicClassifier();
      const report = await classifier.classify('The weather is beautiful today.');

      expect(report.hasSensitiveContent).toBe(false);
      expect(report.entities).toHaveLength(0);
    });

    it('returns empty report for empty text', async () => {
      const classifier = createDeterministicClassifier();
      const report = await classifier.classify('');

      expect(report.hasSensitiveContent).toBe(false);
      expect(report.entities).toHaveLength(0);
    });
  });

  describe('multiple PII in one text', () => {
    it('detects multiple different PII types', async () => {
      const classifier = createDeterministicClassifier();
      const report = await classifier.classify(
        'Email alice@example.com, SSN 123-45-6789, call (555) 867-5309.',
      );

      expect(report.entities.length).toBeGreaterThanOrEqual(3);
      const types = report.entities.map((e) => e.type);
      expect(types).toContain('email_address');
      expect(types).toContain('identity_number');
      expect(types).toContain('phone_number');
    });
  });

  describe('entity spans', () => {
    it('provides correct start/end offsets', async () => {
      const classifier = createDeterministicClassifier();
      const text = 'Email: alice@example.com ok';
      const report = await classifier.classify(text);

      const entity = report.entities[0]!;
      expect(text.slice(entity.start, entity.end)).toBe('alice@example.com');
    });
  });
});
