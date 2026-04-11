import { describe, expect, it, vi } from 'vitest';
import { createLlmClassifier } from '../../src/privacy/classifier/llm/index.js';
import { LlmClassificationError, UngroundableLlmFindingError } from '../../src/core/errors.js';
import type { LlmClient } from '../../src/core/interfaces.js';

const createMockClient = (result: unknown): LlmClient => ({
  generate: vi.fn().mockResolvedValue(result),
});

const createFailingClient = (error: Error): LlmClient => ({
  generate: vi.fn().mockRejectedValue(error),
});

describe('LLM classifier', () => {
  describe('sensitivity detection by category', () => {
    it('detects health conditions', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'health',
            confidence: 0.95,
            reasoning: 'Medical treatment mentioned',
            text: 'undergoing chemotherapy',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify(
        'The patient is undergoing chemotherapy at the hospital.',
      );

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities).toHaveLength(1);
      expect(report.entities[0]).toMatchObject({
        type: 'health',
        source: 'llm',
        confidence: 0.95,
        text: 'undergoing chemotherapy',
      });
    });

    it('detects financial information', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'financial',
            confidence: 0.9,
            reasoning: 'Salary information disclosed',
            text: 'earns $200k annually',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify('John earns $200k annually at his tech job.');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities[0]).toMatchObject({ type: 'financial', source: 'llm' });
    });

    it('detects relationship information', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'relationship',
            confidence: 0.88,
            reasoning: 'Divorce proceedings mentioned',
            text: 'going through a divorce',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify('She is going through a divorce right now.');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities[0]).toMatchObject({ type: 'relationship', source: 'llm' });
    });

    it('detects legal matters', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'legal',
            confidence: 0.92,
            reasoning: 'Legal action mentioned',
            text: 'filed a lawsuit against the company',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify(
        'He filed a lawsuit against the company last month.',
      );

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities[0]).toMatchObject({ type: 'legal', source: 'llm' });
    });

    it('detects identity-related sensitivity', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'identity',
            confidence: 0.85,
            reasoning: 'Immigration status mentioned',
            text: 'waiting for visa approval',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify('He is waiting for visa approval from the embassy.');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities[0]).toMatchObject({ type: 'identity', source: 'llm' });
    });
  });

  describe('clean text passthrough', () => {
    it('returns no entities for non-sensitive text', async () => {
      const client = createMockClient({ findings: [] });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify('The weather is great today and I enjoy coding.');

      expect(report.hasSensitiveContent).toBe(false);
      expect(report.entities).toHaveLength(0);
    });

    it('returns empty report for empty text', async () => {
      const client = createMockClient({ findings: [] });
      const classifier = createLlmClassifier(client);

      const report = await classifier.classify('');

      expect(report.hasSensitiveContent).toBe(false);
      expect(report.entities).toHaveLength(0);
    });
  });

  describe('confidence threshold', () => {
    it('filters findings below default 0.7 threshold', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'health',
            confidence: 0.5,
            reasoning: 'Possibly health related',
            text: 'feeling tired',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify('I have been feeling tired lately.');

      expect(report.hasSensitiveContent).toBe(false);
      expect(report.entities).toHaveLength(0);
    });

    it('includes findings at exactly 0.7 threshold', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'health',
            confidence: 0.7,
            reasoning: 'Health condition mentioned',
            text: 'diagnosed with diabetes',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify('She was diagnosed with diabetes.');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities).toHaveLength(1);
    });

    it('uses custom confidence threshold', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'health',
            confidence: 0.85,
            reasoning: 'Health condition mentioned',
            text: 'has depression',
          },
        ],
      });

      const classifier = createLlmClassifier(client, { confidenceThreshold: 0.9 });
      const report = await classifier.classify('User has depression.');

      expect(report.hasSensitiveContent).toBe(false);
      expect(report.entities).toHaveLength(0);
    });
  });

  describe('fail-closed behavior', () => {
    it('throws LlmClassificationError on API failure', async () => {
      const client = createFailingClient(new Error('API rate limited'));
      const classifier = createLlmClassifier(client);

      await expect(classifier.classify('test text')).rejects.toThrow(LlmClassificationError);
    });

    it('throws LlmClassificationError with context about blocked ingestion', async () => {
      const client = createFailingClient(new Error('timeout'));
      const classifier = createLlmClassifier(client);

      await expect(classifier.classify('test text')).rejects.toThrow(
        /Classification blocked.*Ingestion cannot proceed/,
      );
    });

    it('throws on invalid response structure', async () => {
      const client = createMockClient('not-an-object');
      const classifier = createLlmClassifier(client);

      await expect(classifier.classify('test text')).rejects.toThrow(LlmClassificationError);
    });

    it('throws on missing findings field', async () => {
      const client = createMockClient({ results: [] });
      const classifier = createLlmClassifier(client);

      await expect(classifier.classify('test text')).rejects.toThrow(LlmClassificationError);
    });

    it('gracefully skips malformed individual findings', async () => {
      const client = createMockClient({
        findings: [
          { type: 'health', confidence: 'high', reasoning: 'bad', text: 'test' },
          { type: 'health', confidence: 0.9, reasoning: 'valid', text: 'chemotherapy' },
        ],
      });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify('undergoing chemotherapy treatment');

      expect(report.entities).toHaveLength(1);
      expect(report.entities[0]!.text).toBe('chemotherapy');
    });
  });

  describe('entity span calculation', () => {
    it('finds correct start/end positions in source text', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'health',
            confidence: 0.9,
            reasoning: 'Medical condition',
            text: 'diagnosed with cancer',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      const text = 'She was diagnosed with cancer last year.';
      const report = await classifier.classify(text);

      expect(report.entities[0]!.start).toBe(8);
      expect(report.entities[0]!.end).toBe(29);
      expect(text.slice(report.entities[0]!.start, report.entities[0]!.end)).toBe(
        'diagnosed with cancer',
      );
    });

    it('blocks when text is not found in the source', async () => {
      const sourceText = 'Different text entirely.';
      const client = createMockClient({
        findings: [
          {
            type: 'health',
            confidence: 0.9,
            reasoning: 'Medical condition',
            text: 'nonexistent span',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      await expect(classifier.classify(sourceText)).rejects.toThrow(UngroundableLlmFindingError);
    });
  });

  describe('multiple findings', () => {
    it('handles multiple sensitivity findings in one text', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'health',
            confidence: 0.9,
            reasoning: 'Health condition',
            text: 'undergoing chemotherapy',
          },
          {
            type: 'financial',
            confidence: 0.85,
            reasoning: 'Salary disclosed',
            text: 'makes $150k',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify(
        'The patient is undergoing chemotherapy and makes $150k per year.',
      );

      expect(report.entities).toHaveLength(2);
      expect(report.entities[0]!.type).toBe('health');
      expect(report.entities[1]!.type).toBe('financial');
    });
  });

  describe('multilingual PII detection', () => {
    it('detects PII in Mandarin text', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'identity_number',
            confidence: 0.92,
            reasoning: 'Chinese national ID number',
            text: '身份证号码是310101199001011234',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify(
        '我的身份证号码是310101199001011234，请帮我查一下。',
      );

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities[0]).toMatchObject({
        type: 'identity_number',
        source: 'llm',
      });
    });

    it('detects PII in Japanese text', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'health',
            confidence: 0.88,
            reasoning: 'Medical condition in Japanese',
            text: '糖尿病の治療',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify('彼は糖尿病の治療を受けています。');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities[0]).toMatchObject({ type: 'health', source: 'llm' });
    });

    it('detects PII in Spanish text', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'financial',
            confidence: 0.9,
            reasoning: 'Salary information in Spanish',
            text: 'gana 50.000 euros al mes',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify(
        'Mi hermano gana 50.000 euros al mes en su trabajo.',
      );

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities[0]).toMatchObject({ type: 'financial', source: 'llm' });
    });

    it('detects PII in Hindi text', async () => {
      const client = createMockClient({
        findings: [
          {
            type: 'identity_number',
            confidence: 0.91,
            reasoning: 'Aadhaar number mentioned',
            text: 'आधार नंबर 1234 5678 9012',
          },
        ],
      });

      const classifier = createLlmClassifier(client);
      const report = await classifier.classify('मेरा आधार नंबर 1234 5678 9012 है।');

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities[0]).toMatchObject({ type: 'identity_number', source: 'llm' });
    });
  });

  describe('custom system prompt', () => {
    it('uses provided systemPrompt instead of default', async () => {
      const client = createMockClient({ findings: [] });
      const customPrompt = 'You are a custom classifier. Only detect phone numbers.';

      const classifier = createLlmClassifier(client, { systemPrompt: customPrompt });
      await classifier.classify('test text');

      expect(client.generate).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: customPrompt }),
      );
    });
  });
});
