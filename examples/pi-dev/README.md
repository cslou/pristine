This is one way to use Pristine primitives. You can write your own.

# Pristine Pi development reference

This reference proves a Pi-only memory flow where Pi JSONL is the source of truth and Pristine stores only a semantic index: snippets/windows plus source pointers back to Pi's session file path. The first proof targets Pi sessions under `~/.pi/agent/sessions/.../*.jsonl` and a default Pristine DB at `~/.pi/pristine/pristine.db`.

## Reference pieces

- `jsonl-index` parses the active Pi session file and indexes user/assistant snippets/windows with source pointers.
- `search-memory` will provide `pristine_vector_search`, a Pi custom tool that searches the Pristine vector index and returns canonical source pointers.
- `search-session-history` will be a Pi skill that teaches agents to inspect raw Pi JSONL using existing Pi tools such as `bash`, `read`, grep, and jq.

## Pi JSONL fields used

The parser follows Pi's documented session file format from `@mariozechner/pi-coding-agent/docs/session-format.md` and the extension lifecycle from `docs/extensions.md`. The fields used by this reference are:

- file path / session file path: the active `.jsonl` file returned by Pi.
- line number: the 1-indexed JSONL line containing the indexed message entry.
- entry ID: the message entry `id` field, when present.
- parent ID: the message entry `parentId` field, when present.
- role: `message.role`; only `user` and `assistant` are indexed.
- content text: string content or content blocks where `type === "text"`.
- timestamp: the message entry `timestamp`, when present.
- cwd: the session header `cwd`, when present.

Parser behavior is intentionally narrow: user/assistant natural-language text is indexed; tool results, system/context content, custom hidden messages, custom roles, images, tool calls, and thinking blocks are ignored.

## Source pointer shape

The prototype stores and returns this source pointer shape; sprint-023 will formalize it in the core architecture:

```ts
{
  sourceKind: 'pi-jsonl',
  sourceUri: string,
  entryId?: string,
  parentId?: string,
  lineNumber: number,
  timestamp?: string,
  cwd?: string
}
```

Supported pointer metadata and filter keys shared by the index and search references:

- `sourceUri`
- `entryId`
- `parentId`
- `lineNumber`
- `timestamp`
- `cwd`

Search filter parameters `timestampFrom` and `timestampTo` are derived from stored `timestamp`; they are filters, not separate stored pointer fields.

## Ingestion contract

The chosen v1 ingestion contract is deterministic and active-session scoped:

1. Primary indexing runs in a Pi extension on `agent_end` after each completed turn.
2. Reconciliation runs on `session_start` for startup, reload, and resume.
3. The active session path comes from `ctx.sessionManager.getSessionFile()`.
4. Reconciliation is active session only: it indexes missing entries from the current active JSONL file.
5. There is no background scan of all historical sessions in v1.
6. Idempotence is required: reprocessing the same `sourceUri` + `entryId` must not create duplicate search hits.

`session_start` is a catch-up boundary, not a global backfill job. It handles extension install/reload, resumed sessions, missed prior turns, and DB reset while keeping Pi JSONL authoritative.

## Vector search to search-session-history flow

The reference workflow is:

1. `jsonl-index` indexes semantic snippets/windows from Pi user/assistant messages into Pristine with source pointers.
2. `pristine_vector_search` runs vector search over the index and returns likely hits with `sourceUri`, `entryId`, `lineNumber`, `timestamp`, and `cwd` metadata.
3. `search-session-history` instructs the agent to inspect the returned Pi JSONL pointer with existing tools, for example `read` for the file or `bash` with grep/jq to extract surrounding user/assistant context.

This keeps raw context in Pi JSONL and uses Pristine for semantic recall only. The agent can use grep for exact terms and `pristine_vector_search` when it does not know the exact words used in the prior session.
