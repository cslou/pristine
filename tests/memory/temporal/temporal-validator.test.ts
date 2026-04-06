import { describe, expect, it } from 'vitest';
import { validateTemporalFields } from '../../../src/memory/temporal/index.js';
import type { Fact } from '../../../src/core/types.js';

const REF_TIMESTAMP = '2026-03-15T12:00:00.000Z';

const baseFact = (overrides: Partial<Fact> = {}): Fact => ({
  text: 'User works at Google.',
  ...overrides,
});

describe('validateTemporalFields', () => {
  describe('valid dates pass through', () => {
    it('preserves valid explicit validFrom', () => {
      const result = validateTemporalFields(
        baseFact({ validFrom: '2026-01-01T00:00:00.000Z', temporalConfidence: 'explicit' }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.validFrom).toBe('2026-01-01T00:00:00.000Z');
      expect(result.temporalConfidence).toBe('explicit');
    });

    it('preserves valid validUntil', () => {
      const result = validateTemporalFields(
        baseFact({ validUntil: '2025-12-01T00:00:00.000Z', temporalConfidence: 'implied' }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.validUntil).toBe('2025-12-01T00:00:00.000Z');
    });

    it('preserves both validFrom and validUntil', () => {
      const result = validateTemporalFields(
        baseFact({
          validFrom: '2024-01-01T00:00:00.000Z',
          validUntil: '2025-01-01T00:00:00.000Z',
          temporalConfidence: 'inferred',
        }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.validFrom).toBe('2024-01-01T00:00:00.000Z');
      expect(result.validUntil).toBe('2025-01-01T00:00:00.000Z');
      expect(result.temporalConfidence).toBe('inferred');
    });
  });

  describe('invalid dates are nullified', () => {
    it('rejects unparseable validFrom', () => {
      const result = validateTemporalFields(
        baseFact({ validFrom: 'not-a-date', temporalConfidence: 'explicit' }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.validFrom).toBeUndefined();
      expect(result.temporalConfidence).toBe('none');
    });

    it('rejects unparseable validUntil', () => {
      const result = validateTemporalFields(
        baseFact({ validUntil: 'garbage', temporalConfidence: 'inferred' }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.validUntil).toBeUndefined();
      expect(result.temporalConfidence).toBe('none');
    });

    it('rejects validFrom before minimum date (1900)', () => {
      const result = validateTemporalFields(
        baseFact({ validFrom: '1850-01-01T00:00:00.000Z', temporalConfidence: 'explicit' }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.validFrom).toBeUndefined();
      expect(result.temporalConfidence).toBe('none');
    });

    it('uses custom minimum date when provided', () => {
      const result = validateTemporalFields(
        baseFact({ validFrom: '1950-01-01T00:00:00.000Z', temporalConfidence: 'explicit' }),
        { referenceTimestamp: REF_TIMESTAMP, minimumDate: '2000-01-01T00:00:00.000Z' },
      );

      expect(result.validFrom).toBeUndefined();
      expect(result.temporalConfidence).toBe('none');
    });
  });

  describe('suspicious future dates', () => {
    it('rejects future validFrom when confidence is implied', () => {
      const futureDate = '2027-06-01T00:00:00.000Z';
      const result = validateTemporalFields(
        baseFact({ validFrom: futureDate, temporalConfidence: 'implied' }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.validFrom).toBeUndefined();
      expect(result.temporalConfidence).toBe('none');
    });

    it('rejects future validFrom when confidence is none', () => {
      const futureDate = '2027-06-01T00:00:00.000Z';
      const result = validateTemporalFields(
        baseFact({ validFrom: futureDate, temporalConfidence: 'none' }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.validFrom).toBeUndefined();
    });

    it('allows future validFrom when confidence is explicit (plans)', () => {
      const futureDate = '2026-06-01T00:00:00.000Z';
      const result = validateTemporalFields(
        baseFact({ validFrom: futureDate, temporalConfidence: 'explicit' }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.validFrom).toBe(futureDate);
      expect(result.temporalConfidence).toBe('explicit');
    });

    it('allows future validFrom when confidence is inferred', () => {
      const futureDate = '2026-04-15T00:00:00.000Z';
      const result = validateTemporalFields(
        baseFact({ validFrom: futureDate, temporalConfidence: 'inferred' }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.validFrom).toBe(futureDate);
      expect(result.temporalConfidence).toBe('inferred');
    });

    it('allows validFrom within 24h of referenceTimestamp even with low confidence', () => {
      const nearFuture = '2026-03-16T00:00:00.000Z'; // 12h after REF_TIMESTAMP
      const result = validateTemporalFields(
        baseFact({ validFrom: nearFuture, temporalConfidence: 'implied' }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.validFrom).toBe(nearFuture);
    });
  });

  describe('confidence policies', () => {
    it('flags implied confidence with temporal_implied metadata', () => {
      const result = validateTemporalFields(
        baseFact({ validFrom: '2026-01-01T00:00:00.000Z', temporalConfidence: 'implied' }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.metadata).toMatchObject({ temporal_implied: true });
    });

    it('does not flag explicit confidence', () => {
      const result = validateTemporalFields(
        baseFact({ validFrom: '2026-01-01T00:00:00.000Z', temporalConfidence: 'explicit' }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.metadata?.temporal_implied).toBeUndefined();
    });

    it('defaults validFrom to referenceTimestamp when no temporal signal (none)', () => {
      const result = validateTemporalFields(baseFact({ temporalConfidence: 'none' }), {
        referenceTimestamp: REF_TIMESTAMP,
      });

      expect(result.validFrom).toBe(REF_TIMESTAMP);
      expect(result.temporalConfidence).toBe('none');
    });

    it('defaults validFrom to referenceTimestamp when temporalConfidence is undefined', () => {
      const result = validateTemporalFields(baseFact({}), {
        referenceTimestamp: REF_TIMESTAMP,
      });

      expect(result.validFrom).toBe(REF_TIMESTAMP);
      expect(result.temporalConfidence).toBe('none');
    });

    it('does not override existing validFrom when confidence is none', () => {
      const result = validateTemporalFields(
        baseFact({ validFrom: '2026-02-01T00:00:00.000Z', temporalConfidence: 'none' }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.validFrom).toBe('2026-02-01T00:00:00.000Z');
    });

    it('preserves existing metadata when adding temporal_implied', () => {
      const result = validateTemporalFields(
        baseFact({
          validFrom: '2026-01-01T00:00:00.000Z',
          temporalConfidence: 'implied',
          metadata: { category: 'work' },
        }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.metadata).toEqual({ category: 'work', temporal_implied: true });
    });
  });

  describe('preserves non-temporal fields', () => {
    it('passes through text, id, sourceConversationId unchanged', () => {
      const result = validateTemporalFields(
        baseFact({
          id: 'fact-123',
          text: 'User likes tea.',
          sourceConversationId: 'conv-456',
          validFrom: '2026-01-01T00:00:00.000Z',
          temporalConfidence: 'explicit',
        }),
        { referenceTimestamp: REF_TIMESTAMP },
      );

      expect(result.id).toBe('fact-123');
      expect(result.text).toBe('User likes tea.');
      expect(result.sourceConversationId).toBe('conv-456');
    });
  });
});
