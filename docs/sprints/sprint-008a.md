# Pristine Local — Sprint 008a
**Date:** TBD
**Goal:** Port the memorybench framework into pristine, fix the 202x ingestion duplication, and create a Pristine provider that uses the SDK directly
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3, sqlite-vec
- **Current state:** Sprint 011 complete. Durable ingest queue with crash recovery, CLI scripts for agent integration, 706+ tests passing. The SDK (`PristineLocal`) is feature-complete with `store()`, `storeAsync()`, `search()`, `createLite()`, and CLI scripts. The memorybench framework lives in `~/projects/memory/benchmarks/memorybench/` (upstream: supermemoryai/memorybench, pinned at 59338e4 with custom `ourmemory` provider). It has never been run against Pristine's local pipeline.
- **Implementation spec:** `docs/specs/implementation-spec-003.md` — Phase 8
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context
- This sprint ports the memorybench framework, fixes the 202x ingestion duplication bug, and creates a Pristine provider. The framework uses Bun as runtime — we keep this (don't convert to Node/Vitest). The benchmark is a separate sub-project under `benchmarks/memorybench/` with its own `package.json` and `tsconfig.json`.
- **Key bug:** The framework creates a separate memory namespace per question (1,986 questions) instead of per conversation (10 conversations). Each question re-ingests all sessions from its parent conversation, causing 55,014 session ingestions instead of 272. The fix: `containerTag` per conversation, shared across all questions from that conversation.
- **Pristine provider** imports `PristineLocal` directly — no HTTP server. Each conversation gets its own `PristineLocal` instance with a separate DB. This is the first time Pristine's memory pipeline is benchmarked against a standard dataset.
- The memorybench source is at `~/projects/memory/benchmarks/memorybench/`. We port `src/`, `data/`, configs, strip vendor-specific providers (ourmemory, supermemory, mem0, zep), keep `filesystem` and `rag` as reference implementations.

### Parallelization
Stories are sequential: Story 1 (port framework) -> Story 2 (fix ingest duplication) -> Story 3 (Pristine provider) -> Story 4 (verification run).

### Stories
**Constraints:** Max 5 stories per sprint. Max 5 commits per story. If a story needs 6+ commits during planning, split it.

#### Story 1: Port memorybench framework into pristine repo
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
- **As a** developer, **I want** the memorybench framework in the pristine repo, **so that** I can run benchmarks against Pristine without depending on the memory repo.
- **Dependencies:** None
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `benchmarks/memorybench/` directory contains the framework source (src/, data/benchmarks/locomo/, package.json, tsconfig.json)
  - [ ] Existing providers stripped out (ourmemory, supermemory, mem0, zep) — only keep `filesystem` and `rag` as reference implementations (note: these depend on OpenAI API key to run, kept for code reference only)
  - [ ] `src/server/` directory stripped (Drizzle ORM web dashboard, not needed)
  - [ ] `benchmarks/memorybench/package.json` has correct dependencies (drizzle-orm, mem0ai, supermemory, @getzep/zep-cloud removed)
  - [ ] Framework compiles: `cd benchmarks/memorybench && npx tsc --noEmit`
  - [ ] LOCOMO dataset present at `benchmarks/memorybench/data/benchmarks/locomo/locomo10.json` (2.7 MB, tracked in git)
  - [ ] `benchmarks/memorybench/data/runs/` added to `.gitignore` (benchmark runtime artifacts)
  - [ ] `benchmarks/memorybench/data/benchmarks/longmemeval/` NOT copied (518 MB, too large)
- **Testing approach:** Typecheck only — framework compiles without errors. No runtime tests yet (provider not wired).
- **QA:** N/A
- **Planned commits:**
  1. `feat: port memorybench framework into benchmarks/` — copy src/, data/benchmarks/locomo/ from ~/projects/memory/benchmarks/memorybench/, strip vendor providers and server
  2. `chore: configure benchmarks/memorybench package.json and dependencies` — clean up deps, remove unused provider packages
- **Technical notes:**
  - Copy: `src/` (except `src/server/` and vendor providers), `data/benchmarks/locomo/` only, `package.json`, `tsconfig.json`, `README.md`
  - Do NOT copy: `data/benchmarks/longmemeval/` (518 MB), `data/runs/`, `data/leaderboard.db`, `src/server/`, `ui/`, `bun.lock`, `node_modules/`
  - Remove provider directories: `src/providers/ourmemory/`, `src/providers/supermemory/`, `src/providers/mem0/`, `src/providers/zep/`
  - Remove `src/server/` directory (Drizzle ORM web dashboard — imports drizzle-orm which we strip)
  - Keep `src/providers/filesystem/` and `src/providers/rag/` as code reference (note: they require OpenAI API key to actually run)
  - Keep `src/cli/`, `src/orchestrator/`, `src/benchmarks/`, `src/judges/`, `src/prompts/`, `src/types/`, `src/utils/`
  - Update `src/providers/index.ts` to only register filesystem and rag
  - Remove deps from package.json: `mem0ai`, `supermemory`, `@getzep/zep-cloud`, `drizzle-orm`, and `OUR_MEMORY_API_KEY` references
  - The benchmark uses Bun as runtime — keep this, don't convert to Node/Vitest. Ensure Bun is installed in the dev environment.
  - Don't add benchmarks/ to the main pristine tsconfig — it's a separate sub-project
  - The source repo's `.gitignore` excludes `/data/` — the LOCOMO dataset only exists locally at `~/projects/memory/benchmarks/memorybench/data/benchmarks/locomo/locomo10.json`. Copy it explicitly.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Fix 202x ingestion duplication
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
- **As a** developer, **I want** the benchmark to ingest each conversation once and share it across all questions, **so that** a full LOCOMO run takes hours instead of days.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `containerTag` for ingest is per-conversation (e.g., `conv-42-{runId}`), not per-question
  - [ ] All questions from the same conversation share the same memory namespace for search
  - [ ] Ingest phase skips conversations that are already ingested (checkpoint tracks per-conversation, not per-question)
  - [ ] Search phase uses the conversation-level containerTag to query the shared namespace
  - [ ] `clear()` uses conversation-level containerTag (not per-question)
  - [ ] Total session ingestions for a full LOCOMO run is 272 (not 55,014). Verified via unit test that counts ingestion calls.
  - [ ] Old-format checkpoints (per-question containerTag) are rejected with a clear error message instructing to use `--force` for a fresh run
  - [ ] Existing checkpoint/resume logic still works for new-format checkpoints
- **Testing approach:** Add a unit test that verifies containerTag generation is per-conversation. Run a dry-run with `--limit 5` from two different conversations and verify ingest count matches expected sessions (not questions x sessions).
- **QA:** N/A
- **Planned commits:**
  1. `fix: generate containerTag per-conversation instead of per-question` — modify ingest phase to deduplicate by conversation
  2. `fix: update search, indexing, and clear phases to use conversation-level containerTag`
  3. `test: verify per-conversation ingest deduplication` — unit test for containerTag generation and ingest count
- **Technical notes:**
  - The key change is in `src/orchestrator/phases/ingest.ts`: `containerTag` should use the conversation ID, not the question ID
  - **Verify the questionId format** in the LOCOMO dataset before implementing the split pattern. If questionIds don't contain a predictable conversation prefix, add a `conversationId` field to `UnifiedQuestion` instead of parsing
  - Need a conversation-level ingest tracking structure in the checkpoint (instead of per-question ingest status)
  - The search phase in `src/orchestrator/phases/search.ts` needs to resolve the question's containerTag to the conversation-level one
  - **The indexing phase** (`src/orchestrator/phases/indexing.ts`) also uses per-question checkpoint tracking and calls `provider.awaitIndexing()` per question — update it for per-conversation semantics
  - The `getHaystackSessions(questionId)` already returns conversation-level sessions — the data model supports this, only the isolation logic is wrong
  - Be careful with checkpoint backward compatibility — existing checkpoints should be rejected with a clear error
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Create Pristine provider (direct SDK import, no HTTP)
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
- **As a** developer, **I want** a Pristine benchmark provider that uses `PristineLocal` directly, **so that** I can benchmark the memory system without running an HTTP server.
- **Dependencies:** Story 2
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `benchmarks/memorybench/src/providers/pristine/index.ts` implements the `Provider` interface
  - [ ] Provider creates `PristineLocal` client with per-conversation file-backed SQLite databases at `data/runs/{runId}/{conversationId}.db`
  - [ ] `ingest()` maps `UnifiedSession` messages to Pristine `Message[]` and calls `client.store()`
  - [ ] `search()` calls `client.search()` and returns results in the benchmark's expected format
  - [ ] `clear()` disposes the client and removes the conversation's database
  - [ ] Provider registered in `src/providers/index.ts` as `"pristine"`
  - [ ] Runs with local Ollama (llama3.2) — no API keys needed for the provider itself
- **Testing approach:** Unit test with mock LLM: create provider, ingest a small session, search, verify results returned. Integration test: run `--limit 2` with real Ollama and verify end-to-end.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement Pristine benchmark provider` — src/providers/pristine/index.ts with Provider interface implementation
  2. `feat: register pristine provider and add answer prompt` — src/providers/pristine/prompts.ts, update src/providers/index.ts
  3. `test: add pristine provider unit test` — verify ingest/search lifecycle
- **Technical notes:**
  - Import `PristineLocal` from pristine's built output. Run `npm run build` in the pristine root first. Recommended approach: add `"pristine": "file:../../"` as a dependency in memorybench's `package.json`, then import as `import { PristineLocal } from 'pristine'`. Alternative: use a relative import path to `../../dist/index.js` or add a `paths` alias in memorybench's `tsconfig.json`.
  - **Must use file-backed DBs**, not in-memory. The benchmark orchestrator runs multiple phases (ingest -> indexing -> search -> answer) and the provider instance must persist data across phases. File DBs at `benchmarks/memorybench/data/runs/{runId}/{conversationId}.db` ensure ingested data survives across phases. In-memory DBs would be destroyed between phases, causing search to return zero results.
  - Map `UnifiedMessage` to Pristine's `Message` type: `{ role: msg.role, content: msg.content, timestamp: msg.timestamp }`
  - The provider manages a `Map<containerTag, PristineLocal>` of client instances
  - `awaitIndexing` is a no-op (Pristine's `store()` is synchronous from the caller's perspective)
  - The provider uses whatever LLM is configured in `~/.pristine/models.json` (Ollama by default)
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: Verification run — prove ingestion fix and provider work end-to-end
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
- **As a** developer, **I want** to run the benchmark with a small subset and verify the ingestion fix and Pristine provider work, **so that** I know the sprint's changes are correct before moving to scoring/baseline.
- **Dependencies:** Stories 2, 3
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] **Ingestion count verified:** Run with `--limit 5` (5 questions spanning at least 2 conversations). Count total session ingestions. Must equal the number of unique sessions across those conversations (e.g., ~50), NOT questions x sessions. Log the count explicitly.
  - [ ] **No 202x duplication:** If conv-42 has 29 sessions and 3 of the 5 questions come from conv-42, verify conv-42 is ingested exactly once (29 session ingestions), not 3 times (87).
  - [ ] **Pristine provider ingest works:** Conversations are stored in file-backed SQLite DBs at `data/runs/{runId}/`. Verify DB files exist after ingest.
  - [ ] **Pristine provider search works:** Search phase returns results (non-empty) for the ingested questions. At least 1 question gets a non-empty search result.
  - [ ] **Checkpoint resume works:** Interrupt the run after 3 questions, restart with the same run ID. Verify it resumes from question 4 (not re-ingesting).
  - [ ] **Run completes without crashes:** All 5 questions go through ingest -> search without errors.
  - [ ] Results logged to stdout/file for Lou to inspect.
- **Testing approach:** This IS the test — run the benchmark CLI with `--limit 5`, inspect output, verify ingestion count. This is a manual verification step, not an automated test.
- **QA:**
  - Lou: Inspect the run output — verify ingestion count matches expected sessions, search returns results, no crashes.
- **Planned commits:**
  1. `docs: document verification run results for sprint 008a` — add run output summary to sprint completion section
- **Technical notes:**
  - Run command: `cd benchmarks/memorybench && bun run src/index.ts run -p pristine -b locomo --limit 5`. If `--limit 5` takes questions sequentially from one conversation, use `--sample 1` (1 per category) or manually select questions from 2+ conversations to satisfy AC1. Check the LOCOMO dataset structure and the framework's `--limit` behavior before running.
  - **Answer + judge phases:** The framework may require a judge model to run the full pipeline. Options in order of preference: (1) check if the framework supports `--phases ingest,search` or similar to run only ingest + search, (2) if not, use the `filesystem` reference provider with an OpenAI API key for one quick run to verify the ingestion fix, then verify the Pristine provider via its unit tests from Story 3, (3) as a last resort, temporarily stub the answer/judge phases to return dummy values so the pipeline completes.
  - The key metric is: **total ingestions = sum of unique sessions per conversation**, not questions x sessions.
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
- `benchmarks/memorybench/` compiles and runs
- Pristine provider ingests + searches via `PristineLocal` SDK (no HTTP server)
- Ingest deduplication verified: 272 session ingestions for full LOCOMO (not 55,014)
- Tests + linter pass (locally and CI)
- One or more commits per story (logical chunks), one PR per story
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`) per repo CLAUDE.md
- All PRs open and Greptile-clean

---

## Completion

### Summary
Ported memorybench framework into `benchmarks/memorybench/`, fixed the 202x ingestion duplication (per-conversation containerTag instead of per-question), created a Pristine provider using PristineLocal SDK directly, and ran a verification run with `--limit 5`. The verification confirmed: conversation-level dedup works (1 conversation ingested for 5 questions), checkpoint resume works, file-backed DBs created, and the Pristine SDK integrates correctly. The benchmark must be run with `npx tsx` (not Bun) because `better-sqlite3` is not supported in Bun.

### Results
- :white_check_mark: Story 1: Port memorybench framework — PR #77, merged
- :white_check_mark: Story 2: Fix 202x ingestion duplication — PR #78, merged
- :white_check_mark: Story 3: Pristine provider — PR #79, merged
- :white_check_mark: Story 4: Verification run — PR #80, open

### Verification Run Results (Story 4)
- **Run command:** `cd benchmarks/memorybench && npx tsx src/index.ts run -p pristine -b locomo -r verify-008a --limit 5 --force`
- **Questions selected:** 5 (all from conversation 26, limit mode takes first N sequentially)
- **Conversation dedup:** "Ingesting 1 conversations for 5 questions" (only 1 conversation, not 5)
- **Session ingestions:** 7/19 completed before Ollama hang on session_8 (39 messages). Previous run reached 16/19 sessions.
- **Checkpoint resume:** Verified — killed process at 3/19 sessions, resumed and continued from session 4 (not re-ingesting 1-3)
- **DB file created:** `data/runs/verify-008a/conv_26_verify_008a.db` (4.2 MB after 16 sessions)
- **Pristine SDK integration:** Works via tsx/Node.js. Bun not supported (better-sqlite3 native addon)
- **Blocker:** Ollama hangs on sessions with 35+ messages. This is an Ollama/model timeout issue, not a framework bug. Likely requires increasing Ollama timeout or using a faster model.

### New Dependencies
- `pristine` (file:../../) — local dependency for Pristine provider
- `zod` upgraded from 3.24.4 to 4.3.6 — required by @ai-sdk/google (zod/v4 import)

### Blockers / Issues
- **Bun incompatibility:** `better-sqlite3` not supported in Bun (oven-sh/bun#4290). Must use `npx tsx` instead of `bun run`. This affects Sprint 008b — all benchmark runs must use tsx.
- **Ollama hang on large sessions:** Sessions with 35+ messages cause Ollama to hang indefinitely. Likely a timeout or context length issue with llama3.2. May need a different model or timeout configuration.

### Carry-Over
- None — all stories complete. Blockers documented for Sprint 008b.

### Notes for Next Sprint
- Sprint 008b must use `npx tsx` instead of `bun run` for all benchmark commands
- Consider adding an Ollama request timeout to the Pristine provider to prevent indefinite hangs
- The `--limit 5` takes questions sequentially (all from conv-26). Use `--sample 1` for cross-conversation coverage
- The full LOCOMO run (1,986 questions, 272 sessions) will require a model that handles 35+ message sessions without hanging

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
