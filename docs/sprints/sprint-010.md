# Pristine Local — Sprint 010
**Date:** TBD
**Goal:** Move embedding to Ollama (eliminating the daemon requirement) and expose temporalMode on the search API so agents can filter by temporal validity
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3, sqlite-vec
- **Current state:** Sprint 009 expected complete. Conversation store added (SQLite + FTS5), ingest pipeline writes conversations before extraction, `sourceConversationId` links facts to conversations, `searchConversations()` and `getConversation()` exposed on client. The embedder is still hardcoded to `LocalEmbedder` (@huggingface/transformers, in-process, 300MB model, 2-3s cold start). The `search()` convenience method only accepts `topK` — `temporalMode` requires using `orchestrator.retrieve()` directly.
- **Implementation spec:** `docs/specs/implementation-spec-003.md` — Phases 3 + 4
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context
- This sprint makes the embedder configurable and Pristine stateless. The current `LocalEmbedder` loads a 300MB HuggingFace model into the Node process. Moving to Ollama for embedding means scripts open SQLite, call Ollama via HTTP, and exit — no model loading, no daemon, no cold start.
- Ollama runs the embedding model (`nomic-embed-text`) on a separate model queue from the LLM (`llama3.2`). They don't compete — embedding calls complete in ~0.1s even while extraction is running.
- The `models.json` config gains an `embedder` section. Missing section falls back to current `LocalEmbedder` for backward compatibility.
- The `search()` temporalMode change is a small API surface update that's been pending since Sprint 006. Bundled here because it's a quick win alongside the embedder work.

### Parallelization
Stories 1-2 (Ollama embedder) are sequential. Story 3 (temporalMode API) is independent and can run in parallel with Stories 1-2. Note: Stories 2 and 3 both touch `src/client.ts` (factory method vs. search method) — trivially resolvable merge conflict expected if developed in parallel. Story 4 depends on all three.

### Stories
**Constraints:** Max 5 stories per sprint. Max 5 commits per story. If a story needs 6+ commits during planning, split it.

#### Story 1: Implement OllamaEmbedder and embedder factory
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
- **As a** developer, **I want** an Ollama-backed embedder that calls `/api/embed`, **so that** embedding uses the same Ollama instance as LLM inference with no in-process model loading.
- **Dependencies:** None
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/embedder/ollama/index.ts` exports `OllamaEmbedder` implementing `Embedder` interface
  - [ ] `OllamaEmbedder` calls `POST http://localhost:11434/api/embed` (or configured host) with `{ model, input }`
  - [ ] `embed(text)` returns `number[]` of correct dimension (768 for nomic-embed-text)
  - [ ] `embedBatch(texts)` returns `number[][]` — batches via multiple API calls or single call with array input (check Ollama API support)
  - [ ] Configurable model name and host (default: `nomic-embed-text`, `localhost:11434`)
  - [ ] Throws `EmbedderError` on HTTP failure or invalid response
  - [ ] `src/embedder/index.ts` exports `createEmbedder(config)` factory — selects `OllamaEmbedder`, `LocalEmbedder`, or future engines based on config
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Unit tests with mocked HTTP responses for Ollama API. Integration test with real Ollama (skippable). Factory tests: correct engine selected for each config.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement OllamaEmbedder` — src/embedder/ollama/index.ts
  2. `feat: add createEmbedder factory` — src/embedder/index.ts
  3. `test: add OllamaEmbedder and factory tests` — tests/embedder/ollama.test.ts, tests/embedder/factory.test.ts
- **Technical notes:**
  - Ollama `/api/embed` accepts `{ model: string, input: string | string[] }` and returns `{ embeddings: number[][] }`. Check if batch input is supported — if not, loop over texts sequentially.
  - The `OLLAMA_HOST` env var should be respected (same as OllamaClient for LLM)
  - No `dispose()` needed — OllamaEmbedder is stateless (just HTTP calls)
  - Connection-refused handling: throw `EmbedderError` with message including the host URL and guidance ("Is Ollama running? Check `ollama serve` or OLLAMA_HOST"). Same pattern as `OllamaClient` for LLM (see `src/engine/ollama/index.ts` error handling). No retries on connection refused — fail immediately.
  - The factory reads an embedder config object: `{ engine: 'ollama' | 'local', model?: string, host?: string }`. Do not include `llamacpp` as an option yet — throw `ConfigError` for unsupported engines
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Wire embedder config into models.json and PristineLocal
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
- **As a** developer, **I want** the embedder to be configurable via `models.json`, **so that** users can choose Ollama embedding (no daemon) or keep the current local embedder.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `models.json` supports an `embedder` section: `{ "engine": "ollama", "model": "nomic-embed-text" }`
  - [ ] `loadModelConfig()` in `src/core/init.ts` parses and validates the `embedder` section
  - [ ] Missing `embedder` section falls back to `{ "engine": "local" }` (backward compatible)
  - [ ] `PristineLocal.create()` uses `createEmbedder()` factory instead of hardcoded `createLocalEmbedder()`
  - [ ] With Ollama embedder, `PristineLocal.create()` is near-instant (no 300MB model download)
  - [ ] Default `models.json` template updated to include embedder section
  - [ ] DI config still accepts `embedder?: Embedder` override (for testing)
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Update existing client tests to verify createEmbedder is used. Integration test: full pipeline with Ollama embedder (store + search round-trip). Backward compat test: missing embedder config falls back to local.
- **QA:** N/A
- **Planned commits:**
  1. `feat: add embedder config to models.json and loadModelConfig` — src/core/init.ts
  2. `refactor: use createEmbedder factory in PristineLocal.create` — src/client.ts
  3. `test: verify embedder config and factory wiring` — tests/core/init.test.ts additions, tests/client.test.ts updates
- **Technical notes:**
  - The `ModelConfig` type in `src/core/init.ts` gains `embedder?: EmbedderEntry` where `EmbedderEntry = { engine: 'ollama', model: string, host?: string } | { engine: 'local', model?: string }`. The `llamacpp` embedder is deferred to a future sprint — do not include it in the type. The factory throws `ConfigError` for any unrecognized engine string.
  - `validateEmbedderEntry()` follows the same pattern as `validateModelEntry()`
  - `PristineLocal.create()` flow: `config.embedder ?? createEmbedder(modelConfig.embedder ?? { engine: 'local' })`. Note: currently `PristineLocal.create()` does not access `modelConfig` directly — `initPristine()` returns it nested in `InitPristineResult`. Thread `init.config` (which is a `ModelConfig`) through to the embedder factory call.
  - The `ownsEmbedder` flag in PristineLocal stays — DI'd embedders are not disposed, factory-created ones are (though OllamaEmbedder has no dispose)
  - Do NOT change `DEFAULT_MODEL_CONFIG` — new installs default to no `embedder` key, which falls back to `{ engine: 'local' }`. This avoids breaking new users who don't have Ollama installed. Users who want Ollama embedding add the `embedder` section to `models.json` manually. A future sprint can change the default after Ollama embedding is proven in production.
  - **Test strategy:** All existing `PristineLocal.create()` tests inject an embedder via DI config — they never hit the factory path. Confirm this by reviewing `tests/client.test.ts` and `tests/e2e/sdk.test.ts` before implementation. If any test omits the DI embedder, add it.
  - The factory should throw a clear `ConfigError` for unsupported engines (e.g., `llamacpp` for embedder when no implementation exists yet) rather than silently failing
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Expose temporalMode on search() convenience method
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
- **As a** developer, **I want** to pass `temporalMode` and `asOf` to `search()`, **so that** I can filter results to only currently-valid facts without using the orchestrator directly.
- **Dependencies:** None (can run in parallel with Stories 1-2)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `search()` signature changes from `(query, userId, topK?)` to `(query, userId, options?: SearchOptions)`
  - [ ] `SearchOptions` type: `{ topK?, temporalMode?: 'current' | 'as_of' | 'full', asOf?: string }`
  - [ ] `Orchestrator.search()` updated to match (delegates to `retrieve()` with options)
  - [ ] `SearchOptions` exported from barrel (`src/index.ts`)
  - [ ] Default `temporalMode` is `'current'` — unchanged from current behavior (retriever already defaults to `'current'`), this story makes the option explicit and user-controllable
  - [ ] Existing callers passing `topK` as a number updated to pass `{ topK }` object — update all call sites in tests and client code
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` pass
- **Testing approach:** Unit tests: search with temporalMode='current' excludes superseded facts, 'as_of' filters by date, 'full' returns everything. Verify backward compat: existing calls without options still work.
- **QA:** N/A
- **Planned commits:**
  1. `feat: add SearchOptions type and update search() signatures` — src/core/types.ts, src/core/interfaces.ts, src/memory/orchestrator/index.ts, src/client.ts
  2. `feat: export SearchOptions from barrel` — src/index.ts
  3. `test: verify temporalMode filtering on search()` — tests/client.test.ts additions
- **Technical notes:**
  - The `Orchestrator` interface in `src/core/interfaces.ts` has `search(query, userId, topK?)` — change to `search(query, userId, options?: SearchOptions)`
  - The orchestrator implementation delegates: `this.retrieve(query, userId, options)` — `RetrieveOptions` already has `topK`, `temporalMode`, `asOf`
  - `PristineLocal.search()` passes through: `this.orchestrator.search(query, userId, options)`
  - The `SearchOptions` type is a subset of `RetrieveOptions` — consumer-facing, simpler naming
  - **Breaking change:** `search(query, userId, 10)` no longer compiles — must be updated to `search(query, userId, { topK: 10 })`. Only known breaking call site: `tests/integration/orchestrator.test.ts:154` (passes numeric `topK`). Non-breaking two-arg calls (no update needed): `tests/client.test.ts`, `tests/e2e/sdk.test.ts`, `tests/integration/conversation-store.test.ts`, `tests/integration/orchestrator.test.ts:136`. Grep for `\.search(` across all test files before committing to catch any missed sites.
  - Calls without options (`search(query, userId)`) are unaffected — backward compatible
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: End-to-end verification with Ollama embedder
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
- **As a** developer, **I want** end-to-end smoke tests proving the Ollama embedder, config wiring, temporalMode, and backward compatibility all work together, **so that** I know the sprint's changes integrate correctly with the existing SDK.
- **Dependencies:** Stories 1, 2, 3
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] E2e test: `PristineLocal.create()` with Ollama embedder config → `store()` → `search()` returns matching facts (round-trip through Ollama embedding)
  - [ ] E2e test: `PristineLocal.create()` with missing embedder config → falls back to LocalEmbedder → `store()` + `search()` still works (backward compat)
  - [ ] E2e test: `search(query, userId, { temporalMode: 'current' })` excludes superseded facts, `{ temporalMode: 'full' }` includes them
  - [ ] E2e test: `searchConversations()` and `getConversation()` still work (regression — conversation store unaffected by embedder change)
  - [ ] E2e test: `PristineLocal.create()` with Ollama embedder is near-instant (< 500ms, no model download)
  - [ ] Ollama e2e tests skippable via `SKIP_OLLAMA_TESTS=1` (requires Ollama running with `nomic-embed-text` pulled)
  - [ ] All tests pass: `npm run typecheck`, `npm test`, `npm run lint`
- **Testing approach:** Two test files: (1) Ollama integration tests with real Ollama (skippable), (2) unit tests with mocked HTTP to verify factory wiring and config fallback without Ollama dependency.
- **QA:**
  - Lou: run `ollama pull nomic-embed-text` then `SKIP_OLLAMA_TESTS= npm test` to verify real Ollama round-trip
  - Lou: verify `PristineLocal.create()` startup time with Ollama embedder vs LocalEmbedder
- **Planned commits:**
  1. `test: add Ollama embedder end-to-end and regression tests` — tests/integration/ollama-embedder.test.ts, tests/e2e/embedder-config.test.ts
- **Technical notes:**
  - Ollama tests require `nomic-embed-text` model pulled and Ollama server running
  - Use `SKIP_OLLAMA_TESTS=1` env var (separate from `SKIP_SLOW_TESTS` since LocalEmbedder tests are slow but don't need Ollama)
  - Backward compat test: create client WITHOUT embedder config section in models.json → verify it still uses LocalEmbedder and produces correct results
  - temporalMode test: uses mock LLM client (not real Ollama LLM) for deterministic extraction/consolidation. Ingest a conversation with "I used to work at Meta, now I work at Google" → mock returns two facts where Google supersedes Meta → search with `current` returns only Google, `full` returns both. Embedder can be either real Ollama or mock depending on skip flag.
  - Startup time test: `Date.now()` before and after `PristineLocal.create()` with Ollama embedder, assert < 500ms
  - Conversation store regression: store + searchConversations + getConversation work identically regardless of embedder engine
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
- `OllamaEmbedder` works end-to-end (embed + search round-trip via Ollama)
- `models.json` embedder config parsed, validated, backward compatible
- `PristineLocal.create()` near-instant with Ollama embedder
- `search()` accepts `temporalMode` and filters correctly
- E2e smoke tests pass: Ollama round-trip, LocalEmbedder fallback, temporalMode filtering, conversation store regression
- Lou verifies: `ollama pull nomic-embed-text && SKIP_OLLAMA_TESTS= npm test`
- Tests + linter pass (locally and CI)
- One or more commits per story (logical chunks), one PR per story
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`) per repo CLAUDE.md
- All PRs open and Greptile-clean

---

## Completion
*(Filled by coding agent when sprint is done)*

### Summary

### Results
- :white_check_mark: Story 1: OllamaEmbedder + factory — PR #, status
- :white_check_mark: Story 2: Embedder config + PristineLocal wiring — PR #, status
- :white_check_mark: Story 3: temporalMode on search() — PR #, status
- :white_check_mark: Story 4: E2e verification + regression — PR #, status

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
