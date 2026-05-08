# Pristine — Sprint 024

**Date:** TBD – TBD
**Goal:** Harden the post-Sprint-023 memory system with comprehensive public API, source-index, persistence, embedder, and smoke/integration tests so source-pointer memory behavior is proven across success paths, validation failures, rollback paths, and durable DB lifecycle edges.
**Status:** 🟡 Planning

---

## Handoff

### Project Context

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript strict ESM, Node 18+, `better-sqlite3` + `sqlite-vec`, `@huggingface/transformers` with Nomic Embed v1.5 default, Vitest, regression tiers in `.checks/regression.sh`.
- **Current state:** Sprint 023 has landed on `main`. The live memory system is now source-pointer semantic indexing via `PristineLocal.indexSourceChunks`, `searchSourceChunks`, and `deleteSourceChunks`. Raw conversation storage, ingest queue/embed-worker, FTS/hybrid/session-vector search, and raw SQL searcher APIs were removed. Existing tests cover the sprint acceptance criteria and main happy paths, but the post-merge audit identified gaps around public API atomicity, persistence/schema drift, direct `SourceChunkStore` contract permutations, metadata/vector boundary validation, embedder malformed payloads, and package/integration smoke coverage.
- **Implementation spec:** `docs/specs/implementation-spec-005.md` — active target sections are §1A and §5.1. Historical raw-conversation sections remain background only where explicitly marked historical.

### Sprint-Wide Context

- **Sprint type:** Tooling / Test hardening / Quality.
- **Shared context:** This sprint is primarily test work. Runtime changes are allowed only when a new test exposes a real bug or inaccurate public contract. New tests should preserve the source-pointer architecture: source systems own raw records; Pristine owns indexed chunks, embeddings, source metadata, and privacy vault data. Keep tests deterministic unless explicitly marked real-model integration.
- **Non-goals:** No new user-facing memory feature, no restoration of raw conversation/message storage, no reintroduction of `storeAsync`, `searcher.sql`, FTS/hybrid/session-vector APIs, no new SQL/debug primitive, no default embedder change, no migration support for pre-Sprint-023 user databases beyond schema compatibility issues discovered by tests, and no benchmark/eval corpus work.

### Affected Flows

- **Existing flows affected:** Public source-index API (`indexSourceChunks`, `searchSourceChunks`, `deleteSourceChunks`), direct `SourceChunkStore` storage/search/delete contract, SQLite source-index initialization and reopen lifecycle, embedder factory/config paths, smoke/package-entrypoint verification, regression tier confidence.
- **New flows introduced:** None — this sprint adds verification coverage for existing flows and fixes implementation bugs only if tests reveal them.

### Verification Strategy

This sprint follows verifiability-first engineering: every story must define how its new or changed behavior will be proven correct and which existing behavior it could regress.

Verification has two categories:

- **Functional verification:** new verification created for behavior introduced or changed by this sprint.
- **Regression verification:** existing verification for behavior that predates this sprint.

Each implementation story must include:

- Functional verification for the new or changed behavior it delivers.
- Targeted regression verification for existing behavior most likely to be affected by that story.

The Final Verification Story runs all sprint functional verification plus the full available regression verification suite. After the sprint completes, the sprint's functional verification becomes part of the regression suite for future sprints.

### Stories

**Constraints:** Target 5-8 stories per sprint. Each story should be small enough to review, verify, and merge independently. Split stories that combine unrelated outcomes or cannot be verified with a clear functional/regression verification plan.

#### Story 1: Harden public source-index client API failure and validation tests

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: P2 — delete edge-case AC referenced the documented public contract without enumerating expected counts/error classes.
  - Resolution: AC updated to state nonexistent deletes return `{ deletedCount: 0 }`, mixed existing/nonexistent deletes count only existing rows, invalid inputs/options throw `InvalidArgumentError`, and no invalid delete mutates storage.
- **As a** SDK maintainer, **I want** public client tests for embedder failure, count mismatch, invalid pointer fields, and delete/search edge cases, **so that** callers cannot observe partial writes or ambiguous validation behavior through the primary API.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] `tests/client.test.ts` covers `indexSourceChunks` when `embedBatch()` rejects after valid input. **Pass condition:** the call rejects with a domain error or propagated embedder error and both `source_chunks` and `vec_source_chunks` have no rows for the attempted batch.
  - [ ] `tests/client.test.ts` covers `embedBatch()` returning too few and too many embeddings. **Pass condition:** `InvalidArgumentError` is thrown before any source/vector row is written.
  - [ ] `tests/client.test.ts` covers invalid `chunkId`, source pointer string fields, and timestamp values. **Pass condition:** invalid inputs reject before `embedBatch()` is called.
  - [ ] `tests/client.test.ts` covers `searchSourceChunks` default limit and query trimming. **Pass condition:** omitted `limit` sends `10` to storage search and the query passed to `embed()` is trimmed.
  - [ ] `tests/client.test.ts` covers `deleteSourceChunks` edge cases: nonexistent IDs, mixed existing/nonexistent IDs, non-array input, non-string/empty IDs, invalid options, and blank project ID. **Pass condition:** nonexistent IDs return `{ deletedCount: 0 }`; mixed existing/nonexistent IDs count only existing deleted rows; non-array input, non-string/empty IDs, invalid options, and blank project ID throw `InvalidArgumentError`; invalid delete calls do not mutate either source/vector rows.
- **Functional verification:**
  - [ ] Run `npm run test:unit -- tests/client.test.ts`. **Pass condition:** new public API failure/validation tests fail before any required implementation fix and pass after the story.
  - [ ] If implementation fixes are needed, add assertions proving no partial rows remain after each failure path. **Pass condition:** explicit row-count assertions are present and pass.
- **Regression verification:**
  - [ ] Run `npm run test:smoke`. **Pass condition:** public API and package-entrypoint smoke tests still pass.
  - [ ] Run `npm run typecheck` and `npm run lint`. **Pass condition:** both exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `test(client): cover source-index public API failure paths`
  2. `fix(client): enforce public source-index edge contracts` *(only if tests expose implementation gaps)*
- **Technical notes:** Keep tests at the public API boundary. Do not reach into private client fields. Use injected in-memory DB and mock embedder for deterministic behavior.

#### Story 2: Prove source-index persistence and schema compatibility behavior

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: None.
  - Resolution: N/A.
- **As a** maintainer, **I want** file-backed source-index lifecycle and schema drift tests, **so that** durable databases fail loudly or remain usable instead of breaking later inside sqlite-vec or prepared statements.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] A file-backed DB test indexes at least one source chunk, closes the DB, reopens the same file with the same dimension, and verifies source/vector rows remain readable.
  - [ ] A file-backed DB test reopens an existing source-index DB with a different configured dimension. **Pass condition:** `InvalidArgumentError` names the configured/on-disk dimension mismatch and no schema is dropped.
  - [ ] Schema compatibility tests cover an existing `source_chunks` table with composite `(project_id, chunk_id)` primary key but missing current nullable pointer/metadata columns. **Pass condition:** initialization either rebuilds/alters safely or throws a clear domain error before writes; the tested behavior is documented in the test name.
  - [ ] Schema compatibility tests cover an existing `vec_source_chunks` table with `chunk_key` but missing expected `project_id`/`chunk_id` columns. **Pass condition:** initialization does not silently accept a table that cannot support current writes/search.
  - [ ] Schema compatibility tests cover malformed existing vec DDL missing `embedding float[N]`. **Pass condition:** initialization throws `InvalidArgumentError` with actionable wording.
- **Functional verification:**
  - [ ] Run `npm run test:unit -- tests/memory/source-index/schema.test.ts`. **Pass condition:** new persistence/schema compatibility tests pass.
  - [ ] If a compatibility bug is found, add the minimal schema-init fix and verify the new test fails before the fix and passes after it.
- **Regression verification:**
  - [ ] Run `npm run test:unit -- tests/core/database.test.ts tests/core/init.test.ts tests/memory/source-index/schema.test.ts`. **Pass condition:** database/init behavior and source-index schema behavior remain green.
  - [ ] Run `npm run typecheck` and `npm run lint`. **Pass condition:** both exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `test(index): cover source-index persistence and schema drift`
  2. `fix(index): harden source-index schema compatibility` *(only if tests expose implementation gaps)*
- **Technical notes:** Prefer file-backed temp DBs for lifecycle tests. Incompatible draft schemas may be rebuilt only after dimension validation; this invariant must remain tested.

#### Story 3: Cover direct SourceChunkStore search, batch, and delete permutations

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: P2 — search validation AC did not state error behavior; delete duplicate/mixed-ID counting behavior was intentionally left open.
  - Resolution: AC updated to require `InvalidArgumentError` for invalid search inputs, zero storage mutation for invalid cases, mixed delete IDs counting only existing rows, and duplicate delete IDs counting a row at most once.
- **As a** maintainer of the storage primitive, **I want** direct store-level tests for search ordering, limits, batch writes, timestamps, and delete counts, **so that** the lower-level source-index contract is pinned independently of the public client facade.
- **Dependencies:** Story 2 if schema fixes are needed; otherwise none
- **Acceptance criteria:**
  - [ ] `SourceChunkStore.search()` has direct tests with known vectors. **Pass condition:** order, score range, project isolation, and limit truncation are deterministic.
  - [ ] `SourceChunkStore.search()` validation tests cover invalid options, blank project ID, non-integer/negative/zero/too-large limits, wrong-dimension query vector, non-array query vector, and non-finite query values. **Pass condition:** each invalid case throws `InvalidArgumentError` and no source/vector rows are inserted, deleted, or changed.
  - [ ] `SourceChunkStore.putMany()` and `putStoredMany()` have multi-row success tests. **Pass condition:** rows and vector rows are written for every chunk and returned values match normalized stored chunks.
  - [ ] `putStoredMany()` tests cover embedding-count mismatch, invalid stored chunk fields, oversized `metadataJson`, wrong-dimension embeddings, and non-finite embeddings. **Pass condition:** each rejects with `InvalidArgumentError` and no partial rows remain.
  - [ ] `deleteMany()` tests cover nonexistent IDs, mixed existing/nonexistent IDs, duplicate IDs, invalid non-array input, non-string/empty IDs, and blank project ID. **Pass condition:** nonexistent IDs return `0`; mixed existing/nonexistent IDs count only existing deleted rows; duplicate IDs count a deleted row at most once; invalid inputs throw `InvalidArgumentError`; invalid delete calls do not mutate storage.
- **Functional verification:**
  - [ ] Run `npm run test:unit -- tests/memory/source-index/schema.test.ts`. **Pass condition:** new store search/batch/delete permutations pass.
  - [ ] Add or update implementation only where tests reveal a contract bug. **Pass condition:** each changed behavior has a failing-before/passing-after test.
- **Regression verification:**
  - [ ] Run `npm run test:unit -- tests/client.test.ts tests/memory/source-index/schema.test.ts`. **Pass condition:** public client behavior still composes the direct store correctly.
  - [ ] Run `npm run typecheck` and `npm run lint`. **Pass condition:** both exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `test(index): cover SourceChunkStore search and batch contracts`
  2. `test(index): cover SourceChunkStore delete edge cases`
  3. `fix(index): align store contracts with tests` *(only if tests expose implementation gaps)*
- **Technical notes:** Do not overfit to sqlite-vec internals beyond stable score/order behavior for controlled vectors. If duplicate delete IDs are currently counted multiple times, either document that contract in the test name or normalize to unique IDs with a fix.

#### Story 4: Add metadata, pointer, and vector boundary validation tests

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: None.
  - Resolution: N/A.
- **As a** SDK maintainer, **I want** boundary tests for metadata, text, pointer fields, generated IDs, and vector values, **so that** source chunks fail predictably at the edge of the public contract.
- **Dependencies:** Story 3 if validation helper changes are needed; otherwise none
- **Acceptance criteria:**
  - [ ] Metadata tests cover exact 16 KiB serialized JSON acceptance and 16 KiB + 1 rejection, including multibyte strings where byte length differs from character count.
  - [ ] Metadata tests cover nested invalid values: `NaN`, `Infinity`, functions, symbols, and `bigint`. **Pass condition:** each is rejected with `InvalidArgumentError`.
  - [ ] Metadata tests cover valid nested arrays/objects and supported `toJSON()` values. **Pass condition:** serialized metadata round-trips to the expected JSON.
  - [ ] Text boundary tests cover exact text byte-limit acceptance and byte-limit + 1 rejection, including multibyte text.
  - [ ] Pointer field tests cover all nullable public result fields (`sourceKind`, `sourceUri`, `entryId`, `parentId`, `lineNumber`, `lineStart`, `lineEnd`, `timestamp`) in stored and searched results. **Pass condition:** public hits include the expected values or `null`.
  - [ ] Generated chunk ID tests index multiple minimal chunks without caller IDs. **Pass condition:** generated IDs are non-empty, unique within the batch, stored, and searchable.
- **Functional verification:**
  - [ ] Run `npm run test:unit -- tests/memory/source-index/schema.test.ts tests/client.test.ts`. **Pass condition:** new boundary tests pass.
  - [ ] If validation changes are needed, add targeted tests for both acceptance and rejection sides of the boundary. **Pass condition:** behavior is explicit at the limit and over the limit.
- **Regression verification:**
  - [ ] Run `npm run test:smoke`. **Pass condition:** ordinary source-index public API flows still pass after adding boundary tests/fixes.
  - [ ] Run `npm run typecheck` and `npm run lint`. **Pass condition:** both exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `test(index): add metadata and text boundary coverage`
  2. `test(index): cover pointer result fields and generated ids`
  3. `fix(index): tighten boundary validation` *(only if tests expose implementation gaps)*
- **Technical notes:** Keep boundary constants imported from the module where possible instead of duplicating numeric values in tests.

#### Story 5: Harden embedder and config/core wiring coverage

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: None.
  - Resolution: N/A.
- **As a** maintainer, **I want** embedder factory/config and malformed-response tests tied to source-index dimensions, **so that** configured dimensions and embedder errors cannot drift away from storage behavior.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] Add a config-to-client-to-source-index dimension test. **Pass condition:** a temp `baseDir` `models.json` with custom local embedder dimension produces `vec_source_chunks embedding float[N]` through `PristineLocal.create({ baseDir })` and indexing/search uses that dimension.
  - [ ] `createEmbedder` tests prove local `model` and Ollama `model`/`host` config are passed to their backends. **Pass condition:** mocked pipeline/fetch observes the configured values.
  - [ ] `tests/core/init.test.ts` covers negative embedder config cases: local empty/non-string model, Ollama empty/non-string model, Ollama empty/non-string host, and non-number `dim` from `models.json`. **Pass condition:** each throws `ConfigError` with embedder-context wording.
  - [ ] `tests/embedder/ollama.test.ts` covers malformed nested payloads: embedding count mismatch, inner embedding not an array, non-number values, `NaN`, and `Infinity`. **Pass condition:** errors are domain errors and no source-index writes occur in any client-level composition test added by this story.
  - [ ] `tests/embedder/local.test.ts` covers retry after model-load failure. **Pass condition:** first load rejects as `EmbedderError`, second load succeeds, and pipeline creation was retried.
- **Functional verification:**
  - [ ] Run `npm run test:unit -- tests/embedder/factory.test.ts tests/embedder/local.test.ts tests/embedder/ollama.test.ts tests/embedder/dim-parameterization.test.ts tests/core/init.test.ts`. **Pass condition:** new embedder/config tests pass.
  - [ ] Run the new config-to-client-to-source-index dimension test. **Pass condition:** DDL and indexing/search behavior reflect the configured dimension.
- **Regression verification:**
  - [ ] Run `npm run test:unit -- tests/client.test.ts tests/memory/source-index/schema.test.ts`. **Pass condition:** source-index APIs still work with injected embedders and configured dimensions.
  - [ ] Run `npm run typecheck` and `npm run lint`. **Pass condition:** both exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `test(embedder): cover config passthrough and malformed payloads`
  2. `test(core): cover embedder config validation edges`
  3. `test(client): prove configured dim reaches source index`
  4. `fix(embedder): normalize malformed payload errors` *(only if tests expose implementation gaps)*
- **Technical notes:** Avoid real model loads in unit tests by mocking `@huggingface/transformers` and `fetch`. Real-model coverage belongs in Story 6.

#### Story 6: Expand smoke and integration coverage for package and real-model source-index workflows

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: None.
  - Resolution: N/A.
- **As a** package maintainer, **I want** smoke and integration tests that exercise the built package and real local embedder source-index workflow, **so that** the package consumers use the same verified path as source tests.
- **Dependencies:** Stories 1-5 recommended, but this story may run independently if no implementation dependencies exist.
- **Acceptance criteria:**
  - [ ] `tests/smoke/package-entrypoint.smoke.test.ts` imports built `../../dist/index.js`, creates a client with injected in-memory DB + stub embedder, indexes, searches, deletes, and verifies the obsolete raw APIs remain absent. **Pass condition:** `npm run test:smoke` passes after build.
  - [ ] Add a Vitest real-model source-index integration test, skipped when `SKIP_SLOW_TESTS=1`. **Pass condition:** with slow tests enabled, default local embedder indexes/searches one source chunk in a temp DB and returns the expected hit; with `SKIP_SLOW_TESTS=1`, it is skipped explicitly.
  - [ ] Ensure `scripts/smoke-source-index.mjs` remains aligned with the public API. **Pass condition:** the script still runs after `npm run build` and no obsolete raw API appears in the script.
  - [ ] Update smoke/integration docs or README verification notes only if command names or behavior change. **Pass condition:** docs remain accurate or no doc change is needed.
- **Functional verification:**
  - [ ] Run `npm run test:smoke`. **Pass condition:** built-package workflow smoke passes.
  - [ ] Run `npm run test:integration` with slow tests enabled. **Pass condition:** real-model source-index integration test passes or is explicitly documented as environment-blocked with reproducible reason.
  - [ ] Run `node scripts/smoke-source-index.mjs` after `npm run build`. **Pass condition:** script prints `source-index smoke: PASS`.
- **Regression verification:**
  - [ ] Run `SKIP_SLOW_TESTS=1 npm run test:integration` and `npm run test:e2e`. **Pass condition:** deterministic integration and e2e suites remain green.
  - [ ] Run `npm run typecheck` and `npm run lint`. **Pass condition:** both exit 0.
- **Manual-only verification:** N/A — real-model checks are automated but may be skipped under `SKIP_SLOW_TESTS=1`.
- **Planned commits:**
  1. `test(smoke): exercise built package source-index workflow`
  2. `test(integration): add real-model source-index round trip`
  3. `docs(readme): update verification notes` *(only if command behavior changes)*
- **Technical notes:** Keep deterministic smoke fast by injecting stub embedders. Real-model integration should use temp dirs/databases and clean up after itself.

#### Final Story: Sprint Verification & Completion

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Uses the story sections above and the existing regression suite as the verification source of truth
  - [x] Defines where final verification evidence will be recorded
  - [x] Includes full regression verification, not only areas believed to be touched
  - [x] Ready for Lou
- **As a** maintainer, **I want** all sprint functional verification and all available regression verification run, **so that** the sprint can be integrated with evidence that new behavior works and existing behavior did not regress.
- **Dependencies:** All implementation stories
- **Acceptance criteria:**
  - [ ] Every story’s acceptance criteria are evaluated against implementation evidence.
  - [ ] Every story’s functional verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [ ] Every story’s targeted regression verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [ ] The full available regression verification suite is run, including existing unit, integration, e2e, smoke, simulator/browser/device, static, and manual-only checks where applicable.
  - [ ] Failed, ambiguous, manual-only, or unrun verification items are documented.
  - [ ] The sprint’s new functional verification is identified as future regression verification.
  - [ ] Verification delta is reported by canonical type, showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals. **Pass condition:** the table includes every canonical row even when the count is zero, includes an `Unknown / not classified` row only with explicit rationale, and does not use `Other verification` for checks that fit named canonical methods.
  - [ ] The sprint doc status is updated to `🟢 Complete` only if completion criteria are met.
  - [ ] A `## Final Review` section is appended to the sprint doc with the final completion message quoted for auditability.
- **Functional verification:**
  - [ ] Run all functional verification items from every story and record pass/fail evidence.
- **Regression verification:**
  - [ ] Run all targeted regression verification items from every story and record pass/fail evidence.
  - [ ] Run the full available regression verification suite and record pass/fail evidence.
- **Manual-only verification:** N/A — no manual-only verification required.
- **Planned commits:**
  1. `docs(sprint-024): record final verification`
- **Technical notes:** Use the story sections plus the existing regression suite as the source of truth. Do not duplicate all AC/verification items here; run them, reference the evidence, compute the verification delta table, and record final results in `## Final Review`. Use `workflow-prompts/handle-sprint-completion.md` for the final completion message shape. `## Final Review` is the durable audit copy of that message; emit the same summary to the user and append it to the sprint doc.

### Rules

- Use the sprint-branch workflow from AGENTS.md: `sprint-NNN` branches from target, story branches fork from `sprint-NNN`, and story PRs target `sprint-NNN`.
- Work through stories sequentially. The Final Verification Story is always last.
- Each story PR follows the normal review/fix/merge gates from AGENTS.md.
- After the Final Verification Story merges, open the sprint-integration PR (`sprint-NNN → target`). It uses the same gates, then pauses for the user's explicit merge command.
- Record new dependencies in `## Final Review`, or record `None` when no dependencies were added.

### Definition of Done

- All implementation stories pass acceptance criteria.
- Functional verification evidence is recorded for every implementation story.
- Targeted regression verification evidence is recorded for every implementation story.
- Final Verification Story has run all sprint functional verification and the full available regression verification suite.
- Failed, ambiguous, manual-only, or unrun verification items are documented in `## Final Review`.
- `## Final Review` includes a verification delta table showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals by canonical verification type.
- Sprint doc status is `🟢 Complete` only when completion criteria are met.
- Sprint doc includes `## Final Review` with the final completion message and a New Dependencies field containing dependencies or `None`.
- Sprint-integration PR is reviewed, passes the required gates, and is merged only after the explicit user merge command.
- If the sprint introduces new flows, they are folded into the implementation spec before sprint integration.
