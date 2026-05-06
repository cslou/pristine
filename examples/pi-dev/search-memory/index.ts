import { Type } from '@mariozechner/pi-ai';
import { defineTool, type ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { createPristinePiVectorSearcher } from './src/vector-search.js';

const pristineVectorSearchTool = defineTool({
  name: 'pristine_vector_search',
  label: 'Pristine Vector Search',
  description:
    'Semantic search over Pristine-indexed Pi JSONL snippets. Returns JSONL source pointers for follow-up inspection.',
  promptSnippet:
    'pristine_vector_search: semantic search over indexed Pi JSONL snippets; returns sourceUri/entryId/lineNumber pointers.',
  parameters: Type.Object({
    query: Type.String({ description: 'Non-empty semantic query.' }),
    sourceUri: Type.Optional(
      Type.String({ description: 'Optional exact Pi JSONL source file path filter.' }),
    ),
    entryId: Type.Optional(
      Type.String({ description: 'Optional exact Pi JSONL entry ID filter.' }),
    ),
    parentId: Type.Optional(
      Type.String({ description: 'Optional exact Pi JSONL parent entry ID filter.' }),
    ),
    lineNumber: Type.Optional(
      Type.Number({ description: 'Optional exact one-based JSONL line number filter.' }),
    ),
    timestampFrom: Type.Optional(
      Type.String({ description: 'Optional inclusive ISO timestamp lower bound.' }),
    ),
    timestampTo: Type.Optional(
      Type.String({ description: 'Optional inclusive ISO timestamp upper bound.' }),
    ),
    cwd: Type.Optional(Type.String({ description: 'Optional exact working directory filter.' })),
    limit: Type.Optional(
      Type.Number({ description: 'Result limit. Defaults to 5; min 1, max 20.' }),
    ),
  }),
  async execute(_toolCallId, params) {
    const searcher = createPristinePiVectorSearcher();
    const result = await searcher.search(params);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      details: result,
    };
  },
});

export default function searchMemoryExtension(pi: ExtensionAPI): void {
  pi.registerTool(pristineVectorSearchTool);
}
