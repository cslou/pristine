# Pristine Local — Sprint 004
**Date:** TBD
**Goal:** Build memory pipeline foundations: temporal validation, conversation chunking, fact extraction via LLM, and SQLite memory store with vector search
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3, sqlite-vec
- **Current state:** Sprint 003 (privacy pipeline) complete. 193 tests passing. Sanitizer, classifier (deterministic + LLM + combined), vault (RSA/AES crypto + SQLite), and privacy pipeline (`secureAndRedact`, `reveal`, `scrubOutput`) all working. Local LLM inference (llamacpp + ollama) and embedding (Nomic Embed v1.5, 768-dim) operational.
- **Implementation spec:** `docs/specs/implementation-spec-001.md` — Phase 3a, 3b, 3c
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context
- This sprint starts the memory pipeline — the core of the SDK. At the end, we can extract facts from conversations and store them in SQLite with vector search.
- The extractor adapts from Anthropic SDK `messages.create()` with tool calling to `LlmClient.generate<T>()` — same pattern used in the classifier (Sprint 003).
- The store adapts from PostgreSQL (`pg.Pool`) to SQLite (`better-sqlite3`). Vector search via `sqlite-vec` cosine distance. Full-text search via FTS5 with sync triggers.
- Temporal validation is pure logic ported directly from source — no adaptation needed.
- Source files for reference: `~/projects/memory/src/temporal/`, `~/projects/memory/src/extractor/`, `~/projects/memory/src/store/`, `~/projects/memory/src/orchestrator/chunker.ts`

### Parallelization
Story 0 (docs) runs first — no code dependencies. Story 1 (temporal) must come before Stories 3-5. Story 2 (chunker) is independent. Story 3 (extractor) depends on Story 1. Stories 4-5 (store CRUD, store search+supersession) are sequential. Extractor and store tracks are independent of each other.

### Stories
**Note:** This sprint has 6 stories (Story 0 for docs + 5 code stories across 3 spec sub-phases). Max 5 commits per story.

#### Story 0: Update documentation for workstream directory structure
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
- **As a** developer, **I want** documentation reflecting the current module structure with extension guides, **so that** contributors know where modules live and how to add new engines or models.
- **Dependencies:** None
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Implementation spec repo structure table updated: all `src/classifier/`, `src/sanitizer/`, `src/vault/`, `src/extractor/`, `src/store/`, `src/temporal/`, `src/retriever/`, `src/query-analyzer/`, `src/orchestrator/`, `src/episodes/`, `src/graph/` paths replaced with `src/privacy/...` or `src/memory/...` equivalents
  - [ ] Implementation spec Section 9 (repo structure tree) reflects the new directory layout
  - [ ] New section added to implementation spec: "Extension Guide" with concrete examples for adding a new LLM engine and adding a new model to the registry
  - [ ] Sprint 004, 005, 006 file paths verified (already updated in restructure PR, but verify no stale refs)
  - [ ] `npm run typecheck` and `npm test` pass (no code changes, just docs)
- **Testing approach:** Grep for stale paths across all docs to verify completeness. No code changes — typecheck/test as sanity check.
- **QA:** N/A
- **Planned commits:**
  1. `docs: update implementation spec paths for workstream directory structure` — bulk path replacement + repo structure tree update
  2. `docs: add extension guide for new engines and models` — concrete examples showing how to add an MLX engine or a new GGUF model
- **Technical notes:**
  - ~36 stale path references in implementation spec need updating
  - Extension guide should reference: `LlmClient` interface (`src/core/interfaces.ts:39-46`), `Embedder` interface (`src/core/interfaces.ts:52-55`), engine factory (`src/engine/index.ts`), model registry (`src/models/registry.ts`)
  - Examples: "Adding MLX Swift engine", "Adding a new GGUF model to the registry"
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 1: Port temporal validation utilities
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
- **As a** developer, **I want** temporal field validation working, **so that** the extractor and store can correctly handle time-bounded facts.
- **Dependencies:** None
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/memory/temporal/index.ts` exports `validateTemporalFields()` with ISO date validation, temporal bounds checking (validFrom <= validUntil), and confidence policies
  - [ ] `src/memory/temporal/types.ts` re-exports temporal types from core (TemporalConfidence, etc.)
  - [ ] Validates: ISO 8601 format, rejects invalid dates, handles undefined fields, applies confidence-based policies
  - [ ] Temporal validation tests pass (ported from source `tests/memory/temporal/`)
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Port temporal tests directly — pure logic, no mocks needed. Port key validation scenarios (valid dates, invalid dates, bounds checking, confidence policies).
- **QA:** N/A
- **Planned commits:**
  1. `feat: port temporal validation utilities` — src/temporal/index.ts, types.ts
  2. `test: port temporal validation tests` — tests/memory/temporal/
- **Technical notes:**
  - Source: `~/projects/memory/src/temporal/index.ts` (111 lines), `types.ts` (13 lines)
  - Source tests: `~/projects/memory/tests/memory/temporal/` (1,145 lines — extensive, port key scenarios)
  - Pure logic, no external dependencies
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Port conversation chunker
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
- **As a** developer, **I want** conversation chunking, **so that** long conversations can be split into manageable pieces for the extractor.
- **Dependencies:** None
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/memory/orchestrator/chunker.ts` exports `chunkConversation()` with configurable `CHUNK_SIZE` and `CHUNK_OVERLAP`
  - [ ] Chunks are arrays of `Message[]` with overlap for context continuity
  - [ ] Handles edge cases: empty conversation, single message, exactly chunk-size
  - [ ] Chunker tests pass (ported from source `tests/memory/orchestrator/chunker.test.ts`)
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Port chunker tests — pure logic, splits message arrays by token/message count.
- **QA:** N/A
- **Planned commits:**
  1. `feat: port conversation chunker` — src/orchestrator/chunker.ts
  2. `test: port chunker tests` — tests/memory/orchestrator/chunker.test.ts
- **Technical notes:**
  - Source: `~/projects/memory/src/orchestrator/chunker.ts` (26 lines)
  - Source tests: `~/projects/memory/tests/memory/orchestrator/chunker.test.ts`
  - Very small module — straightforward port
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Port extraction prompt, schema, and extractor implementation
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
- **As a** developer, **I want** the fact extractor working with local LLM, **so that** conversations can be processed into structured facts with temporal metadata.
- **Dependencies:** Story 1 (temporal types)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/memory/extractor/prompts.ts` contains `buildExtractionPrompt()` — system prompt configurable via `PromptConfig.extractor`
  - [ ] `src/memory/extractor/schema.ts` contains `EXTRACT_FACTS_SCHEMA` as plain JSON Schema (not Anthropic tool format)
  - [ ] `src/memory/extractor/index.ts` exports class implementing `Extractor` interface from `src/core/interfaces.ts`, using `LlmClient.generate<T>()` — ported from source with Anthropic SDK adaptation
  - [ ] Extracted facts include: text, temporal fields (validFrom, validUntil, temporalConfidence), pronoun filtering
  - [ ] `ExtractionError` thrown on LLM failure (fail-closed)
  - [ ] Prompt configurable via constructor config (same pattern as LlmClassifier.systemPrompt)
  - [ ] All extractor tests pass (ported from source, mocking `generate<T>()`)
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Port extractor tests from source, adapting mocked `messages.create` to mocked `generate<T>()`. Same mock adapter pattern used in classifier tests.
- **QA:** N/A
- **Planned commits:**
  1. `feat: port extraction prompt and schema` — src/extractor/prompts.ts, src/extractor/schema.ts
  2. `feat: implement extractor with generate<T>()` — src/extractor/index.ts, adapted from Anthropic SDK
  3. `test: port extractor tests` — tests/memory/extractor/
- **Technical notes:**
  - Source: `~/projects/memory/src/extractor/index.ts` (207 lines), `types.ts` (88 lines)
  - Source prompt: `~/projects/memory/src/prompts/extraction.ts`
  - Source tests: `~/projects/memory/tests/pipeline/extractor.test.ts` (542 lines)
  - Key adaptation: `messages.create()` with tool calling → `generate<T>()` with schema. Same pattern as classifier Story 2 in Sprint 003.
  - Pronoun filter: regex that rejects facts starting with unresolved pronouns ("He lives in...", "She works at...")
  - Temporal confidence: `explicit` (date mentioned), `inferred` (time reference), `implied` (general statement)
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: Build SQLite memory store — tables and CRUD
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
- **As a** developer, **I want** memory tables created in SQLite with basic CRUD, **so that** extracted facts can be persisted.
- **Dependencies:** Story 1 (temporal types)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `memories`, `memory_vectors` (sqlite-vec 768-dim), `memories_fts` (FTS5 with sync triggers) SQLite tables created on module init
  - [ ] `src/memory/store/sqlite/index.ts` exports `SqliteStore` implementing `Store` interface from `src/core/interfaces.ts`
  - [ ] `addMemory()` stores fact with embedding in sqlite-vec and text in FTS5
  - [ ] `getMemory()` retrieves by ID + userId
  - [ ] `updateMemory()` updates fields, syncs FTS5
  - [ ] `deleteMemory()` soft delete via is_deleted flag
  - [ ] `clearAll()` with optional userId filter
  - [ ] Content hash dedup (SHA-256 + UNIQUE constraint on user_id + content_hash)
  - [ ] CRUD tests pass with in-memory SQLite
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** SQLite in-memory database. Test add/get/update/delete/clearAll. Test content hash dedup (same text, same user = rejected). Test soft delete (deleted memories excluded from get).
- **QA:** N/A
- **Planned commits:**
  1. `feat: create memory SQLite tables with vector and FTS5 indexes` — DDL with sqlite-vec, FTS5, sync triggers
  2. `feat: implement SqliteStore CRUD operations` — addMemory, getMemory, updateMemory, deleteMemory, clearAll, content hash dedup
  3. `test: add memory store CRUD tests` — tests/memory/store/
- **Technical notes:**
  - Source: `~/projects/memory/src/store/index.ts` (602 lines), `types.ts` (78 lines)
  - SQLite adaptation: `$1` → `?`, `pg.Pool` → `better-sqlite3.Database`
  - FTS5 sync triggers: INSERT/UPDATE/DELETE triggers on `memories` that keep `memories_fts` in sync
  - sqlite-vec: `CREATE VIRTUAL TABLE memory_vectors USING vec0(embedding float[768])` — rowid maps to memories.rowid
  - Soft deletes: `is_deleted` flag, queries exclude deleted by default
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 5: Build SQLite memory store — vector search, FTS5, and supersession
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
- **As a** developer, **I want** vector search, keyword search, and supersession chains, **so that** memories are searchable by similarity, keywords, and linked through updates.
- **Dependencies:** Story 4 (SqliteStore CRUD)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `searchSimilar()` performs cosine distance search via sqlite-vec `vec_distance_cosine()`, returns ranked results
  - [ ] FTS5 keyword search via `memories_fts MATCH` query
  - [ ] Temporal modes in search: `current` (valid now), `as_of` (valid at date), `full` (no filter)
  - [ ] `supersedeMemory()` creates new memory linked to old via superseded_by, sets validUntil on old
  - [ ] `getSupersessionChain()` follows chain with cycle detection (max depth 50)
  - [ ] Vector search + supersession tests pass
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- **Testing approach:** Test vector search with known embeddings (verify cosine distance ranking). Test FTS5 keyword search. Test temporal mode filtering. Test supersession chain traversal with cycle detection.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement vector search and temporal filtering` — searchSimilar via sqlite-vec with temporal modes
  2. `feat: implement FTS5 keyword search` — keyword search via memories_fts MATCH
  3. `feat: implement supersession chains` — supersedeMemory, getSupersessionChain with cycle detection
  4. `test: add vector search, FTS5, and supersession tests` — tests/memory/store/
- **Technical notes:**
  - Source tests: `~/projects/memory/tests/memory/store/` (1,275 lines — port search + supersession scenarios)
  - sqlite-vec cosine: `SELECT rowid, vec_distance_cosine(embedding, ?) AS distance FROM memory_vectors ORDER BY distance LIMIT ?`
  - FTS5: `SELECT rowid, rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank`
  - Supersession: recursive query or iterative loop with max depth 50 and visited set for cycle detection
  - Temporal modes: WHERE clauses on validFrom/validUntil columns
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
- Story 0: Update documentation — PR #, status
- Story 1: Port temporal validation — PR #, status
- Story 2: Port conversation chunker — PR #, status
- Story 3: Port fact extractor — PR #, status
- Story 4: Build SqliteStore CRUD — PR #, status
- Story 5: Build SqliteStore search + supersession — PR #, status

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
