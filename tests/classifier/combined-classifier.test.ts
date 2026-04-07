import { describe, expect, it, vi } from 'vitest';
import { createCombinedClassifier, mergeReports } from '../../src/privacy/classifier/combined/index.js';
import { createLlmClassifier } from '../../src/privacy/classifier/llm/index.js';
import { resolve, clearResolvedStringRegistry } from '../../src/privacy/sanitizer/index.js';
import { ResolveApprovalError } from '../../src/core/errors.js';
import type { LlmClient } from '../../src/core/interfaces.js';

describe('mergeReports', () => {
  it('keeps both non-overlapping entities', () => {
    const a = {
      entities: [
        {
          type: 'email_address',
          source: 'deterministic' as const,
          confidence: 0.95,
          start: 0,
          end: 17,
          text: 'alice@example.com',
        },
      ],
      hasSensitiveContent: true,
    };
    const b = {
      entities: [
        {
          type: 'health',
          source: 'llm' as const,
          confidence: 0.9,
          start: 30,
          end: 50,
          text: 'diagnosed with cancer',
        },
      ],
      hasSensitiveContent: true,
    };
    const result = mergeReports(a, b);
    expect(result.entities).toHaveLength(2);
    expect(result.hasSensitiveContent).toBe(true);
  });

  it('prefers wider span when entities overlap', () => {
    const a = {
      entities: [
        {
          type: 'identity_number',
          source: 'deterministic' as const,
          confidence: 0.95,
          start: 5,
          end: 16,
          text: '123-45-6789',
        },
      ],
      hasSensitiveContent: true,
    };
    const b = {
      entities: [
        {
          type: 'identity',
          source: 'llm' as const,
          confidence: 0.85,
          start: 0,
          end: 20,
          text: 'SSN is 123-45-6789!',
        },
      ],
      hasSensitiveContent: true,
    };
    const result = mergeReports(a, b);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.source).toBe('llm');
  });

  it('prefers higher confidence when spans are same width', () => {
    const a = {
      entities: [
        {
          type: 'phone_number',
          source: 'deterministic' as const,
          confidence: 0.85,
          start: 0,
          end: 12,
          text: '555-867-5309',
        },
      ],
      hasSensitiveContent: true,
    };
    const b = {
      entities: [
        {
          type: 'phone_number',
          source: 'llm' as const,
          confidence: 0.95,
          start: 0,
          end: 12,
          text: '555-867-5309',
        },
      ],
      hasSensitiveContent: true,
    };
    const result = mergeReports(a, b);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.confidence).toBe(0.95);
  });

  it('returns hasSensitiveContent false for empty inputs', () => {
    const result = mergeReports(
      { entities: [], hasSensitiveContent: false },
      { entities: [], hasSensitiveContent: false },
    );
    expect(result.entities).toHaveLength(0);
    expect(result.hasSensitiveContent).toBe(false);
  });

  it('merges warnings from both reports', () => {
    const result = mergeReports(
      { entities: [], hasSensitiveContent: false, warnings: ['deterministic warning'] },
      { entities: [], hasSensitiveContent: false, warnings: ['llm warning'] },
    );

    expect(result.warnings).toEqual(['deterministic warning', 'llm warning']);
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

describe('combined classifier LLM failure modes', () => {
  it('degrades and emits warnings when configured to continue on LLM failure', async () => {
    const client: LlmClient = {
      generate: vi.fn().mockRejectedValue(new Error('llm offline')),
    };

    const classifier = createCombinedClassifier(client, { onLlmFailure: 'degrade' });
    const report = await classifier.classify('Reach me at alice@example.com');

    expect(report.hasSensitiveContent).toBe(true);
    expect(report.entities).toHaveLength(1);
    expect(report.entities[0]!.type).toBe('email_address');
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings?.[0]).toMatch(/llm offline/);
  });

  it('blocks by default when the LLM classifier fails', async () => {
    const client: LlmClient = {
      generate: vi.fn().mockRejectedValue(new Error('llm offline')),
    };

    const classifier = createCombinedClassifier(client);

    await expect(classifier.classify('Reach me at alice@example.com')).rejects.toThrow(
      /Classification blocked/,
    );
  });
});
