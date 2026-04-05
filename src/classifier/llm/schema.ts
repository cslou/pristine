import type { JsonSchema } from '../../core/types.js';

/**
 * JSON Schema for the classify_sensitivity structured output.
 *
 * Plain JSON Schema object (not Anthropic tool format) — used with
 * LlmClient.generate<T>() for grammar-constrained generation.
 */
export const CLASSIFY_SENSITIVITY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      description: 'Detected sensitive content spans. Empty array if text is clean.',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description:
              'Short snake_case label for the sensitivity type (e.g. address, identity_number, health, financial, phone_number, email, salary, passport, credit_card, bank_account, etc). Use whatever fits best — no fixed categories.',
          },
          confidence: {
            type: 'number',
            description: 'Confidence score between 0.0 and 1.0.',
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of why this text is sensitive.',
          },
          text: {
            type: 'string',
            description: 'The exact text span that is sensitive.',
          },
        },
        required: ['type', 'confidence', 'reasoning', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
};
