import type { JsonSchema } from '../../core/types.js';

/**
 * JSON Schema for the query analysis structured output.
 *
 * Plain JSON Schema object (not Anthropic tool format) — used with
 * LlmClient.generate<T>() for grammar-constrained generation.
 */
export const QUERY_ANALYSIS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['factual_lookup', 'contextual_search', 'temporal_query'],
      description: 'The classified intent of the query.',
    },
    filters: {
      type: 'object',
      description: 'Optional filters extracted from the query.',
      properties: {
        topic: {
          type: 'string',
          description: 'Topic filter extracted from the query.',
        },
        timeRange: {
          type: 'object',
          description: 'Time range filter extracted from the query.',
          properties: {
            start: {
              type: 'string',
              description: 'ISO date string for the start of the range.',
            },
            end: {
              type: 'string',
              description: 'ISO date string for the end of the range.',
            },
          },
        },
        agentScope: {
          type: 'string',
          description: 'Agent scope filter extracted from the query.',
        },
      },
    },
    suggestedTopK: {
      type: 'number',
      description: 'Suggested number of results to retrieve.',
    },
    rewrittenQuery: {
      type: 'string',
      description: 'Rewritten query optimized for embedding similarity search.',
    },
  },
  required: ['intent', 'filters', 'suggestedTopK', 'rewrittenQuery'],
};
