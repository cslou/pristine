This is one way to use Pristine primitives. You can write your own.

# Pi JSONL index extension

This Pi extension indexes the active Pi session JSONL into a local Pristine-compatible vector index. Pi JSONL remains the source of truth; the index stores snippets plus source pointers only.

## Install shape

Copy `examples/pi-dev/jsonl-index/` into a Pi auto-discovered extension location such as:

```bash
mkdir -p .pi/extensions/jsonl-index
rsync -a examples/pi-dev/jsonl-index/. .pi/extensions/jsonl-index/
```

The extension entry point is `index.ts`.

## Ingestion lifecycle

- `agent_end`: primary indexing trigger after each completed agent turn.
- `session_start`: reconciliation trigger for startup, reload, and resume.
- Active session discovery: `ctx.sessionManager.getSessionFile()`.
- Active branch filtering: `ctx.sessionManager.getBranch()`; abandoned JSONL branches are not indexed when branch data is available.
- Scope: active session only; no background scan of all historical sessions.
- Idempotence: duplicate indexing is prevented by stable `sourceUri + entryId`.

## DB path

Resolution precedence:

1. Explicit config path passed to the runtime factory.
2. `PRISTINE_DB_PATH` environment variable.
3. Default `~/.pi/pristine/pristine.db`.

## Stored fields

Each indexed row stores:

- snippet / indexed text
- vector embedding
- `sourceKind: 'pi-jsonl'`
- `sourceUri`
- `entryId`
- optional `parentId`
- `lineNumber`
- optional `timestamp`
- optional `cwd`
- metadata JSON containing role and source pointer

## Reset

```bash
rm -f ~/.pi/pristine/pristine.db ~/.pi/pristine/pristine.db-wal ~/.pi/pristine/pristine.db-shm
```

## Known phrase verification

Type a unique phrase in Pi, let the turn complete, then query the SQLite DB for that phrase:

```bash
sqlite3 ~/.pi/pristine/pristine.db "select source_uri, entry_id, line_number, snippet from pi_jsonl_chunks where snippet like '%known phrase%';"
```

Pass condition: the known phrase appears once with a Pi JSONL source pointer.
