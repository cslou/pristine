import { describe, expect, it, vi } from 'vitest';
import { createExtractor } from '../../../src/memory/extractor/index.js';
import { ExtractionError } from '../../../src/core/errors.js';
import { resolve, clearResolvedStringRegistry } from '../../../src/privacy/sanitizer/index.js';
import type { LlmClient } from '../../../src/core/interfaces.js';

const TEST_TIMESTAMP = '2026-03-15T00:00:00.000Z';

const createMockClient = (result: unknown): LlmClient => ({
  generate: vi.fn().mockResolvedValue(result),
});

const createFailingClient = (error: Error): LlmClient => ({
  generate: vi.fn().mockRejectedValue(error),
});

describe('extractor', () => {
  it('blocks resolved conversation payloads from extractor LLM input', async () => {
    clearResolvedStringRegistry();

    const client: LlmClient = { generate: vi.fn() };
    const extractor = createExtractor(client);
    const resolvedConversation = resolve(
      [
        {
          role: 'user' as const,
          content: 'User says [SENSITIVE:identity_number:00000000-0000-0000-0000-000000000001]',
        },
      ],
      {
        approvedValues: {
          '00000000-0000-0000-0000-000000000001': 'redacted-identity',
        },
      },
    );

    await expect(
      extractor.extract(
        resolvedConversation as { role: 'user'; content: string }[],
        TEST_TIMESTAMP,
      ),
    ).rejects.toThrow('Resolved payload is not allowed for extractor conversation payload.');

    expect(client.generate).not.toHaveBeenCalled();
  });

  it('returns { facts: [] } for empty conversation without LLM call', async () => {
    const client: LlmClient = { generate: vi.fn() };
    const extractor = createExtractor(client);
    const result = await extractor.extract([], TEST_TIMESTAMP);

    expect(client.generate).not.toHaveBeenCalled();
    expect(result).toEqual({ facts: [] });
  });

  it('parses generate<T>() response', async () => {
    const client = createMockClient({ facts: [{ text: 'User likes espresso.' }] });
    const extractor = createExtractor(client);
    const result = await extractor.extract(
      [{ role: 'user', content: 'espresso.' }],
      TEST_TIMESTAMP,
    );

    expect(client.generate).toHaveBeenCalledTimes(1);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.text).toBe('User likes espresso.');
  });

  it('filters out empty string facts', async () => {
    const client = createMockClient({
      facts: [{ text: '' }, { text: 'User likes cold brew.' }],
    });
    const extractor = createExtractor(client);
    const result = await extractor.extract([{ role: 'user', content: 'coffee.' }], TEST_TIMESTAMP);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.text).toBe('User likes cold brew.');
  });

  it('throws ExtractionError when response has no facts field', async () => {
    const client = createMockClient({ items: [] });
    const extractor = createExtractor(client);

    await expect(
      extractor.extract([{ role: 'user', content: 'I like tea.' }], TEST_TIMESTAMP),
    ).rejects.toThrow('Extractor response missing facts array.');
  });

  it('throws ExtractionError when facts is not an array', async () => {
    const client = createMockClient({ facts: { text: 'bad' } });
    const extractor = createExtractor(client);

    await expect(
      extractor.extract([{ role: 'user', content: 'I like tea.' }], TEST_TIMESTAMP),
    ).rejects.toThrow('Extractor response missing facts array.');
  });

  it('drops fact missing text field silently', async () => {
    const client = createMockClient({
      facts: [{ metadata: { source: 'chat' } }, { text: 'User likes espresso.' }],
    });
    const extractor = createExtractor(client);
    const result = await extractor.extract(
      [{ role: 'user', content: 'I like espresso.' }],
      TEST_TIMESTAMP,
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.text).toBe('User likes espresso.');
  });

  it('drops fact with non-string text', async () => {
    const client = createMockClient({
      facts: [{ text: 123 }, { text: 'User likes cold brew.' }],
    });
    const extractor = createExtractor(client);
    const result = await extractor.extract([{ role: 'user', content: 'coffee.' }], TEST_TIMESTAMP);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.text).toBe('User likes cold brew.');
  });

  it('preserves optional metadata on output facts', async () => {
    const client = createMockClient({
      facts: [{ text: 'User likes oat milk.', metadata: { source: 'voice', confidence: 0.9 } }],
    });
    const extractor = createExtractor(client);
    const result = await extractor.extract(
      [{ role: 'user', content: 'I drink oat milk.' }],
      TEST_TIMESTAMP,
    );

    expect(result.facts[0]!.metadata).toEqual({ source: 'voice', confidence: 0.9 });
  });

  it('maps sourceConversationId', async () => {
    const client = createMockClient({
      facts: [{ text: 'User likes espresso.', sourceConversationId: 'conv-123' }],
    });
    const extractor = createExtractor(client);
    const result = await extractor.extract(
      [{ role: 'user', content: 'Espresso.' }],
      TEST_TIMESTAMP,
    );

    expect(result.facts[0]!.sourceConversationId).toBe('conv-123');
  });

  it('filters unresolved pronouns: he, she, its', async () => {
    const client = createMockClient({
      facts: [
        { text: "He's into espresso." },
        { text: "She's on a diet." },
        { text: 'The user likes cold brew.' },
        { text: 'That was a great idea.' },
        { text: 'This feels better now.' },
        { text: 'User prefers tea.' },
      ],
    });
    const extractor = createExtractor(client);
    const result = await extractor.extract([{ role: 'user', content: 'test' }], TEST_TIMESTAMP);

    expect(result.facts.map((fact) => fact.text)).toEqual([
      'The user likes cold brew.',
      'That was a great idea.',
      'This feels better now.',
      'User prefers tea.',
    ]);
  });

  it('does not filter therapist because it only checks word boundaries', async () => {
    const client = createMockClient({
      facts: [{ text: 'The therapist is available.' }],
    });
    const extractor = createExtractor(client);
    const result = await extractor.extract(
      [{ role: 'user', content: 'talking about therapist' }],
      TEST_TIMESTAMP,
    );

    expect(result.facts[0]).toMatchObject({ text: 'The therapist is available.' });
  });

  it('does not filter another because it only checks word boundaries', async () => {
    const client = createMockClient({
      facts: [{ text: 'User has another coffee mug.' }],
    });
    const extractor = createExtractor(client);
    const result = await extractor.extract(
      [{ role: 'user', content: 'I have another mug.' }],
      TEST_TIMESTAMP,
    );

    expect(result.facts[0]).toMatchObject({ text: 'User has another coffee mug.' });
  });

  it('wraps API/network errors as ExtractionError', async () => {
    const client = createFailingClient(new Error('upstream failure'));
    const extractor = createExtractor(client);

    await expect(
      extractor.extract([{ role: 'user', content: 'I like tea.' }], TEST_TIMESTAMP),
    ).rejects.toThrow(ExtractionError);
  });

  it('passes through empty facts arrays', async () => {
    const client = createMockClient({ facts: [] });
    const extractor = createExtractor(client);
    const result = await extractor.extract(
      [{ role: 'user', content: 'I have no facts.' }],
      TEST_TIMESTAMP,
    );

    expect(result).toEqual({ facts: [] });
  });
});

describe('extraction prompt and referenceTimestamp', () => {
  it('system prompt includes temporal extraction rules', async () => {
    const client = createMockClient({ facts: [] });
    const extractor = createExtractor(client);
    await extractor.extract([{ role: 'user', content: 'hello' }], '2026-03-15T00:00:00.000Z');

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      systemPrompt: string;
    };
    expect(call.systemPrompt).toContain('TEMPORAL EXTRACTION RULES');
    expect(call.systemPrompt).toContain('REFERENCE_TIME: 2026-03-15T00:00:00.000Z');
    expect(call.systemPrompt).toContain('temporalConfidence');
    expect(call.systemPrompt).toContain('ISO 8601');
  });

  it('prompt includes all 5 temporal signal types', async () => {
    const client = createMockClient({ facts: [] });
    const extractor = createExtractor(client);
    await extractor.extract([{ role: 'user', content: 'hello' }], TEST_TIMESTAMP);

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      systemPrompt: string;
    };
    expect(call.systemPrompt).toContain('Absolute dates');
    expect(call.systemPrompt).toContain('Relative dates');
    expect(call.systemPrompt).toContain('State changes');
    expect(call.systemPrompt).toContain('Duration');
    expect(call.systemPrompt).toContain('Implicit past');
  });

  it('prompt includes all 4 confidence levels', async () => {
    const client = createMockClient({ facts: [] });
    const extractor = createExtractor(client);
    await extractor.extract([{ role: 'user', content: 'hello' }], TEST_TIMESTAMP);

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      systemPrompt: string;
    };
    expect(call.systemPrompt).toContain('"explicit"');
    expect(call.systemPrompt).toContain('"inferred"');
    expect(call.systemPrompt).toContain('"implied"');
    expect(call.systemPrompt).toContain('"none"');
  });

  it('uses provided referenceTimestamp in prompt', async () => {
    const client = createMockClient({ facts: [] });
    const extractor = createExtractor(client);
    await extractor.extract([{ role: 'user', content: 'hello' }], '2025-12-25T10:00:00.000Z');

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      systemPrompt: string;
    };
    expect(call.systemPrompt).toContain('REFERENCE_TIME: 2025-12-25T10:00:00.000Z');
  });

  it('uses custom systemPrompt when provided', async () => {
    const client = createMockClient({ facts: [] });
    const customPrompt = 'Extract only food preferences.';
    const extractor = createExtractor(client, { systemPrompt: customPrompt });
    await extractor.extract([{ role: 'user', content: 'hello' }], TEST_TIMESTAMP);

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      systemPrompt: string;
    };
    expect(call.systemPrompt).toBe(customPrompt);
  });
});

describe('message timestamps in prompt', () => {
  it('includes [timestamp] prefix for messages with timestamps', async () => {
    const client = createMockClient({ facts: [] });
    const extractor = createExtractor(client);
    await extractor.extract(
      [{ role: 'user', content: 'I moved yesterday', timestamp: '2023-05-08T14:00:00.000Z' }],
      '2023-05-08T14:00:00.000Z',
    );

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      userPrompt: string;
    };
    expect(call.userPrompt).toBe('[2023-05-08T14:00:00.000Z] user: I moved yesterday');
  });

  it('omits prefix for messages without timestamps', async () => {
    const client = createMockClient({ facts: [] });
    const extractor = createExtractor(client);
    await extractor.extract([{ role: 'user', content: 'hello' }], TEST_TIMESTAMP);

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      userPrompt: string;
    };
    expect(call.userPrompt).toBe('user: hello');
  });

  it('handles mixed timestamps — only timestamped messages get prefix', async () => {
    const client = createMockClient({ facts: [] });
    const extractor = createExtractor(client);
    await extractor.extract(
      [
        { role: 'user', content: 'first', timestamp: '2023-05-08T10:00:00.000Z' },
        { role: 'assistant', content: 'response' },
        { role: 'user', content: 'second', timestamp: '2023-05-08T10:05:00.000Z' },
      ],
      '2023-05-08T10:05:00.000Z',
    );

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      userPrompt: string;
    };
    expect(call.userPrompt).toBe(
      '[2023-05-08T10:00:00.000Z] user: first\nassistant: response\n[2023-05-08T10:05:00.000Z] user: second',
    );
  });
});

describe('temporal field extraction', () => {
  it('parses validFrom and temporalConfidence from response', async () => {
    const client = createMockClient({
      facts: [
        {
          text: 'User started at Google in January 2026.',
          validFrom: '2026-01-01T00:00:00.000Z',
          temporalConfidence: 'explicit',
        },
      ],
    });
    const extractor = createExtractor(client);
    const result = await extractor.extract(
      [{ role: 'user', content: 'I started at Google in January.' }],
      TEST_TIMESTAMP,
    );

    expect(result.facts[0]!.validFrom).toBe('2026-01-01T00:00:00.000Z');
    expect(result.facts[0]!.temporalConfidence).toBe('explicit');
    expect(result.facts[0]!.validUntil).toBeUndefined();
  });

  it('parses validUntil for facts that are no longer true', async () => {
    const client = createMockClient({
      facts: [
        {
          text: 'User used to work at Facebook.',
          validUntil: '2025-06-01T00:00:00.000Z',
          temporalConfidence: 'implied',
        },
      ],
    });
    const extractor = createExtractor(client);
    const result = await extractor.extract(
      [{ role: 'user', content: 'I used to work at Facebook.' }],
      TEST_TIMESTAMP,
    );

    expect(result.facts[0]!.validUntil).toBe('2025-06-01T00:00:00.000Z');
    expect(result.facts[0]!.temporalConfidence).toBe('implied');
    expect(result.facts[0]!.validFrom).toBeUndefined();
  });

  it('handles facts with no temporal fields (backward compatible)', async () => {
    const client = createMockClient({ facts: [{ text: 'User likes espresso.' }] });
    const extractor = createExtractor(client);
    const result = await extractor.extract(
      [{ role: 'user', content: 'I like espresso.' }],
      TEST_TIMESTAMP,
    );

    expect(result.facts[0]!.validFrom).toBeUndefined();
    expect(result.facts[0]!.validUntil).toBeUndefined();
    expect(result.facts[0]!.temporalConfidence).toBeUndefined();
  });

  it('drops invalid temporalConfidence values', async () => {
    const client = createMockClient({
      facts: [{ text: 'User likes tea.', temporalConfidence: 'maybe' }],
    });
    const extractor = createExtractor(client);
    const result = await extractor.extract(
      [{ role: 'user', content: 'I like tea.' }],
      TEST_TIMESTAMP,
    );

    expect(result.facts[0]!.temporalConfidence).toBeUndefined();
  });

  it('drops non-string validFrom/validUntil values', async () => {
    const client = createMockClient({
      facts: [{ text: 'User likes coffee.', validFrom: 12345, validUntil: true }],
    });
    const extractor = createExtractor(client);
    const result = await extractor.extract([{ role: 'user', content: 'coffee.' }], TEST_TIMESTAMP);

    expect(result.facts[0]!.validFrom).toBeUndefined();
    expect(result.facts[0]!.validUntil).toBeUndefined();
  });

  it('parses all temporal fields together', async () => {
    const client = createMockClient({
      facts: [
        {
          text: 'User worked at Meta from 2024 to 2025.',
          validFrom: '2024-01-01T00:00:00.000Z',
          validUntil: '2025-01-01T00:00:00.000Z',
          temporalConfidence: 'inferred',
        },
      ],
    });
    const extractor = createExtractor(client);
    const result = await extractor.extract(
      [{ role: 'user', content: 'I worked at Meta from 2024 to 2025.' }],
      TEST_TIMESTAMP,
    );

    expect(result.facts[0]!.validFrom).toBe('2024-01-01T00:00:00.000Z');
    expect(result.facts[0]!.validUntil).toBe('2025-01-01T00:00:00.000Z');
    expect(result.facts[0]!.temporalConfidence).toBe('inferred');
  });
});
