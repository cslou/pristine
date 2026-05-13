This is one way to use Pristine primitives. You can write your own.

# Pi Dev Search Memory Reference

Type: Pi extension / custom tool. Install target: `.pi/extensions/search-memory/`. Entry point: `.pi/extensions/search-memory/index.ts`. Registers tool: `pristine_recall`.

`pristine_recall` is a Pi custom tool that semantically searches the Pi JSONL snippets indexed by `examples/pi-dev/extensions/jsonl-index/`. Pi JSONL remains the source of truth; this tool returns source pointers for authoritative follow-up. By default the `snippet` field is withheld; extension hosts that explicitly set `includeSnippetText` receive bounded minimized previews that preserve safe context words and supported sensitive placeholders while replacing other raw text with `[TEXT]`.

## Install

Copy this directory into a repo-local `.pi` extension location, then install runtime dependencies:

```bash
mkdir -p ~/projects/test-pristine/.pi/extensions ~/projects/test-pristine/.pi/shared
rsync -a --delete examples/pi-dev/shared/. ~/projects/test-pristine/.pi/shared/
rsync -a --delete examples/pi-dev/extensions/search-memory/. ~/projects/test-pristine/.pi/extensions/search-memory/
cd ~/projects/test-pristine/.pi/extensions/search-memory
npm install --omit=dev
```

The tool reads the same DB as `jsonl-index`: explicit config when wired by an extension host, `PRISTINE_DB_PATH`, then `~/.pi/pristine/pristine.db`. To enable minimized preview snippets without exposing a tool input, a trusted host can call `createSearchMemoryExtension({ includeSnippetText: true })` or set `PRISTINE_RECALL_INCLUDE_SNIPPET_TEXT=true` before loading the default extension.

## Tool input

Required:

- `query`: non-empty semantic query.

Optional filters:

- `sourceUri`
- `entryId`
- `parentId`
- `lineNumber`
- `timestampFrom`
- `timestampTo`
- `cwd`
- `limit` — defaults to `5`, minimum `1`, maximum `20`.

Filtered search ranks exact semantic distance over the metadata-matched candidate set. To keep this repo-local Pi tool responsive, filters that match more than 5,000 indexed rows return a narrowing message instead of scanning the whole local index; add a more selective `sourceUri`, `entryId`, time range, `cwd`, or lower-scope query workflow before retrying.

## Result shape

Each result includes:

- `rank`
- `score`
- `chunkId`
- `snippet` — withheld by default with source-pointer guidance. When an extension host explicitly sets `includeSnippetText`, snippets are bounded minimized previews for relevance judgment: safe context words and supported sensitive placeholders are preserved, while other raw text is replaced with `[TEXT]`; returned snippets are limited to 800 Unicode characters, and longer snippets keep the first 799 characters and end with `…`.
- `sourcePointer.sourceKind` = `pi-jsonl`
- `sourcePointer.sourceUri`
- `sourcePointer.entryId`
- `sourcePointer.parentId`
- `sourcePointer.lineNumber`
- `sourcePointer.timestamp`
- `sourcePointer.cwd`

## Known phrase verification

1. Use `jsonl-index` to index a session containing a unique phrase such as `known phrase sapphire bridge`.
2. Ask Pi to call `pristine_recall` with `{ "query": "sapphire bridge", "limit": 5 }`.
3. Pass condition: one result ranks the known phrase chunk and returns a `sourcePointer` with `sourceUri`, `entryId`, and `lineNumber`; default `snippet` output is withheld with guidance to inspect the pointer.
4. Follow the pointer with `search-session-history` to inspect nearby authoritative JSONL context.

## Reset

Remove the local index DB and let `jsonl-index` rebuild it:

```bash
db="${PRISTINE_DB_PATH:-$HOME/.pi/pristine/pristine.db}"
rm -f "$db" "$db-wal" "$db-shm" "$db-journal"
```
