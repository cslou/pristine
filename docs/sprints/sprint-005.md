# Pristine Local — Sprint 005
**Date:** TBD
**Goal:** Build memory processing modules: fact consolidation, query analysis, and retrieval with temporal ranking
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3, sqlite-vec
- **Current state:** Sprint 004 complete. Temporal validation, conversation chunker, fact extractor, and SQLite memory store (vector search + FTS5) all working. Privacy pipeline from Sprint 003 operational.
- **Implementation spec:** `docs/specs/implementation-spec-001.md` — Phase 3d, 3e, 3f, 3g
- **Note:** Phase 3f (embedder test coverage) is a small story folded into this sprint
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context
- This sprint builds the processing layer that sits between extraction and orchestration.
- The consolidator decides how new facts relate to existing memories (ADD, UPDATE, SUPERSEDE, DELETE, NOOP). It uses the LLM with batch processing and exponential backoff retry.
- The query analyzer classifies user queries by intent and extracts filters for the retriever. It has a heuristic-only fallback for low-latency search.
- The retriever combines vector similarity with temporal boosting to rank results.
- All three LLM modules (consolidator, query analyzer, and the embedder test coverage) follow the same `generate<T>()` adaptation pattern from Sprint 003.
- Source files: `~/projects/memory/src/consolidator/`, `~/projects/memory/src/query-analyzer/`, `~/projects/memory/src/retriever/`

### Parallelization
All three stories are independent — they can run in parallel. Story 3 (retriever) depends on the Store from Sprint 004, but not on Stories 1 or 2 of this sprint.

### Stories
**Constraints:** Max 5 stories per sprint. Max 5 commits per story. If a story needs 6+ commits during planning, split it.

#### Story 1: Port consolidator with batch processing
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** the consolidator deciding how new facts relate to existing memories, **so that** the memory store stays deduplicated and up-to-date.
- **Dependencies:** Sprint 004 (Store, temporal types)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/consolidator/prompts.ts` contains `buildConsolidationPrompt()` — configurable via `PromptConfig.consolidator`
  - [ ] `src/consolidator/schema.ts` contains consolidation JSON Schema for `generate<T>()`
  - [ ] `src/consolidator/index.ts` exports class implementing `Consolidator` interface from `src/core/interfaces.ts`, with `consolidate()` and `consolidateBatch()`
  - [ ] 5 action types: ADD, UPDATE, DELETE, NOOP, SUPERSEDE
  - [ ] Batch processing with integer-to-UUID ID remapping
  - [ ] Retry with exponential backoff (max 2 retries, base 500ms, on transient/retryable errors — engine-agnostic, not HTTP status codes)
  - [ ] Post-validation downgrades: SUPERSEDE→ADD (invalid target), UPDATE→ADD (invalid target), DELETE→NOOP (invalid target)
  - [ ] `ConsolidationError` thrown on unrecoverable failure
  - [ ] Prompt configurable via constructor config
  - [ ] All consolidator tests pass (ported from source, mocking `generate<T>()`)
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Port consolidator tests adapting mocked `messages.create` to `generate<T>()`. Test all 5 action types, batch remapping, retry logic, post-validation downgrades.
- **QA:** N/A
- **Planned commits:**
  1. `feat: port consolidation prompt and schema` — src/consolidator/prompts.ts, schema.ts
  2. `feat: implement consolidator with batch processing` — src/consolidator/index.ts
  3. `test: port consolidator tests` — tests/consolidator/
- **Technical notes:**
  - Source: `~/projects/memory/src/consolidator/index.ts` (422 lines), `types.ts` (85 lines)
  - Source prompt: `~/projects/memory/src/prompts/consolidation.ts`
  - Source tests: `~/projects/memory/tests/pipeline/consolidator.test.ts` (712 lines)
  - Key adaptation: same `messages.create()` → `generate<T>()` pattern
  - Batch ID remapping: LLM sees integer indices (0, 1, 2...) mapped to real UUIDs in pre/post processing
  - Retry: `isRetryableError()` checks for transient/retryable error conditions, `withRetry()` wraps generate call
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Port query analyzer with heuristic fallback
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** the query analyzer classifying search queries by intent, **so that** the retriever can apply appropriate filtering and ranking strategies.
- **Dependencies:** None (uses LlmClient interface only)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/query-analyzer/prompts.ts` contains `buildQueryAnalysisPrompt()` — configurable via `PromptConfig.queryAnalyzer`
  - [ ] `src/query-analyzer/schema.ts` contains query analysis JSON Schema for `generate<T>()`
  - [ ] `src/query-analyzer/index.ts` exports class implementing `QueryAnalyzer` interface from `src/core/interfaces.ts`
  - [ ] Add `queryAnalyzer?: string` field to `PromptConfig` in `src/core/types.ts` (missing from Sprint 001 scaffolding)
  - [ ] Intent classification: `factual_lookup`, `contextual_search`, `temporal_query`
  - [ ] Filter extraction: temporal range, topic, agent scope, suggested topK
  - [ ] Query rewriting for embedding clarity
  - [ ] Heuristic-only mode for low-latency search (no LLM call)
  - [ ] Fallback result on LLM failure (graceful degradation, not fail-closed)
  - [ ] Prompt configurable via constructor config
  - [ ] All query analyzer tests pass
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Port tests adapting mocked `messages.create` to `generate<T>()`. Test intent classification, filter extraction, validation, heuristic fallback, error handling.
- **QA:** N/A
- **Planned commits:**
  1. `feat: port query analysis prompt and schema` — src/query-analyzer/prompts.ts, schema.ts
  2. `feat: implement query analyzer with heuristic fallback` — src/query-analyzer/index.ts
  3. `test: port query analyzer tests` — tests/query-analyzer/
- **Technical notes:**
  - Source: `~/projects/memory/src/query-analyzer/index.ts` (297 lines), `types.ts` (141 lines)
  - Source prompt: `~/projects/memory/src/prompts/query-analysis.ts`
  - Source tests: `~/projects/memory/tests/pipeline/query-analyzer.test.ts` (506 lines)
  - Note: query analyzer has graceful degradation (returns default query on error), unlike classifier which is fail-closed
  - Heuristic mode: spec says "consider making LLM analysis optional — use heuristic-only by default and LLM analysis when the query is complex"
  - Temporal filter validation: ISO date ranges, trim/empty checks
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Port retriever with temporal ranking
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** the retriever combining vector search with temporal ranking, **so that** memory search returns relevant, current results.
- **Dependencies:** Sprint 004 (SqliteStore from Stories 4-5)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/retriever/ranking.ts` exports temporal boost functions: `applyTemporalBoosts()`, `recencyBoost()`, `currentFactBoost()`, `confidenceBoost()`
  - [ ] `src/retriever/index.ts` exports class implementing `Retriever` interface from `src/core/interfaces.ts`
  - [ ] Vector search channel: query embedding → store.searchSimilar → ranking
  - [ ] Keyword search channel: FTS5 BM25 search via store (per spec Phase 3g.2)
  - [ ] Temporal boost system: recency (2-year decay, 0.02 max), current fact (0.05 boost in full mode), confidence (0.007 inferred, 0.003 implied)
  - [ ] Temporal modes: `current`, `as_of`, `full`
  - [ ] All retriever and ranking tests pass
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Port retriever tests (pure logic for ranking, mocked store + embedder for retriever). Verify boost calculations, ranking order, temporal mode filtering.
- **QA:** N/A
- **Planned commits:**
  1. `feat: port retriever ranking logic` — src/retriever/ranking.ts with temporal boost functions
  2. `feat: implement retriever with temporal modes` — src/retriever/index.ts
  3. `test: port retriever and ranking tests` — tests/retriever/
- **Technical notes:**
  - Source: `~/projects/memory/src/retriever/index.ts` (127 lines), `ranking.ts` (50 lines), `types.ts` (23 lines)
  - Source tests: `~/projects/memory/tests/retriever/` (1,034 lines — extensive ranking scenarios)
  - Retriever is thin: delegates search to Store, then applies ranking boosts
  - Ranking is additive: base similarity score + sum of temporal boosts
  - No LLM dependency — pure algorithm
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: Port embedder test coverage (Phase 3f)
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** comprehensive embedder test coverage ported from source, **so that** batching, chunking, and error handling are verified beyond the basic integration tests from Sprint 002.
- **Dependencies:** Sprint 002 (LocalEmbedder)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Embedder tests ported from source covering: mock Embedder interface, batching logic, error handling
  - [ ] Existing LocalEmbedder integration tests (Sprint 002) preserved
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- **Testing approach:** Port embedder tests from source `tests/embedder/`, adapting mocked interface to Pristine's `Embedder` contract.
- **QA:** N/A
- **Planned commits:**
  1. `test: port embedder test coverage` — tests/embedder/
- **Technical notes:**
  - Source tests: `~/projects/memory/tests/embedder/`
  - LocalEmbedder implementation already exists from Sprint 002 — this story ports additional test coverage only
  - Small story — 1 commit
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
- Code compiles / app runs without errors
- Tests + linter pass (locally and CI)
- One or more commits per story (logical chunks), one PR per story
- Commit messages: conventional commits (`feat:`, `chore:`, `test:`, `docs:`) per repo CLAUDE.md
- All PRs open and Greptile-clean

---

## Completion
*(Filled by coding agent when sprint is done)*

### Summary

### Results
- Story 1: Port consolidator — PR #, status
- Story 2: Port query analyzer — PR #, status
- Story 3: Port retriever — PR #, status
- Story 4: Port embedder test coverage — PR #, status

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

### Documentation Updates
