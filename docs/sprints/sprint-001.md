# Pristine Local — Sprint 001
**Date:** 2026-04-03 – 2026-04-04
**Goal:** Scaffold the pristine-local repo with all type contracts, interfaces, error types, directory structure, and SQLite connection scaffolding
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, better-sqlite3
- **Current state:** Repo initialized with implementation spec only. No source code yet.
- **Implementation spec:** `docs/specs/implementation-spec-001.md` — Phase 0: Foundation
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context
- This sprint is Phase 0 — scaffold only, no module implementations. Everything must compile but nothing runs yet.
- All types are consolidated from the source repo (`~/projects/memory`) but adapted: remove Anthropic/OpenAI SDK shapes, use new `generate<T>()` LlmClient interface, add Episode/Entity/Relationship types.
- Source repo types are **reference material**, not copy-paste targets. The type hierarchy is being redesigned for local-first architecture.
- `better-sqlite3` and `sqlite-vec` are added as dependencies but no tables are created — modules create their own tables in later sprints.
- No tests in this sprint beyond typecheck + lint verification.

### Parallelization
All stories are sequential. Story 2 depends on Story 1 (needs tsconfig for typecheck). Story 3 depends on Story 2 (needs types to re-export). Story 4 depends on Story 1 (needs package.json for deps). Each story is small and fast — sequential is fine.

### Stories
**Constraints:** Max 5 stories per sprint. Max 5 commits per story. If a story needs 6+ commits during planning, split it.

#### Story 1: Initialize TypeScript project with tooling
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
- **As a** developer, **I want** a properly configured TypeScript project, **so that** I can start building modules with strict types, ESM imports, and automated quality checks.
- **Dependencies:** None
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `package.json` exists with name `@pristine/shield-local`, TypeScript, Vitest, ESLint as devDependencies
  - [ ] `tsconfig.json` has strict mode enabled, ESM module resolution, path aliases for `@/` -> `src/`
  - [ ] `vitest.config.ts` configured
  - [ ] ESLint config with TypeScript strict rules (no `any`)
  - [ ] Prettier config
  - [ ] `npm run typecheck`, `npm run lint`, `npm test` scripts defined in package.json
  - [ ] `CLAUDE.md` exists at repo root with project-specific coding conventions (references implementation spec, local-first architecture, module boundaries)
- **Testing approach:** Run `npm run typecheck` and `npm run lint` — both must pass on empty project.
- **QA:** N/A
- **Planned commits:**
  1. `chore: initialize typescript project with vitest, eslint, prettier` — package.json, tsconfig.json, vitest.config.ts, eslint config, prettier config, .gitignore
  2. `docs: add project CLAUDE.md` — CLAUDE.md with pristine-local specific conventions
- **Technical notes:**
  - Pin exact dependency versions (no ^ or ~) per coding standards
  - ESM only — `"type": "module"` in package.json
  - tsconfig target: ES2022 or later for top-level await support
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Define core types, interfaces, and error hierarchy
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
- **As a** developer, **I want** all module contracts defined in one place, **so that** I can implement any module by reading its interface without touching other modules.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/core/types.ts` contains all shared types: Message, MessageRole, Fact, TemporalConfidence, ExtractionResult, Memory, AddMemoryInput, UpdateMemoryInput, SupersedeMemoryResult, TemporalMode, ConsolidationAction, ConsolidationResult, ConsolidationBatchResult, DetectedEntity, SensitivitySource, SensitivityType, SensitivityReport, LlmSensitivityFinding, VaultEntry, VaultEntryInput, ZkV2EncryptedValue, ZkV2EncryptedValueMetadata, VaultEncryptionMode, RankedMemory, RetrieveFilters, AnalyzedQuery, QueryIntent, IngestResult, RetrieveResult, PipelineStep, PromptConfig, LocalConfig
  - [ ] `src/core/types.ts` contains new types not in source: Episode, EpisodeInput, RankedEpisode, Entity, EntityInput, Relationship, RelationshipInput, TraversalResult, RankedRelationship
  - [ ] `src/core/interfaces.ts` contains all module interfaces: LlmClient (with `generate<T>()`), Embedder, Store, Extractor, Consolidator, SensitivityClassifier, VaultStore, EpisodeStore, EntityStore, RelationshipStore, Retriever, QueryAnalyzer, Orchestrator. Note: QueryAnalyzer and Orchestrator are intentionally consolidated into core/interfaces.ts (not in their module types.ts) so all contracts live in one place.
  - [ ] `LlmClient` uses `generate<T>({ systemPrompt, userPrompt, schema, maxTokens })` shape — NOT Anthropic SDK shape
  - [ ] `src/core/errors.ts` contains base `AppError` class and domain errors: `LlmClassificationError`, `DownloadError`, `ResolveApprovalError`, `ResolveApprovalTimeoutError`. Additional errors (`ExtractionError`, `ConsolidationError`) added as needed — these are new, not in source repo.
  - [ ] No `any` types — use `unknown` with type guards where needed
  - [ ] No Anthropic SDK, OpenAI SDK, or PostgreSQL types referenced
  - [ ] `npm run typecheck` passes
- **Testing approach:** Type-check only — `npm run typecheck`. No runtime tests needed for pure type definitions.
- **QA:** N/A
- **Planned commits:**
  1. `feat: add core shared types` — src/core/types.ts with all data types consolidated from source + new Episode/Entity/Relationship types
  2. `feat: add core module interfaces` — src/core/interfaces.ts with all module contracts using generate<T>() LlmClient
  3. `feat: add core error hierarchy` — src/core/errors.ts with AppError base + domain-specific errors
- **Technical notes:**
  - Source types reference: `~/projects/memory/src/extractor/types.ts`, `store/types.ts`, `consolidator/types.ts`, `classifier/types.ts`, `classifier/llm/types.ts`, `vault/types.ts`, `retriever/types.ts`, `query-analyzer/types.ts`, `orchestrator/types.ts`, `embedder/types.ts`
  - Strip all Anthropic/OpenAI/PostgreSQL-specific types (ClaudeClient, ClaudeRequest, AnthropicTool, EmbeddingClient, DatabaseQueryable, etc.)
  - New types for Episode, Entity, Relationship are defined by the SQLite schema in spec Section 6 and interfaces in Section 9
  - PromptConfig defined in spec Section 5.4, LocalConfig in Section 5.3
  - JsonSchema type needed for LlmClient.generate<T>() — use `Record<string, unknown>` or a proper JSON Schema type
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Create module directory structure with placeholder types
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
- **As a** developer, **I want** all module directories pre-created with types re-exported, **so that** each module's implementation can start immediately in its own directory.
- **Dependencies:** Story 2
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] All module directories exist per spec Section 9: `src/engine/`, `src/engine/llamacpp/`, `src/engine/ollama/`, `src/embedder/`, `src/embedder/local/`, `src/store/`, `src/store/sqlite/`, `src/extractor/`, `src/consolidator/`, `src/classifier/`, `src/classifier/deterministic/`, `src/classifier/llm/`, `src/classifier/combined/`, `src/vault/`, `src/vault/sqlite/`, `src/episodes/`, `src/episodes/sqlite/`, `src/graph/`, `src/graph/sqlite/`, `src/retriever/`, `src/query-analyzer/`, `src/orchestrator/`, `src/sanitizer/`, `src/temporal/`, `src/models/`
  - [ ] Each module directory has a `types.ts` that re-exports relevant types from `core/types.ts` and `core/interfaces.ts`
  - [ ] Test directory structure mirrors src: `tests/engine/`, `tests/embedder/`, `tests/store/`, `tests/extractor/`, `tests/consolidator/`, `tests/classifier/`, `tests/vault/`, `tests/episodes/`, `tests/graph/`, `tests/retriever/`, `tests/query-analyzer/`, `tests/orchestrator/`, `tests/sanitizer/`, `tests/temporal/`, `tests/integration/`
  - [ ] `src/index.ts` exists as public API entry point (empty or minimal re-exports)
  - [ ] `npm run typecheck` passes
- **Testing approach:** `npm run typecheck` — all re-exports must resolve.
- **QA:** N/A
- **Planned commits:**
  1. `chore: create module directory structure with placeholder types` — all src/ directories, types.ts re-exports, test/ directory structure, src/index.ts
- **Technical notes:**
  - Each types.ts should re-export only the types relevant to that module, not everything from core
  - Example: `src/extractor/types.ts` re-exports `Extractor`, `ExtractionResult`, `Fact`, `Message` from core
  - Keep files minimal — just re-exports, no new type definitions
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: SQLite connection scaffolding
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
- **As a** developer, **I want** a reusable SQLite connection factory, **so that** any module can get a database connection with WAL mode and integrity checks already configured.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `better-sqlite3` and `sqlite-vec` added as dependencies (pinned versions)
  - [ ] `@types/better-sqlite3` added as devDependency
  - [ ] Connection factory function exists (e.g., `createDatabase(path: string): Database`) that returns a configured better-sqlite3 instance
  - [ ] WAL mode enabled on connection (`PRAGMA journal_mode=WAL`)
  - [ ] Integrity check runs on startup (`PRAGMA integrity_check`)
  - [ ] sqlite-vec extension loaded on connection
  - [ ] Connection factory is tested: creates DB file, WAL mode active, integrity check passes, sqlite-vec loaded
  - [ ] `npm run typecheck` passes with zero errors
  - [ ] `npm run lint` passes with zero errors
  - [ ] `npm test` passes
  - [ ] No `any` types anywhere in the codebase
  - [ ] No Anthropic/OpenAI/PostgreSQL imports anywhere
- **Testing approach:** Unit tests — create temp DB, verify WAL mode pragma, verify sqlite-vec is loadable, verify integrity check. Final verification: grep for prohibited patterns (`any`, `@anthropic-ai`, `openai`, `pg`).
- **QA:** N/A
- **Planned commits:**
  1. `feat: add sqlite connection factory with WAL mode and sqlite-vec` — src/core/database.ts, tests, dependency additions
  2. `chore: final verification and fixes` — fix any typecheck/lint/prohibited-pattern issues found across the full codebase (may be empty if clean)
- **Technical notes:**
  - Connection factory should accept a file path and return a configured `Database` instance
  - For in-memory testing, support `:memory:` path
  - sqlite-vec loading: `db.loadExtension(sqliteVecPath)` — may need platform-specific path resolution. If sqlite-vec fails to load on CI, skip the extension test gracefully.
  - No tables created — just connection setup. Modules create their own tables.
  - Place in `src/core/database.ts` since it's shared infrastructure, not store-specific
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
- Story 1: Initialize TypeScript project — PR #, status
- Story 2: Core types + interfaces + errors — PR #, status
- Story 3: Module directory structure — PR #, status
- Story 4: SQLite connection scaffolding + final verification — PR #, status

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
