# Pristine Local — Sprint 008
**Date:** TBD
**Goal:** Port the memorybench framework into pristine, fix the 202x ingestion duplication that makes benchmark runs take days instead of hours, and create a Pristine provider that uses the SDK directly (no HTTP server)
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3, sqlite-vec
- **Current state:** Sprint 007 complete. SDK is shippable — `PristineLocal.create()` wires all modules, public API barrel exports work, `npm run build` produces clean dist/. 558 tests passing. The memorybench framework lives in `~/projects/memory/benchmarks/memorybench/` (upstream: supermemoryai/memorybench, pinned at 59338e4 with custom `ourmemory` provider). It has never been run against Pristine's local pipeline.
- **Implementation spec:** `docs/specs/implementation-spec-001.md` — Phase 8
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context

#### The 202x Ingestion Problem

The memorybench framework creates a **separate memory namespace per question** by generating a unique `containerTag` (which hashes to a userId) for each question. ALL conversation sessions from that question's parent conversation are then ingested into that unique namespace.

The LOCOMO dataset has 10 conversations with 272 total sessions and 1,986 questions. Because each question re-ingests all sessions from its conversation:
- `conv-42` has 29 sessions and 260 questions → 29 × 260 = **7,540 session ingestions** for what should be 29
- Total across all conversations: **55,014 session ingestions** instead of 272
- **202x duplication factor**

Measured ingest time per question: 81–817 seconds. Ingest is **85-98% of total wall time.** A full LOCOMO run takes 40-80 hours instead of ~4 hours.

**The fix:** Ingest once per conversation (not per question). All questions from the same conversation share the same memory namespace. This is semantically correct — a user's memory persists across questions about that user.

#### Provider Architecture

The benchmark framework defines a `Provider` interface:
```typescript
interface Provider {
  initialize(config): Promise<void>
  ingest(sessions, options): Promise<IngestResult>
  search(query, options): Promise<unknown[]>
  clear(containerTag): Promise<void>
  awaitIndexing(result, containerTag): Promise<void>
}
```

The existing `ourmemory` provider uses **HTTP API calls** to a running memory server. For Pristine, we'll create a new `pristine` provider that imports `PristineLocal` directly — no HTTP server, no network overhead.

#### Judge Models

The benchmark uses an LLM judge for scoring. Currently configured for OpenAI/Anthropic API models ($50/run with GPT-4o). We need to support local Ollama models as judges ($0/run, ~25 min for 500 questions). The judge interface is already abstracted — adding an Ollama judge backend is straightforward.

### Parallelization
Stories are sequential: Story 1 (port framework) → Story 2 (fix ingest duplication) → Story 3 (pristine provider) → Story 4 (local judge) → Story 5 (validation run).

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
  - [ ] `benchmarks/memorybench/` directory contains the framework source (src/, data/, package.json, tsconfig.json)
  - [ ] Existing providers stripped out (ourmemory, supermemory, mem0, zep) — only keep `filesystem` and `rag` as reference implementations
  - [ ] `benchmarks/memorybench/package.json` has correct dependencies
  - [ ] Framework compiles: `cd benchmarks/memorybench && npx tsc --noEmit` (add a `typecheck` script to package.json if one doesn't exist)
  - [ ] LOCOMO dataset present at `benchmarks/memorybench/data/benchmarks/locomo/locomo10.json`
- **Testing approach:** Typecheck only — framework compiles without errors. No runtime tests yet (provider not wired).
- **QA:** N/A
- **Planned commits:**
  1. `feat: port memorybench framework into benchmarks/` — copy src/, data/, configs from ~/projects/memory/benchmarks/memorybench/, strip vendor-specific providers
  2. `chore: configure benchmarks/memorybench package.json and dependencies` — clean up deps, remove unused provider packages (mem0ai, supermemory, @getzep/zep-cloud)
- **Technical notes:**
  - Copy the full `src/` directory, `data/` directory, `package.json`, `tsconfig.json`
  - Remove provider directories: `src/providers/ourmemory/`, `src/providers/supermemory/`, `src/providers/mem0/`, `src/providers/zep/`
  - Keep `src/providers/filesystem/` and `src/providers/rag/` as working reference implementations
  - Update `src/providers/index.ts` to only register filesystem and rag
  - Remove deps: `mem0ai`, `supermemory`, `@getzep/zep-cloud`, and `OUR_MEMORY_API_KEY` references
  - The benchmark uses Bun as runtime — keep this, don't convert to Node/Vitest
  - Don't add benchmarks/ to the main pristine tsconfig — it's a separate sub-project
  - Add `benchmarks/memorybench/data/runs/` and `benchmarks/memorybench/data/checkpoints/` to `.gitignore` (benchmark runtime artifacts)
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
  - [ ] Existing checkpoint/resume logic still works for new-format checkpoints (can resume after interruption)
- **Testing approach:** Add a unit test that verifies containerTag generation is per-conversation. Run a dry-run with `--limit 5` from two different conversations and verify ingest count matches expected sessions (not questions × sessions).
- **QA:** N/A
- **Planned commits:**
  1. `fix: generate containerTag per-conversation instead of per-question` — modify ingest phase to deduplicate by conversation
  2. `fix: update search phase to use conversation-level containerTag` — search phase resolves question → conversation → containerTag
  3. `test: verify per-conversation ingest deduplication` — unit test for containerTag generation and ingest count
- **Technical notes:**
  - The key change is in `src/orchestrator/phases/ingest.ts` line 45: `const containerTag = \`${question.questionId}-${checkpoint.dataSourceRunId}\`` → change to use the conversation ID (e.g., `question.questionId.split('-q')[0]` or add a `conversationId` field to `UnifiedQuestion`)
  - Need a conversation-level ingest tracking structure in the checkpoint (instead of per-question ingest status)
  - The search phase in `src/orchestrator/phases/search.ts` needs to resolve the question's containerTag to the conversation-level one
  - The clear phase needs to clear per-conversation, not per-question
  - The `getHaystackSessions(questionId)` already returns conversation-level sessions — the data model supports this, only the isolation logic is wrong
  - Be careful with checkpoint backward compatibility — existing checkpoints should either be rejected or migrated
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
  - Import `PristineLocal` from pristine's built output. Run `npm run build` in the pristine root first, then import from the dist: `import { PristineLocal } from '../../../../../../dist/index.js'`. Alternatively, configure the benchmark's `tsconfig.json` with a path alias pointing to pristine's dist/. The exact path depends on the provider file's depth — verify at implementation time.
  - Update the `ProviderName` union type in `src/types/provider.ts` to include `"pristine"`
  - Each conversation gets its own `PristineLocal` instance with a separate in-memory DB (or file DB at `benchmarks/memorybench/data/runs/{runId}/{conversationId}.db`)
  - Map `UnifiedMessage` to Pristine's `Message` type: `{ role: msg.role, content: msg.content, timestamp: msg.timestamp }`
  - The provider manages a `Map<containerTag, PristineLocal>` of client instances
  - `awaitIndexing` is a no-op (Pristine's store() is synchronous from the caller's perspective)
  - For the answering prompt, format search results as the benchmark expects (text + score)
  - The provider uses whatever LLM is configured in `~/.pristine/models.json` (Ollama by default)
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: Add local Ollama judge backend
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
- **As a** developer, **I want** to use a local Ollama model as the benchmark judge, **so that** I can run the full benchmark for $0.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `benchmarks/memorybench/src/judges/ollama.ts` implements the judge interface
  - [ ] Judge calls local Ollama API (`localhost:11434/api/chat`) with the same judge prompts as existing judges
  - [ ] Judge parses JSON response from Ollama with retry (up to 3 attempts on malformed JSON)
  - [ ] Configurable model name (default: `llama3.2:latest`)
  - [ ] CLI accepts `--judge ollama` or `--judge ollama:llama3.2`
  - [ ] Answering model also supports `ollama:modelname` format
  - [ ] `getModel()` returns an `ollama-ai-provider` LanguageModel instance (install `ollama-ai-provider` package), OR if incompatible, retrieval evaluation is skipped for the Ollama judge with a warning
- **Testing approach:** Unit test with mocked Ollama HTTP response. Manual test: run a single question with `--judge ollama --limit 1` and verify scoring.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement Ollama judge backend` — src/judges/ollama.ts
  2. `feat: support ollama as answering model` — update answer phase to use Ollama when model starts with "ollama:"
  3. `chore: register ollama judge and update CLI help` — update src/judges/index.ts, CLI docs
- **Technical notes:**
  - The `Judge` interface (in `src/judges/base.ts` / `src/types/judge.ts`) has two requirements: (1) `judge()` method for scoring, (2) `getModel(): LanguageModel` for retrieval evaluation via Vercel AI SDK
  - For `getModel()`: install `ollama-ai-provider` (npm package that provides Vercel AI SDK-compatible LanguageModel for Ollama). If it's incompatible or unmaintained, skip retrieval evaluation for the Ollama judge (log a warning, return null metrics). The answer accuracy scoring (the main metric) does not use `getModel()` — it uses `judge()` directly.
  - Ollama's `/api/chat` endpoint accepts `{ model, messages, format: "json" }` — use `format: "json"` for structured output
  - Parse the response JSON for `{ score: 0|1, label, explanation }` with 3 retries on parse failure. 3B models produce syntactically valid JSON (via format flag) but may output wrong keys — the fallback parser in `base.ts` handles this
  - The answering model currently uses Vercel AI SDK (`@ai-sdk/openai`, etc.). For `ollama:modelname` format, add an Ollama branch in `getAnsweringModel()` using `ollama-ai-provider` or direct HTTP `fetch` to `/api/chat`. This requires updating the model resolution logic (currently 3 branches: openai, anthropic, google → add 4th for ollama)
  - The judge prompt is the same regardless of backend — only the transport changes
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 5: Validation run — LOCOMO with Pristine + local judge
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
- **As a** developer, **I want** to run a sampled LOCOMO benchmark and verify the full pipeline works, **so that** I have a baseline accuracy number and can detect regressions.
- **Dependencies:** Stories 2, 3, 4
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Run: `bun run src/index.ts run -p pristine -b locomo -j ollama -m ollama:llama3.2 --sample 10`
  - [ ] Ingestion completes for all 10 conversations (272 sessions, not 55K)
  - [ ] Total ingest time < 30 minutes
  - [ ] All sampled questions get scores (no crashes)
  - [ ] `report.json` generated with accuracy breakdown by question type
  - [ ] Baseline report committed to `benchmarks/memorybench/data/baselines/pristine-local-v1.json`
  - [ ] Total run time < 2 hours for the sampled run
- **Testing approach:** This IS the test — run the benchmark end-to-end, verify it completes, commit the baseline.
- **QA:**
  - Manual: Inspect `report.json` — verify accuracy numbers are in a reasonable range (>0.2 for any question type, should not be 0 across the board). Inspect latency stats for obvious outliers.
- **Planned commits:**
  1. `docs: add benchmark run instructions to benchmarks/memorybench/README.md`
  2. `feat: commit baseline report for pristine-local-v1` — data/baselines/pristine-local-v1.json
- **Technical notes:**
  - `--sample 10` takes 10 questions per category (5 categories × 10 = 50 questions). This keeps the run under 2 hours.
  - If accuracy is very low (<10% overall), that's still a valid baseline — it establishes where we are, not where we need to be
  - The baseline report is the reference point for all future regression checks
  - Document the exact command used to produce the baseline so it's reproducible
  - If the run crashes partway, the checkpoint system should allow resuming with the same run ID
- **Priority:** Must-have
- **Owner:** Coding Agent

### Rules
- Follow repo's `CLAUDE.md` for branching, rebase, and PR conventions
- Follow PR template (`.github/PULL_REQUEST_TEMPLATE.md`) when opening PRs
- Branch off `main` after the previous story is merged. For parallelizable stories, branch off `main` simultaneously. Do NOT stack unmerged branches.
- Open a PR per story with: story reference, summary, files changed, testing done
- Run tests + linter locally before pushing
- If `main` has changed since branching: rebase onto latest `main`, re-test, force-push
- If blocked, document the blocker and move to next story
- Do not modify files outside the project directory
- Do not install new dependencies without noting them in completion report
- **Do not merge PRs.** Open PRs, get Greptile review clean, then move to the next story. Lou merges all PRs at the end of the sprint.

### Definition of Done
- All must-have stories pass acceptance criteria
- `benchmarks/memorybench/` compiles and runs
- Pristine provider ingests + searches via `PristineLocal` SDK (no HTTP server)
- Ingest deduplication verified: 272 session ingestions for full LOCOMO (not 55,014)
- Ollama judge produces valid scores for $0
- Baseline report committed with sampled LOCOMO results
- One or more commits per story (logical chunks), one PR per story
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`) per repo CLAUDE.md
- All PRs open and Greptile-clean

---

## Completion
*(Filled by coding agent when sprint is done)*

### Summary

### Results
- :white_check_mark: Story 1: Port memorybench framework — PR #, status
- :white_check_mark: Story 2: Fix 202x ingestion duplication — PR #, status
- :white_check_mark: Story 3: Pristine provider — PR #, status
- :white_check_mark: Story 4: Local Ollama judge — PR #, status
- :white_check_mark: Story 5: Validation run — PR #, status

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
