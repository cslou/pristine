import type { JsonSchema } from '../../core/types.js';

/**
 * JSON Schema for the consolidation structured output.
 *
 * Plain JSON Schema object (not Anthropic tool format) — used with
 * LlmClient.generate<T>() for grammar-constrained generation.
 */
export const CONSOLIDATION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          factIndex: {
            type: 'number',
            description: 'Zero-based index of the fact this decision is for.',
          },
          action: {
            type: 'string',
            enum: ['ADD', 'UPDATE', 'DELETE', 'NOOP', 'SUPERSEDE'],
            description: 'Action to perform.',
          },
          mergedText: {
            type: 'string',
            description: 'Merged/updated text. Required for ADD, UPDATE, SUPERSEDE.',
          },
          targetMemoryId: {
            type: 'string',
            description:
              'Integer ID of the target memory from the list. Required for UPDATE, DELETE, SUPERSEDE.',
          },
          supersessionReason: {
            type: 'string',
            description: 'Why the old fact is superseded. Required for SUPERSEDE.',
          },
          validUntil: {
            type: 'string',
            description: 'ISO timestamp when the old fact stopped being true. Optional.',
          },
        },
        required: ['factIndex', 'action'],
      },
    },
  },
  required: ['decisions'],
};
