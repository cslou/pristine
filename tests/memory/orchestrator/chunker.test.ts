import { describe, expect, it } from 'vitest';
import type { Message } from '../../../src/core/types.js';
import {
  chunkConversation,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  defaultTokenCounter,
  OVERSIZE_OVERLAP_TOKENS,
  OVERSIZE_TOKEN_THRESHOLD,
  splitOversizeMessage,
  type TokenCounter,
} from '../../../src/memory/orchestrator/chunker.js';

function msg(content: string): Message {
  return { role: 'user', content };
}

function msgs(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => msg(`msg-${i}`));
}

describe('chunkConversation', () => {
  it('empty input returns one empty chunk', () => {
    const chunks = chunkConversation([]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual([]);
  });

  it('single message returns one chunk', () => {
    const messages = msgs(1);
    const chunks = chunkConversation(messages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(messages);
  });

  it('exactly CHUNK_SIZE messages returns one chunk', () => {
    const messages = msgs(CHUNK_SIZE);
    const chunks = chunkConversation(messages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(messages);
  });

  it('CHUNK_SIZE + 1 messages returns two chunks', () => {
    const messages = msgs(CHUNK_SIZE + 1);
    const chunks = chunkConversation(messages);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(CHUNK_SIZE);
    expect(chunks[1].length).toBeGreaterThan(0);
  });

  it('two full chunks (38 messages) produces 2 chunks of 20', () => {
    const messages = msgs(38);
    const chunks = chunkConversation(messages);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(20);
    expect(chunks[1]).toHaveLength(20);
  });

  it('39 messages produces 3 chunks, last chunk shorter', () => {
    const messages = msgs(39);
    const chunks = chunkConversation(messages);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(20);
    expect(chunks[1]).toHaveLength(20);
    expect(chunks[2].length).toBeLessThan(20);
    expect(chunks[2].length).toBeGreaterThan(0);
  });

  it('adjacent chunks share exactly CHUNK_OVERLAP messages at boundary', () => {
    const messages = msgs(38);
    const chunks = chunkConversation(messages);
    const tailOfFirst = chunks[0]!.slice(-CHUNK_OVERLAP);
    const headOfSecond = chunks[1]!.slice(0, CHUNK_OVERLAP);
    expect(tailOfFirst).toEqual(headOfSecond);
  });

  it('custom chunkSize and overlap work correctly', () => {
    const messages = msgs(6);
    const chunks = chunkConversation(messages, 4, 1);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(4);
    expect(chunks[1]).toHaveLength(3);
    expect(chunks[0]![chunks[0]!.length - 1]).toEqual(chunks[1]![0]);
  });

  it('overlap=0 produces non-overlapping chunks', () => {
    const messages = msgs(8);
    const chunks = chunkConversation(messages, 4, 0);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual(messages.slice(0, 4));
    expect(chunks[1]).toEqual(messages.slice(4, 8));
  });
});

// ---------------------------------------------------------------------------
// splitOversizeMessage — sprint-015 Story 4
// ---------------------------------------------------------------------------

// Deterministic token counter — 1 char == 1 token. Lets us write tests in
// terms of explicit lengths without having to reason about the 4-chars/token
// heuristic. The threshold for these tests is 30 (vs production's 3000).
const charTokens: TokenCounter = (text: string) => text.length;

describe('splitOversizeMessage', () => {
  describe('routing + thresholds', () => {
    it('returns the message unchanged when below threshold', () => {
      const result = splitOversizeMessage(
        { role: 'user', content: 'short' },
        { tokenCounter: charTokens, threshold: 30 },
      );
      expect(result).toEqual([{ role: 'user', content: 'short' }]);
    });

    it('returns the message unchanged when exactly at the threshold', () => {
      const result = splitOversizeMessage(
        { role: 'user', content: 'a'.repeat(30) },
        { tokenCounter: charTokens, threshold: 30 },
      );
      expect(result).toHaveLength(1);
    });

    it('preserves timestamp when present, omits when absent', () => {
      const withTs = splitOversizeMessage(
        { role: 'user', content: 'x', timestamp: '2026-04-25T00:00:00Z' },
        { tokenCounter: charTokens, threshold: 30 },
      );
      expect(withTs[0]).toMatchObject({
        role: 'user',
        content: 'x',
        timestamp: '2026-04-25T00:00:00Z',
      });

      const noTs = splitOversizeMessage(
        { role: 'user', content: 'x' },
        { tokenCounter: charTokens, threshold: 30 },
      );
      expect(noTs[0]).not.toHaveProperty('timestamp');
    });

    it('uses default threshold + counter when options omitted (production path)', () => {
      // Production threshold = 3000 tokens ≈ 12000 chars. A 100-char string
      // is well under, so a single chunk back.
      const result = splitOversizeMessage({ role: 'user', content: 'hi'.repeat(50) });
      expect(result).toHaveLength(1);
      expect(defaultTokenCounter('hi'.repeat(50))).toBeLessThan(OVERSIZE_TOKEN_THRESHOLD);
    });
  });

  describe('prose splitting', () => {
    it('splits at double-newline paragraph boundaries with token overlap', () => {
      const para = (n: number) => `Paragraph ${n}: ${'word '.repeat(20)}`.trim();
      const content = [para(1), para(2), para(3), para(4)].join('\n\n');
      // Each paragraph ~110 chars. Threshold 200 → ~2 paragraphs per chunk.
      const result = splitOversizeMessage(
        { role: 'user', content },
        { tokenCounter: charTokens, threshold: 200, overlapTokens: 10 },
      );
      expect(result.length).toBeGreaterThan(1);
      // Concat all chunks and assert every paragraph appears at least once.
      const allText = result.map((r) => r.content).join('\n');
      for (const i of [1, 2, 3, 4]) {
        expect(allText).toContain(`Paragraph ${i}`);
      }
    });

    it('falls back to single-newline boundaries when no double-newlines exist', () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i}: ${'x'.repeat(15)}`);
      const content = lines.join('\n');
      const result = splitOversizeMessage(
        { role: 'user', content },
        { tokenCounter: charTokens, threshold: 100, overlapTokens: 0 },
      );
      expect(result.length).toBeGreaterThan(1);
      // Every line should appear in the union of chunks.
      const allText = result.map((r) => r.content).join('\n');
      for (let i = 0; i < 20; i++) {
        expect(allText).toContain(`line ${i}`);
      }
    });

    it('emits a single chunk when one segment alone exceeds the threshold (Graphiti invariant)', () => {
      // Single huge paragraph with no newlines — the splitter falls back to
      // single-newline split, which still produces one segment, which becomes
      // its own chunk regardless of size.
      const content = 'x'.repeat(500);
      const result = splitOversizeMessage(
        { role: 'user', content },
        { tokenCounter: charTokens, threshold: 100 },
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.content.length).toBe(500);
    });
  });

  describe('AST splitting (code-tagged content)', () => {
    const code = `
function alpha() {
  return 1;
}

class Beta {
  greet() {
    return 'hi';
  }
}

const gamma = () => 42;

export const delta = () => {
  console.log('side effect');
  return alpha() + Beta.prototype.greet().length;
};
`.trim();

    it('routes role=tool + ```ts fenced content through the AST splitter', () => {
      const fenced = '```ts\n' + code + '\n```';
      // Threshold below the full content; should produce >1 chunk.
      const result = splitOversizeMessage(
        { role: 'tool', content: fenced },
        { tokenCounter: charTokens, threshold: 80, overlapTokens: 0 },
      );
      expect(result.length).toBeGreaterThan(1);
      // No chunk's content is empty.
      for (const r of result) {
        expect(r.content.length).toBeGreaterThan(0);
      }
    });

    it('routes mimeType=text/x-typescript content through the AST splitter', () => {
      const result = splitOversizeMessage(
        { role: 'user', content: code, mimeType: 'text/x-typescript' },
        { tokenCounter: charTokens, threshold: 80, overlapTokens: 0 },
      );
      expect(result.length).toBeGreaterThan(1);
    });

    it('does NOT route role=user without mimeType through AST even with code-fenced content', () => {
      // Without role=tool AND no code mimeType, prose splitter is used.
      const fenced = '```ts\nfunction f() { return 1; }\n```';
      const result = splitOversizeMessage(
        { role: 'user', content: fenced },
        { tokenCounter: charTokens, threshold: 10 },
      );
      // Prose splitter on a no-newline string returns 1 chunk per Graphiti.
      // The point: we didn't try to AST-parse, so no error path either.
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('falls back to line-aware split when AST parse fails (garbage code)', () => {
      const garbage = 'this is not valid }}}}} javascript {{ ((( syntax';
      const garbageMany = Array.from({ length: 10 }, () => garbage).join('\n');
      const result = splitOversizeMessage(
        { role: 'tool', content: '```ts\n' + garbageMany + '\n```' },
        { tokenCounter: charTokens, threshold: 80, overlapTokens: 0 },
      );
      // Should not throw; should produce at least one chunk.
      expect(result.length).toBeGreaterThan(0);
      const allText = result.map((r) => r.content).join('\n');
      expect(allText).toContain('this is not valid');
    });
  });

  describe('exports', () => {
    it('OVERSIZE_TOKEN_THRESHOLD = 3000 (Graphiti default)', () => {
      expect(OVERSIZE_TOKEN_THRESHOLD).toBe(3000);
    });

    it('OVERSIZE_OVERLAP_TOKENS = 200 (prose carry-over)', () => {
      expect(OVERSIZE_OVERLAP_TOKENS).toBe(200);
    });

    it('defaultTokenCounter approximates 4 chars/token via Math.ceil', () => {
      expect(defaultTokenCounter('')).toBe(0);
      expect(defaultTokenCounter('a')).toBe(1); // ceil(1/4) = 1
      expect(defaultTokenCounter('a'.repeat(4))).toBe(1);
      expect(defaultTokenCounter('a'.repeat(5))).toBe(2);
      expect(defaultTokenCounter('a'.repeat(12000))).toBe(3000);
    });
  });
});
