# Pristine Local — Sprint 006
**Date:** TBD
**Goal:** Wire all memory modules into the orchestrator with ingest and retrieve pipelines, achieving full end-to-end memory: conversation in → facts stored → searchable
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3, sqlite-vec
- **Current state:** Sprints 004-005 complete. All memory pipeline modules built: temporal validation, chunker, extractor, store (SQLite + sqlite-vec + FTS5), consolidator, query analyzer, retriever with temporal ranking. Privacy pipeline from Sprint 003 operational. LocalEmbedder from Sprint 002 used for embedding throughout.
- **Implementation spec:** `docs/specs/implementation-spec-001.md` — Phase 3h
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context
- This sprint wires everything together. The orchestrator coordinates 6 modules into two pipelines: ingest (conversation → facts) and retrieve (query → ranked results).
- The ingest pipeline: chunk conversation → extract facts per chunk → embed facts → search for similar existing → consolidate (ADD/UPDATE/SUPERSEDE/DELETE/NOOP) → store in SQLite.
- The retrieve pipeline: analyze query → embed query → search store → rank results → return.
- The orchestrator uses a pluggable `PipelineStep` architecture for extensibility.
- Turn-order computation determines message ordering within chunks.
- Source file: `~/projects/memory/src/orchestrator/` (936 lines across 8 files)

### Parallelization
Stories are sequential: Story 1 (infrastructure) → Story 2 (ingest) → Story 3 (retrieve) → Story 4 (integration tests). Each builds on the previous.

### Stories
**Constraints:** Max 5 commits per story. If a story needs 6+ commits during planning, split it.

#### Story 1: Port orchestrator types and pipeline infrastructure
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
- **As a** developer, **I want** the orchestrator types and pipeline step infrastructure, **so that** the ingest and retrieve pipelines can be wired with pluggable steps.
- **Dependencies:** Sprints 004-005
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/memory/orchestrator/types.ts` exports: `PipelineStep`, `PipelineContext`, `IngestOptions`, `IngestResult`, `OrchestratorConfig`
  - [ ] `src/memory/orchestrator/pipeline.ts` exports pipeline step execution utilities
  - [ ] `src/memory/orchestrator/turn-order.ts` exports turn-order computation for chunk message ordering
  - [ ] Types compile and are usable by ingest/retrieve modules
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Unit tests for turn-order computation (pure logic). Pipeline step execution tested via integration in Stories 2-3.
- **QA:** N/A
- **Planned commits:**
  1. `feat: port orchestrator types and pipeline step infrastructure` — types.ts, pipeline.ts
  2. `feat: port turn-order computation` — turn-order.ts with tests
- **Technical notes:**
  - Source: `~/projects/memory/src/orchestrator/types.ts` (62 lines), `pipeline.ts` (58 lines), `turn-order.ts` (69 lines)
  - PipelineStep interface: `{ name, execute(context) }` — each step receives and returns a mutable context
  - Turn-order: computes sequential message indices for chunked conversations
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Wire ingest pipeline
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
- **As a** developer, **I want** the ingest pipeline wired end-to-end, **so that** conversations are chunked, facts extracted, embedded, consolidated, and stored in SQLite.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/memory/orchestrator/ingest.ts` implements the full ingest flow: chunk → extract → embed → search similar → consolidate → store
  - [ ] Content hash dedup prevents re-processing identical conversations
  - [ ] Source conversation ID tracked on stored memories
  - [ ] Each pipeline step callable independently and composable
  - [ ] Ingest tests pass with mocked modules (verify step ordering, context threading)
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Mock all 6 modules (extractor, embedder, store, consolidator, retriever, query-analyzer). Verify pipeline step execution order, context data flow, error handling.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement ingest pipeline` — src/orchestrator/ingest.ts
  2. `test: add ingest pipeline tests` — tests/memory/orchestrator/ingest.test.ts
- **Technical notes:**
  - Source: `~/projects/memory/src/orchestrator/ingest.ts` (449 lines)
  - Ingest flow: (1) hash conversation for dedup, (2) chunk into manageable pieces, (3) extract facts per chunk, (4) embed each fact, (5) search for similar existing facts, (6) consolidate new vs existing, (7) apply consolidation actions to store
  - Consolidation actions map: ADD → store.addMemory, UPDATE → store.updateMemory, SUPERSEDE → store.supersedeMemory, DELETE → store.deleteMemory, NOOP → skip
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Wire retrieve pipeline
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
- **As a** developer, **I want** the retrieve pipeline wired end-to-end, **so that** search queries are analyzed, embedded, and matched against stored memories with temporal ranking.
- **Dependencies:** Story 1, Sprint 005 (query analyzer, retriever)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/memory/orchestrator/retrieve.ts` implements: analyze query → embed query → retrieve from store → rank → return
  - [ ] Query analyzer results feed into retriever (intent, filters, suggested topK)
  - [ ] Retrieve tests pass with mocked modules
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Mock query analyzer, embedder, retriever. Verify query analysis feeds correctly into retriever, results returned in expected format.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement retrieve pipeline` — src/orchestrator/retrieve.ts
  2. `test: add retrieve pipeline tests` — tests/memory/orchestrator/retrieve.test.ts
- **Technical notes:**
  - Source: `~/projects/memory/src/orchestrator/retrieve.ts` (103 lines)
  - Simpler than ingest: analyze → embed → retrieve → return
  - Query analyzer provides: intent, filters (temporal, topic, agent), suggested topK, rewritten query
  - Retriever uses rewritten query embedding for better vector match
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: Create orchestrator and end-to-end integration tests
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
- **As a** developer, **I want** the orchestrator class and end-to-end integration tests, **so that** I can verify the full memory pipeline works: conversation in → facts stored → searchable.
- **Dependencies:** Stories 1-3
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/memory/orchestrator/index.ts` exports `Orchestrator` class with `ingest()`, `retrieve()`, pipeline step registration
  - [ ] `createOrchestrator(config)` factory function with dependency injection
  - [ ] `store()` and `search()` convenience methods on orchestrator (aliases for `ingest()` and `retrieve()` with simplified signatures for the common case)
  - [ ] End-to-end test: ingest a multi-turn conversation with mocked LLM, search, verify correct facts returned
  - [ ] End-to-end test: ingest, then ingest same conversation again, verify dedup (no duplicate facts)
  - [ ] End-to-end test: ingest conversation with temporal facts, search with temporal filter, verify filtering works
  - [ ] End-to-end tests skippable when embedding model is unavailable (CI-safe via `describe.skipIf`)
  - [ ] All orchestrator tests pass
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- **Testing approach:** End-to-end tests using in-memory SQLite, real embedder (Nomic Embed), and mocked LlmClient. Verify full pipeline from conversation input to search results.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement orchestrator with ingest and retrieve` — src/orchestrator/index.ts, factory function
  2. `test: add end-to-end orchestrator integration tests` — tests/integration/orchestrator.test.ts
- **Technical notes:**
  - Source: `~/projects/memory/src/orchestrator/orchestrator.ts` (166 lines), `index.ts` (3 lines)
  - Source tests: `~/projects/memory/tests/pipeline/orchestrator.test.ts` (1,071 lines)
  - Factory: `createOrchestrator({ llmClient, embedder, store, ... })` — all dependencies injected
  - For e2e tests: mock LlmClient to return known facts, use real embedder + real SQLite store
  - This is the milestone: after this sprint, the core memory pipeline is complete
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
- Story 1: Port orchestrator infrastructure — PR #, status
- Story 2: Wire ingest pipeline — PR #, status
- Story 3: Wire retrieve pipeline — PR #, status
- Story 4: Orchestrator + e2e tests — PR #, status

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
