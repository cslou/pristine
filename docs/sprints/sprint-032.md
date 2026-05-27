# Pristine — Sprint 032
**Date:** 2026-05-27 – 2026-06-03
**Goal:** New Pi sessions receive a bounded relay handoff from the latest prior session in the same repo through a lightweight session-relay extension that is independent of embeddings/vector search, while shared Pi JSONL helpers keep existing semantic indexing behavior intact.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript strict ESM SDK/reference examples; SQLite via `better-sqlite3`; vectors via `sqlite-vec`; local embeddings via `@huggingface/transformers`; Vitest for unit/integration/e2e/smoke checks.
- **Current state:** `examples/pi-dev/extensions/jsonl-index/` indexes active Pi JSONL visible user/assistant messages into `pi_jsonl_chunks` plus `vec_pi_jsonl_chunks`; it is intentionally tied to embeddings, `sqlite-vec`, and semantic search. `examples/pi-dev/extensions/search-memory/` exposes `pristine_recall` over those vectors. `examples/pi-dev/skills/search-session-history/` inspects authoritative Pi JSONL by source pointer. Some generally useful Pi JSONL parsing/session-selection logic currently lives inside `jsonl-index` even though start-session relay should not depend on embeddings or vector tables.
- **Implementation spec:** `docs/specs/implementation-spec-005.md`

### Sprint-Wide Context

- **Sprint type:** Feature
- **Shared context:** This sprint is Pi-first. It must extract reusable non-vector Pi JSONL/session helpers from the existing `jsonl-index` reference into `examples/pi-dev/shared/`, then add a separate lightweight `examples/pi-dev/extensions/session-relay/` reference. `session-relay` owns relay-specific session metadata and start-session injection. It must not require `jsonl-index`, `search-memory`, embeddings, `sqlite-vec`, or vector table availability. Future Codex/Claude support should be represented as harness-agnostic seams and metadata fields only; no Codex/Claude adapters are implemented now.
- **Non-goals:** No Codex adapter, no Claude adapter, no background scan of all historical sessions, no persistent cached relay summaries, no vector search dependency for relay, no semantic retrieval in relay selection, no monolithic configurable mega-extension, no changes to core SDK public APIs unless required by example typings, no raw transcript mirroring into Pristine beyond existing snippet/index behavior.

### Affected Flows

- **Existing flows affected:** Pi JSONL indexing reference (`examples/pi-dev/extensions/jsonl-index/`) because reusable parser/session helpers move to `examples/pi-dev/shared/`; Pi development reference install/runtime docs (`examples/pi-dev/README.md`); Pi search-memory/reference tests that share the SQLite DB path and source pointer assumptions.
- **New flows introduced:** Pi session relay flow: when `session-relay` is installed and a new Pi session begins in a repo with prior session metadata, Pristine selects the latest prior session, summarizes a bounded visible user/assistant tail using the six-section relay format, and injects the result once as model-visible custom context.

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

#### Story 1: Extract Shared Pi JSONL Helpers Without Changing Vector Indexing
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
  - Findings: P2 — Planning review placeholder text remained after sprint-doc-reviewer re-review; no story-specific scope or verification findings.
  - Resolution: Replaced placeholder with concrete reviewer outcome before sprint start.
- **As a** maintainer, **I want** reusable Pi JSONL/session helpers moved out of `jsonl-index`, **so that** both vector indexing and session relay can share source parsing without making relay depend on embeddings.
- **Dependencies:** None
- **Acceptance criteria:**
  - [x] Reusable non-vector Pi JSONL logic is available under `examples/pi-dev/shared/`, including visible user/assistant text extraction, source pointer construction, active-branch/active-entry selection, and session-file handling where currently duplicated or trapped inside `jsonl-index`.
  - [x] `examples/pi-dev/extensions/jsonl-index/` imports the shared helpers and preserves its existing public runtime behavior, table writes, duplicate suppression, active-branch reconciliation, and notifications.
  - [x] Shared helper APIs expose explicit TypeScript types and do not import `@huggingface/transformers`, `sqlite-vec`, local embedder code, or vector-index code.
  - [x] Existing Pi JSONL fixtures remain valid and do not need semantic/content rewrites.
- **Functional verification:**
  - [x] Add/extend Vitest coverage proving the shared visible-message parser returns the same indexed user/assistant entries from `tests/fixtures/pi-jsonl/mixed-session.jsonl` that `jsonl-index` indexed before extraction.
  - [x] Add/extend Vitest coverage proving active-branch filtering and fallback parent-chain derivation behave the same through the shared helper API.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts` and verify existing chunk/vector indexing, stale active-branch cleanup, duplicate suppression, and startup missing-file behavior still pass.
  - [x] Run `pnpm run test:unit -- tests/examples/pi-dev/search-session-history.test.ts` and verify source-pointer exact-context behavior still passes after helper extraction.
  - [x] Run `pnpm run typecheck` and verify the shared helper refactor compiles under strict TypeScript.
- **Story 1 evidence:** PASS — `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-session-history.test.ts`; PASS — `pnpm run typecheck`; PASS — pre-push standard regression (`pnpm run lint`, `pnpm run typecheck`, full `pnpm run test:unit`).
- **Manual-only verification:** N/A — this is a refactor with automatable parser/runtime regression checks.
- **Planned commits:**
  1. `refactor: extract shared pi jsonl helpers` — shared helper modules, jsonl-index import updates, and regression-preserving tests.
- **Technical notes:** Keep this story behavior-preserving. Do not add relay metadata, injection, or new extension behavior here; those follow in later stories.

#### Story 2: Add Lightweight Session Metadata Store in a New Session Relay Extension
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
  - Findings: P2 — Planning review placeholder text remained after sprint-doc-reviewer re-review; no story-specific scope or verification findings.
  - Resolution: Replaced placeholder with concrete reviewer outcome before sprint start.
- **As a** maintainer, **I want** `session-relay` to maintain generic session metadata without vector dependencies, **so that** start-session handoff can work for users who do not install semantic search.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [ ] A new reference extension exists at `examples/pi-dev/extensions/session-relay/` with its own `package.json`, runtime entry point, and tests.
  - [ ] The extension creates/maintains a generic `memory_sessions` table in the Pi-dev SQLite DB using shared schema constants, with fields including `source_harness`, `source_uri`, `project_id` or `cwd`, `first_message_at`, `last_message_at`, `visible_message_count`, and `updated_at`.
  - [ ] Pi rows use `source_harness = 'pi'`, `source_uri = ctx.sessionManager.getSessionFile()`, and timestamps/counts derived from visible user/assistant messages parsed through shared helpers.
  - [ ] Reprocessing the same Pi session upserts one metadata row idempotently and updates timestamps/counts without duplicating `memory_sessions` rows.
  - [ ] `session-relay` package/runtime does not import `jsonl-index`, `search-memory`, `sqlite-vec`, local embedder modules, or `@huggingface/transformers`.
  - [ ] `jsonl-index` remains usable without installing `session-relay`, and `session-relay` remains usable without installing `jsonl-index`.
- **Functional verification:**
  - [ ] Add Vitest coverage proving a temporary DB receives one `memory_sessions` row after the `session-relay` metadata runtime processes `tests/fixtures/pi-jsonl/mixed-session.jsonl`, with assertions for every required metadata field: `source_harness = 'pi'`, expected `source_uri`, `project_id` or `cwd`, `first_message_at`, `last_message_at`, `visible_message_count`, and `updated_at`.
  - [ ] Add Vitest coverage proving a second processing pass for the same session leaves exactly one matching `memory_sessions` row and updates it idempotently.
  - [ ] Add a static/import-boundary test proving `session-relay` source files do not import vector/embedder modules or `jsonl-index`/`search-memory` extension internals.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-memory-tool.test.ts` and verify existing vector index/search tool behavior still passes despite the new independent metadata store.
  - [ ] Run `pnpm run typecheck` and verify the new extension package and shared schema types compile.
- **Manual-only verification:** N/A — table creation, idempotence, and dependency boundaries are automatable.
- **Planned commits:**
  1. `feat: add lightweight pi session relay metadata` — new extension scaffold, `memory_sessions` schema, metadata upsert runtime, dependency-boundary tests.
- **Technical notes:** The `memory_sessions` table is owned by the relay reference flow, not by embeddings. Keep it generic enough for future harness rows (`source_harness = 'codex' | 'claude'`) without adding those adapters now.

#### Story 3: Implement Latest Prior Session Discovery and Bounded Pi Message Loading
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
  - Findings: P2 — Planning review placeholder text remained after sprint-doc-reviewer re-review; no story-specific scope or verification findings.
  - Resolution: Replaced placeholder with concrete reviewer outcome before sprint start.
- **As a** Pi extension developer, **I want** `session-relay` to find and load the latest prior Pi session, **so that** relay generation receives only the relevant bounded source material.
- **Dependencies:** Story 2
- **Acceptance criteria:**
  - [ ] `session-relay` exposes a small harness-agnostic discovery interface for historical sessions using `sourceHarness`, `sourceUri`, `projectId` or `cwd`, and `lastMessageAt`.
  - [ ] The Pi implementation selects the latest prior `memory_sessions` row for the same repo/project by `last_message_at`, excluding the current session URI when supplied.
  - [ ] No historical rows for the repo/project produce a clean `null`/no-prior-session result without warnings or thrown errors.
  - [ ] The Pi message loader reads only visible user/assistant natural-language text from the selected Pi JSONL source and excludes tool results, hidden custom/context messages, system content, images, thinking blocks, and non-text blocks.
  - [ ] The loader returns the tail of visible messages bounded by an explicit char/token-budget approximation, truncating from the front when oversized.
- **Functional verification:**
  - [ ] Add Vitest coverage proving two historical Pi session rows in a temp DB select the one with the newest `last_message_at` for the same repo/project.
  - [ ] Add Vitest coverage proving the current session URI is excluded even if it has the newest timestamp.
  - [ ] Add Vitest coverage proving no historical rows for a repo/project return `null`/no prior session without throwing or warning.
  - [ ] Add Vitest coverage using JSONL fixtures proving visible-message extraction excludes tool/hidden/system/thinking/image/non-text content and enforces the configured tail budget.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-session-history.test.ts` and verify existing JSONL parser/source-pointer inspection expectations still pass.
  - [ ] Run `pnpm run typecheck` and verify relay/discovery interfaces compile without `any`.
- **Manual-only verification:** N/A — latest-session selection and message filtering are automatable with SQLite/JSONL fixtures.
- **Planned commits:**
  1. `feat: add pi prior session discovery` — discovery interface, Pi SQL implementation, and latest-session tests.
  2. `feat: add bounded pi relay message loader` — visible-message loader, budget handling, and filtering tests.
- **Technical notes:** Keep Codex/Claude as type-level harness values/seams only; do not add incomplete adapters. Use the same visible-message filtering rules already documented by `search-session-history`.

#### Story 4: Add Relay Generation Abstraction with Six-Section Prompt
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
  - Findings: P2 — Planning review placeholder text remained after sprint-doc-reviewer re-review; no story-specific scope or verification findings.
  - Resolution: Replaced placeholder with concrete reviewer outcome before sprint start.
- **As a** user starting a new session, **I want** the prior-session handoff to use the existing relay structure, **so that** the new agent receives concise continuity rather than raw message dumps.
- **Dependencies:** Story 3
- **Acceptance criteria:**
  - [ ] A relay generator module builds a prompt/input using the existing six-section relay format: Current task, Progress, Key files, Decisions made, Blockers/open questions, Next steps.
  - [ ] The generator is dependency-injected so tests can use a fake summarizer/model transport without calling an external provider.
  - [ ] Relay output is validated enough to reject empty/whitespace-only summaries and preserve a clear non-blocking failure result for callers.
  - [ ] Generated relay content includes a clear heading/preamble identifying the source harness/session pointer before injection.
  - [ ] Relay generation does not require embeddings, vector search, `pristine_recall`, or a prior semantic index.
- **Functional verification:**
  - [ ] Add Vitest coverage proving the fake summarizer receives bounded prior-session visible messages and a prompt containing all six required relay sections.
  - [ ] Add Vitest coverage proving a non-empty summarizer result is formatted as a `Prior Session Handoff` payload with source harness/session metadata.
  - [ ] Add Vitest coverage proving summarizer errors and empty summaries return a failure result without throwing to the top-level caller.
  - [ ] Add Vitest/import-boundary coverage proving relay generation does not import vector/embedder/search-memory modules.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/examples/pi-dev/search-session-history.test.ts` and verify existing pointer-first exact-context skill expectations still pass.
  - [ ] Run `pnpm run typecheck` and verify the generator abstraction has explicit types and no `any`.
- **Manual-only verification:** N/A for unit behavior. Real model behavior is covered by the sprint manual smoke in Story 7 / Final Story.
- **Planned commits:**
  1. `feat: add relay handoff generator` — six-section prompt builder, injectable summarizer interface, result formatting, dependency-boundary check, and tests.
- **Technical notes:** The sprint agreed to run relay fresh on every eligible new session and not check/store cached relay summaries. Keep model/provider integration thin so Pi runtime can supply the summarizer while tests supply a fake.

#### Story 5: Inject Relay Once on Eligible New Pi Sessions
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
  - Findings: P2 — Planning review placeholder text remained after sprint-doc-reviewer re-review; no story-specific scope or verification findings.
  - Resolution: Replaced placeholder with concrete reviewer outcome before sprint start.
- **As a** Pi user, **I want** a fresh new session to receive a prior-session relay only when repo history exists, **so that** continuity appears automatically without requiring semantic search setup.
- **Dependencies:** Story 4
- **Acceptance criteria:**
  - [ ] `session-relay` hooks into the appropriate new-session/first-prompt path and injects a model-visible custom context message only when a latest prior session exists for the current repo/project.
  - [ ] The runtime injects at most once per current session, including when the relevant Pi lifecycle callback is retried or reloaded.
  - [ ] The runtime excludes the current session from prior-session selection.
  - [ ] No-history behavior is a silent no-op: no injected message, no thrown error, and no user-facing warning.
  - [ ] Relay generation failure is fail-open: no partial relay injection, session continues, and a non-blocking visible warning is sent to the user.
  - [ ] Successful injection is routed through Pi's model-visible custom context/message channel, includes source harness/session pointer metadata for auditability, and emits no success notification or visible chat/TUI message; user-visible notification is reserved for fail-open relay generation warnings only.
  - [ ] Injection works in tests with only `session-relay` and shared helpers present; it must not require vector tables, embeddings, `jsonl-index`, `search-memory`, or `pristine_recall`.
- **Functional verification:**
  - [ ] Add Vitest coverage with fake Pi context/session manager proving a new session with prior metadata returns/appends exactly one relay custom message.
  - [ ] Add Vitest coverage proving repeated lifecycle invocation for the same session does not duplicate the relay.
  - [ ] Add Vitest coverage proving no-history returns no injection and no warning.
  - [ ] Add Vitest coverage proving summarizer failure sends a non-blocking warning and returns no injection.
  - [ ] Add Vitest coverage proving successful injection includes source harness/session pointer metadata and is routed through the model-visible custom context/message channel without a success notification or visible chat/TUI message.
  - [ ] Add Vitest coverage proving injection succeeds when vector tables are absent from the temporary DB.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-memory-tool.test.ts tests/examples/pi-dev/search-session-history.test.ts` and verify existing Pi reference index/search/session-history behavior still passes.
  - [ ] Run `pnpm run typecheck` and verify the new extension/runtime types compile.
- **Manual-only verification:** N/A for core injection decisions; real Pi lifecycle smoke is covered by Story 7.
- **Planned commits:**
  1. `feat: add pi start-session relay runtime` — extension/runtime integration, once-per-session guard, injection/no-history/failure behavior, vector-independent tests.
- **Technical notes:** Prefer `before_agent_start` for model-visible custom message injection unless code inspection proves a better Pi event path. The guard may be in-memory/session-local; persistent relay cache is explicitly out of scope.

#### Story 6: Document Installation, Configuration, and Cross-Harness Boundaries
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
  - Findings: P2 — Planning review placeholder text remained after sprint-doc-reviewer re-review, and cross-story synthesis noted the new Pi session relay flow needs implementation-spec alignment.
  - Resolution: Replaced placeholder with concrete reviewer outcome and added Story 6 acceptance/verification items to update `docs/specs/implementation-spec-005.md` before sprint integration.
- **As a** developer adopting the Pi reference, **I want** clear docs for start-session relay behavior and boundaries, **so that** I know what is installed, what is automatic, and which artifacts are optional.
- **Dependencies:** Story 5
- **Acceptance criteria:**
  - [ ] `examples/pi-dev/README.md` documents `session-relay` as a separate optional artifact with copy/install target, dependency install expectations, and how it relates to existing `jsonl-index`, `search-memory`, and `search-session-history` artifacts.
  - [ ] Documentation explicitly states that `session-relay` does not require embeddings, `sqlite-vec`, `jsonl-index`, `search-memory`, or `pristine_recall`.
  - [ ] Documentation explicitly states no-history behavior, latest-prior-session selection, fresh relay generation/no cache, failure warning behavior, and Pi-first scope with Codex/Claude deferred.
  - [ ] Documentation identifies the generic `memory_sessions` metadata contract and the meaning of `source_harness = 'pi'` for current rows.
  - [ ] `docs/specs/implementation-spec-005.md` is updated with a concise reference-flow addendum for `session-relay`, including its vector independence, generic `memory_sessions` metadata, and relationship to the source-pointer semantic index boundary.
  - [ ] A manual Pi smoke checklist is added with setup steps, pass/fail conditions, and expected evidence to record.
- **Functional verification:**
  - [ ] Add/extend docs-focused Vitest coverage (for example `tests/examples/pi-dev/install-layout.test.ts`) proving the new `session-relay` extension/docs path is represented in the install layout and README text includes the required behavior statements.
  - [ ] Run a markdown/static grep check proving the README contains `session-relay`, `memory_sessions`, `source_harness`, no-history behavior, vector-independence language, and manual smoke pass/fail language.
  - [ ] Run a markdown/static grep check proving `docs/specs/implementation-spec-005.md` mentions `session-relay`, vector independence, and `memory_sessions` as the session-relay metadata contract.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/examples/pi-dev/install-layout.test.ts` and verify existing Pi-dev artifact layout expectations still pass.
  - [ ] Run `pnpm run docs:build` or, if docs build is unrelated/unavailable for examples-only docs, run `pnpm run typecheck` and record why docs build was not the relevant regression check.
  - [ ] Review the `docs/specs/implementation-spec-005.md` update and verify it preserves the source-pointer semantic index boundary instead of reintroducing raw transcript ownership or fact extraction.
- **Manual-only verification:** N/A for docs content; the manual smoke checklist is executed in Story 7 / Final Story.
- **Planned commits:**
  1. `docs: document pi session relay reference` — README updates, install layout references, and docs/static tests.
- **Technical notes:** Keep docs explicit that this is a reference implementation: “This is one way to use Pristine primitives. You can write your own.”

#### Story 7: Real-Path Pi Smoke and Sprint Evidence Prep
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
  - Findings: P2 — Planning review placeholder text remained after sprint-doc-reviewer re-review; no story-specific scope or verification findings.
  - Resolution: Replaced placeholder with concrete reviewer outcome before sprint start.
- **As a** maintainer, **I want** a documented real-path Pi smoke and consolidated evidence hooks before final verification, **so that** the feature is proven in the actual harness path, not only unit tests.
- **Dependencies:** Story 6
- **Acceptance criteria:**
  - [ ] The sprint doc or a linked docs/checklist section records a manual Pi smoke procedure that installs/enables `session-relay` without `jsonl-index`, creates prior Pi history, starts a new session in the same repo, observes relay injection, verifies no duplicate injection, and verifies no-history behavior in a temporary/empty repo.
  - [ ] The manual smoke procedure includes explicit pass/fail conditions and where to record evidence.
  - [ ] The sprint implementation includes test fixtures or helper scripts needed to make final verification reproducible without committing generated logs, local DBs, model output dumps, or local session data.
- **Functional verification:**
  - [ ] Run the documented manual Pi smoke checklist once after implementation and record pass/fail evidence path or transcript summary in the story PR and final sprint review.
  - [ ] Run all new Pi relay unit/integration tests introduced by Stories 1-6 and record the command plus pass/fail status.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-memory-tool.test.ts tests/examples/pi-dev/search-session-history.test.ts tests/examples/pi-dev/install-layout.test.ts` and verify existing Pi reference tests pass.
  - [ ] Run `pnpm run typecheck` and verify the repository still compiles.
- **Manual-only verification:** Manual Pi smoke is required because lifecycle injection must be proven in the actual Pi harness. Pass condition: a new session in a repo with prior `session-relay` metadata receives exactly one prior-session handoff without installing vector indexing; a new session in an empty-history repo receives none; relay generation failure, if simulated manually, warns without blocking.
- **Planned commits:**
  1. `test: add pi relay smoke evidence hooks` — any fixture/checklist refinements and evidence prep updates.
- **Technical notes:** Default noisy commands to file-backed logs and summarize only the result/path. Do not commit generated Pi session files, generated relay transcripts, or local DBs.

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
  - [ ] Verification delta is reported by canonical type, showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals, and includes rows for every canonical verification type even when the count is zero.
  - [ ] The sprint doc status is updated to `🟢 Complete` only if completion criteria are met.
  - [ ] A `## Final Review` section is appended to the sprint doc with the final completion message quoted for auditability.
- **Functional verification:**
  - [ ] Run all functional verification items from every story and record pass/fail evidence.
- **Regression verification:**
  - [ ] Run all targeted regression verification items from every story and record pass/fail evidence.
  - [ ] Run the full available regression verification suite and record pass/fail evidence.
- **Manual-only verification:** Manual Pi smoke from Story 7 must be run or explicitly documented as unrun/blocked with rationale.
- **Planned commits:**
  1. `test: complete sprint 032 verification` — final verification evidence and sprint doc completion update.
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
