# Pristine Local — Sprint 008c
**Date:** TBD
**Goal:** Fix temporal extraction by ensuring hooks pass timestamps through to Pristine, and document the hook contract
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3, sqlite-vec
- **Current state:** Sprint 008a complete (memorybench ported, ingestion dedup fixed, Pristine provider created). Verification run revealed all extracted facts had `validFrom: 2026-04-16` (today) instead of the LOCOMO conversation dates from 2023. Root cause: timestamps exist at every data source but are dropped at the hook boundary.
- **Implementation spec:** `docs/specs/implementation-spec-003.md` — Phase 8 (memorybench)
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context

#### The Hook Pattern
Every system that feeds conversations into Pristine is a **hook**. Each hook reads from a source that has timestamps, builds a `Message[]` array, and calls `store()` or `orchestrator.ingest()`. The problem: all current hooks drop the timestamps.

| Hook | Source | Timestamp Location | Currently Passed? |
|---------|--------|-------------------|-------------------|
| Claude Code hook | `transcript_path` (.jsonl) | `entry.timestamp` on every entry | No |
| Pi.dev extension | session events (.jsonl) | `entry.timestamp` on every entry | No |
| LOCOMO provider | `locomo10.json` | `session_N_date_time` per session | No |

Pristine's `Message` type already supports `timestamp?: string`. The conversation DB persists it. The extraction prompt accepts `REFERENCE_TIME`. The plumbing exists end-to-end — the hooks just need to include the timestamp.

#### What needs to change
1. **Pristine core** — The extractor should use message timestamps when available (currently ignores them). Make `referenceTimestamp` derivation automatic.
2. **LOCOMO hook** — Pass `session.metadata.date` as `referenceTimestamp` via `IngestOptions`. LOCOMO has per-session dates (not per-message), so this uses the explicit `referenceTimestamp` option.
3. **Documentation** — Document the hook contract: what hooks must provide, how timestamps flow, and examples for each hook type.
4. **Claude Code / Pi.dev hooks** — These live in `harness-config` (separate repo). Document the required changes; implementation is out of scope for this sprint.

### Parallelization
Stories 1, 2, 4 are **DONE** (merged in PRs #81, #82, #83). Remaining stories for this sprint:

- Story 3 (DB path + --force contract) — foundation; must come first
- Story 5 (Provider lifecycle) — depends on Story 3 (uses same interface extension point)
- Story 6 (Silent no-op detection) — depends on Story 3 (fewer false positives after DB fix)
- Story 7 (Partial-ingest recovery) — depends on Stories 3, 5, 6
- Story 8a (Docs + build ergonomics) — depends on Stories 1-7
- Story 8b (Defensive hardening) — depends on Stories 1-7; can run in parallel with 8a

Recommended order: Story 3 -> Stories 5 + 6 (parallel) -> Story 7 -> Stories 8a + 8b (parallel).

### Stories
**Constraints:** Max 5 stories per sprint. Max 5 commits per story. If a story needs 6+ commits during planning, split it.

#### Story 1: Fix temporal extraction timestamp handling in core
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** the extractor to use message timestamps for temporal anchoring, **so that** facts are extracted with correct dates regardless of when the pipeline runs.
- **Dependencies:** None
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `extractFactsStep` derives `referenceTimestamp` from the latest `Message.timestamp` when no explicit `referenceTimestamp` is provided via `IngestOptions`
  - [ ] If no messages have timestamps, falls back to `new Date().toISOString()` (existing behavior preserved)
  - [ ] `buildUserPrompt()` includes `[timestamp]` prefix on messages that have timestamps (e.g., `[2023-05-08T14:00:00Z] user: I moved yesterday`)
  - [ ] Messages without timestamps render as before (e.g., `user: hello`)
  - [ ] `Extractor` interface in `src/core/interfaces.ts` updated: `referenceTimestamp` parameter changed from optional to required
  - [ ] `referenceTimestamp` parameter is required (not optional) in `LocalExtractor.extract()` and `buildExtractionPrompt()` — the pipeline step is the single resolution point
  - [ ] Redundant `new Date()` defaults removed from `extractor.extract()` and `buildExtractionPrompt()`
  - [ ] `IngestOptions` in `src/core/types.ts` updated: add explicit `referenceTimestamp?: string` field (compile-time safety for callers)
  - [ ] All existing extractor tests updated and passing (referenceTimestamp now required) — includes mock extractors in `tests/memory/orchestrator/ingest.test.ts` and `tests/e2e/memory-pipeline.test.ts`
  - [ ] New test: extract with timestamped messages uses latest message timestamp as reference
  - [ ] New test: extract with no timestamps falls back to provided referenceTimestamp
  - [ ] Full test suite passes (706+ tests)
- **Testing approach:** Unit tests for the new `deriveTimestamp()` helper, updated extractor tests for required `referenceTimestamp`, and integration verification that the full ingest pipeline correctly derives timestamps.
- **QA:** N/A
- **Planned commits:**
  1. `fix: auto-derive referenceTimestamp from message timestamps` — add `deriveTimestamp()` helper to `ingest.ts`, update `extractFactsStep` to use it, rename `_options` to `options` in `orchestrator/index.ts` (no longer unused)
  2. `feat: include message timestamps in extraction prompt` — update `buildUserPrompt()` in `extractor/index.ts` to prefix timestamps
  3. `refactor: make referenceTimestamp required in extractor API` — remove optional/default from `extractor.extract()` and `buildExtractionPrompt()`, update all callers and tests
- **Technical notes:**
  - **Three-tier resolution:** `referenceTimestamp` resolves as: (1) explicit value from `IngestOptions` (set by caller or hook), (2) `deriveTimestamp(messages)` (latest message timestamp), (3) `new Date().toISOString()` (fallback). The explicit option must NOT be overridden by `deriveTimestamp()`.
  - `deriveTimestamp()` scans messages from last to first, returns the first (latest) `message.timestamp` found, or `new Date().toISOString()` if none have timestamps. This is O(n) worst case but conversations are small.
  - The `buildUserPrompt()` change is backward-compatible: messages without timestamps render exactly as before (no `[]` prefix).
  - Making `referenceTimestamp` required in `extractor.extract()` is a breaking change to the `Extractor` interface in `src/core/interfaces.ts:85`. Update the interface and all implementations/callers.
  - **`IngestOptions` type safety:** Currently `{ readonly [key: string]: unknown }` — add an explicit `referenceTimestamp?: string` field so callers get compile-time checking. The open index signature remains for other pass-through options.
  - The `storeAsync()` -> `IngestQueue.processNext()` path benefits automatically IF the caller originally included timestamps on messages. The conversation DB persists `Message.timestamp` and `processNext()` reads it back. Today no production caller passes timestamps (column is always NULL), so this benefit is future-only — it activates once Claude Code / Pi.dev hooks start including timestamps.
  - **Test sites needing updates:** `tests/memory/extractor/extractor.test.ts` (~25 calls omit timestamp), `tests/memory/orchestrator/ingest.test.ts:47` (mock Extractor takes no args), `tests/e2e/memory-pipeline.test.ts:48` (calls `extractor.extract(conversation)` without timestamp).
  - **Note for LOCOMO:** `deriveTimestamp()` alone is insufficient for LOCOMO because LOCOMO messages lack per-message timestamps (only `session.metadata.date` exists). Story 2's explicit `referenceTimestamp` passthrough via `IngestOptions` is the actual fix for LOCOMO. `deriveTimestamp()` fixes the production `storeAsync()` path where messages DO have timestamps.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Fix LOCOMO hook timestamp passthrough and verify
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** the LOCOMO hook (Pristine benchmark provider) to pass session dates to the extractor, **so that** temporal facts are extracted with correct 2023 dates instead of 2026.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Pristine provider calls `client.orchestrator.ingest()` instead of `client.store()`, passing `{ referenceTimestamp: session.metadata.date }` via IngestOptions
  - [ ] Verification run with `--limit 2`: extracted facts have `validFrom` dates in 2023 (matching LOCOMO conversation dates), not 2026
  - [ ] Search results for temporal questions include memories with correct date context
  - [ ] Non-temporal sessions (no metadata.date) still work (falls back to message timestamps or "now")
- **Testing approach:** Run `npx tsx src/index.ts run -p pristine -b locomo -r verify-timestamps --limit 2 --force`, inspect checkpoint for validFrom dates. Compare against the pre-fix run where all validFrom dates were 2026.
- **QA:**
  - Lou: Inspect search results — verify validFrom dates match LOCOMO session dates (2023), not today's date.
- **Planned commits:**
  1. `fix: pass LOCOMO session date as referenceTimestamp in pristine provider` — change provider to use `orchestrator.ingest()` with session metadata date
  2. `docs: document timestamp fix verification results` — update sprint completion section
- **Technical notes:**
  - The provider currently calls `client.store(messages, containerTag)` which has no way to pass `referenceTimestamp`. Switch to `client.orchestrator.ingest(messages, containerTag, { referenceTimestamp: sessionDate })`.
  - The `orchestrator` property is public on `PristineLocal` — no API changes needed.
  - LOCOMO session dates are in `session.metadata.date` as ISO strings (e.g., `"2023-05-08T13:56:00.000Z"`).
  - If `session.metadata.date` is undefined, omit `referenceTimestamp` from options — the pipeline will derive from message timestamps (Story 1's fix) or fall back to "now".
  - **Note:** The provider passes `containerTag` as the `userId` parameter to `orchestrator.ingest()`. This is pre-existing behavior from the current `client.store()` call — each conversation gets its own isolated namespace via containerTag. Not a new issue.
  - LOCOMO has per-session dates, not per-message timestamps. Every message in a session happened during the same session, so the session date is the correct anchor for all messages.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Fix Pristine provider DB path segregation and --force contract
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** each benchmark run's Pristine DBs stored in an isolated per-run folder with a clean `--force` contract, **so that** re-runs start with fresh extraction data and runs don't silently share state.
- **Dependencies:** None (can run in parallel with Stories 1 and 2, but recommended before Story 2 to ensure clean verification runs)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Pristine provider stores DBs at `data/pristine-dbs/{dataSourceRunId}/conv-{conversationId}.db` (separate namespace from memorybench's `data/runs/`, keyed on `dataSourceRunId` NOT `runId`)
  - [ ] `dataSourceRunId` is passed explicitly from orchestrator to provider via `ProviderConfig` (not parsed from containerTag)
  - [ ] `Provider` interface extended with optional `purgeRunData?(dataSourceRunId: string): Promise<void>` method
  - [ ] Pristine provider implements `purgeRunData()` by deleting `data/pristine-dbs/{dataSourceRunId}/` and disposing any cached clients for that run
  - [ ] Filesystem and RAG providers MAY implement `purgeRunData()` (clear their respective stores) but are not required to
  - [ ] `--force` path reads the OLD `dataSourceRunId` from the existing checkpoint BEFORE `checkpointManager.delete(runId)`, stores it in a local variable, then passes that captured value to `provider.purgeRunData?()` AFTER `provider.initialize()` completes (the old dataSourceRunId is lost once the checkpoint is deleted)
  - [ ] `initialize()` is idempotent: if called a second time with a different `dataSourceRunId` and the clients Map is non-empty, disposes all existing clients first
  - [ ] Provider class has `private dataSourceRunId: string | null = null` with runtime guard in `getDbPath()` — throws clear error if called before `initialize()`
  - [ ] Run `grep -r "getProviderConfig" benchmarks/memorybench/src/` and update ALL call sites (not just the one at line 276) to pass the new `dataSourceRunId` argument
  - [ ] `parseContainerTag` method removed (no longer used for path derivation)
  - [ ] **Verification run:** run `baseline-v1 --force` twice with different extraction models (llama3.2:3b then gemma4:e4b). Inspect the DB memories via `sqlite3 data/pristine-dbs/baseline-v1/*.db "SELECT text FROM memories LIMIT 10"`. Second run must show gemma4-quality extractions (structured facts), NOT llama3.2 fragments.
  - [ ] Unit test: `purgeRunData()` deletes the correct folder and disposes clients
  - [ ] Unit test: `initialize()` called twice with different `dataSourceRunId` disposes old clients
  - [ ] Unit test: filesystem and rag providers unaffected by new `dataSourceRunId` param (existing tests still pass)
  - [ ] Framework compiles: `npx tsc --noEmit` passes
  - [ ] Migration note: existing runs in `data/runs/default/` documented as safe to delete in sprint completion
- **Testing approach:** Unit tests for the path derivation and `purgeRunData()` behavior. Integration test: run `--force` twice with different extraction models, verify the DB contents differ between runs. Existing provider tests (filesystem, rag) should continue passing.
- **QA:**
  - Lou: After Story 2's verification run, check `ls data/pristine-dbs/` — should see a folder per run ID. Old `data/runs/default/` folder (if exists) should be deletable.
- **Planned commits:**
  1. `fix: thread dataSourceRunId to provider via ProviderConfig and isolate DB namespace` — update `getProviderConfig(providerName, dataSourceRunId)` signature, update orchestrator to pass `checkpoint.dataSourceRunId`, update Pristine provider to store `this.dataSourceRunId` and use it directly for DB path (`data/pristine-dbs/{dataSourceRunId}/`). Remove `parseContainerTag`.
  2. `feat: add Provider.purgeRunData for --force cleanup contract` — extend `Provider` interface with optional `purgeRunData?(dataSourceRunId)`. Pristine implements it (rm -rf isolated folder + dispose clients). Orchestrator calls it after `checkpointManager.delete(runId)`.
  3. `test: verify DB path isolation and --force cleanup` — unit + integration tests
- **Technical notes:**
  - **The bug:** `parseContainerTag` uses regex `^conv-(\d+)-(.+)$` which assumes numeric conversationIds. But LOCOMO `sample_id` is `"conv-26"` (letters + digits), so containerTag `"conv-conv-26-baseline-v1"` fails the regex. Fallback returns `runId = "default"`, causing all runs to share `data/runs/default/`.
  - **Why parsing is fundamentally broken:** containerTag format is `conv-{conversationId}-{runId}`. Both fields can contain hyphens. Without a unique delimiter, parsing is ambiguous. Passing `dataSourceRunId` explicitly is the only robust fix.
  - **`runId` vs `dataSourceRunId`:** The orchestrator at `benchmarks/memorybench/src/orchestrator/index.ts:264` builds containerTag from `checkpoint.dataSourceRunId`, NOT `checkpoint.runId`. These diverge when checkpoints are copied (see `orchestrator/checkpoint.ts:343`). Ingested data intentionally survives checkpoint copies to avoid re-ingesting when only judge/answering model changes. Therefore the provider MUST key DBs on `dataSourceRunId`. Using `runId` would break checkpoint copy semantics.
  - **Why isolated namespace (`data/pristine-dbs/` not `data/runs/{dataSourceRunId}/`):** Memorybench's `CheckpointManager` owns `data/runs/{runId}/` (stores `checkpoint.json` and `results/`). If Pristine DBs go there, `--force` cleanup races with `checkpointManager.delete(runId)`. Separate namespace eliminates the race and makes ownership unambiguous.
  - **The fix implementation:**
    1. Modify `getProviderConfig(providerName)` in `benchmarks/memorybench/src/utils/config.ts` to accept `(providerName, dataSourceRunId)`. Extend the return type with `dataSourceRunId?: string` (via the `[key: string]: unknown` index signature on `ProviderConfig`).
    2. Modify orchestrator at `benchmarks/memorybench/src/orchestrator/index.ts` (around line 276) to pass `checkpoint.dataSourceRunId`: `await provider.initialize(getProviderConfig(providerName, checkpoint.dataSourceRunId))`.
    3. In Pristine provider `initialize(config)`, read `config.dataSourceRunId`, store as `this.dataSourceRunId`. If previously initialized with a different value, loop over `this.clients` Map and call `dispose()` on each, then clear the Map.
    4. Change `getDbPath(containerTag)` to use `this.dataSourceRunId` directly. Path becomes `join(process.cwd(), "data", "pristine-dbs", this.dataSourceRunId, sanitize(containerTag) + ".db")`.
    5. Add `purgeRunData(dataSourceRunId)` method: dispose clients, `rmSync` the folder.
  - **--force cleanup sequencing (subtle!):** The current code at `benchmarks/memorybench/src/orchestrator/index.ts:129-132` does `if (force && this.checkpointManager.exists(runId)) this.checkpointManager.delete(runId)` BEFORE creating the new checkpoint. After delete-then-create, `checkpoint.dataSourceRunId` defaults to `runId` (see `CheckpointManager.create` line 125), which loses the OLD `dataSourceRunId`. If a user had a copied checkpoint where `dataSourceRunId !== runId`, the old DB folder is never purged. Correct sequence:
    ```typescript
    // Capture OLD dataSourceRunId before deleting checkpoint
    let oldDataSourceRunId: string | undefined;
    if (force && this.checkpointManager.exists(runId)) {
      const existing = this.checkpointManager.load(runId);
      oldDataSourceRunId = existing?.dataSourceRunId;
      this.checkpointManager.delete(runId);
    }
    // ... later, after provider.initialize() at line ~276:
    if (force && oldDataSourceRunId) {
      await provider.purgeRunData?.(oldDataSourceRunId);
    }
    ```
    This guarantees we purge the folder that actually held the old DBs, not a folder named after the (possibly different) runId.
  - **Runtime guard for `dataSourceRunId`:** Declare `private dataSourceRunId: string | null = null`. In `getDbPath()` and `getOrCreateClient()`, check `if (!this.dataSourceRunId) throw new Error("Pristine provider not initialized. Call initialize() first.")`. This catches misuse at the boundary instead of producing paths like `data/pristine-dbs/null/...`.
  - **grep callers:** `getProviderConfig` is called from orchestrator's `run()` method. Run `grep -rn "getProviderConfig" benchmarks/memorybench/src/` before implementation to catch any other call sites (e.g., test files, batch.ts for compare workflow). All must pass the new `dataSourceRunId` argument (with sensible fallback where appropriate).
  - **Migration note:** Existing runs in `data/runs/default/` (from prior broken behavior) can be safely deleted with `rm -rf data/runs/default/`. Document this in sprint completion so Lou knows the cleanup step.
- **Priority:** Must-have (blocks baseline run)
- **Owner:** Coding Agent

#### Story 4: Document hook timestamp contract
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer integrating Pristine with a chat system, **I want** clear documentation on how hooks should pass timestamps, **so that** temporal extraction works correctly.
- **Dependencies:** Stories 1, 2, 3
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] **README.md** updated with a "Hook Timestamp Contract" section explaining: (1) why timestamps matter for extraction, (2) the two patterns (per-message via `Message.timestamp`, per-session via `referenceTimestamp` IngestOption), (3) hook table showing known integration points and where timestamps live in each source
  - [ ] `docs/agent-integration.md` updated with detailed timestamp guidance: the `Message.timestamp` field, the `referenceTimestamp` IngestOption, and the three-tier resolution chain
  - [ ] Hook table includes: Claude Code (transcript_path), Pi.dev (session events), LOCOMO (session metadata) — with status of each (LOCOMO: implemented, others: documented for future implementation)
  - [ ] LOCOMO provider documented as a reference implementation for per-session timestamp passthrough
- **Testing approach:** Documentation review only. No code changes.
- **QA:** N/A
- **Planned commits:**
  1. `docs: document hook timestamp contract in README and agent-integration` — add hook timestamp contract to README.md, update agent-integration.md with timestamp guidance and hook table
- **Technical notes:**
  - The documentation should cover both patterns: (1) per-message timestamps (Claude Code, Pi.dev — each message has its own timestamp), and (2) per-session timestamps (LOCOMO — all messages in a session share one date, passed via `referenceTimestamp` IngestOption).
  - Claude Code timestamps are at `entry.timestamp` in the `.jsonl` transcript at `transcript_path`.
  - Pi.dev timestamps are at `entry.timestamp` in the session `.jsonl` at `~/.pi/agent/sessions/`.
  - Timestamp format: ISO 8601 UTC (e.g., `"2026-04-16T05:29:11.000Z"`). All timestamps should use the Z suffix.
  - **Out of scope:** Creating `hooks/` directory with ready-to-use Claude Code / Pi.dev integration files. Tracked as a follow-up sprint.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 5: Provider lifecycle — shutdown and client disposal
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer running the benchmark, **I want** providers to cleanly dispose resources at the end of each run, **so that** SQLite connections don't leak and WAL files flush properly.
- **Dependencies:** Story 3 (uses the same Provider interface extension path)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `Provider` interface extended with optional `shutdown?(): Promise<void>` method
  - [ ] Pristine provider implements `shutdown()`: iterates `this.clients` Map, calls `dispose()` on each `PristineLocal` client, clears the Map
  - [ ] Filesystem and RAG providers MAY implement `shutdown()` as no-op (interface is optional)
  - [ ] Orchestrator's `Orchestrator.run()` calls `await provider.shutdown?()` in a `finally` block wrapping the main phase execution
  - [ ] SIGINT/SIGTERM handling: process hooks call `provider.shutdown?()` before exit via a module-level provider registry in `orchestrator/index.ts` (see technical notes for the pattern)
  - [ ] Module-level `currentProvider: Provider | null` in `orchestrator/index.ts` — set in `run()` before the phase execution, cleared in `finally`. SIGINT handler imports and reads it.
  - [ ] SIGINT handler location: `benchmarks/memorybench/src/index.ts` (process entry) — registers `process.on('SIGINT', ...)` and `process.on('SIGTERM', ...)` that call `currentProvider?.shutdown?.()` and then `process.exit(130)` (standard SIGINT exit code)
  - [ ] Unit test: `shutdown()` disposes all cached clients
  - [ ] Unit test: calling `shutdown()` twice is idempotent (no double-dispose errors)
  - [ ] Integration test: after a full `run -p pristine --limit 1`, verify no `.db-wal` or `.db-shm` files remain (clean WAL checkpoint happened)
  - [ ] Framework compiles: `npx tsc --noEmit` passes
- **Testing approach:** Unit tests for shutdown behavior. Integration test verifies WAL cleanup after run completion. Manual: run + SIGINT mid-run, verify DB is not corrupted (can still open + query).
- **QA:** N/A
- **Planned commits:**
  1. `feat: add Provider.shutdown lifecycle method` — extend Provider interface with `shutdown?()`. Update Pristine provider to implement it (dispose all cached clients).
  2. `feat: call provider.shutdown in orchestrator run() finally block` — wrap the phase execution in try/finally in `Orchestrator.run()`.
  3. `feat: add SIGINT/SIGTERM handlers for graceful shutdown` — process-level handlers call provider.shutdown before exit.
- **Technical notes:**
  - **Current state:** Pristine provider caches clients in `this.clients = new Map<string, PristineLocal>()`. `clear(containerTag)` disposes ONE client. No method disposes all.
  - **Why this matters:** SQLite in WAL mode holds file locks + uncommitted writes in the WAL journal. Without a clean close, WAL checkpoint doesn't happen, leaving `.db-wal` and `.db-shm` files. Next open may replay the WAL (usually fine) but can corrupt on crash.
  - **SIGINT handling pattern:** Node's signal handlers run outside the scope of `Orchestrator.run()`, so they can't access the local `provider` variable. Use a module-level registry:
    ```typescript
    // benchmarks/memorybench/src/orchestrator/index.ts
    let currentProvider: Provider | null = null;
    export function getCurrentProvider(): Provider | null { return currentProvider; }

    // inside Orchestrator.run():
    const provider = createProvider(providerName);
    await provider.initialize(...);
    currentProvider = provider;
    try {
      // phases
    } finally {
      await provider.shutdown?.();
      currentProvider = null;
    }

    // benchmarks/memorybench/src/index.ts (process entry)
    import { getCurrentProvider } from "./orchestrator";
    const handleSignal = async (signal: string) => {
      const provider = getCurrentProvider();
      if (provider) {
        try { await provider.shutdown?.(); } catch { /* best-effort */ }
      }
      process.exit(signal === "SIGINT" ? 130 : 143);
    };
    process.on("SIGINT", () => void handleSignal("SIGINT"));
    process.on("SIGTERM", () => void handleSignal("SIGTERM"));
    ```
  - **Known limitations (document, don't fix):** SIGKILL cannot be trapped. If `better-sqlite3` is mid-synchronous-call when SIGINT arrives, the handler still runs but the in-flight write may be incomplete (SQLite WAL recovery handles this on next open). Power loss is unhandled. These are acceptable because better-sqlite3's WAL journaling recovers correctly on next open in practice.
  - **Interaction with Story 3's `purgeRunData`:** Both are lifecycle methods on `Provider`. Document them together in the interface with a brief comment: "`purgeRunData` wipes persisted data for a specific run (called on --force); `shutdown` releases in-memory resources (called at end of run or on signal)."
  - **File touches:** `benchmarks/memorybench/src/types/provider.ts` (interface), `benchmarks/memorybench/src/providers/pristine/index.ts` (impl), `benchmarks/memorybench/src/orchestrator/index.ts` (call site), `benchmarks/memorybench/src/index.ts` (SIGINT handlers at process entry).
- **Priority:** Must-have (prevents SQLite corruption across runs)
- **Owner:** Coding Agent

#### Story 6: Detect silent no-op ingestions
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer running the benchmark, **I want** loud warnings and a fail-fast path when ingest silently produces zero new memories, **so that** contaminated runs are detected instead of silently producing misleading baseline numbers.
- **Dependencies:** Story 3 (DB path fix reduces but doesn't eliminate this risk)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Pristine provider checks `result.memoryIds.length` after each `orchestrator.ingest()` call. If zero AND the session had non-empty messages, logs a warning with the session ID, conversation ID, and the cause (`duplicateDetected` vs other)
  - [ ] `IngestResult` in `benchmarks/memorybench/src/types/provider.ts` extended with optional `memoryCount?: number` field — populated by providers that know this information (Pristine), ignored by others (filesystem, rag)
  - [ ] Pristine provider populates `result.memoryCount` from `pristineResult.memoryIds.length` before returning
  - [ ] `IngestPhaseCheckpoint` in `benchmarks/memorybench/src/types/checkpoint.ts` extended with `memoryCount?: number` field — semantically a **per-conversation** total: sum of memories created across all sessions of that question's conversation (the checkpoint is keyed per-question; per-conversation value is duplicated across all questions sharing the conversation since we dedupe at the conversation level)
  - [ ] Ingest phase reads `provider_result.memoryCount` returned per session, SUMS across all sessions for the conversation, writes the sum to checkpoint
  - [ ] Existing ingest tests that assert on `IngestResult` shape (e.g., `toStrictEqual({ documentIds: [...] })`) are updated to allow the new optional `memoryCount` field — prefer `toMatchObject` or explicit omission
  - [ ] If the entire ingest phase completes with 0 memories across all conversations (via checkpoint aggregate), the run exits with a clear error: `"Ingest produced 0 memories across all conversations. This usually means stale DBs or content-hash duplicate detection. Run with --force to reset."`
  - [ ] `show-failures` CLI command displays the memoryCount for failed or suspicious questions
  - [ ] Unit test: provider with a mock orchestrator that returns `{ memoryIds: [], errors: [] }` logs a warning
  - [ ] Unit test: provider returns `IngestResult.memoryCount` correctly populated
  - [ ] Unit test: orchestrator aborts the run if total memory count across all ingested sessions is zero
  - [ ] Framework compiles: `npx tsc --noEmit` passes
- **Testing approach:** Unit tests for the warning path and fail-fast check. Integration: run `--force` twice without cleaning DBs (simulating the bug we hit). Second run should now fail loudly instead of silently reusing old data.
- **QA:**
  - Lou: Inspect the warning output in a deliberately contaminated run (old DBs + `--force` simulated bug). Warning should be prominent and informative.
- **Planned commits:**
  1. `feat: Pristine provider warns on silent no-op ingestion` — add memoryIds.length check after orchestrator.ingest, log warning
  2. `feat: track memoryCount in IngestPhaseCheckpoint` — extend checkpoint type, populate in ingest phase, surface in show-failures
  3. `feat: fail-fast when ingest produces zero memories across run` — orchestrator checks aggregate memoryCount, aborts with clear error
- **Technical notes:**
  - **The silent dedup bug:** Pristine's conversation store has a UNIQUE index on `(user_id, content_hash)`. When the same conversation messages are ingested twice with the same `userId` (which in the benchmark is `containerTag`), the second attempt hits `duplicateDetected=true` at `src/memory/orchestrator/ingest.ts:299-301`. The pipeline then skips extract/embed/consolidate/store, returning `{ memoryIds: [] }` silently.
  - **Why this is dangerous:** The benchmark interprets success as "ingest call did not throw". It has no signal that extraction was skipped. Test runs look correct but use whatever extraction model first created the memories — not the currently configured model.
  - **Where to detect:** The Pristine provider receives the `IngestResult` from `orchestrator.ingest()`. Check `result.memoryIds.length === 0` and the session messages were non-empty.
  - **Fail-fast threshold:** Exactly zero memories across all ingested sessions is almost certainly a bug (even poor extraction produces SOMETHING). A single zero-memory session may be legitimate (e.g., a very short session). Only fail when the AGGREGATE is zero.
  - **Checkpoint extension:** `IngestPhaseCheckpoint` in `benchmarks/memorybench/src/types/checkpoint.ts:24-32` currently tracks `completedSessions: string[]` and `ingestResult?: IngestResult`. Add `memoryCount?: number`.
  - **`IngestResult` type extension:** The memorybench `IngestResult` at `benchmarks/memorybench/src/types/provider.ts:24-27` currently has `{ documentIds: string[], taskIds?: string[] }`. Add optional `memoryCount?: number`. This is the provider-agnostic channel for surfacing memory counts to the ingest phase. Non-Pristine providers omit the field; ingest phase treats missing as 0 for aggregation (logs different message: "no memoryCount reported by provider").
  - **Alternative considered:** Instead of extending `IngestResult`, the ingest phase could query the provider via a new method like `getMemoryCount(containerTag)`. Rejected: more round-trips, more interface surface, same outcome. The `IngestResult` channel is simpler.
- **Priority:** Must-have (required to trust baseline numbers)
- **Owner:** Coding Agent

#### Story 7: Partial-ingest recovery
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer whose Ollama hangs mid-session during a long benchmark run, **I want** the retry to either complete the session cleanly or produce a clear error, **so that** partial-ingest doesn't silently corrupt the extracted corpus.
- **Dependencies:** Stories 3, 5, 6
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] **Approach: Option B (benchmark-side duplicate-check + delete).** Option A (core transactional pipeline) is deferred and tracked as a follow-up GitHub issue.
  - [ ] **Pristine core API additions:** `ConversationStore` in `src/conversations/store.ts` exposes `findByHash(userId: string, contentHash: string): ConversationRecord | null` and `deleteById(id: string): void` methods. These don't exist today — confirmed via grep. The `computeHash` function used internally by `addConversation` must also be exported (or the finder must compute the same hash internally) so the benchmark provider can look up the exact row.
  - [ ] Pristine public API surface: `PristineLocal.conversationStore` is already accessible (or is made accessible via a narrow method) so the benchmark provider can call these new methods
  - [ ] Before calling `orchestrator.ingest()`, the Pristine benchmark provider checks the conversation store: if a conversation with matching `(userId, content_hash)` exists AND has zero associated memories, the provider deletes the conversation row and re-ingests fresh
  - [ ] If the conversation exists WITH associated memories, the provider skips the ingest (this is a legitimate idempotent re-run, not partial data)
  - [ ] If the conversation does NOT exist, the provider proceeds normally
  - [ ] Ollama request timeout configured (default 120s per LLM call). Timed-out requests throw a clear `AppError` with message `"Ollama request timed out after {N}ms for model {model}"`. This prevents the indefinite hang pattern we observed in Sprint 008a.
  - [ ] Timeout is configurable via `ProviderConfig.ollamaTimeoutMs` (passed through from `models.json` or IngestOptions)
  - [ ] Unit test: mock conversation store returning `{ exists: true, memoryCount: 0 }` — provider deletes and re-ingests
  - [ ] Unit test: mock conversation store returning `{ exists: true, memoryCount: 5 }` — provider skips ingest (idempotent)
  - [ ] Unit test: Ollama mock that hangs indefinitely — timeout fires at configured threshold, throws clear error
  - [ ] Manual/integration test: run `--limit 3` with Ollama manually killed during session 2's extraction. Resume. Verify session 2 completes cleanly on retry (not silently skipped).
  - [ ] A GitHub issue is filed titled "Option A: make Pristine ingest pipeline transactional" with link back to this story's context
  - [ ] Framework compiles: `npx tsc --noEmit` passes
- **Testing approach:** Unit tests for the three code paths (not-exists, exists-empty, exists-populated) + Ollama timeout. Integration test: simulated mid-session failure and resume.
- **QA:**
  - Lou: Run `baseline-v1` with Ollama. If a session takes > 3 min, note it. If Ollama hangs on a specific session, kill + resume and verify clean behavior.
- **Planned commits:**
  1. `feat: add Ollama request timeout to prevent indefinite hangs` — config-driven timeout in Pristine's OllamaClient. Default 120s. Throws `AppError` with clear message on timeout.
  2. `feat: add ConversationStore.findByHash and deleteById to Pristine core` — prerequisite for Option B; adds narrow methods to `src/conversations/store.ts`, exposes via PristineLocal
  3. `fix: benchmark provider detects partial-ingest and cleanly re-ingests` — Option B implementation using the new ConversationStore methods
  4. `test: verify partial-ingest recovery and Ollama timeout handling`
  5. `chore: file follow-up issue for Option A transactional ingest pipeline` — just opens the GitHub issue; no code change
- **Technical notes:**
  - **The bug:** Pristine's `orchestrator.ingest()` pipeline has multiple steps: `storeUser` (insert conversation) -> `extract` (call LLM) -> `embed` -> `consolidate` -> `store`. If `extract` throws (Ollama timeout), the conversation was already inserted by `storeUser`. On retry, `storeUser` detects the duplicate via content_hash and sets `duplicateDetected=true`, which skips all subsequent steps. Net result: extraction never happens, no memories are created, no error surfaces (Story 6 catches the zero-memory state but doesn't fix it — this story does).
  - **Why Option B, not Option A:** Option A (transactional pipeline) is architecturally cleaner but has large surface area — it touches `src/memory/orchestrator/ingest.ts`, the pipeline runner, and introduces rollback semantics that affect every Pristine consumer. Option B is localized to the benchmark provider, has a small diff, and unblocks the baseline run. The bug still exists in Pristine core for other SDK consumers, but they can apply the same check pattern until Option A lands. Option A is filed as a follow-up issue.
  - **Option B implementation sketch:**
    ```typescript
    // In PristineProvider.ingest(sessions, options):
    for (const session of sessions) {
      const messages = mapToMessages(session);
      const contentHash = computeHash(messages);  // Same hash as Pristine's conversation store
      const existing = await client.conversationStore.findByHash(options.containerTag, contentHash);
      if (existing && existing.memoryCount === 0) {
        await client.conversationStore.deleteById(existing.id);
      }
      if (existing && existing.memoryCount > 0) {
        continue;  // idempotent re-run, skip
      }
      await client.orchestrator.ingest(messages, options.containerTag, { referenceTimestamp: sessionDate });
    }
    ```
  - **Pristine core API surface:** The provider needs `ConversationStore.findByHash(userId, contentHash)` and `.deleteById(id)`. Check if these exist; if not, expose them from PristineLocal. Prefer adding narrow methods rather than raw DB access.
  - **Ollama timeout:** The hang we observed during Sprint 008a was 10+ minutes on a 39-message session with llama3.2:3b. Pristine's `OllamaClient` (at `src/engine/ollama/index.ts`) should accept a timeout option via `AbortController`. Default: 120s per LLM call (configurable via models.json or IngestOptions). Wrap the `fetch` call with `AbortSignal.timeout(ms)`.
- **Priority:** Must-have (prevents silent data loss on Ollama timeout — which happens in practice)
- **Owner:** Coding Agent

#### Story 8a: Documentation and build ergonomics
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer running the benchmark for the first time, **I want** the documented setup steps to actually work without hitting undocumented gotchas, **so that** I can iterate quickly instead of debugging integration issues.
- **Dependencies:** Stories 1-7
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `benchmarks/memorybench/README.md` explicitly documents: (1) Bun is NOT supported due to better-sqlite3 ABI incompatibility — use `npx tsx`, (2) `npm run build` must be run at the repo root before the benchmark (so `dist/` exists for the `file:` dependency), (3) run from repo root OR `cd benchmarks/memorybench && ...` (CWD sensitivity explained)
  - [ ] `benchmarks/memorybench/package.json` has a `prebench` script OR `prestart` that runs `npm run build` in `../../` (automates the build prerequisite)
  - [ ] LOCOMO provider documents the role-mapping bias (speakerA → user, speakerB → assistant) in a comment in `benchmarks/memorybench/src/benchmarks/locomo/index.ts`, explaining that extraction may be biased toward user-side facts (speakerA's facts are surfaced more prominently than speakerB's in Pristine's extraction prompt)
  - [ ] Migration note in `benchmarks/memorybench/README.md`: existing in-flight `baseline-v1` or similar runs must be `--force` re-run after Story 3 lands (DB path changed). Include the explicit cleanup command: `rm -rf data/runs/default/ data/runs/{old-run-ids}/`
  - [ ] On resume, Pristine provider checks if the referenced DB path exists in the checkpoint. If not (migration case), logs a clear warning: `"DB path {path} not found. This checkpoint predates Story 3 and cannot be resumed. Run with --force to reset."`
- **Testing approach:** Documentation + script review. Manually verify README steps produce a working first run on a clean machine (`rm -rf data/pristine-dbs/ node_modules/ benchmarks/memorybench/node_modules/` then follow README).
- **QA:**
  - Lou: Follow the README steps on a fresh state. Verify the benchmark runs without manual intervention beyond the documented commands.
- **Planned commits:**
  1. `docs: document Bun incompatibility, build prerequisite, and CWD sensitivity` — README updates
  2. `chore: add prebench script to build Pristine automatically` — memorybench package.json
  3. `docs: add LOCOMO role-mapping bias note + checkpoint migration warning` — comment in locomo/index.ts + README migration section + provider warning on missing DB path
- **Technical notes:**
  - **Bun incompatibility:** Known issue: better-sqlite3 native addon doesn't work in Bun (oven-sh/bun#4290). Also breaks `bun test` for any code that imports Pristine. Document explicitly; don't try to work around it.
  - **prebench script:** `"prebench": "cd ../.. && npm run build"` — runs automatically before `npm run bench` (or whatever the entry is). Verify the script works on both macOS and Linux (POSIX `cd` works; don't use Windows-specific syntax).
  - **Role-mapping bias:** LOCOMO's `speakerA → "user"` mapping at `benchmarks/memorybench/src/benchmarks/locomo/index.ts:162-164` is arbitrary — both speakers are humans in a peer-to-peer chat. Pristine's extraction prompt treats "user" turns as the primary subject, so facts about speakerA are extracted more directly than facts about speakerB. Acceptable for now (results still meaningful); document explicitly so future contributors don't chase ghost bugs.
  - **Migration warning:** Users with pre-Story-3 checkpoints have DB paths pointing to `data/runs/default/` (the broken shared folder). On resume, attempting to open these paths fails. Warn clearly; don't silently recreate.
- **Priority:** Must-have (first-run reliability is critical for onboarding)
- **Owner:** Coding Agent

#### Story 8b: Defensive hardening
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer iterating on the benchmark, **I want** defensive guardrails that catch configuration mistakes, unsafe casts, and silent data reuse, **so that** bugs fail loudly instead of silently producing misleading results.
- **Dependencies:** Stories 1-7
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Pristine provider warns when concurrency > 1 is set (Ollama is single-stream for llama3/gemma; concurrency just adds latency): `"Warning: Pristine provider with concurrency > 1 may not improve throughput when using Ollama as the LLM backend."`
  - [ ] Pristine provider writes a `metadata.json` stamp file at `data/pristine-dbs/{dataSourceRunId}/metadata.json` with `{ createdAt, extractionModel, benchmark, pristineSha? }`. On initialize:
    - If folder exists AND metadata.json exists AND model mismatches → warn: `"Reusing DB folder created at {date} with model {model}. Pass --force to reset."`
    - If folder exists AND metadata.json is MISSING (legacy/cold-start case) → log info, write fresh stamp, proceed (don't warn — user didn't do anything wrong)
    - If folder doesn't exist → create folder, write stamp, proceed
  - [ ] Pristine provider logs a warning if an incoming LOCOMO session has no `metadata.date` (expected to always be present per Sprint 008c Story 2). Surfaces silent regressions in the LOCOMO loader.
  - [ ] Answer phase input validated at the boundary where search results flow into the prompt: the `PristineResult` cast at `benchmarks/memorybench/src/providers/pristine/prompts.ts:10-11` is replaced with a zod schema parse. Invalid shape throws a clear error (not a silent downstream bug).
  - [ ] End-to-end test: `-m ollama:gemma4:e4b` format parses correctly through `resolveModel()`, `getModelConfig()`, and the Ollama client. Verify the model string is NOT truncated or split at the second colon.
  - [ ] Unit test for metadata.json cold-start (missing file) path
  - [ ] Unit test for metadata.json model-mismatch warning
  - [ ] Unit test for the zod schema rejecting malformed context
  - [ ] Framework compiles: `npx tsc --noEmit` passes
- **Testing approach:** Unit tests for each defensive check. Integration: run `--force` then run without `--force` in the same dataSourceRunId with a different model — verify warning fires.
- **QA:**
  - Lou: After Story 8b lands, intentionally pass `--concurrency 4 -p pristine` and verify the warning fires.
- **Planned commits:**
  1. `feat: warn on Pristine provider concurrency > 1 with Ollama backend`
  2. `feat: add metadata.json stamp to Pristine DB folder for config-mismatch defense`
  3. `feat: warn when LOCOMO session metadata.date is missing`
  4. `refactor: validate answer phase context with zod at the boundary`
  5. `test: end-to-end test for ollama:<model> format parsing through resolveModel and OllamaClient`
- **Technical notes:**
  - **Concurrency warning:** Check `config.concurrency?.default` or `config.concurrency?.ingest` in the Pristine provider's `initialize()`. If > 1, log a warning regardless of backend (simpler than detecting Ollama specifically). Pristine with concurrency > 1 against an API-based LLM backend may actually be useful, so soften message: `"Note: concurrency > 1 with Ollama as the LLM backend may not improve throughput (Ollama serializes requests)."`
  - **metadata.json stamp structure:**
    ```json
    {
      "createdAt": "2026-04-16T05:29:11.000Z",
      "extractionModel": "gemma4:e4b",
      "benchmark": "locomo",
      "pristineSha": "abc123..." // optional: git SHA of pristine at run time
    }
    ```
  - **metadata.json cold-start path:** When Story 3's `data/pristine-dbs/{dataSourceRunId}/` folder is freshly created, there's no metadata.json yet. First run writes one. Subsequent runs read it. The missing-metadata case (legacy folder or interrupted first run) should proceed silently with an info log — NOT a warning — because the user didn't cause it.
  - **LOCOMO metadata.date warning:** Add at `benchmarks/memorybench/src/providers/pristine/index.ts` ingest() method: `if (!session.metadata?.date) logger.warn("LOCOMO session ${session.sessionId} missing metadata.date — falling back to deriveTimestamp")`. Signals a regression in the LOCOMO loader without hard-failing.
  - **Answer phase validation (zod):**
    ```typescript
    // benchmarks/memorybench/src/providers/pristine/prompts.ts
    import { z } from "zod";
    const PristineResultSchema = z.object({
      text: z.string(),
      score: z.number(),
      validFrom: z.string().optional(),
      validUntil: z.string().optional(),
    });
    function buildPristineContext(context: unknown[]): string {
      const results = z.array(PristineResultSchema).parse(context);
      // ... existing logic ...
    }
    ```
    zod is already a dependency in memorybench (used by ai-sdk).
  - **ollama:<model> test:** `benchmarks/memorybench/src/utils/models.ts` has `alias.slice("ollama:".length)` — correctly handles `ollama:gemma4:e4b` → `gemma4:e4b`. Test at three levels: (1) `resolveModel("ollama:gemma4:e4b")` returns config with `id: "gemma4:e4b"`, (2) Ollama client initializes with that model ID, (3) a real generate call succeeds (can mock with a test double).
- **Priority:** Must-have (defensive checks for baseline integrity)
- **Owner:** Coding Agent

### Rules
- Follow repo's `CLAUDE.md` for branching, rebase, and PR conventions
- Follow PR template (`.github/PULL_REQUEST_TEMPLATE.md`) when opening PRs
- Branch off `main` after the previous story is merged. Do NOT stack unmerged branches.
- Open a PR per story with: story reference, summary, files changed, testing done
- Run tests + linter locally before pushing
- If `main` has changed since branching: rebase onto latest `main`, re-test, force-push
- If blocked, document the blocker and move to next story
- Do not modify files outside the project directory
- Do not install new dependencies without noting them in completion report
- **Review loop** Open PRs, get Greptile review clean, merge, then move to the next story. Stop once the sprint is completed for Lou to have a final review.

### Definition of Done
- All stories in this sprint are must-have. Stories 1, 2, 4 are already merged. Remaining: 3, 5, 6, 7, 8a, 8b.
- Extractor correctly derives referenceTimestamp from message timestamps (Story 1 ✅)
- Extraction prompt includes per-message timestamps when available (Story 1 ✅)
- LOCOMO hook passes session dates to the extractor (Story 2 ✅)
- Hook timestamp contract documented in README.md (Story 4 ✅)
- Pristine DBs isolated per `dataSourceRunId` in `data/pristine-dbs/` (Story 3)
- `--force` cleanly purges both memorybench checkpoint AND Pristine DBs via `Provider.purgeRunData?()` (Story 3)
- Provider lifecycle methods (`shutdown`, `purgeRunData`) prevent SQLite corruption and resource leaks (Stories 3, 5)
- Silent no-op ingestions detected via warnings + fail-fast + `IngestResult.memoryCount` channel (Story 6)
- Partial-ingest recovery via Option B (benchmark-side duplicate-check) + Ollama timeout (Story 7)
- Bun incompatibility, build prerequisite, CWD sensitivity, LOCOMO role-mapping bias, and migration path documented (Story 8a)
- Defensive checks: concurrency warning, metadata.json stamp, missing-metadata.date warning, zod at answer boundary, ollama:<model> e2e test (Story 8b)
- Verification: running `baseline-v1 --force` twice with different extraction models produces DIFFERENT memory content
- Verification: final baseline extraction is from gemma4:e4b (spot-check facts: structured sentences, not fragments)
- Tests + linter pass (locally and CI)
- One or more commits per story (logical chunks), one PR per story
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`) per repo CLAUDE.md
- All PRs open and Greptile-clean

---

## Completion
*(Filled by coding agent when sprint is done)*

### Summary

### Results
- :white_check_mark: Story 1: Fix temporal extraction timestamp handling — PR #81, merged
- :white_check_mark: Story 2: LOCOMO hook timestamp passthrough — PR #82, merged
- :large_yellow_circle: Story 3: Fix Pristine provider DB path segregation + --force contract — PR #, status
- :white_check_mark: Story 4: Document hook timestamp contract — PR #83, merged
- :large_yellow_circle: Story 5: Provider lifecycle (shutdown) — PR #, status
- :large_yellow_circle: Story 6: Detect silent no-op ingestions — PR #, status
- :large_yellow_circle: Story 7: Partial-ingest recovery — PR #, status
- :large_yellow_circle: Story 8a: Documentation and build ergonomics — PR #, status
- :large_yellow_circle: Story 8b: Defensive hardening — PR #, status

### New Dependencies

### Blockers / Issues

### Carry-Over
- Claude Code and Pi.dev hook implementation (memory store with timestamps, memory search) — aligns with `implementation-spec-004.md` which establishes the `hooks/` directory for per-harness integrations (Claude Code hooks, Pi extensions). The memory hooks should live alongside the secret redaction hooks from spec 004.

### Notes for Next Sprint

---

## Retro
*(Filled by main agent during sprint review)*

- **What went well:**
- **What didn't:**

### Refactoring Opportunities
- :red_circle: **Critical** —
- :yellow_circle: **Good to have** —
- :white_circle: **Ignore** —

### Documentation Updates
- **Backlog:**
- **README / Repo Docs:**
- **Memory:**
- **Playbook Learnings:**
