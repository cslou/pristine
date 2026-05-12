This is one way to use Pristine primitives. You can write your own.

# Pristine Pi development reference

This reference proves a Pi-only memory flow where Pi JSONL is the source of truth and Pristine stores only a semantic index: snippets/windows plus source pointers back to Pi's session file path. The first proof targets Pi sessions under `~/.pi/agent/sessions/.../*.jsonl` and a default Pristine DB at `~/.pi/pristine/pristine.db`.

This README is written as an agent-facing runbook: a coding agent should be able to copy these artifacts into another repo, install dependencies, understand how Pi discovers them, warm up the embedding model, and verify the flow.

## Artifact map

Pi artifacts are grouped by the runtime shape users install: extensions live under `extensions/`, skills live under `skills/`, and shared helper code stays outside both so it is not mistaken for a loadable Pi artifact.

| Source path | Copy/install target in another repo | Pi artifact type | Purpose |
| --- | --- | --- | --- |
| `examples/pi-dev/extensions/jsonl-index/` | `.pi/extensions/jsonl-index/` | Pi extension | Ingestion/indexing: parses the active Pi JSONL session and writes snippets, vectors, and source pointers. |
| `examples/pi-dev/extensions/search-memory/` | `.pi/extensions/search-memory/` | Pi extension / custom tool | Registers `pristine_recall` for semantic vector search over indexed Pi snippets. |
| `examples/pi-dev/skills/search-session-history/` | `.pi/skills/search-session-history/` | Pi skill | User-facing skill for memory/history questions; uses vector search when needed, then directed JSONL inspection. |
| `examples/pi-dev/shared/` | `.pi/shared/` | Shared helper code | Imported by the two extensions. It is not loaded directly by Pi and has no user-facing tool. |

Pi auto-discovers project-local extensions from `.pi/extensions/<name>/index.ts` and skills from `.pi/skills/<name>/SKILL.md` when started from the repo root. `shared` is copied under `.pi/shared/` only so relative extension imports resolve without making shared code look like a Pi extension.

## What agents should invoke

Users should ask normal memory/history questions, preferably naming the skill:

```text
Use the search-session-history skill to find what we decided about Lantern Cache.
```

The agent should then:

1. Load `search-session-history`.
2. If no pointer is already known, call `pristine_recall` with the user's semantic query.
3. Use score, filters, and any explicitly enabled bounded `snippet` previews for first-pass relevance judgment; default `snippet` output is withheld.
4. Use the selected hit's `sourcePointer` (`sourceUri`, `entryId`, `lineNumber`).
5. Inspect only `sourcePointer.sourceUri` for bounded user/assistant context.
6. Avoid broad `rg`/grep over `~/.pi/agent/sessions` once a usable pointer exists.

`pristine_recall` is the discovery layer: it returns ranked source pointers and may include explicitly enabled bounded snippet previews. `search-session-history` is the exact-context layer.

## Install into another repo

From the repo where you want Pi memory support, copy the reference artifacts into Pi's repo-local discovery layout. Replace `/path/to/pristine` with this repository path.

```bash
cd /path/to/your/repo

mkdir -p .pi/extensions .pi/skills .pi/shared

rsync -a --delete /path/to/pristine/examples/pi-dev/shared/ .pi/shared/
rsync -a --delete /path/to/pristine/examples/pi-dev/extensions/jsonl-index/ .pi/extensions/jsonl-index/
rsync -a --delete /path/to/pristine/examples/pi-dev/extensions/search-memory/ .pi/extensions/search-memory/
rsync -a --delete /path/to/pristine/examples/pi-dev/skills/search-session-history/ .pi/skills/search-session-history/
```

Install runtime dependencies next to each copied extension:

```bash
cd /path/to/your/repo/.pi/extensions/jsonl-index
npm install --omit=dev

cd /path/to/your/repo/.pi/extensions/search-memory
npm install --omit=dev
```

No root package install is required in the target repo. The copied extension directories own their runtime dependencies.

## Optional explicit Pi settings

If Pi's default project-local discovery is enabled, no settings are required: start `pi` from the repo root and it discovers `.pi/extensions/*/index.ts` and `.pi/skills/*/SKILL.md`.

If discovery is disabled or you want explicit settings, add paths like this to the target repo's `.pi/settings.json`:

```json
{
  "extensions": ["./extensions/jsonl-index", "./extensions/search-memory"],
  "skills": ["./skills/search-session-history"]
}
```

Project `.pi/settings.json` paths are relative to the `.pi` directory. Do not add `.pi/shared` as an extension. It is shared code imported by the extension packages, not a Pi extension entry point.

## Embedding model and Nomic warmup

This reference uses `nomic-ai/nomic-embed-text-v1.5` through `@huggingface/transformers`.

- No Ollama server is required.
- There is no `ollama pull` step.
- The first indexing/search operation downloads and caches the Nomic model files through Transformers/Hugging Face cache behavior.
- First use can take several seconds while model files load and the local runtime warms up. Later calls should be faster.

Warmup smoke from the target repo:

```bash
cd /path/to/your/repo
pi -p "Reply exactly OK."
```

Pass condition: Pi starts, loads the extensions/skill, and returns `OK` without Pristine startup errors.

## DB path and reset

Both extensions use the same local SQLite DB. Resolution precedence:

1. Explicit extension config path, if wired by a custom host.
2. `PRISTINE_DB_PATH` environment variable.
3. Default `~/.pi/pristine/pristine.db`.

Reset the semantic index:

```bash
db="${PRISTINE_DB_PATH:-$HOME/.pi/pristine/pristine.db}"
rm -f "$db" "$db-wal" "$db-shm" "$db-journal"
```

After reset, `jsonl-index` rebuilds the active session index as Pi lifecycle events run. It does not background-scan all historical sessions in v1.

## End-to-end TUI verification

Start Pi from the target repo root:

```bash
cd /path/to/your/repo
pi
```

In the Pi TUI, send a longer conversation:

```text
We are testing Pristine on this repo. The durable test phrase is copper-lion-harbor-31. The project codename is Lantern Cache. Reply OK and remember these details.
```

```text
For Lantern Cache, let's decide three things:
1. Use SQLite for local persistence.
2. Never make network calls.
3. Store only source pointers for Pi sessions, not raw transcript mirrors.
Reply with a concise summary.
```

```text
Add one more decision: semantic recall should happen through vector search, but exact context should come from the Pi JSONL source pointer. Reply with the updated decision list.
```

```text
Reply exactly OK.
```

Then test the skill as the user-facing entry point:

```text
Use the search-session-history skill to answer: what did we decide about Lantern Cache and exact context?
```

Pass condition:

- The agent uses the skill, and the skill uses `pristine_recall` internally if no pointer is known.
- The answer includes the Lantern Cache decisions.
- The exact context comes from the returned `sourcePointer.sourceUri`.
- The agent does not broad-grep all Pi sessions once it has a usable source pointer.
- Tool results, hidden context, thinking blocks, and image payloads are excluded.

Exact phrase check:

```text
Use the search-session-history skill to find the durable test phrase from this repo and summarize the surrounding context.
```

Pass condition: the response includes `copper-lion-harbor-31`, nearby visible user/assistant context, and/or the source pointer used.

## Optional SQL verification

If you need to inspect the DB directly:

```bash
sqlite3 "${PRISTINE_DB_PATH:-$HOME/.pi/pristine/pristine.db}" \
  "select entry_id, source_uri, line_number from pi_jsonl_chunks where snippet like '%copper-lion-harbor-31%';"
```

Pass condition: a row exists with a Pi JSONL `source_uri`, `entry_id`, and `line_number`.

## Pi JSONL fields used

The parser follows Pi's documented session file format from `@mariozechner/pi-coding-agent/docs/session-format.md` and the extension lifecycle from `docs/extensions.md`. The fields used by this reference are:

- file path / session file path: the active `.jsonl` file returned by Pi.
- line number: the 1-indexed JSONL line containing the indexed message entry.
- entry ID: the message entry `id` field. It is required for indexing because idempotence uses `sourceUri` + `entryId`.
- parent ID: the message entry `parentId` field, when present.
- role: `message.role`; only `user` and `assistant` are indexed.
- content text: string content or content blocks where `type === "text"`.
- timestamp: the message entry `timestamp`, when present.
- cwd: the session header `cwd`, when present.

Parser behavior is intentionally narrow: user/assistant natural-language text is indexed; tool results, system/context content, custom hidden messages, custom roles, images, tool calls, and thinking blocks are ignored.

## Source pointer shape

The prototype stores and returns this source pointer shape so later core architecture can formalize the same source-owned record model:

```ts
{
  sourceKind: 'pi-jsonl',
  sourceUri: string,
  entryId: string,
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
4. The active branch comes from `ctx.sessionManager.getBranch()`; abandoned branches in the same JSONL file are not indexed by the runtime extension when branch data is available.
5. Reconciliation is active session only: it indexes missing entries from the current active JSONL file.
6. There is no background scan of all historical sessions in v1.
7. Idempotence is required: reprocessing the same `sourceUri` + `entryId` must not create duplicate search hits; message entries without an `entryId` are skipped.

`session_start` is a catch-up boundary, not a global backfill job. It handles extension install/reload, resumed sessions, missed prior turns, and DB reset while keeping Pi JSONL authoritative.

## Install/runtime gotchas

- Pi discovers repo-local extensions from `.pi/extensions/<name>/index.ts` and skills from `.pi/skills/<name>/SKILL.md`; copying examples directly under `.pi/<name>` does not load them.
- Copy `examples/pi-dev/shared/` to `.pi/shared/` because both extension examples import shared helpers.
- Run `npm install --omit=dev` separately in `.pi/extensions/jsonl-index` and `.pi/extensions/search-memory`; each copied extension owns its runtime dependencies.
- Copied repo-local files are intentionally self-contained and do not import this repository's `src/` internals.
- `session_start:startup` can occur before Pi creates a new session file; the index extension skips that startup-only missing-file case and indexes once the file exists on later lifecycle events.
