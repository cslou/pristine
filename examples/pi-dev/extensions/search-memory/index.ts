import {
  createPristinePiVectorSearcher,
  type PristineVectorSearchInput,
  type PristineVectorSearchResult,
} from './lib/vector-search.js';

interface PiToolResultLike {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly details: PristineVectorSearchResult;
}

type SearchToolName = 'pristine_recall' | 'pristine_vector_search';

interface PiToolLike {
  readonly name: SearchToolName;
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

const toSearchInput = (params: unknown, toolName: SearchToolName): PristineVectorSearchInput => {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error(`${toolName} parameters must be an object`);
  }
  const input = params as Record<string, unknown>;
  if (typeof input.query !== 'string') {
    throw new Error(`${toolName} query must be a non-empty string`);
  }
  const parsed: Record<string, unknown> = { query: input.query };
  for (const field of optionalStringFields) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new Error(`${toolName} ${field} must be a string`);
    parsed[field] = value;
  }
  for (const field of ['lineNumber', 'limit'] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'number') throw new Error(`${toolName} ${field} must be a number`);
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

const createSearchTool = (
  searcher: PristineVectorSearcherLike,
  toolName: SearchToolName,
): PiToolLike => ({
  name: toolName,
  label: toolName === 'pristine_recall' ? 'Pristine Recall' : 'Pristine Vector Search',
  description:
    toolName === 'pristine_recall'
      ? 'Recall Pristine-indexed Pi JSONL snippets by semantic query. Returns JSONL source pointers for follow-up inspection.'
      : 'Deprecated alias for pristine_recall. Semantic search over Pristine-indexed Pi JSONL snippets.',
  promptSnippet:
    toolName === 'pristine_recall'
      ? 'pristine_recall: recall indexed Pi JSONL snippets by semantic query; returns sourceUri/entryId/lineNumber pointers.'
      : 'pristine_vector_search: deprecated alias for pristine_recall.',
  parameters,
  async execute(_toolCallId, params) {
    const result = await searcher.search(toSearchInput(params, toolName));
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      details: result,
    };
  },
});

export const createPristineRecallTool = (
  searcher: PristineVectorSearcherLike = createPristinePiVectorSearcher(),
): PiToolLike => createSearchTool(searcher, 'pristine_recall');

/** @deprecated Use createPristineRecallTool(). */
export const createPristineVectorSearchTool = (
  searcher: PristineVectorSearcherLike = createPristinePiVectorSearcher(),
): PiToolLike => createSearchTool(searcher, 'pristine_vector_search');

export const registerSearchMemoryExtension = (
  pi: PiExtensionApiLike,
  searcherFactory: () => PristineVectorSearcherLike = createPristinePiVectorSearcher,
): void => {
  const searcher = searcherFactory();
  pi.registerTool(createPristineRecallTool(searcher));
  pi.registerTool(createPristineVectorSearchTool(searcher));
};

export default function searchMemoryExtension(pi: PiExtensionApiLike): void {
  registerSearchMemoryExtension(pi);
}
