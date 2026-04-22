import { describe, expect, it, vi } from 'vitest';
import {
  createCombinedClassifier,
  mergeReports,
} from '../../src/privacy/classifier/combined/index.js';
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

  it('keeps fail-closed ungroundable findings as full-span entities even when degrade mode is enabled', async () => {
    const client: LlmClient = {
      generate: vi.fn().mockResolvedValue({
        findings: [
          {
            type: 'health',
            confidence: 0.95,
            reasoning: 'Medical information',
            text: 'nonexistent span',
          },
        ],
      }),
    };

    const classifier = createCombinedClassifier(client, { onLlmFailure: 'degrade' });
    const report = await classifier.classify('Different text entirely.');

    expect(report.entities).toHaveLength(1);
    expect(report.entities[0]!.start).toBe(0);
    expect(report.entities[0]!.end).toBe('Different text entirely.'.length);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings?.[0]).toMatch(/Fail-closed on ungroundable LLM finding/);
  });
});

describe('combined classifier resolution heuristics', () => {
  const classifyWithFindings = async (
    text: string,
    findings: ReadonlyArray<{
      readonly type: string;
      readonly confidence: number;
      readonly reasoning: string;
      readonly text: string;
    }>,
  ) => {
    const client: LlmClient = {
      generate: vi.fn().mockResolvedValue({ findings }),
    };

    const classifier = createCombinedClassifier(client);
    return classifier.classify(text);
  };

  it('suppresses non-sensitive travel scheduling text', async () => {
    const text = 'Itinerary update: next Tuesday departure is at 9am from Terminal 2.';
    const report = await classifyWithFindings(text, [
      {
        type: 'travel_date',
        confidence: 0.92,
        reasoning: 'Travel scheduling text with a departure date/time.',
        text: 'next Tuesday departure is at 9am',
      },
    ]);

    expect(report.entities).toHaveLength(0);
    expect(report.hasSensitiveContent).toBe(false);
  });

  it('keeps health-related findings even when they mention dates', async () => {
    const text = 'Medical update: diagnosed with diabetes on March 10 after lab work.';
    const report = await classifyWithFindings(text, [
      {
        type: 'health',
        confidence: 0.94,
        reasoning: 'Person-linked medical condition.',
        text: 'diagnosed with diabetes on March 10',
      },
    ]);

    expect(report.entities).toHaveLength(1);
    expect(report.hasSensitiveContent).toBe(true);
  });

  it('suppresses vague physical addresses without address context', async () => {
    const text = 'Meet me near Main Street later.';
    const report = await classifyWithFindings(text, [
      {
        type: 'physical_address',
        confidence: 0.9,
        reasoning: 'Address-like phrase.',
        text: 'Main Street',
      },
    ]);

    expect(report.entities).toHaveLength(0);
    expect(report.hasSensitiveContent).toBe(false);
  });

  it('keeps DOB-related findings based on wider context windows', async () => {
    const prefix = 'Notes: '.padEnd(170, 'x');
    const text = `${prefix}date of birth: 1990-01-01 was entered yesterday.`;
    const report = await classifyWithFindings(text, [
      {
        type: 'other',
        confidence: 0.89,
        reasoning: 'Date-like value that may be sensitive.',
        text: '1990-01-01',
      },
    ]);

    expect(report.entities).toHaveLength(1);
    expect(report.hasSensitiveContent).toBe(true);
  });
});
