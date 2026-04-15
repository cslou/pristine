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
Stories are sequential: Story 1 (port framework) -> Story 2 (fix ingest duplication) -> Story 3 (Pristine provider).

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
  - [ ] Total session ingestions for a full LOCOMO run is 272 (not 55,014)
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
  - [ ] Provider creates `PristineLocal` client with per-conversation SQLite databases (in-memory or file-backed)
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
  - Each conversation gets its own `PristineLocal` instance with a separate in-memory DB (or file DB at `benchmarks/memorybench/data/runs/{runId}/{conversationId}.db`)
  - Map `UnifiedMessage` to Pristine's `Message` type: `{ role: msg.role, content: msg.content, timestamp: msg.timestamp }`
  - The provider manages a `Map<containerTag, PristineLocal>` of client instances
  - `awaitIndexing` is a no-op (Pristine's `store()` is synchronous from the caller's perspective)
  - The provider uses whatever LLM is configured in `~/.pristine/models.json` (Ollama by default)
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
*(Filled by coding agent when sprint is done)*

### Summary

### Results
- :white_check_mark: Story 1: Port memorybench framework — PR #, status
- :white_check_mark: Story 2: Fix 202x ingestion duplication — PR #, status
- :white_check_mark: Story 3: Pristine provider — PR #, status

### New Dependencies

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
