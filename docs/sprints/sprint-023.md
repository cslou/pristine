# Pristine — Sprint 023

**Date:** TBD – TBD
**Goal:** Using sprint-022 Pi proof evidence, refactor Pristine from raw conversation ownership to a source-pointer semantic index: remove raw transcript storage as a core requirement, store vector-indexed chunks with optional metadata and source pointers, and keep search useful even when source metadata is partial.
**Status:** 🟡 Planning

---

## Handoff

### Project Context

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript strict ESM, Node 18+, `better-sqlite3` + `sqlite-vec`, `@huggingface/transformers` with Nomic Embed v1.5 default, Vitest.
- **Current state:** Pristine currently has conversation/message tables, queue/indexer logic built around stored raw messages, vector windows in `vec_windows`, session vectors in `vec_sessions`, FTS/SQL public views, and search APIs returning conversation/message-centric results. Sprint-022 is complete and proved the Pi JSONL vector-search → JSONL-inspection workflow with source pointers into the authoritative Pi JSONL store. Architecture cleanup uses that evidence: harnesses typically already own authoritative transcript state (Pi JSONL, other harness SQLite/JSONL/etc.), so Pristine should not duplicate raw transcripts by default.
- **Implementation spec:** `docs/specs/implementation-spec-005.md` must be updated by this sprint because the core primitive model changes from raw corpus owner to semantic index over source-owned records.

### Sprint-Wide Context

- **Sprint type:** Refactor / Architecture cleanup.
- **Shared context:** Depends on sprint-022 Pi proof evidence. No user-data compatibility burden. Remove dead/incorrect raw transcript ownership now rather than preserving dual modes. Pristine stores embeddings, indexed snippets, and optional source pointers/metadata; source systems remain authoritative for raw context. Metadata must be optional because not every harness exposes session IDs, line numbers, timestamps, or stable entry IDs.
- **Non-goals:** No new Pi reference implementation in this sprint beyond consuming evidence from sprint-022. No default embedder swap. No migration support for old Pristine DBs. No fact extraction. No SQL query tool over raw conversations. No published package split. No replacement SQL/debug primitive over source-index tables unless a later sprint explicitly reintroduces one.

### Affected Flows

- **Existing flows affected:** Memory ingest/index, vector search, FTS/hybrid search if retained, SQL public views if removed/replaced, spec/reference flows `search_memory` and `query_memory`, tests around `ConversationStore`, client APIs that expose `storeAsync`, `drainEmbedQueue`, `buildSessionVector`, and search result shapes.
- **New flows introduced:** Generic source-chunk indexing with optional source metadata and pointer-based vector search results.

### Regression Invariants to Preserve

- Project isolation is enforced before any search result is returned.
- Embedding dimension mismatch remains a loud domain error, not an opaque sqlite-vec failure or bogus score.
- Search results include enough source pointer/provenance data for a harness to inspect the authoritative raw source when metadata is available.
- Minimal metadata indexing works: text plus generated chunk ID is sufficient to index and retrieve.
- Stable source-pointer reindex behavior is deterministic: duplicate/replacement semantics are documented and tested.
- Delete/replace cleanup prevents stale vector hits from removed or superseded source chunks.
- Pristine does not require or imply ownership of raw transcripts, threads, or messages.
- Local-first/no-network guarantees remain documented and verified.
- Deterministic regression tiers remain green; the deep gate includes the first-class smoke suite from PR #188.

### SQL Primitive Decision

- The current public `searcher.sql(...)` primitive is planned for removal during this cleanup because it exists to query curated SQL views over Pristine-owned raw conversation/message mirrors (`messages_public`, `conversations_public`, `messages_fts`, and `summaries_public`).
- Source systems remain authoritative for raw context inspection; Pristine should return pointers/snippets, not expose a transcript SQL surface.
- A future source-index-only SQL/debug primitive may be designed later, but it is out of scope for this sprint and must not preserve the current raw-transcript SQL contract.

### Verification Strategy

This sprint follows verifiability-first engineering: every story must define how its new or changed behavior will be proven correct and which existing behavior it could regress.

Verification has two categories:

- **Functional verification:** new verification created for behavior introduced or changed by this sprint.
- **Regression verification:** existing verification for behavior that predates this sprint.

Each implementation story must include functional verification for new behavior and targeted regression verification for affected existing behavior. The Final Verification Story runs all sprint functional verification plus the full available regression suite.

### Stories

**Constraints:** Target 5-8 stories per sprint. Each story should be small enough to review, verify, and merge independently.

#### Story 1: Update spec and public architecture language for source-pointer indexing

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
  - Findings: P1 contradictions in active spec sections initially still referenced raw conversations, SQL/FTS/hybrid primitives, and legacy `searcher.sql`; P2 ambiguity around whether `projectId` is required chunk metadata.
  - Resolution: Updated active sections to source-pointer semantic index architecture, marked remaining legacy sections historical/non-target, removed active raw SQL/FTS/hybrid primitive language, and made `projectId` an indexing-call option while minimal chunk metadata remains text plus generated chunk ID.
- **As a** SDK maintainer, **I want** the spec to define Pristine as a semantic index over source-owned records, **so that** implementation work removes raw transcript ownership intentionally rather than as an ad-hoc deletion.
- **Dependencies:** Sprint 022 complete
- **Acceptance criteria:**
  - [x] Sprint-022 final evidence from `docs/sprints/sprint-022.md` `## Final Review` is reviewed and the observed Pi source pointer/metadata shape is incorporated into the architecture update.
  - [x] `docs/specs/implementation-spec-005.md` states that external harness stores are authoritative for raw transcripts and Pristine indexes source chunks with snippets and pointers.
  - [x] Spec names index fields: chunk ID, indexed text/snippet, embedding, nullable source kind, nullable source URI, optional source entry/range identifiers, optional timestamps, optional metadata JSON.
  - [x] Spec explicitly removes raw `conversations` / `messages` ownership from the core architecture and explains that source context is fetched from the harness store on demand.
  - [x] Spec explicitly removes the current `searcher.sql(...)` raw-transcript read primitive and distinguishes that removal from any possible future source-index-only SQL/debug primitive.
  - [x] Spec defines missing/partial metadata behavior: indexing/search must work with only indexed text plus a generated chunk ID.
- **Functional verification:**
  - [x] Record the observed sprint-022 pointer/metadata shape in the spec or Story 1 PR notes, then run a grep/spec check after reviewing sprint-022 final evidence: `rg 'source pointer|source-owned|metadata_json|chunk ID|source kind|source URI|entry ID|line range|timestamp|text-only|generated chunk ID|conversations / messages|raw transcript|searcher\.sql|SQL debug' docs/specs/implementation-spec-005.md`. **Pass condition:** output shows the new architecture, required index fields, text-only/minimal metadata behavior, raw SQL primitive removal, and removal rationale.
- **Regression verification:**
  - [x] Run `rg 'local-first|No API calls|no data leaving|source pointer' docs/specs/implementation-spec-005.md` plus `npm run typecheck` and `npm run lint`. **Pass condition:** local-first/no-network commitments and source-pointer architecture remain documented, and checks exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `docs(spec): define source-pointer semantic index architecture`
- **Technical notes:** This story locks terminology before code deletion: source-owned raw records, Pristine-owned semantic index.

#### Story 2: Introduce generic source chunk/index types and storage schema

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: Pending PR review.
  - Resolution: Pending PR review.
- **As a** SDK consumer, **I want** to index arbitrary text chunks with optional source metadata, **so that** Pristine can support Pi JSONL and future harness stores without raw transcript duplication.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [x] Core public types expose an index input such as `SourceChunkInput` with `text` required and all source metadata optional.
  - [x] SQLite schema stores vector-indexed chunks with validated embedding dimension, indexed snippet/text, source pointer fields, and metadata JSON.
  - [x] New source-index table names and field meanings are documented in the module or spec so future regression tests can audit the stable contract.
  - [x] Storage accepts full metadata, partial metadata, and no metadata beyond text.
  - [x] Metadata must be a JSON-serializable object no larger than 16 KiB; arrays/primitives/cyclic values are rejected. Text must be non-empty after trim and no larger than the configured chunk text limit documented in the module.
- **Functional verification:**
  - [x] Add unit tests for type/storage validation. **Pass condition:** full, partial, and minimal chunk inputs store successfully; invalid inputs fail with domain errors.
  - [x] Add schema tests. **Pass condition:** created source-chunk vec table uses configured `float[N]` dim and source/metadata columns are nullable where promised.
- **Regression verification:**
  - [x] Run `npm run test:unit -- tests/core/database.test.ts tests/embedder/dim-parameterization.test.ts` and the new schema tests. **Pass condition:** database setup still works and configured vector dimensions still create the expected `float[N]` schema.
  - [x] Run `npm run typecheck` and `npm run lint`. **Pass condition:** both exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `feat(index): add source chunk types and storage schema`
  2. `test(index): verify optional metadata storage`
- **Technical notes:** Prefer new module names that do not imply chat ownership, e.g. `src/memory/index/` or `src/memory/source-index/`.

#### Story 3: Replace raw conversation ingest with source chunk indexing API

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: Pending PR review.
  - Resolution: Pending PR review.
- **As a** SDK consumer, **I want** an API to index source chunks directly, **so that** harness adapters can feed Pristine snippets/windows without first creating raw conversation/message rows.
- **Dependencies:** Story 2
- **Acceptance criteria:**
  - [x] Public client exposes a direct source-chunk indexing method as the primary memory ingest primitive and no new code path requires `ConversationStore` to ingest raw messages.
  - [x] Indexing embeds chunks, writes vectors and metadata atomically, and is idempotent or clearly documents duplicate behavior.
  - [x] Synchronous indexing path is available for deterministic harness verification and resolves only after the vector row is queryable in the same process.
  - [x] Existing queue/worker code is retained only for legacy raw-conversation APIs until Story 5 removes obsolete ownership paths; the new source-chunk indexing path does not use it.
- **Functional verification:**
  - [x] Add integration test for direct source-chunk indexing with stub embedder. **Pass condition:** vector rows and metadata are present after indexing.
  - [x] Add synchronous indexing test. **Pass condition:** the public indexing call resolves only after the vector row is queryable in the same process.
  - [x] Add duplicate/idempotency test. **Pass condition:** indexing the same stable source pointer twice produces the documented single replacement row and queryable rows reflect that behavior; user-facing vector search verification is deferred to Story 4.
  - [x] Add integration test for minimal metadata. **Pass condition:** the chunk is indexed with a queryable vector row and optional pointer fields are empty/null safely; user-facing vector search verification is deferred to Story 4.
- **Regression verification:**
  - [x] Run `npm run test:unit -- tests/client.test.ts tests/queue/ingest-queue.test.ts tests/memory/indexer/embed-worker.test.ts` after adapting/removing queue paths. **Pass condition:** remaining tests pass or deleted tests correspond only to deleted raw-conversation behavior.
  - [x] Run `npm run typecheck`, `npm run lint`, and targeted unit tests. **Pass condition:** all exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `feat(index): expose source chunk indexing API`
  2. `refactor(queue): adapt or remove raw conversation ingest queue`
  3. `test(index): verify direct chunk indexing`
- **Technical notes:** If append/update complexity disappears with chunk indexing, delete it rather than preserving unused abstractions.

#### Story 4: Return source pointers from vector search and remove conversation-centric result assumptions

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: _(sprint-doc-reviewer findings for this story, or `None`)_
  - Resolution: _(changes made, accepted risk, or `N/A`)_
- **As a** search consumer, **I want** vector search results to return snippets and source pointers, **so that** a harness can inspect the authoritative raw source after semantic retrieval.
- **Dependencies:** Story 3
- **Acceptance criteria:**
  - [x] Vector search is the retained core search primitive and its result shape returns chunk ID, snippet/indexed text, score/rank, and optional source pointer/metadata fields.
  - [x] Search no longer requires conversation/message joins or assumes `conversationId` / `messageIds` exist.
  - [x] FTS/hybrid/session-vector APIs are either adapted to chunk text with pointer results in this story or explicitly marked for removal in Story 5 before any export/docs remain; default plan is removal unless adapting them clearly reduces risk.
  - [x] `searcher.sql(...)` remains marked for removal unless this story records a reviewed decision to replace it with a source-index-only SQL/debug primitive in a later sprint.
  - [x] Missing metadata is represented explicitly and does not throw.
  - [x] Dimension mismatch guard remains in place for vector tables.
- **Functional verification:**
  - [x] Add vector search tests for chunks with full and minimal metadata. **Pass condition:** both are retrievable and result shapes match the new pointer model.
  - [x] Add a missing-source-metadata test. **Pass condition:** result contains snippet and chunk ID with optional fields absent/null.
  - [x] Add FTS/hybrid decision verification. **Pass condition:** Story 4 PR records removal decision; Story 5 will remove conversation-backed `ftsSearch`, `hybridSearch`, `sessionVectorSearch`, `searcher.sql`, `SqlBackend`, and related exports/tests/docs.
- **Regression verification:**
  - [x] Run existing vector search dimension mismatch/default-dim tests, adapted to chunk tables. **Pass condition:** source-index schema dim tests and new pointer search tests pass.
  - [x] Run `npm run typecheck`, `npm run lint`, and targeted integration tests. **Pass condition:** all exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `refactor(search): return source pointer results`
  2. `test(search): cover pointer and minimal metadata results`
- **Technical notes:** FTS/hybrid search should either be adapted to chunk text or explicitly removed in Story 5 if it depends on raw messages.

#### Story 5: Remove raw conversation/message storage and obsolete SQL/public views

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: _(sprint-doc-reviewer findings for this story, or `None`)_
  - Resolution: _(changes made, accepted risk, or `N/A`)_
- **As a** maintainer, **I want** obsolete raw conversation/message storage removed, **so that** Pristine has one clear source-pointer index architecture and no dead dual mode.
- **Dependencies:** Stories 3 and 4
- **Acceptance criteria:**
  - [x] Remove or rename `ConversationStore` and raw `conversations` / `messages` table creation code when no longer used by live APIs.
  - [x] Remove conversation/message public SQL views and the current `searcher.sql(...)` public API that only makes sense over mirrored raw transcripts.
  - [x] Remove `SqlBackend`, `DEFAULT_PUBLIC_VIEW_ALLOWLIST`, and SQL parser/backend code if no retained source-index SQL/debug primitive uses them.
  - [x] Remove FTS/hybrid/session-vector APIs if they depend on raw conversations and are not adapted to chunk-based pointer results.
  - [x] Consume Story 4's recorded adapt/remove decision and removal list; if the list is not `None`, remove all named exports/docs/tests for any FTS/hybrid/session API removed by that decision.
  - [x] Delete tests that only verify removed raw transcript ownership; do not weaken tests for retained vector indexing behavior.
  - [x] `rg 'ConversationStore|CREATE TABLE IF NOT EXISTS conversations|CREATE TABLE IF NOT EXISTS messages|messages_public|conversations_public|messages_fts|vec_sessions|buildSessionVector|storeAsync|ftsSearch|hybridSearch|searcher\.sql|SqlBackend|DEFAULT_PUBLIC_VIEW_ALLOWLIST' src tests scripts` returns only intentionally retained chunk-index APIs, compatibility notes, or zero hits.
- **Functional verification:**
  - [x] Run deletion audit command above. **Pass condition:** no live production references to removed raw transcript APIs remain; remaining hits are negative client assertions.
  - [x] Run new source-index functional tests from Stories 2–4. **Pass condition:** all pass, proving replacement behavior exists.
- **Regression verification:**
  - [x] Run `npm run test:unit`. **Pass condition:** pass count changes only by tests deleted for removed raw transcript behavior; failures are fixed, not skipped.
  - [x] Run `npm run typecheck` and `npm run lint`. **Pass condition:** both exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `refactor(memory): remove raw conversation storage`
  2. `refactor(search): remove obsolete transcript SQL/session APIs`
  3. `test(memory): delete obsolete transcript-store tests`
- **Technical notes:** This is the destructive cleanup story; verify all replacement APIs are in place before deleting.

#### Story 6: Update docs, examples, and exports to source-index terminology

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Acceptance criteria are specific and testable
  - [ ] Functional verification items are concrete and have pass/fail conditions
  - [ ] Regression verification items are concrete and have pass/fail conditions
  - [ ] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [ ] Ready for Lou
- **Planning review:**
  - Findings: _(sprint-doc-reviewer findings for this story, or `None`)_
  - Resolution: _(changes made, accepted risk, or `N/A`)_
- **As a** SDK consumer, **I want** public docs and exports to describe source indexing accurately, **so that** consumers do not build against removed conversation-store assumptions.
- **Dependencies:** Story 5
- **Acceptance criteria:**
  - [ ] Public barrel exports only live source-index/search types and APIs; removed raw-conversation APIs are not exported.
  - [ ] README/JSDoc examples use source chunks and source pointers, not raw conversations.
  - [ ] Implementation spec and sprint docs have no unresolved contradiction about Pristine owning raw transcripts.
  - [ ] Package scripts/examples that referenced removed APIs are updated or deleted.
- **Functional verification:**
  - [ ] Run `rg 'ConversationStore|storeAsync|buildSessionVector|messages_public|conversations_public|searcher\.sql|ftsSearch|hybridSearch|sessionVectorSearch' README.md docs src tests scripts examples`. **Pass condition:** hits are zero or explicitly documented as historical/removed behavior.
  - [ ] Add a public barrel import smoke test or typecheck fixture that imports the new source-index API from the package entrypoint. **Pass condition:** the fixture compiles without importing from `src/` internals.
  - [ ] Run `rg 'Pristine stores raw|raw conversations are stored|conversation corpus|messages table' README.md docs/specs/implementation-spec-005.md src/index.ts`. **Pass condition:** no unresolved raw-transcript ownership language remains outside historical rationale sections.
- **Regression verification:**
  - [ ] Run `npm run typecheck`, `npm run lint`, and docs/static grep checks. **Pass condition:** all exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `docs(memory): update source-index API examples`
  2. `refactor(exports): expose source index primitives only`
- **Technical notes:** Keep docs terse; Pi-specific usage belongs in sprint-022 or future Pi reference follow-ups.

#### Final Story: Sprint Verification & Completion

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Uses the story sections above and the existing regression suite as the verification source of truth
  - [ ] Defines where final verification evidence will be recorded
  - [ ] Includes full regression verification, not only areas believed to be touched
  - [ ] Ready for Lou
- **As a** maintainer, **I want** all sprint functional verification and all available regression verification run, **so that** the sprint can be integrated with evidence that new architecture works and existing retained behavior did not regress.
- **Dependencies:** All implementation stories
- **Acceptance criteria:**
  - [ ] Every story’s acceptance criteria are evaluated against implementation evidence.
  - [ ] Every story’s functional verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [ ] Every story’s targeted regression verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [ ] The full available regression verification suite is run, including existing unit, integration, e2e, smoke, simulator/browser/device, static, and manual-only checks where applicable.
  - [ ] Failed, ambiguous, manual-only, or unrun verification items are documented.
  - [ ] The sprint’s new functional verification is identified as future regression verification.
  - [ ] Verification delta is reported by canonical type, showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals. Include rows for Unit, Integration / contract, E2E / smoke, Simulator / device, AI / model evals, Static / local checks, Performance / load, Security / dependency, Accessibility / visual, Manual-only, and Other verification, even when zero.
  - [ ] The sprint doc status is updated to `🟢 Complete` only if completion criteria are met.
  - [ ] A `## Final Review` section is appended to the sprint doc with the final completion message quoted for auditability.
- **Functional verification:**
  - [ ] Run all functional verification items from every story and record pass/fail evidence.
- **Regression verification:**
  - [ ] Run all targeted regression verification items from every story and record pass/fail evidence.
  - [ ] Run the full deterministic regression gate: `.checks/regression.sh --tier=deep`. **Pass condition:** regression status is green and score is 5/5.
  - [ ] Run first-class deterministic smoke explicitly if not already covered by the recorded deep-gate evidence: `npm run test:smoke`. **Pass condition:** smoke suite discovers and passes `tests/smoke/**/*.test.ts`.
  - [ ] Run the full available regression verification suite and record pass/fail evidence. **Pass condition:** `npm run test:unit`, `SKIP_SLOW_TESTS=1 npm run test:integration`, `npm run test:e2e`, `npm run typecheck`, and `npm run lint` pass directly or as recorded components of the deep gate.
- **Manual-only verification:** N/A — architecture cleanup should be fully automatable.
- **Planned commits:**
  1. `docs(sprint-023): record final verification and completion`
- **Technical notes:** Use `workflow-prompts/handle-sprint-completion.md` for final completion message shape.

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
