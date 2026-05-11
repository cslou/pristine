# Pristine — Sprint 026
**Date:** 2026-05-10 – 2026-05-10
**Goal:** Rename the public memory primitives to `store`, `recall`, and `forget` across the SDK, docs, tests, and examples while preserving source-pointer semantics and proving full regression passes.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript strict ESM, Node.js, Vitest, ESLint, SQLite via `better-sqlite3`, `sqlite-vec`, `@huggingface/transformers` local embeddings.
- **Current state:** Sprint 025 and PR #214 are merged on `main`. The public memory API currently exposes implementation-shaped names: `PristineLocal.indexSourceChunks`, `searchSourceChunks`, and `deleteSourceChunks`. Privacy primitives already use intent-oriented names: `secureAndRedact`, `reveal`, and `scrubOutput`. The desired public memory primitive names are `store`, `recall`, and `forget`.
- **Implementation spec:** `docs/specs/implementation-spec-005.md`

### Sprint-Wide Context

- **Sprint type:** Feature / Refactor / Docs
- **Shared context:** The rename is a public SDK surface change, not a storage-model change. Source-owned records, source pointers, project scoping, embeddings, sqlite-vec storage, and privacy APIs remain unchanged. `store`, `recall`, and `forget` become the canonical memory verbs. The old `indexSourceChunks`, `searchSourceChunks`, and `deleteSourceChunks` methods should remain as deprecated compatibility aliases during this sprint unless implementation evidence shows keeping them creates unacceptable ambiguity.
- **Non-goals:** Changing the source chunk schema; changing vector-search ranking; adding keyword/hybrid/SQL search; changing privacy APIs; renaming Pi tool names such as `pristine_vector_search`; deleting historical sprint docs solely because they mention old names; adding runtime dependencies.

### Expected Touch List

- **Core SDK:** `src/client.ts`, `src/index.ts`
- **Public docs/specs:** `README.md`, `docs/agent-integration.md`, `docs/specs/implementation-spec-005.md`
- **Public API/type tests:** `tests/client.test.ts`, `tests/client-config-dim.test.ts`, `tests/smoke/public-api.smoke.test.ts`, `tests/smoke/package-entrypoint.smoke.test.ts`, `tests/smoke/public-api-types-fixture.mts`, `tests/integration/embedder.test.ts`
- **Reference examples to audit/update:** `examples/README.md`, `examples/pi-dev/README.md`, `examples/pi-dev/extensions/jsonl-index/`, `examples/pi-dev/extensions/search-memory/`, `examples/pi-dev/skills/search-session-history/`, `tests/examples/pi-dev/`
- **Search/audit commands:** `rg "indexSourceChunks|searchSourceChunks|deleteSourceChunks" README.md docs src tests examples` to identify intentional legacy-only references after migration.

### Affected Flows

- **Existing flows affected:** Public SDK memory API flow (`create` → memory write → memory query → memory delete); README quickstart; public package import/type discovery; package-entrypoint smoke tests; local/reference integration docs that explain how harnesses compose Pristine primitives.
- **New flows introduced:** Developer uses `client.store(...)`, `client.recall(...)`, and `client.forget(...)` as the canonical memory primitive flow.

### Verification Strategy

This sprint follows verifiability-first engineering: every story must define how its new or changed behavior will be proven correct and which existing behavior it could regress.

Verification has two categories:

- **Functional verification:** new verification created for behavior introduced or changed by this sprint.
- **Regression verification:** existing verification for behavior that predates this sprint.

Each implementation story must include:

- Functional verification for the new or changed behavior it delivers.
- Targeted regression verification for existing behavior most likely to be affected by that story.

The Final Verification Story runs all sprint functional verification plus the full available regression verification suite. After the sprint completes, the sprint's functional verification becomes part of the regression suite for future sprints.

### Story Selection Rationale

1. **Core SDK methods first** so the new verbs have real behavior before docs or examples advertise them.
2. **Public API/type verification second** so tests prove the new surface is importable, typed, and behavior-compatible while legacy aliases remain intentional.
3. **Docs/spec migration third** so public onboarding and the architecture spec match the new primitive names without changing the underlying source-pointer model.
4. **Reference example audit fourth** so installable examples and their tests do not teach stale primitive names or accidentally rely on outdated docs.
5. **Stale-name audit fifth** so any remaining old names are limited to compatibility aliases, migration notes, or immutable historical sprint records.

### Sprint Doc Review

- **Pass 1:** Mergeability 4/5. One P2 finding: final verification delta table should require every canonical verification-type row, including zero-count rows, and reserve `Unknown`/`Other verification` for rationale-backed cases.
- **Resolution:** Added the explicit canonical-row requirement to the Final Story acceptance criteria. All implementation stories had no findings.

### Stories

#### Story 1: Canonical Memory Verb Methods
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
- **As a** SDK user, **I want** `store`, `recall`, and `forget` methods on `PristineLocal`, **so that** memory usage reads like user intent rather than implementation mechanics.
- **Dependencies:** None
- **Acceptance criteria:**
  - [x] `src/client.ts` exposes `PristineLocal.store(chunks, { projectId })` with the same successful behavior as the current source-chunk indexing path: validates input, embeds each chunk, writes source rows and vector rows atomically, replaces duplicate `(projectId, chunkId)` rows, and returns indexed chunk metadata. Evidence: `src/client.ts`; `npm run test:unit -- tests/client.test.ts` passed.
  - [x] `src/client.ts` exposes `PristineLocal.recall(query, { projectId, limit? })` with the same successful behavior as the current source-chunk search path: trims/embeds the query, enforces project scope and limit bounds, and returns ranked source-pointer hits. Evidence: `src/client.ts`; `npm run test:unit -- tests/client.test.ts` passed.
  - [x] `src/client.ts` exposes `PristineLocal.forget(chunkIds, { projectId })` with the same successful behavior as the current source-chunk delete path: validates IDs/options and deletes source rows plus vector rows atomically within one project. Evidence: `src/client.ts`; `npm run test:unit -- tests/client.test.ts` passed.
  - [x] `indexSourceChunks`, `searchSourceChunks`, and `deleteSourceChunks` remain available as deprecated compatibility aliases that delegate to the new methods, with no duplicate storage/search logic. Evidence: aliases delegate to `store`, `recall`, and `forget`; compatibility test passed.
  - [x] New public option/result type aliases are exported from `src/index.ts` for the new verbs, and old type names remain exported for compatibility with deprecation comments where appropriate. Evidence: `StoreOptions`, `StoredMemory`, `RecallOptions`, `RecalledMemory`, `ForgetOptions`, and `ForgetResult` exported; legacy aliases have `@deprecated` comments; `npm run verify:public-api-types` passed with new and legacy imports from `@pristine/shield-local`.
- **Functional verification:**
  - [x] Add or update `tests/client.test.ts` cases proving `store`, `recall`, and `forget` perform a complete write/search/delete flow. **Pass condition:** storing a chunk makes it recallable, forgetting it removes both the hit and vector row, and all calls return the expected existing result shapes. Evidence: `npm run test:unit -- tests/client.test.ts tests/client/` passed, 18 tests.
  - [x] Add or update `tests/client.test.ts` cases proving invalid `store`, `recall`, and `forget` arguments throw `InvalidArgumentError` before mutating storage. **Pass condition:** invalid calls reject/throw and source/vector row counts remain unchanged. Evidence: `npm run test:unit -- tests/client.test.ts tests/client/` passed, 18 tests.
- **Regression verification:**
  - [x] Keep targeted compatibility tests for `indexSourceChunks`, `searchSourceChunks`, and `deleteSourceChunks`. **Pass condition:** each legacy alias still delegates successfully to the new method and preserves the expected result shape. Evidence: compatibility alias test in `tests/client/source-memory-store.test.ts` passed.
  - [x] Run `npm run test:unit -- tests/client.test.ts` and confirm all client memory and privacy API tests pass. Evidence: `npm run test:unit -- tests/client.test.ts tests/client/` passed, 18 tests.
- **Manual-only verification:** N/A — no manual-only verification required.
- **Planned commits:**
  1. `feat: add canonical memory verb methods`
- **Technical notes:** Prefer small delegating private helpers to keep `store`/`recall`/`forget` and deprecated aliases DRY. Do not rename internal `SourceChunkStore` schema/classes unless the public method rename requires it.

#### Story 2: Public API Type & Smoke Coverage
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
- **As a** package consumer, **I want** the new memory verbs to be covered by public import/type and package smoke tests, **so that** the shipped package proves the new API is usable outside repo internals.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [x] `tests/smoke/public-api-types-fixture.mts` imports and type-checks the new public type aliases for `store`, `recall`, and `forget` while retaining compatibility imports for the deprecated source-chunk names. Evidence: `npm run verify:public-api-types` passed.
  - [x] `tests/smoke/public-api.smoke.test.ts` uses `client.store(...)` and `client.recall(...)` for the public API source-memory smoke path. Evidence: `npm run test:smoke` passed.
  - [x] `tests/smoke/package-entrypoint.smoke.test.ts` uses `client.store(...)`, `client.recall(...)`, and `client.forget(...)` against the built package entrypoint. Evidence: `npm run test:smoke` passed.
  - [x] `tests/client-config-dim.test.ts` and `tests/integration/embedder.test.ts` use the canonical new verbs for dimension/config and real-embedder source-memory coverage. Evidence: targeted unit and integration commands passed.
- **Functional verification:**
  - [x] Run `npm run verify:public-api-types` and confirm public type imports compile with the new verb type aliases. Evidence: passed.
  - [x] Run `npm run test:smoke` and confirm package/public API smoke tests pass through `store`, `recall`, and `forget`. Evidence: passed, 5 smoke tests.
- **Regression verification:**
  - [x] Run `npm run test:unit -- tests/client-config-dim.test.ts` and confirm configured embedder dimensions still control source-memory vector writes/searches. Evidence: passed, 1 test.
  - [x] Run `SKIP_SLOW_TESTS=1 npm run test:integration -- tests/integration/embedder.test.ts` and confirm deterministic integration coverage remains green or explicitly document if the integration runner does not accept file filters. Evidence: skipped under `SKIP_SLOW_TESTS=1` by design; full `npm run test:integration -- tests/integration/embedder.test.ts` passed, 3 real-model tests.
- **Manual-only verification:** N/A — no manual-only verification required.
- **Planned commits:**
  1. `test: cover canonical memory verbs in public API smoke tests`
- **Technical notes:** The package entrypoint smoke test is the guard that the built `dist/` API is correct, not just TypeScript source.

#### Story 3: Public Docs & Spec Naming Migration
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
- **As a** new SDK user, **I want** README and integration docs to teach `store`, `recall`, and `forget`, **so that** I start with the canonical memory primitives and understand that source-pointer semantics still apply.
- **Dependencies:** Stories 1 and 2
- **Acceptance criteria:**
  - [x] `README.md` quickstart, public documentation map, Core API headings, source-memory cleanup text, and removed-API note use `store`, `recall`, and `forget` as the canonical memory primitive names. Evidence: README updated; docs verification passed.
  - [x] `README.md` includes a short compatibility note that `indexSourceChunks`, `searchSourceChunks`, and `deleteSourceChunks` are deprecated aliases during the transition, if those aliases remain in code. Evidence: compatibility note added under Core API.
  - [x] `docs/agent-integration.md` describes host integrations in terms of `PristineLocal.store()`, `recall()`, and `forget()`. Evidence: document updated; docs verification passed.
  - [x] `docs/specs/implementation-spec-005.md` §0.3/§5.1 and relevant target-architecture references name the core SDK primitives as `store`, `recall`, and `forget` while preserving the explanation that inputs/results are source-owned chunks and pointers. Evidence: spec updated; stale-name grep limited to README compatibility note.
- **Functional verification:**
  - [x] Run `npm run verify:docs` and confirm README snippets, package import snippets, and local links remain valid. Evidence: passed.
  - [x] Run `rg "indexSourceChunks|searchSourceChunks|deleteSourceChunks" README.md docs/agent-integration.md docs/specs/implementation-spec-005.md` and confirm any remaining hits are intentional deprecated-alias or historical-context references. Evidence: one remaining README compatibility-note hit, intentional.
- **Regression verification:**
  - [x] Run `npm run test:smoke` and confirm documentation/API naming changes did not break package smoke behavior. Evidence: passed, 5 smoke tests.
  - [x] Run `npm run typecheck` and confirm doc/spec edits did not accompany broken public API types. Evidence: passed.
- **Manual-only verification:** N/A — no manual-only verification required.
- **Planned commits:**
  1. `docs: rename memory primitives in public docs`
- **Technical notes:** Do not rewrite unrelated historical design sections. Keep source-pointer terminology visible so `store` is not misread as raw transcript ownership.

#### Story 4: Reference Example Audit & Alignment
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
- **As a** developer copying the Pi examples, **I want** examples and example docs to align with the new primitive names where they discuss SDK composition, **so that** reference implementations do not teach stale public API language.
- **Dependencies:** Story 3
- **Acceptance criteria:**
  - [ ] `examples/README.md` and `examples/pi-dev/README.md` are audited and updated if they mention the core memory primitive names.
  - [ ] `examples/pi-dev/extensions/jsonl-index/`, `examples/pi-dev/extensions/search-memory/`, and `examples/pi-dev/skills/search-session-history/` are audited for stale public method names; any actual SDK-client calls are migrated to `store`, `recall`, or `forget`.
  - [ ] `tests/examples/pi-dev/` remains aligned with the example source layout and passes after any example doc/code changes.
  - [ ] Pi tool names such as `pristine_vector_search` are left unchanged unless a test or README proves they are specifically describing the SDK primitive rather than the Pi tool.
- **Functional verification:**
  - [ ] Run `rg "indexSourceChunks|searchSourceChunks|deleteSourceChunks" examples tests/examples/pi-dev` and confirm zero hits or only explicitly justified compatibility references.
  - [ ] Run `npm run test:unit -- tests/examples/pi-dev/` and confirm all Pi example tests pass.
- **Regression verification:**
  - [ ] Run `npm run typecheck` and confirm example/test imports and TypeScript source remain valid.
  - [ ] Run `npm run verify:docs` and confirm example README links/snippets remain valid.
- **Manual-only verification:** N/A — no manual-only verification required.
- **Planned commits:**
  1. `docs: align examples with memory verb primitives`
- **Technical notes:** Current examples may not call `PristineLocal` directly; this story is still required as an explicit audit because examples are public onboarding material.

#### Story 5: Stale Name Guard & Migration Audit
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
- **As a** maintainer, **I want** a final stale-name audit for the old memory method names, **so that** the repo clearly presents `store`, `recall`, and `forget` as canonical and keeps old names only where intentional.
- **Dependencies:** Stories 1–4
- **Acceptance criteria:**
  - [ ] A repo-wide search identifies every remaining `indexSourceChunks`, `searchSourceChunks`, and `deleteSourceChunks` reference under `README.md`, `docs/`, `src/`, `tests/`, and `examples/`.
  - [ ] Remaining old-name references are limited to deprecated compatibility aliases, compatibility tests, migration/deprecation notes, or immutable historical sprint records.
  - [ ] If old type names remain exported, `src/index.ts` and the public type fixture make clear they are compatibility exports, not the canonical naming users should copy first.
  - [ ] The sprint notes record whether the old aliases are intended for removal in a future breaking cleanup or indefinite compatibility.
- **Functional verification:**
  - [ ] Run `rg "indexSourceChunks|searchSourceChunks|deleteSourceChunks" README.md docs src tests examples` and record the categorized hit list in the story PR body. **Pass condition:** every hit is categorized as canonical replacement needed, compatibility alias/test, deprecated-alias doc, or historical record; no uncategorized stale user-facing reference remains.
  - [ ] Run `npm run verify:docs` and confirm migration/deprecation wording does not break public docs checks.
- **Regression verification:**
  - [ ] Run `npm run lint` and confirm any deprecation comments or code moves follow lint rules.
  - [ ] Run `npm run test:unit` and confirm the full unit suite remains green after the migration audit.
- **Manual-only verification:** N/A — no manual-only verification required.
- **Planned commits:**
  1. `chore: audit memory primitive naming migration`
- **Technical notes:** Do not edit old completed sprint docs simply to erase historical references; categorize them as historical records.

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
  - [ ] Verification delta is reported by canonical type, showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals.
  - [ ] The verification delta table includes every canonical verification-type row, even when a row count is zero; `Unknown` or `Other verification` rows are used only with an explicit rationale.
  - [ ] The sprint doc status is updated to `🟢 Complete` only if completion criteria are met.
  - [ ] A `## Final Review` section is appended to the sprint doc with the final completion message quoted for auditability.
- **Functional verification:**
  - [ ] Run all functional verification items from every story and record pass/fail evidence.
- **Regression verification:**
  - [ ] Run all targeted regression verification items from every story and record pass/fail evidence.
  - [ ] Run `.checks/regression.sh --tier=full` and record pass/fail evidence. **Pass condition:** full regression exits 0, including lint, typecheck, unit, build, smoke, deterministic integration, e2e, full real-model integration, and `scripts/smoke-source-index.mjs`.
  - [ ] Run the sprint-integration PR's required GitHub checks and record pass/fail evidence.
- **Manual-only verification:** N/A — no manual-only verification required unless full regression exposes a real-model/manual environment blocker; if blocked, document exact command, error, and Lou decision.
- **Planned commits:**
  1. `docs: complete sprint 026 verification`
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
