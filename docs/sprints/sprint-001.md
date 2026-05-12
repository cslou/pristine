# Pristine — Sprint 001
**Date:** 2026-05-12 – 2026-05-12
**Goal:** Rename the public package to `@pristine/sdk` and make Pi-dev recall return judgment-useful snippets while preserving source-pointer follow-up and existing verification tiers.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript, ESM, Node.js 22+, Vitest, Vocs, SQLite via `better-sqlite3` and `sqlite-vec`, local embeddings via `@huggingface/transformers`.
- **Current state:** The package is currently named `@pristine/shield-local`, which overemphasizes privacy shielding and redundantly says local. The Pi-dev semantic recall tool currently hard-redacts every returned snippet, forcing agents to inspect a source pointer before they can judge result relevance.
- **Implementation spec:** None — no implementation spec for this sprint

### Sprint-Wide Context

- **Sprint type:** Mixed
- **Shared context:** No backward compatibility is required for `@pristine/shield-local`; this sprint should present `@pristine/sdk` as the only public package name. Pi-dev recall should return bounded actual snippets by default, not expose a snippet policy option.
- **Non-goals:** Publishing to npm, adding compatibility aliases for `@pristine/shield-local`, renaming the `PristineLocal` class, changing database schema, changing embedding or vector ranking behavior, adding new snippet policy/configuration options, and broad product copy rewrites unrelated to the package rename or recall snippet behavior.

### Affected Flows

- **Existing flows affected:** npm install/import examples; public API type fixture; package verification; docs build; Pi-dev `pristine_recall` semantic search; `search-session-history` follow-up workflow; unit/smoke/local-model smoke/integration/e2e regression tiers.
- **New flows introduced:** None

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

#### Story 1: Rename package identity to `@pristine/sdk`
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
- **As a** package consumer, **I want** the published package identity to be `@pristine/sdk`, **so that** the name reflects the full privacy and memory SDK without implying a separate non-local product.
- **Dependencies:** None
- **Acceptance criteria:**
  - [x] `package.json` has `"name": "@pristine/sdk"`.
  - [x] `package-lock.json` root package name is `@pristine/sdk`.
  - [x] `rg "@pristine/shield-local|shield-local" package.json package-lock.json tests/smoke` returns no matches.
  - [x] No compatibility export, alias package, or deprecation shim for `@pristine/shield-local` is added.
- **Functional verification:**
  - [x] Run `npm install --package-lock-only --ignore-scripts` and verify `package-lock.json` records `@pristine/sdk` as the root package name.
  - [x] Run `npm run verify:package` and verify the package builds and contains the expected distributable files under the new package name.
  - [x] Run `npm run test:smoke` and verify the public API type fixture imports from `@pristine/sdk` successfully.
- **Regression verification:**
  - [x] Run `npm run typecheck` and verify source and tests typecheck after the package rename.
  - [x] Run `npm run test:smoke` and verify the built package entrypoint still exports the expected SDK symbols and public API type fixture passes.
- **Manual-only verification:** N/A — package identity behavior is covered by package metadata, smoke, and package verification commands.
- **Planned commits:**
  1. `chore: rename package to pristine sdk` — update package metadata, lockfile, and public API smoke import fixture.
- **Technical notes:** Do not rename `PristineLocal` in this story; class/API naming is out of scope.

#### Story 2: Update public docs and examples for `@pristine/sdk`
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
- **As a** documentation reader, **I want** install and import examples to use `@pristine/sdk`, **so that** the public docs match the new package identity.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [ ] `README.md` install and import snippets use `@pristine/sdk`.
  - [ ] Vocs docs in `docs/pages/` use `@pristine/sdk` for install and import snippets.
  - [ ] `rg "@pristine/shield-local|shield-local" README.md docs/pages examples tests --glob '!docs/dist/**'` returns no public-facing stale package-name matches, excluding any intentionally retained historical references recorded in this sprint doc.
  - [ ] Documentation still describes Pristine as a privacy and memory SDK, not only a shield.
- **Functional verification:**
  - [ ] Run `npm run docs:build` and verify Vocs builds successfully with the updated package examples.
  - [ ] Run `rg "npm install @pristine/sdk|from '@pristine/sdk'" README.md docs/pages -n` and verify the updated install/import snippets are present.
- **Regression verification:**
  - [ ] Run `npm run verify:package` and verify documentation/package file inclusion still succeeds after docs changes.
  - [ ] Run `npm run lint` and verify docs-related test fixtures and examples still satisfy lint rules where applicable.
- **Manual-only verification:** N/A — docs references and docs build are automated.
- **Planned commits:**
  1. `docs: update package name references` — update README, Vocs pages, and examples from `@pristine/shield-local` to `@pristine/sdk`.
- **Technical notes:** Do not rewrite unrelated prose beyond package identity and any wording needed to avoid `shield-local` implications.

#### Story 3: Return bounded actual snippets from Pi-dev recall
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
  - Findings: P2 — truncation AC did not specify the exact max length or truncation rule; P2 — truncation verification did not name the exact expected suffix or boundary condition.
  - Resolution: Story updated to require a maximum returned snippet length of 800 characters, with snippets longer than 800 characters sliced to the first 799 characters plus `…`, and tests required to assert that exact boundary behavior.
- **As an** agent using `pristine_recall`, **I want** each hit to include a bounded actual snippet, **so that** I can judge relevance before following the source pointer for authoritative context.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] `PristinePiVectorSearcher.search()` returns the stored snippet text for each hit instead of the fixed redaction placeholder.
  - [ ] Returned snippets are bounded to a documented maximum length of 800 characters; snippets longer than 800 characters are deterministically truncated to the first 799 characters plus `…`.
  - [ ] No `snippetPolicy`, reveal option, or other snippet behavior configuration is added.
  - [ ] `sourcePointer` fields remain present and unchanged for each hit.
  - [ ] `rg "snippet redacted by default|redacted by default" examples/pi-dev tests/examples/pi-dev` returns no stale behavior references.
- **Functional verification:**
  - [ ] Update and run `npm run test:unit -- tests/examples/pi-dev/search-memory.test.ts` and verify a semantic hit includes the expected stored snippet text.
  - [ ] Add or update a unit test proving a snippet longer than 800 characters returns exactly 800 characters, preserves the first 799 characters, and ends with `…`.
  - [ ] Run `npm run test:unit -- tests/examples/pi-dev/search-memory-tool.test.ts` and verify the Pi tool still returns JSON-serializable recall results with snippets and source pointers.
- **Regression verification:**
  - [ ] Run `npm run test:unit -- tests/examples/pi-dev/search-memory-negative.test.ts` and verify empty index, missing DB, invalid query, and filter guard behavior still pass.
  - [ ] Run `npm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts` and verify ingestion still stores snippets and source pointers correctly.
  - [ ] Run `npm run test:smoke:local-model` and verify the source-index local-model smoke path still stores and recalls a semantic source pointer.
- **Manual-only verification:** N/A — recall output and truncation behavior are covered by unit and smoke tests.
- **Planned commits:**
  1. `feat: return bounded recall snippets` — replace hard-coded snippet redaction with bounded actual snippet mapping and update tests.
- **Technical notes:** Keep truncation local to the Pi-dev search result mapper. Preserve database schema and ranking behavior.

#### Story 4: Update Pi-dev recall guidance for snippet-first judgment
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
- **As an** agent integrator, **I want** Pi-dev docs to explain snippets as the relevance-judgment layer and source pointers as the authority layer, **so that** agents use recall without blind pointer chasing.
- **Dependencies:** Story 3
- **Acceptance criteria:**
  - [ ] `examples/pi-dev/extensions/search-memory/README.md` documents that `snippet` contains bounded matched text for relevance judgment.
  - [ ] `examples/pi-dev/skills/search-session-history/SKILL.md` continues to instruct agents to inspect `sourcePointer.sourceUri` for authoritative exact context after a useful recall hit.
  - [ ] `examples/pi-dev/skills/search-session-history/README.md` describes `pristine_recall` as discovery using snippets plus source pointers, not redacted snippets.
  - [ ] `examples/pi-dev/README.md` remains consistent with the snippet-first discovery and source-pointer follow-up workflow.
- **Functional verification:**
  - [ ] Run `rg "bounded|snippet|sourcePointer" examples/pi-dev/extensions/search-memory/README.md examples/pi-dev/skills/search-session-history/README.md examples/pi-dev/README.md -n` and verify docs describe snippets for judgment and source pointers for exact context.
  - [ ] Run `rg "redacted by default|snippet redacted" examples/pi-dev -n` and verify no stale redacted-snippet guidance remains.
- **Regression verification:**
  - [ ] Run `npm run test:unit -- tests/examples/pi-dev/search-session-history.test.ts` and verify the skill still enforces directed `sourcePointer` inspection for exact context.
  - [ ] Run `npm run docs:build` and verify public docs still build after Pi-dev wording updates.
- **Manual-only verification:** N/A — documentation assertions and docs build cover the guidance changes.
- **Planned commits:**
  1. `docs: clarify pi recall snippets` — update Pi-dev extension and skill docs for snippet-first relevance judgment.
- **Technical notes:** Do not tell agents to treat snippets as authoritative full context; source pointers remain the authoritative follow-up path.

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
  - [ ] Verification delta is reported by canonical type, showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals, with a row for every canonical verification type even when counts are zero and rationale for any `Unknown` values.
  - [ ] The sprint doc status is updated to `🟢 Complete` only if completion criteria are met.
  - [ ] A `## Final Review` section is appended to the sprint doc with the final completion message quoted for auditability.
- **Functional verification:**
  - [ ] Run all functional verification items from every story and record pass/fail evidence.
- **Regression verification:**
  - [ ] Run all targeted regression verification items from every story and record pass/fail evidence.
  - [ ] Run the full available regression verification suite and record pass/fail evidence.
- **Manual-only verification:** N/A — no manual-only verification required
- **Planned commits:**
  1. `docs: complete sprint 001 verification` — final verification evidence and sprint doc completion update.
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
- `## Final Review` includes a verification delta table showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals by canonical verification type, including rows for zero-count canonical verification types and rationale for any `Unknown` values.
- Sprint doc status is `🟢 Complete` only when completion criteria are met.
- Sprint doc includes `## Final Review` with the final completion message and a New Dependencies field containing dependencies or `None`.
- Sprint-integration PR is reviewed, passes the required gates, and is merged only after the explicit user merge command.
- If the sprint introduces new flows, they are folded into the implementation spec before sprint integration.
