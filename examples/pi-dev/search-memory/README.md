This is one way to use Pristine primitives. You can write your own.

# Pi Dev Search Memory Reference

`pristine_vector_search` is a Pi custom tool that semantically searches the Pi JSONL snippets indexed by `examples/pi-dev/jsonl-index/`. Pi JSONL remains the source of truth; this tool returns snippets plus source pointers so an agent can inspect the authoritative session file with `search-session-history` or ordinary `bash`/`read`/jq commands.

## Install

Copy this directory into a repo-local `.pi` extension location, then install runtime dependencies:

```bash
mkdir -p ~/projects/test-pristine/.pi
rsync -a --delete examples/pi-dev/. ~/projects/test-pristine/.pi/
cd ~/projects/test-pristine/.pi/search-memory
npm install --omit=dev
```

The tool reads the same DB as `jsonl-index`: explicit config when wired by an extension host, `PRISTINE_DB_PATH`, then `~/.pi/pristine/pristine.db`.

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

## Result shape

Each result includes:

- `rank`
- `score`
- `chunkId`
- `snippet`
- `sourcePointer.sourceKind` = `pi-jsonl`
- `sourcePointer.sourceUri`
- `sourcePointer.entryId`
- `sourcePointer.parentId`
- `sourcePointer.lineNumber`
- `sourcePointer.timestamp`
- `sourcePointer.cwd`

## Known phrase verification

1. Use `jsonl-index` to index a session containing a unique phrase such as `known phrase sapphire bridge`.
2. Ask Pi to call `pristine_vector_search` with `{ "query": "sapphire bridge", "limit": 5 }`.
3. Pass condition: one result includes the known phrase snippet and a `sourcePointer` with `sourceUri`, `entryId`, and `lineNumber`.
4. Follow the pointer with `search-session-history` to inspect nearby raw JSONL context.

## Reset

Remove the local index DB and let `jsonl-index` rebuild it:

```bash
rm -f ~/.pi/pristine/pristine.db ~/.pi/pristine/pristine.db-*
```
