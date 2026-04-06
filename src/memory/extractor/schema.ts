import type { JsonSchema } from '../../core/types.js';

/**
 * JSON Schema for the extract_facts structured output.
 *
 * Plain JSON Schema object (not Anthropic tool format) — used with
 * LlmClient.generate<T>() for grammar-constrained generation.
 */
export const EXTRACT_FACTS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      description: 'Extracted facts from the conversation.',
      items: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description:
              'A complete, standalone factual statement with no unresolved pronouns.',
          },
          metadata: {
            type: 'object',
            description: 'Optional metadata about the extracted fact.',
          },
          validFrom: {
            type: 'string',
            description:
              'ISO 8601 UTC timestamp when this fact became true. Omit if no temporal signal.',
          },
          validUntil: {
            type: 'string',
            description:
              'ISO 8601 UTC timestamp when this fact stopped being true. Omit if still current.',
          },
          temporalConfidence: {
            type: 'string',
            enum: ['explicit', 'inferred', 'implied', 'none'],
            description: 'Confidence level of the temporal extraction.',
          },
        },
        required: ['text'],
      },
    },
  },
  required: ['facts'],
};
