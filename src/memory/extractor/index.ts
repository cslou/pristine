import type { LlmClient, Extractor } from '../../core/interfaces.js';
import type { Fact, Message, TemporalConfidence, ExtractionResult } from '../../core/types.js';
import { ExtractionError } from '../../core/errors.js';
import { assertNoLlmReentry } from '../../privacy/sanitizer/index.js';
import { buildExtractionPrompt } from './prompts.js';
import { EXTRACT_FACTS_SCHEMA } from './schema.js';

const DEFAULT_MAX_TOKENS = 4096;

export interface ExtractorConfig {
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
}

interface ExtractFactsInput {
  readonly facts: readonly Record<string, unknown>[];
}

const noPronounPattern = /\b(\bhe\b|\bshe\b|\bthey\b|\bthem\b|\bhe's\b|\bshe's\b|\bits\b)\b/i;

const isTemporalConfidence = (value: unknown): value is TemporalConfidence =>
  value === 'explicit' || value === 'inferred' || value === 'implied' || value === 'none';

const parseFacts = (result: ExtractFactsInput): Fact[] => {
  if (!result || !Array.isArray(result.facts)) {
    throw new ExtractionError('Extractor response missing facts array.');
  }

  return result.facts
    .filter(
      (value): value is Record<string, unknown> =>
        typeof value === 'object' &&
        value !== null &&
        'text' in value &&
        typeof value.text === 'string',
    )
    .map(
      (entry): Fact => ({
        text: entry.text as string,
        sourceConversationId:
          typeof entry.sourceConversationId === 'string' ? entry.sourceConversationId : undefined,
        metadata:
          entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
            ? (entry.metadata as Record<string, unknown>)
            : undefined,
        validFrom: typeof entry.validFrom === 'string' ? entry.validFrom : undefined,
        validUntil: typeof entry.validUntil === 'string' ? entry.validUntil : undefined,
        temporalConfidence: isTemporalConfidence(entry.temporalConfidence)
          ? entry.temporalConfidence
          : undefined,
      }),
    );
};

const buildUserPrompt = (conversation: readonly Message[]): string => {
  const lines = conversation.map((message) =>
    message.timestamp
      ? `[${message.timestamp}] ${message.role}: ${message.content}`
      : `${message.role}: ${message.content}`,
  );
  return `Transcript:\n---\n${lines.join('\n')}\n---\nExtract facts from the transcript above.`;
};

export class LocalExtractor implements Extractor {
  private readonly client: LlmClient;
  private readonly maxTokens: number;
  private readonly systemPrompt: string | undefined;

  public constructor(client: LlmClient, config: ExtractorConfig = {}) {
    this.client = client;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.systemPrompt = config.systemPrompt;
  }

  public async extract(
    conversation: readonly Message[],
    referenceTimestamp: string,
  ): Promise<ExtractionResult> {
    assertNoLlmReentry(conversation, 'extractor conversation payload');

    if (conversation.length === 0) {
      return { facts: [] };
    }

    const systemPrompt = this.systemPrompt ?? buildExtractionPrompt(referenceTimestamp);

    let result: ExtractFactsInput;
    try {
      result = await this.client.generate<ExtractFactsInput>({
        systemPrompt,
        userPrompt: buildUserPrompt(conversation),
        schema: EXTRACT_FACTS_SCHEMA,
        maxTokens: this.maxTokens,
      });
    } catch (error: unknown) {
      throw new ExtractionError(
        `Extraction failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    const allFacts = parseFacts(result);
    const facts = allFacts.filter(
      (fact) => fact.text.length > 0 && !noPronounPattern.test(fact.text),
    );

    return { facts };
  }
}

export const createExtractor = (client: LlmClient, config: ExtractorConfig = {}): Extractor =>
  new LocalExtractor(client, config);
