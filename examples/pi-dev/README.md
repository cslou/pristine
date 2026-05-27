This is one way to use Pristine primitives. You can write your own.

# Pristine Pi development reference

This reference proves a Pi-only memory flow where Pi JSONL is the source of truth and Pristine stores only a semantic index: snippets/windows plus source pointers back to Pi's session file path. The first proof targets Pi sessions under `~/.pi/agent/sessions/.../*.jsonl` and a default Pristine DB at `~/.pi/pristine/pristine.db`.

This README is written as an agent-facing runbook: a coding agent should be able to copy these artifacts into another repo, install dependencies, understand how Pi discovers them, warm up the embedding model, and verify the flow.

## Artifact map

Pi artifacts are grouped by the runtime shape users install: extensions live under `extensions/`, skills live under `skills/`, and shared helper code stays outside both so it is not mistaken for a loadable Pi artifact.

| Source path                                      | Copy/install target in another repo  | Pi artifact type           | Purpose                                                                                                         |
| ------------------------------------------------ | ------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `examples/pi-dev/extensions/jsonl-index/`        | `.pi/extensions/jsonl-index/`        | Pi extension               | Ingestion/indexing: parses the active Pi JSONL session and writes snippets, vectors, and source pointers.       |
| `examples/pi-dev/extensions/search-memory/`      | `.pi/extensions/search-memory/`      | Pi extension / custom tool | Registers `pristine_recall` for semantic vector search over indexed Pi snippets.                                |
| `examples/pi-dev/extensions/privacy-input/`      | `.pi/extensions/privacy-input/`      | Pi input/tool extension    | Privacy reference: detects/classifies/redacts user input, reveals allowlisted placeholders for local tools, and scrubs tool results. |
| `examples/pi-dev/extensions/session-relay/`      | `.pi/extensions/session-relay/`      | Pi lifecycle extension     | Optional new-session handoff: records lightweight `memory_sessions` metadata and injects one prior-session relay on eligible new sessions. |
| `examples/pi-dev/skills/search-session-history/` | `.pi/skills/search-session-history/` | Pi skill                   | User-facing skill for memory/history questions; uses vector search when needed, then directed JSONL inspection. |
| `examples/pi-dev/shared/`                        | `.pi/shared/`                        | Shared helper code         | Imported by memory extensions. It is not loaded directly by Pi and has no user-facing tool.                     |

Pi auto-discovers project-local extensions from `.pi/extensions/<name>/index.ts` and skills from `.pi/skills/<name>/SKILL.md` when started from the repo root. `shared` is copied under `.pi/shared/` only so relative extension imports resolve without making shared code look like a Pi extension.

## What agents should invoke

Users should ask normal memory/history questions, preferably naming the skill:

```text
Use the search-session-history skill to find what we decided about Lantern Cache.
```

The agent should then:

1. Load `search-session-history`.
2. If no pointer is already known, call `pristine_recall` with the user's semantic query.
3. Use score, filters, and bounded `snippet` previews for first-pass relevance judgment.
4. Use the selected hit's `sourcePointer` (`sourceUri`, `entryId`, `lineNumber`).
5. Inspect only `sourcePointer.sourceUri` for bounded user/assistant context.
6. Avoid broad `rg`/grep over `~/.pi/agent/sessions` once a usable pointer exists.

`pristine_recall` is the discovery layer: it returns ranked source pointers and bounded snippet previews. `search-session-history` is the exact-context layer.

## Install vector-search memory into another repo

From the repo where you want Pi vector-search memory support, copy the source-index artifacts into Pi's repo-local discovery layout. Replace `/path/to/pristine` with this repository path. `session-relay` is optional and has its own install section below because it does not depend on the vector-search artifacts.

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

`privacy-input` is not enabled by the default memory install because it requires host-wired detector, classifier, redactor, vault/key, and user ID dependencies. Copy and enable it only after adding a small wrapper that calls `registerPrivacyInputExtension` with a configured runtime factory:

```bash
rsync -a --delete /path/to/pristine/examples/pi-dev/extensions/privacy-input/ .pi/extensions/privacy-input/
cd /path/to/your/repo/.pi/extensions/privacy-input
npm install --omit=dev
# Only if your wrapper imports @pristine/sdk from this copied directory before the SDK is published:
# npm install --omit=dev /path/to/pristine
```

Then wire the runtime from your host extension code before adding `./extensions/privacy-input` to `.pi/settings.json` or relying on project-local discovery. The copied package installs only the Pi model transport dependency; the host supplies `detect`, `classify`, `redact`, `resolveSensitive`, and the configured `Pristine` client (from `@pristine/sdk` or compatible local functions). Local-first deployments should use a local/fake/manual classifier callback. For real classifier smoke with an explicit non-local/provider-backed Pi model opt-in, use `createPrivacyInputClassifierCallback(createPiModelClassifierTransport(...))`; the transport sends sanitized classifier context to Pi `completeSimple` with `ctx.modelRegistry` auth, supports OAuth/header-backed providers, defaults examples to `openai-codex/gpt-5.5`, and falls back to the current Pi model when configured preferences are unavailable.

## Optional session relay reference

`session-relay` is a separate optional reference artifact. It does not require embeddings, `sqlite-vec`, `jsonl-index`, `search-memory`, or `pristine_recall`; it can be installed by itself with only shared helpers and its `better-sqlite3` dependency. It records one generic `memory_sessions` row per processed session with `source_harness = 'pi'`, `source_uri`, `cwd`, first/last visible-message timestamps, visible-message count, active-entry metadata, and `updated_at`.

Copy and install only the relay artifacts when you want new-session handoff without vector search:

```bash
cd /path/to/your/repo
mkdir -p .pi/extensions .pi/shared
rsync -a --delete /path/to/pristine/examples/pi-dev/shared/ .pi/shared/
rsync -a --delete /path/to/pristine/examples/pi-dev/extensions/session-relay/ .pi/extensions/session-relay/
cd .pi/extensions/session-relay
npm install --omit=dev
```

If explicit settings are required for this optional artifact, add only the relay extension path:

```json
{
  "extensions": ["./extensions/session-relay"]
}
```

On `before_agent_start`, the extension selects the latest prior `memory_sessions` row for the same `cwd`, excludes the current session URI, loads a bounded visible user/assistant tail, generates a fresh six-section relay (no cache), and returns a hidden model-visible custom context message. No-history behavior is a silent no-op: no injection, no warning, no thrown error. Relay generation failures fail open: no partial injection, the session continues, and Pi receives a non-blocking warning. Successful injection emits no success notification or visible chat/TUI noise.

The reference is Pi-first. Codex and Claude adapters are deferred; the generic metadata contract leaves room for future `source_harness` values without implementing those adapters now.

### Session-relay manual smoke checklist

You can run the reproducible helper instead of performing the steps by hand:

```bash
node examples/pi-dev/scripts/session-relay-smoke.mjs
```

Pass condition: the helper exits 0, prints `Session relay smoke PASS`, and prints temporary evidence directories for success, empty-history, and failure scenarios. The helper uses a local fake Pi provider, installs only `session-relay` plus shared helpers, and leaves generated temp repos/DBs under `/tmp` for inspection; do not commit them.

Manual equivalent:

1. Copy only `examples/pi-dev/shared/` and `examples/pi-dev/extensions/session-relay/` into a temporary repo's `.pi/` layout and run `npm install --omit=dev` in `.pi/extensions/session-relay`.
2. Start Pi in that repo, create a short prior session, then start a new Pi session in the same repo.
3. Pass condition: the new session receives exactly one hidden prior-session handoff; repeated prompts or reloads do not duplicate it; no `jsonl-index`, vectors, `search-memory`, or `pristine_recall` are installed.
4. Start Pi in a different temporary repo with no `memory_sessions` history.
5. Pass condition: no handoff is injected and no warning appears.
6. To simulate failure in a disposable copy, temporarily wrap `registerSessionRelayExtension` with a `runtimeFactory` whose relay generator returns an empty summary, or run the unit-level failure tests if you are not changing the copied artifact.
7. Pass condition: Pi shows one non-blocking warning for a failed relay generation path, no partial relay is injected, and the session continues.
8. Record evidence in the Story 7 PR and final sprint review; do not commit generated Pi sessions, local DBs, or relay transcripts.

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

## Privacy input reference

The `privacy-input` extension is a v1 privacy reference. It runs before skill/template expansion for user input and at the local tool execution boundary for selected tool fields:

```text
input hook → detect(text) → classify(text, candidates, classifierCallback) → policy → redact(text, confirmed, userId)
tool_call hook → reveal placeholders only in allowlisted local tool fields
tool_result hook → scrub revealed raw values from model/session-facing results
```

Classifier prompts/tasks receive sanitized context, `[CANDIDATE:<id>]` markers, non-value-derived candidate IDs, safe `sourceSpan` metadata, and safe `hint` metadata only. They must never receive raw candidates, raw prefixes/suffixes, decoded JWT payload values, URL passwords, query secret values, seed phrase words, vault refs, or reveal data.

Real Pi classifier wiring is optional and non-local: sanitized classifier context can leave the device via the selected Pi model provider. It uses the same model-layer pattern as agentic compaction rather than a provider SDK:

```ts
classifierCallback: createPrivacyInputClassifierCallback(
  createPiModelClassifierTransport({
    modelRegistry: ctx.modelRegistry,
    currentModel: ctx.model,
    preferences: [{ provider: 'openai-codex', id: 'gpt-5.5' }],
    reasoning: 'minimal',
    maxTokens: 2048,
    timeoutMs: 10_000,
  }),
);
```

The transport calls `ctx.modelRegistry.getApiKeyAndHeaders(model)`, so Pi OAuth/session headers and API keys are both supported.

Policy modes:

- `uncertainPolicy: "block"` is the default and stops the turn before model context when any candidate remains uncertain.
- `uncertainPolicy: "redact"` stores/redacts uncertain candidates using detector `hint.suggestedType` or a fallback type.
- `uncertainPolicy: "allow"` is an explicit unsafe opt-in; uncertain raw input can continue to model/session history and is excluded from the default no-raw-secret guarantee.

Execution-boundary reveal is intentionally narrow. It applies to `write.content` and `edit.edits[].newText`; non-allowlisted fields remain placeholders. This reference does not reveal `bash.command` because shell commands can stream or exfiltrate secrets. If a placeholder cannot be resolved locally, the tool call fails closed before execution. Tool results after a revealed call are scrubbed before returning to model/session context.

### Privacy-input smoke check

Fake/test classifier mode is covered by the non-interactive test harness:

```bash
pnpm run test:unit -- tests/examples/pi-dev/privacy-input-extension.test.ts -t "uses real primitives to transform and reveal a confirmed secret"
```

Pass condition: the sample fake API key is transformed to a `[SENSITIVE:api_key:<id>]` placeholder, the raw key is absent from model-facing text, the classifier request contains `[CANDIDATE:<id>]` markers instead of the raw key, and `reveal` restores the original value for the same user.

Manual Pi smoke, only after copying/installing the extension and wiring `registerPrivacyInputExtension` with a configured runtime factory:

```text
My test API key is sk-proj-abcdefghijklmnopqrstuvwxyz123456. Please reply OK.
```

Pass condition: Pi blocks or transforms the input before the agent sees the raw key. The model-facing/session-history transcript should contain either a safe notification or a `[SENSITIVE:api_key:<id>]` placeholder and must not contain the raw key.

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
