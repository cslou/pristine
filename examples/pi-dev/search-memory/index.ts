import {
  createPristinePiVectorSearcher,
  type PristineVectorSearchInput,
  type PristineVectorSearchResult,
} from './src/vector-search.js';

interface PiToolResultLike {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly details: PristineVectorSearchResult;
}

interface PiToolLike {
  readonly name: 'pristine_vector_search';
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly parameters: Record<string, unknown>;
  execute(toolCallId: string, params: unknown): Promise<PiToolResultLike>;
}

interface PiExtensionApiLike {
  registerTool(tool: PiToolLike): void;
}

interface PristineVectorSearcherLike {
  search(input: PristineVectorSearchInput): Promise<PristineVectorSearchResult>;
}

const optionalStringFields = [
  'sourceUri',
  'entryId',
  'parentId',
  'timestampFrom',
  'timestampTo',
  'cwd',
] as const;

const toSearchInput = (params: unknown): PristineVectorSearchInput => {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error('pristine_vector_search parameters must be an object');
  }
  const input = params as Record<string, unknown>;
  if (typeof input.query !== 'string') {
    throw new Error('pristine_vector_search query must be a non-empty string');
  }
  const parsed: Record<string, unknown> = { query: input.query };
  for (const field of optionalStringFields) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'string')
      throw new Error(`pristine_vector_search ${field} must be a string`);
    parsed[field] = value;
  }
  for (const field of ['lineNumber', 'limit'] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'number')
      throw new Error(`pristine_vector_search ${field} must be a number`);
    parsed[field] = value;
  }
  return parsed as unknown as PristineVectorSearchInput;
};

const parameters = {
  type: 'object',
  required: ['query'],
  additionalProperties: false,
  properties: {
    query: { type: 'string', description: 'Non-empty semantic query.' },
    sourceUri: { type: 'string', description: 'Optional exact Pi JSONL source file path filter.' },
    entryId: { type: 'string', description: 'Optional exact Pi JSONL entry ID filter.' },
    parentId: { type: 'string', description: 'Optional exact Pi JSONL parent entry ID filter.' },
    lineNumber: {
      type: 'number',
      description: 'Optional exact one-based JSONL line number filter.',
    },
    timestampFrom: { type: 'string', description: 'Optional inclusive ISO timestamp lower bound.' },
    timestampTo: { type: 'string', description: 'Optional inclusive ISO timestamp upper bound.' },
    cwd: { type: 'string', description: 'Optional exact working directory filter.' },
    limit: { type: 'number', description: 'Result limit. Defaults to 5; min 1, max 20.' },
  },
} satisfies Record<string, unknown>;

export const createPristineVectorSearchTool = (
  searcher: PristineVectorSearcherLike = createPristinePiVectorSearcher(),
): PiToolLike => ({
  name: 'pristine_vector_search',
  label: 'Pristine Vector Search',
  description:
    'Semantic search over Pristine-indexed Pi JSONL snippets. Returns JSONL source pointers for follow-up inspection.',
  promptSnippet:
    'pristine_vector_search: semantic search over indexed Pi JSONL snippets; returns sourceUri/entryId/lineNumber pointers.',
  parameters,
  async execute(_toolCallId, params) {
    const result = await searcher.search(toSearchInput(params));
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      details: result,
    };
  },
});

export const registerSearchMemoryExtension = (
  pi: PiExtensionApiLike,
  searcherFactory: () => PristineVectorSearcherLike = createPristinePiVectorSearcher,
): void => {
  const searcher = searcherFactory();
  pi.registerTool(createPristineVectorSearchTool(searcher));
};

export default function searchMemoryExtension(pi: PiExtensionApiLike): void {
  registerSearchMemoryExtension(pi);
}
