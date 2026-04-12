# Pristine Local — Sprint 007
**Date:** TBD
**Goal:** Package the SDK with a unified `PristineLocal` client class so consumers can `npm install` and call `create()` → `store()` / `search()` / `secureAndRedact()` / `reveal()` without manual wiring
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3, sqlite-vec
- **Current state:** Sprints 001-006 complete. Full privacy pipeline (classify → sanitize → vault → reveal) and full memory pipeline (ingest → retrieve via orchestrator) working end-to-end locally. 547 tests passing. `initPristine()` scaffolds `~/.pristine/` dirs + `models.json` + SQLite DB. `createLlmClients()` reads `models.json` for per-pipeline LLM config. `createOrchestrator()` factory wires all memory modules. Privacy pipeline has `secureAndRedact()`, `reveal()`, `scrubOutput()` public functions. No unified client class — consumers must manually wire 8+ modules together.
- **Implementation spec:** `docs/specs/implementation-spec-001.md` — Phase 7
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context
- This sprint creates the SDK surface that downstream consumers (MCP servers, Claude Code skills, Pi skills, CLI tools) import. The goal is a single `PristineLocal.create()` call that returns a ready-to-use client.
- The client wraps the orchestrator (memory) and privacy pipeline, managing lifecycle (embedder init, DB connection, model loading, graceful shutdown).
- `src/index.ts` is currently an empty placeholder — this sprint populates it as the public API barrel export.
- No new dependencies should be needed. All functionality already exists in internal modules.
- package.json already has `"main": "dist/index.js"` and `"types": "dist/index.d.ts"` — the build step (`tsc`) produces these.
- Episodes and entity graph (Phases 4-5) are NOT in scope — the client exposes only what's implemented today.
- The current `tsconfig.json` includes `"tests"` in its `include` array — the build step must exclude tests from `dist/` output (see Story 3).

### Parallelization
Stories are sequential: Story 1 (client class) → Story 2 (barrel exports) → Story 3 (build + packaging) → Story 4 (integration test).

### Stories
**Constraints:** Max 5 stories per sprint. Max 5 commits per story. If a story needs 6+ commits during planning, split it.

#### Story 1: Implement PristineLocal client class
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
- **As a** developer, **I want** a `PristineLocal` client class that wires all modules together, **so that** I can call `PristineLocal.create()` and immediately use memory and privacy features without manual setup.
- **Dependencies:** Sprint 006
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/client.ts` exports `PristineLocal` class with async `create(config?)` static factory
  - [ ] `create()` calls `initPristine()`, creates LLM clients via `createLlmClients()`, creates embedder, store, and all pipeline modules
  - [ ] Config accepts optional dependency overrides for testing and advanced use: `db?: Database`, `llmClients?: { privacyClient: LlmClient; memoryClient: LlmClient }`, `embedder?: Embedder`
  - [ ] Client exposes: `store(conversation, userId)`, `search(query, userId, topK?)`, `secureAndRedact(text, userId)`, `reveal(redactedText, userId)`, `scrubOutput(text)`
  - [ ] Client exposes `orchestrator` property for direct access to advanced pipeline features (custom steps, temporal queries)
  - [ ] `dispose()` method cleanly shuts down embedder and closes DB connection
  - [ ] Config is optional — defaults to `~/.pristine/` paths and `models.json` settings
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Unit tests with mocked modules verifying: create() wires dependencies correctly, store/search delegate to orchestrator, secureAndRedact/reveal delegate to privacy pipeline, dispose() calls embedder.dispose() and db.close(). Use DI overrides to inject mocks without touching the filesystem.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement PristineLocal client class` — src/client.ts with create(), store(), search(), privacy methods, dispose(), DI config
  2. `test: add PristineLocal client tests` — tests/client.test.ts
- **Technical notes:**
  - `create()` is async because embedder init downloads the model on first run (~300MB)
  - Config interface: `{ baseDir?: string; configDir?: string; db?: Database; llmClients?: LlmClients; embedder?: Embedder }` — all optional. When DI fields are provided, skip the corresponding default initialization (don't call initPristine for db, don't call createLlmClients for llmClients, don't create LocalEmbedder for embedder).
  - The client holds references to: db (Database), embedder (Embedder), orchestrator (Orchestrator), and the privacy pipeline deps (classifier, sanitizer, vault, keyManager, kekManager)
  - `KekManager` is required by both `secureAndRedact` and `reveal` — don't forget it in the wiring. See `src/privacy/index.ts` for the full `SecureAndRedactConfig` and `RevealConfig` shapes.
  - `secureAndRedact()` and `reveal()` already exist as standalone functions in `src/privacy/index.ts` — the client wraps them with pre-configured deps
  - `scrubOutput()` is a simple synchronous function (regex strip of `[SENSITIVE:...]` placeholders) — delegate directly
  - Don't duplicate logic — the client is a thin composition layer
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Public API barrel exports
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
- **As a** SDK consumer, **I want** clean imports from the package root, **so that** I can `import { PristineLocal } from '@pristine/shield-local'` without knowing internal module paths.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/index.ts` exports `PristineLocal` class and its config type
  - [ ] `src/index.ts` exports key types consumers need: `Message`, `Memory`, `RankedMemory`, `RetrieveResult`, `IngestResult`, `Fact`, `AnalyzedQuery`, `RetrieveOptions`, `IngestOptions`
  - [ ] `src/index.ts` exports interface types needed for DI and advanced use: `LlmClient`, `Embedder`, `Orchestrator`, `PipelineStep`
  - [ ] `src/index.ts` exports error classes: `AppError`, `OrchestratorError`, `ConfigError`, `EmbedderError`
  - [ ] No internal implementation details exported (no store, extractor, consolidator, etc. from root)
  - [ ] `npm run typecheck` passes
- **Testing approach:** Typecheck only — verify exports compile. No runtime tests needed (barrel is re-exports).
- **QA:** N/A
- **Planned commits:**
  1. `feat: populate public API barrel exports` — src/index.ts
- **Technical notes:**
  - Keep the export surface minimal but sufficient. Consumers who need advanced access use `client.orchestrator` property — they need types like `RetrieveOptions`, `PipelineStep` for that.
  - `LlmClient` and `Embedder` must be exported so consumers can type custom implementations and test mocks (Story 4 depends on this).
  - Export types with `export type` where possible to keep the JS bundle small.
  - Don't export module factories (createExtractor, createConsolidator, etc.) — those are internal wiring.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Build pipeline and package.json exports map
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
- **As a** developer, **I want** `npm run build` to produce a working dist/ with proper exports, **so that** the package can be consumed via npm install or local file path.
- **Dependencies:** Story 2
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `npm run build` produces `dist/` with .js and .d.ts files (source files only, no test files)
  - [ ] `package.json` has `"exports"` map pointing to dist/index.js
  - [ ] `package.json` has `"files"` field limiting published content to `dist/` and `package.json`
  - [ ] A consumer project can `npm install ../pristine` (local path) and `import { PristineLocal } from '@pristine/shield-local'` with full type support
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- **Testing approach:** Manual verification — run `npm run build`, inspect dist/ output (no test files present), verify exports resolve correctly from a test consumer.
- **QA:** N/A
- **Planned commits:**
  1. `chore: add tsconfig.build.json and configure package.json exports` — tsconfig.build.json, package.json updates, build script change
  2. `chore: add dist/ to .gitignore` — ensure build output is not committed
- **Technical notes:**
  - **Critical:** The current `tsconfig.json` has `include: ["src", "tests"]` which would emit test files into `dist/`. Create a separate `tsconfig.build.json` that extends the base config with `include: ["src"]` and `rootDir: "src"` so only source files are emitted.
  - Update the `build` script in package.json to `tsc -p tsconfig.build.json` instead of plain `tsc`.
  - The base `tsconfig.json` keeps `include: ["src", "tests"]` for typecheck and IDE support. The build config narrows it.
  - `tsconfig.build.json` needs: `"outDir": "dist"`, `"declaration": true`, `"declarationMap": true`, `"sourceMap": true`, `"rootDir": "src"`, `"include": ["src"]`
  - package.json exports map: `{ ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } }`
  - `"files": ["dist", "package.json", "README.md"]` to limit published content
  - native deps (better-sqlite3, node-llama-cpp, sqlite-vec) will need platform-specific handling — note this for a future sprint but don't solve it here. For now, the consumer's npm install handles native compilation.
  - Don't add a prepublish/prepack script yet — this sprint is about making the build work, not publishing to npm registry
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: SDK integration test
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
- **As a** developer, **I want** an end-to-end test that uses `PristineLocal.create()` through the public API, **so that** I can verify the SDK works as a consumer would use it.
- **Dependencies:** Story 3
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Integration test: `PristineLocal.create()` → `store()` a conversation → `search()` and verify matching facts returned
  - [ ] Integration test: `PristineLocal.create()` → `secureAndRedact()` → `reveal()` round-trip recovers original PII
  - [ ] Integration test: `dispose()` cleans up resources (no open handles)
  - [ ] Tests skippable via `SKIP_SLOW_TESTS=1` (embedding model required)
  - [ ] All tests pass: `npm run typecheck`, `npm test`, `npm run lint`
- **Testing approach:** End-to-end test using real SQLite (in-memory), real embedder, mocked LlmClient. Tests exercise the public API surface only — no internal module imports.
- **QA:** N/A
- **Planned commits:**
  1. `test: add SDK integration test via PristineLocal public API` — tests/e2e/sdk.test.ts
- **Technical notes:**
  - Source: the existing `tests/integration/orchestrator.test.ts` pattern (mocked LLM + real embedder + real SQLite) — adapt to use `PristineLocal.create()` instead of manual wiring
  - The test imports ONLY from the public API barrel (`src/index.ts`): `PristineLocal`, `LlmClient` (for mock typing), `Message`, etc. This validates that the barrel exports are sufficient for real consumers.
  - Use Story 1's DI config to inject: in-memory `Database` (via `createDatabase(':memory:')`), mock `LlmClient`, and optionally a pre-constructed embedder
  - For the privacy round-trip test, mock the LLM to return a classification with PII entities, then verify secureAndRedact produces placeholders and reveal recovers the original
  - `createDatabase` is an internal function — the test can import it as the one exception (database creation is infrastructure, not business logic), or Story 1's config can accept a `dbPath: ':memory:'` option instead
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
- `npm run build` produces valid dist/ with types (no test files in dist/)
- `PristineLocal.create()` → `store()` → `search()` works end-to-end in integration test
- `PristineLocal.create()` → `secureAndRedact()` → `reveal()` works end-to-end
- Tests + linter pass (locally and CI)
- One or more commits per story (logical chunks), one PR per story
- Commit messages: conventional commits (`feat:`, `chore:`, `test:`, `docs:`) per repo CLAUDE.md
- All PRs open and Greptile-clean

---

## Completion
*(Filled by coding agent when sprint is done)*

### Summary

### Results
- :white_check_mark: Story 1: PristineLocal client class — PR #, status
- :white_check_mark: Story 2: Public API barrel exports — PR #, status
- :white_check_mark: Story 3: Build pipeline + package.json — PR #, status
- :white_check_mark: Story 4: SDK integration test — PR #, status

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
