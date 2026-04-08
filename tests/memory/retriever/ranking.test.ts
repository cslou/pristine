import { describe, expect, it } from 'vitest';
import type { Memory } from '../../../src/core/types.js';
import {
  currentFactBoost,
  recencyBoost,
  confidenceBoost,
  applyTemporalBoosts,
  CURRENT_FACT_BOOST,
  RECENCY_MAX_BOOST,
  CONFIDENCE_BOOST_INFERRED,
  CONFIDENCE_BOOST_IMPLIED,
  RECENCY_MAX_AGE_MS,
} from '../../../src/memory/retriever/ranking.js';

function createMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    userId: 'user-1',
    text: 'test',
    embedding: [],
    contentHash: 'hash',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
    metadata: {},
    isDeleted: false,
    ...overrides,
  };
}

describe('temporal ranking boost functions', () => {
  describe('currentFactBoost', () => {
    it('returns CURRENT_FACT_BOOST for current fact in full mode', () => {
      const mem = createMemory({ validUntil: undefined });
      expect(currentFactBoost(mem, 'full')).toBe(CURRENT_FACT_BOOST);
    });

    it('returns 0 for superseded fact in full mode', () => {
      const mem = createMemory({ validUntil: '2026-01-15T00:00:00.000Z' });
      expect(currentFactBoost(mem, 'full')).toBe(0);
    });

    it('returns 0 in current mode', () => {
      const mem = createMemory({ validUntil: undefined });
      expect(currentFactBoost(mem, 'current')).toBe(0);
    });

    it('returns 0 in as_of mode', () => {
      const mem = createMemory({ validUntil: undefined });
      expect(currentFactBoost(mem, 'as_of')).toBe(0);
    });
  });

  describe('recencyBoost', () => {
    it('returns ~RECENCY_MAX_BOOST for very recent fact', () => {
      const now = Date.now();
      const mem = createMemory({ validFrom: new Date(now - 1000).toISOString() });
      const boost = recencyBoost(mem, now);
      expect(boost).toBeCloseTo(RECENCY_MAX_BOOST, 4);
    });

    it('returns 0 for fact older than RECENCY_MAX_AGE', () => {
      const now = Date.now();
      const mem = createMemory({
        validFrom: new Date(now - RECENCY_MAX_AGE_MS * 2).toISOString(),
      });
      expect(recencyBoost(mem, now)).toBe(0);
    });

    it('returns ~half max for fact at half max age', () => {
      const now = Date.now();
      const mem = createMemory({
        validFrom: new Date(now - RECENCY_MAX_AGE_MS / 2).toISOString(),
      });
      const boost = recencyBoost(mem, now);
      expect(boost).toBeCloseTo(RECENCY_MAX_BOOST * 0.5, 3);
    });

    it('returns 0 when validFrom is missing', () => {
      const mem = createMemory({ validFrom: undefined });
      expect(recencyBoost(mem, Date.now())).toBe(0);
    });

    it('returns 0 for malformed validFrom', () => {
      const mem = createMemory({ validFrom: 'not-a-date' });
      expect(recencyBoost(mem, Date.now())).toBe(0);
    });
  });

  describe('confidenceBoost', () => {
    it('returns CONFIDENCE_BOOST_IMPLIED for temporal_implied metadata', () => {
      const mem = createMemory({
        metadata: { temporal_implied: true },
        validFrom: '2026-01-01T00:00:00.000Z',
      });
      expect(confidenceBoost(mem)).toBe(CONFIDENCE_BOOST_IMPLIED);
    });

    it('returns CONFIDENCE_BOOST_INFERRED for validFrom without temporal_implied', () => {
      const mem = createMemory({ metadata: {}, validFrom: '2026-01-01T00:00:00.000Z' });
      expect(confidenceBoost(mem)).toBe(CONFIDENCE_BOOST_INFERRED);
    });

    it('returns 0 when no validFrom and no temporal_implied', () => {
      const mem = createMemory({ metadata: {}, validFrom: undefined });
      expect(confidenceBoost(mem)).toBe(0);
    });

    it('returns 0 when metadata is empty object', () => {
      const mem = createMemory({ metadata: {} });
      expect(confidenceBoost(mem)).toBe(0);
    });
  });

  describe('applyTemporalBoosts', () => {
    it('combines all three boosts correctly in full mode', () => {
      const now = Date.now();
      const mem = createMemory({
        validFrom: new Date(now - 1000).toISOString(),
        validUntil: undefined,
        metadata: {},
      });
      const baseScore = 0.8;
      const result = applyTemporalBoosts(mem, baseScore, 'full', now);

      const expectedBoost = CURRENT_FACT_BOOST + RECENCY_MAX_BOOST + CONFIDENCE_BOOST_INFERRED;
      expect(result).toBeCloseTo(baseScore + expectedBoost, 3);
    });

    it('only applies recency and confidence in current mode', () => {
      const now = Date.now();
      const mem = createMemory({
        validFrom: new Date(now - 1000).toISOString(),
        metadata: {},
      });
      const baseScore = 0.8;
      const result = applyTemporalBoosts(mem, baseScore, 'current', now);

      expect(result).toBeCloseTo(baseScore + RECENCY_MAX_BOOST + CONFIDENCE_BOOST_INFERRED, 3);
    });

    it('returns baseScore when no temporal fields present', () => {
      const mem = createMemory({ validFrom: undefined, validUntil: undefined, metadata: {} });
      const result = applyTemporalBoosts(mem, 0.5, 'current', Date.now());
      expect(result).toBe(0.5);
    });
  });
});
