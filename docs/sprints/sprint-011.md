# Pristine Local — Sprint 011
**Date:** TBD
**Goal:** Add a durable ingest queue with crash recovery and spawn-on-demand workers, and ship CLI scripts so agents can store conversations and search memory via hooks and skills
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3, sqlite-vec
- **Current state:** Sprint 010 complete. OllamaEmbedder added (HTTP-based, configurable via `models.json`), `search()` accepts `SearchOptions` with `temporalMode`. Conversation store, fact extraction pipeline, temporal consolidation, and privacy pipeline all working. 609+ tests passing. The SDK (`PristineLocal`) is feature-complete but only usable as a library — no CLI scripts for agent harness integration. `store()` is synchronous (blocks on the full extract/embed/consolidate pipeline, 8-12s) with no background processing or crash recovery.
- **Implementation spec:** `docs/specs/implementation-spec-003.md` — Phases 5 + 6
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context
- This sprint makes Pristine usable by agent harnesses (Claude Code hooks, Pi extensions). Phase 5 adds a durable ingest queue so `store()` returns instantly while extraction runs in the background. Phase 6 ships the CLI scripts that hooks/skills invoke.
- **Architecture: SQLite outbox + spawn-on-demand worker.** The fast path (`store.ts`) writes conversation + pending task to SQLite atomically and spawns a detached worker process if one isn't already running. The worker polls the `pending_ingest_tasks` table, claims tasks, runs the slow extraction path via Ollama, and exits when the queue is empty and idle for 30s. No persistent daemon — the worker self-terminates. No coordination mechanism (PID files, heartbeats) — if two workers run briefly in parallel, the atomic `claimNext()` prevents double-processing. The outbox table ensures crash recovery: stale `processing` rows are automatically reset on the next claim attempt.
- CLI scripts are stateless TypeScript executables (run via `tsx`) that open SQLite, talk to Ollama, output JSON, and exit. They are the integration surface — agents call these via hooks (store) and skills/tools (search).
- **New dependency:** `p-limit` (1KB, zero deps, 100M+ weekly downloads) for concurrency control on Ollama calls within the worker.
- All scripts use `~/.pristine/data/pristine.db` by default (configurable via `--db-path`), read `~/.pristine/models.json` for engine config.

### Parallelization
Stories are sequential: Story 1 (ingest queue module) → Story 2 (wire into PristineLocal) → Story 3 (CLI store + extract-worker scripts) → Story 4 (CLI search scripts) → Story 5 (integration tests).

### Stories
**Constraints:** Max 5 stories per sprint. Max 5 commits per story. If a story needs 6+ commits during planning, split it.

#### Story 1: Implement durable IngestQueue with SQLite outbox
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
- **As a** developer, **I want** a durable ingest queue backed by SQLite, **so that** pending extractions survive process crashes and are automatically recovered.
- **Dependencies:** None
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/queue/ingest-queue.ts` exports `IngestQueue` class
  - [ ] DDL creates `pending_ingest_tasks` table with status (pending/processing/completed/failed), conversation_id FK, user_id, error, timestamps
  - [ ] `enqueue(conversation, userId)` writes conversation to ConversationStore + pending task row in a single transaction, returns immediately
  - [ ] `claimNext()` resets stale `processing` rows (>30s) to `pending`, then atomically claims next `pending` row
  - [ ] `processNext()` calls `claimNext()`, runs full ingest pipeline on the claimed task, marks `completed` or `failed`
  - [ ] Ollama connection errors leave tasks as `pending` (retryable), not `failed` (terminal). Only non-retryable errors (malformed data, content hash conflicts) mark `failed`.
  - [ ] `pending` property returns count of pending + processing tasks
  - [ ] `enqueue()` handles duplicate conversations gracefully — catches UNIQUE constraint violation from ConversationStore, does not create a duplicate pending task
  - [ ] `IngestQueueError` added to `src/core/errors.ts`
  - [ ] `busy_timeout` pragma set to 5000ms in `createDatabase()` — prevents `SQLITE_BUSY` errors when `store.ts` and `extract-worker.ts` write concurrently
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Unit tests with in-memory SQLite: enqueue writes conversation + task atomically, claimNext picks up pending tasks, stale processing rows recovered, Ollama connection errors leave tasks as pending, non-retryable errors mark failed, duplicate enqueue handled gracefully, pending count accurate.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement IngestQueue with SQLite outbox` — src/queue/ingest-queue.ts with DDL, enqueue, claimNext, processNext; add IngestQueueError to errors.ts; install p-limit
  2. `test: add IngestQueue unit tests` — tests/queue/ingest-queue.test.ts
- **Technical notes:**
  - `better-sqlite3` supports nested transactions via savepoints. The `enqueue()` outer transaction wraps `ConversationStore.addConversation()` (which has its own inner transaction) and the pending task insert. The outer transaction ensures atomicity.
  - The `processNext()` method needs access to the full orchestrator pipeline (extractor, embedder, store, consolidator). Pass these as dependencies to the `IngestQueue` constructor.
  - `p-limit` is ESM-only since v6. The project is already ESM. Pin exact version per CLAUDE.md conventions.
  - The stale threshold (30s) has 2.5x margin over the typical 12s pipeline. If two workers briefly run in parallel and both claim different tasks, that's fine — `p-limit(1)` within each worker prevents overloading Ollama, and the atomic claim prevents double-processing of the same task.
  - **Error classification:** Distinguish retryable errors (Ollama connection refused, timeout) from terminal errors (malformed conversation, content hash conflict, extraction bug). Retryable errors: leave status as `pending` (will be retried on next claim). Terminal errors: mark `failed` with error message. This prevents the queue from permanently failing when Ollama is temporarily down.
  - `completed` rows kept for observability — defer cleanup to a future sprint.
  - No in-process worker/poller in IngestQueue — the queue is just the outbox table + claim logic. The polling loop lives in `extract-worker.ts` (Story 3).
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Wire IngestQueue into PristineLocal
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
  - Resolution: *(agreed + fixed / disagreeded + reason)*
- **As a** developer, **I want** the ingest queue exposed on `PristineLocal`, **so that** I can enqueue conversations for background extraction.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `PristineLocal` has `ingestQueue` property (readonly)
  - [ ] `PristineLocal.create()` creates IngestQueue (no worker — worker is external)
  - [ ] Existing `store()` method unchanged (synchronous pipeline, for callers who want to await)
  - [ ] New `storeAsync(conversation, userId)` method delegates to `ingestQueue.enqueue()` (fire-and-forget, returns immediately)
  - [ ] `IngestQueue` exported from barrel (`src/index.ts`)
  - [ ] `PristineLocal.createLite({ db })` static method — lightweight init with only DB + ConversationStore + IngestQueue (no embedder, no LLM clients). For use by `store.ts` and other fast-path scripts.
  - [ ] `createLite()` throws clear `IngestQueueError` if caller attempts `store()` or `search()` (those need full client)
  - [ ] `storeAsync()` works on lite clients (delegates to `ingestQueue.enqueue()` which only needs DB)
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Unit tests: create client, verify ingestQueue exists, storeAsync enqueues without blocking. createLite supports storeAsync but throws on store()/search(). Existing store() tests unaffected.
- **QA:** N/A
- **Planned commits:**
  1. `feat: wire IngestQueue into PristineLocal and add createLite` — src/client.ts, src/index.ts
  2. `test: verify IngestQueue wiring and createLite` — tests/client.test.ts additions
- **Technical notes:**
  - Keep the existing `store()` as the synchronous path (await full pipeline). `storeAsync()` is the new fire-and-forget path via the queue. Agents choose which to use.
  - **No in-process worker.** `PristineLocal.create()` does not start a poller. The worker is a separate process (`extract-worker.ts`) spawned by `store.ts` (Story 3). This means `dispose()` does not need to drain a worker — it just closes the DB.
  - **`createLite()` is critical for CLI script performance.** `store.ts` must exit in <0.5s, which is impossible if it loads the full PristineLocal (embedder, LLM clients, orchestrator). `createLite()` only opens the DB, creates ConversationStore and IngestQueue — no Ollama connection, no model config.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: CLI store and extract-worker scripts
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
- **As a** agent harness developer, **I want** CLI scripts to store conversations and run background extraction, **so that** hooks can fire-and-forget after each agent turn.
- **Dependencies:** Story 2
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `scripts/store.ts` reads conversation JSON from stdin, enqueues via `createLite()`, exits in <0.5s
  - [ ] `scripts/store.ts` spawns detached `extract-worker.ts` if queue depth was 0 before enqueue (i.e., this is new work, likely no worker running)
  - [ ] `scripts/store.ts` accepts `--user-id <userId>` and optional `--db-path <path>`
  - [ ] Detached spawn uses `child_process.spawn` with `detached: true, stdio: 'ignore'`, `unref()`'d so `store.ts` exits immediately
  - [ ] `scripts/extract-worker.ts` runs a poll loop: `claimNext()` → `processNext()` → repeat. Exits when queue is empty and idle for 30s.
  - [ ] `scripts/extract-worker.ts` accepts `--all` (process all pending, exit immediately when empty — no idle wait)
  - [ ] `scripts/extract-worker.ts` accepts `--retry-failed` (reset failed tasks to pending before processing)
  - [ ] `extract-worker.ts` uses `p-limit(1)` for Ollama calls
  - [ ] `extract-worker.ts` accepts `--db-path <path>` (`store.ts` passes its `--db-path` to the spawned worker)
  - [ ] `extract-worker.ts` reads `~/.pristine/models.json` for engine config (needs full PristineLocal)
  - [ ] `extract-worker.ts` processes all users' pending tasks (no `--user-id` filter — single device, single queue)
  - [ ] Both scripts use `~/.pristine/data/pristine.db` by default
  - [ ] Scripts handle missing args gracefully (exit code 1 with usage message)
  - [ ] Scripts are `.ts` files run via `tsx`
  - [ ] `p-limit` installed (pinned exact version, `npm audit` clean) — used by `extract-worker.ts` for Ollama concurrency control
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Unit tests: mock stdin with conversation JSON, verify store.ts writes conversation + pending task + spawns worker. Verify extract-worker.ts claims and processes pending tasks. Test --all flag processes all and exits. Test --retry-failed resets failed tasks. Test missing args.
- **QA:**
  - Lou: run `echo '{"messages":[{"role":"user","content":"I live in Tokyo"}]}' | npx tsx scripts/store.ts --user-id test-user` and verify conversation appears in DB + worker spawned
  - Lou: run `npx tsx scripts/extract-worker.ts --all` and verify facts extracted for all pending tasks
- **Planned commits:**
  1. `feat: implement store.ts CLI script with detached worker spawn` — scripts/store.ts
  2. `feat: implement extract-worker.ts CLI script with poll loop` — scripts/extract-worker.ts
  3. `test: add CLI script tests` — tests/scripts/store.test.ts, tests/scripts/extract-worker.test.ts
- **Technical notes:**
  - **Spawn-on-demand pattern:** `store.ts` checks `queue.pending` before enqueue. If it was 0 (no prior work), spawn a worker after enqueue. If >0, a worker is likely already running (or will be spawned by another `store.ts` invocation). This is a heuristic, not a guarantee — if two `store.ts` calls race, two workers may spawn briefly. That's fine: atomic `claimNext()` prevents double-processing, and both workers self-terminate when idle.
  - **Worker lifecycle:** `extract-worker.ts` starts → creates full `PristineLocal.create()` → polls `claimNext()` every 2s → processes claimed tasks → when queue empty, starts 30s idle countdown → exits on timeout. Any new enqueue resets the idle countdown (worker checks queue on each poll).
  - `--all` mode: skip idle wait, exit immediately when no pending tasks. For batch recovery and cron jobs.
  - `--retry-failed`: `UPDATE pending_ingest_tasks SET status = 'pending' WHERE status = 'failed'` before starting the poll loop.
  - `store.ts` uses `PristineLocal.createLite()` — no Ollama, no embedder. Enqueue + spawn + exit in <0.5s.
  - `extract-worker.ts` uses full `PristineLocal.create()` — needs Ollama for extraction + embedding.
  - Scripts are `.ts` files run with `npx tsx`. `tsx` is likely already available via vitest's dependency tree; if not, add as devDependency.
  - Parse args with `process.argv` (no external arg parser needed).
  - Output JSON to stdout, errors to stderr.
  - **Ollama down scenario:** Worker claims a task, Ollama unreachable → retryable error → task stays `pending`. Worker keeps polling, retrying every 2s. When Ollama comes back, tasks process. If the queue is large (e.g., 500 tasks from hours of agent use without Ollama), backfill is automatic but slow (~12s per task, serial). Log a warning at queue depth thresholds (>10, >50, >100) so the user knows backfill is in progress.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: CLI search scripts
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
- **As a** agent harness developer, **I want** CLI scripts to search memory and conversations, **so that** agent skills/tools can retrieve context.
- **Dependencies:** Story 2
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `scripts/search.ts` accepts `--user-id`, `--query`, optional `--temporal-mode`, `--top-k`, `--db-path`
  - [ ] `scripts/search.ts` outputs JSON to stdout: `{ memories: [...], metadata: {...} }`
  - [ ] `scripts/search-conversations.ts` accepts `--user-id`, optional `--keyword`, `--date-from`, `--date-to`, `--limit`, `--db-path`
  - [ ] `scripts/search-conversations.ts` outputs JSON: `{ conversations: [...] }`
  - [ ] `scripts/get-conversation.ts` accepts `<conversationId>`, optional `--db-path`
  - [ ] `scripts/get-conversation.ts` outputs JSON: full conversation with messages
  - [ ] `search.ts` exits in <2s (needs full PristineLocal for Ollama embedding). `search-conversations.ts` and `get-conversation.ts` exit in <0.5s (pure SQL via createLite).
  - [ ] All scripts handle missing args gracefully
  - [ ] Agent framework configuration examples documented (Claude Code hook, Pi skill definition) in `docs/` or README
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Unit tests: verify each script produces correct JSON output. Test with mock embedder for search.ts. Test missing/invalid args.
- **QA:**
  - Lou: after storing a conversation, run `npx tsx scripts/search.ts --user-id test-user --query "Tokyo"` and verify results
  - Lou: run `npx tsx scripts/search-conversations.ts --user-id test-user --keyword "Tokyo"` and verify FTS5 results
- **Planned commits:**
  1. `feat: implement search.ts CLI script` — scripts/search.ts
  2. `feat: implement search-conversations.ts and get-conversation.ts` — scripts/search-conversations.ts, scripts/get-conversation.ts
  3. `docs: add agent framework configuration examples` — docs/agent-integration.md or README section
  4. `test: add CLI search script tests` — tests/scripts/search.test.ts
- **Technical notes:**
  - `search.ts` needs full `PristineLocal.create()` (Ollama embedder for query embedding + SQLite for vector search). The <2s AC accounts for initialization time.
  - `search-conversations.ts` and `get-conversation.ts` use `PristineLocal.createLite()` — only SQLite, no Ollama. Exits in <0.5s.
  - JSON output should be compact (no pretty-printing) for pipe-friendly usage.
  - `--temporal-mode` maps to `SearchOptions.temporalMode` — validates against `current | as_of | full`.
  - Agent framework examples (commit 3): show a Claude Code hook config calling `store.ts`, a Pi skill definition calling `search.ts`, and the recovery pattern (`extract-worker.ts --all`).
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 5: End-to-end integration tests
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
- **As a** developer, **I want** end-to-end tests proving the full ingest queue + CLI workflow, **so that** I know the sprint's changes integrate correctly.
- **Dependencies:** Stories 3, 4
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] E2e test: `storeAsync()` enqueues → `processNext()` extracts facts → `search()` finds them
  - [ ] E2e test: crash recovery — enqueue task, set status to `processing` with stale timestamp, call `claimNext()`, verify it resets and re-claims the task
  - [ ] E2e test: Ollama connection error leaves task as `pending` (not `failed`)
  - [ ] E2e test: `store.ts` stdin → `extract-worker.ts --all` → `search.ts` stdout produces correct results (full CLI round-trip)
  - [ ] E2e test: `search-conversations.ts` finds stored conversations by keyword
  - [ ] E2e test: spawn-on-demand — `store.ts` spawns worker, worker processes task and eventually exits
  - [ ] Tests skippable via `SKIP_SLOW_TESTS=1`
  - [ ] All tests pass: `npm run typecheck`, `npm test`, `npm run lint`
- **Testing approach:** E2e tests with in-memory SQLite, mocked LlmClient, mock or real embedder. CLI tests spawn child processes with `child_process.execFile`. Spawn-on-demand test verifies `store.ts` spawns a detached process (check that the spawn call was made, not that the process completes — that's covered by the CLI round-trip test).
- **QA:** N/A
- **Planned commits:**
  1. `test: add ingest queue and CLI end-to-end tests` — tests/integration/ingest-queue.test.ts, tests/e2e/cli-scripts.test.ts
- **Technical notes:**
  - Crash recovery test: enqueue a task, directly update its status to `processing` with a stale `started_at` (>30s ago), then call `claimNext()` and verify it resets the task to `pending` and claims it.
  - Ollama connection error test: mock the orchestrator's ingest to throw a connection error, verify the task stays `pending` (not `failed`).
  - CLI round-trip: use `child_process.execFile('npx', ['tsx', 'scripts/store.ts', ...])` with stdin pipe for store, then `execFile` for extract-worker and search. Verify correct JSON output.
  - Use `SKIP_SLOW_TESTS=1` guard since these tests involve real pipeline execution or process spawning.
- **Priority:** Must-have
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
- All must-have stories pass acceptance criteria
- IngestQueue persists pending tasks in SQLite, recovers from crashes
- `store.ts` enqueues + spawns worker in <0.5s
- Worker self-terminates after 30s idle
- Ollama-down scenario: tasks stay pending, backfill automatically when Ollama returns
- CLI scripts work end-to-end: store → extract → search round-trip
- E2e tests prove crash recovery, spawn-on-demand, and CLI round-trip
- Tests + linter pass (locally and CI)
- One or more commits per story (logical chunks), one PR per story
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`) per repo CLAUDE.md
- All PRs open and Greptile-clean

---

## Completion
*(Filled by coding agent when sprint is done)*

### Summary

### Results
- :white_check_mark: Story 1: IngestQueue with SQLite outbox — PR #, status
- :white_check_mark: Story 2: Wire IngestQueue into PristineLocal — PR #, status
- :white_check_mark: Story 3: CLI store + extract-worker scripts — PR #, status
- :white_check_mark: Story 4: CLI search scripts — PR #, status
- :white_check_mark: Story 5: E2e integration tests — PR #, status

### New Dependencies
- `p-limit`: concurrency control for Ollama calls (1KB, zero deps)

### Blockers / Issues

### Carry-Over

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
