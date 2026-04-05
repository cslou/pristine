import { describe, expect, it, vi } from 'vitest';
import { extractCleanSpans } from '../../src/classifier/combined/index.js';
import { createLlmClassifier } from '../../src/classifier/llm/index.js';
import { resolve, clearResolvedStringRegistry } from '../../src/sanitizer/index.js';
import { ResolveApprovalError } from '../../src/core/errors.js';
import type { LlmClient } from '../../src/core/interfaces.js';
import type { DetectedEntity } from '../../src/core/types.js';

describe('extractCleanSpans', () => {
  it('returns full text when no entities', () => {
    const spans = extractCleanSpans('Hello world', []);
    expect(spans).toEqual([{ text: 'Hello world', originalStart: 0 }]);
  });

  it('extracts text between entities with correct offsets', () => {
    const entities: DetectedEntity[] = [
      {
        type: 'email_address',
        source: 'deterministic',
        confidence: 0.9,
        start: 0,
        end: 17,
        text: 'alice@example.com',
      },
      {
        type: 'phone_number',
        source: 'deterministic',
        confidence: 0.8,
        start: 30,
        end: 42,
        text: '555-867-5309',
      },
    ];
    const text = 'alice@example.com and phone 555-867-5309 end';
    const spans = extractCleanSpans(text, entities);

    expect(spans.length).toBeGreaterThanOrEqual(1);
    spans.forEach((span) => {
      expect(span.text).not.toContain('alice@example.com');
      expect(span.text).not.toContain('555-867-5309');
      expect(text.substring(span.originalStart, span.originalStart + span.text.length)).toBe(
        span.text,
      );
    });
  });

  it('returns empty array when entire text is PII', () => {
    const entities: DetectedEntity[] = [
      {
        type: 'email_address',
        source: 'deterministic',
        confidence: 0.9,
        start: 0,
        end: 17,
        text: 'alice@example.com',
      },
    ];
    const spans = extractCleanSpans('alice@example.com', entities);
    expect(spans).toHaveLength(0);
  });
});

describe('classifier reentry guard', () => {
  it('throws when classify receives a resolved string', async () => {
    clearResolvedStringRegistry();

    const resolved = resolve(
      'hello [SENSITIVE:identity_number:00000000-0000-0000-0000-000000000001]',
      { approvedValues: { '00000000-0000-0000-0000-000000000001': 'ID-123' } },
    ) as string;

    const generate = vi.fn();
    const client: LlmClient = { generate };
    const classifier = createLlmClassifier(client);

    await expect(classifier.classify(resolved)).rejects.toThrow(ResolveApprovalError);
    expect(generate).not.toHaveBeenCalled();
  });
});
