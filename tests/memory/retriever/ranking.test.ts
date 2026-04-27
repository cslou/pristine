import { describe, expect, it } from 'vitest';
import type { Memory } from '../../../src/core/types.js';
import {
  currentFactBoost,
  recencyBoost,
  confidenceBoost,
  applyTemporalBoosts,
  reciprocalRankFusion,
  RRF_DEFAULT_K,
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

  describe('reciprocalRankFusion', () => {
    const idOf = (item: { id: string }): string => item.id;

    it('returns empty array for all-empty input', () => {
      expect(reciprocalRankFusion([], idOf)).toEqual([]);
      expect(reciprocalRankFusion([[], []], idOf)).toEqual([]);
    });

    it('passes a single list through unchanged', () => {
      const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      const result = reciprocalRankFusion([list], idOf);
      expect(result).toEqual(list);
    });

    it('promotes items appearing in multiple lists', () => {
      // 'a' appears in BOTH lists at rank 1; 'b' and 'c' appear in only
      // one list each. Fused order: a (highest, double contribution),
      // then b and c (single contribution each, tie-broken by first-seen).
      const list1 = [{ id: 'a' }, { id: 'b' }];
      const list2 = [{ id: 'a' }, { id: 'c' }];
      const result = reciprocalRankFusion([list1, list2], idOf);
      expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    });

    it('respects the k=60 default formula', () => {
      // For a single list, score(d) at rank 1 = 1/(60+1) = 1/61.
      // We don't expose scores in the return type, but rank order is
      // 1-indexed so the top item should be the head of the input list.
      const list = [{ id: 'top' }, { id: 'middle' }, { id: 'bottom' }];
      const result = reciprocalRankFusion([list], idOf);
      expect(result[0]).toEqual({ id: 'top' });
      expect(result[2]).toEqual({ id: 'bottom' });
    });

    it('accepts custom k via options', () => {
      // Smaller k weighs early-rank items more heavily, but with a
      // single list the order is still preserved by ranks.
      const list = [{ id: 'a' }, { id: 'b' }];
      const result = reciprocalRankFusion([list], idOf, { k: 1 });
      expect(result.map((r) => r.id)).toEqual(['a', 'b']);
    });

    it('rejects non-positive or non-finite k', () => {
      const list = [{ id: 'a' }];
      expect(() => reciprocalRankFusion([list], idOf, { k: 0 })).toThrow();
      expect(() => reciprocalRankFusion([list], idOf, { k: -1 })).toThrow();
      expect(() => reciprocalRankFusion([list], idOf, { k: Number.NaN })).toThrow();
      expect(() => reciprocalRankFusion([list], idOf, { k: Number.POSITIVE_INFINITY })).toThrow();
    });

    it('breaks ties stably by first-seen order across lists', () => {
      // No items overlap. Each item gets a single contribution; items
      // at the same rank position have identical scores. First-seen
      // order (list1's rank-1 item before list2's rank-1 item) decides.
      const list1 = [{ id: 'x' }];
      const list2 = [{ id: 'y' }];
      const result = reciprocalRankFusion([list1, list2], idOf);
      expect(result.map((r) => r.id)).toEqual(['x', 'y']);

      // Reverse input order → reverse output order (deterministic).
      const reversed = reciprocalRankFusion([list2, list1], idOf);
      expect(reversed.map((r) => r.id)).toEqual(['y', 'x']);
    });

    it('drops empty lists silently', () => {
      const list = [{ id: 'a' }];
      const result = reciprocalRankFusion([list, [], []], idOf);
      expect(result).toEqual(list);
    });

    it('is deterministic for identical input', () => {
      const list1 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      const list2 = [{ id: 'b' }, { id: 'd' }];
      const r1 = reciprocalRankFusion([list1, list2], idOf);
      const r2 = reciprocalRankFusion([list1, list2], idOf);
      expect(r1).toEqual(r2);
    });

    it('handles heterogeneous-type lists when idOf normalizes the id space', () => {
      // Caller supplies a unified id like `window:c1:0` vs
      // `message:42` so RRF treats them as distinct documents.
      type Hit =
        | { kind: 'window'; conversationId: string; windowIndex: number }
        | { kind: 'message'; messageId: number };
      const hetIdOf = (h: Hit): string =>
        h.kind === 'window'
          ? `window:${h.conversationId}:${h.windowIndex}`
          : `message:${h.messageId}`;
      const windows: Hit[] = [{ kind: 'window', conversationId: 'c1', windowIndex: 0 }];
      const messages: Hit[] = [{ kind: 'message', messageId: 42 }];
      const result = reciprocalRankFusion<Hit>([windows, messages], hetIdOf);
      expect(result.length).toBe(2);
      // Ids are different so each retains a single-list contribution.
    });

    it('exposes RRF_DEFAULT_K constant', () => {
      expect(RRF_DEFAULT_K).toBe(60);
    });
  });
});
