import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion, RRF_DEFAULT_K } from '../../../src/memory/retriever/ranking.js';

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
