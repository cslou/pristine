# Pristine — Sprint 032
**Date:** 2026-05-27 – 2026-06-03
**Goal:** New Pi sessions receive a bounded relay handoff from the latest prior indexed session in the same repo, while Pristine records generic session metadata for future Codex/Claude adapters.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript strict ESM SDK/reference examples; SQLite via `better-sqlite3`; vectors via `sqlite-vec`; local embeddings via `@huggingface/transformers`; Vitest for unit/integration/e2e/smoke checks.
- **Current state:** `examples/pi-dev/extensions/jsonl-index/` indexes active Pi JSONL visible user/assistant messages into `pi_jsonl_chunks` plus `vec_pi_jsonl_chunks`; `examples/pi-dev/extensions/search-memory/` exposes `pristine_recall`; `examples/pi-dev/skills/search-session-history/` inspects authoritative Pi JSONL by source pointer. The index records source metadata but does not yet maintain harness-generic session metadata, run relay generation, or inject prior-session handoff context into new Pi sessions.
- **Implementation spec:** `docs/specs/implementation-spec-005.md`

### Sprint-Wide Context

- **Sprint type:** Feature
- **Shared context:** This sprint is Pi-first. It must create generic seams for future `codex` and `claude` harness metadata/discovery, but only Pi JSONL discovery/loading and Pi relay injection are implemented now. Relay generation is fresh on each eligible new session; no relay cache is introduced.
- **Non-goals:** No Codex adapter, no Claude adapter, no background scan of all historical sessions, no persistent cached relay summaries, no changes to core SDK public APIs unless required by example typings, no raw transcript mirroring into Pristine beyond existing snippet/index behavior.

### Affected Flows

- **Existing flows affected:** Pi JSONL indexing reference (`examples/pi-dev/extensions/jsonl-index/`), Pi development reference install/runtime docs (`examples/pi-dev/README.md`), Pi search-memory/reference tests that share the SQLite schema.
- **New flows introduced:** New Pi session relay flow: when a new Pi session begins in a repo with indexed historical sessions, Pristine selects the latest prior session, summarizes a bounded visible user/assistant tail using the six-section relay format, and injects the result once as model-visible custom context.

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

#### Story 1: Add Generic Session Metadata to the Pi JSONL Index
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
  - Findings: P2 — Functional tests did not explicitly prove all required metadata fields from AC-1, especially `first_message_at`, `project_id`/`cwd`, and `updated_at`.
  - Resolution: Functional verification now requires assertions for every required `memory_sessions` field named in AC-1.
- **As a** maintainer, **I want** the Pi JSONL index to maintain generic session metadata, **so that** later relay/discovery code can ask for historical sessions without grouping chunk rows or knowing Pi-specific table details.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] `examples/pi-dev/shared/lib/pi-jsonl-index-schema.ts` defines a generic session metadata table contract whose rows include at least `source_harness`, `source_uri`, `project_id` or `cwd`, `first_message_at`, `last_message_at`, `visible_message_count`, and `updated_at`.
  - [ ] `examples/pi-dev/extensions/jsonl-index/lib/source-index.ts` upserts one generic session row per indexed Pi JSONL source with `source_harness = 'pi'` and timestamps/counts derived from visible indexed user/assistant messages.
  - [ ] Re-indexing the same Pi JSONL source updates the same session row idempotently and does not duplicate session metadata.
  - [ ] Existing `pi_jsonl_chunks` and `vec_pi_jsonl_chunks` behavior remains backward-compatible for search-memory.
- **Functional verification:**
  - [ ] Add/extend Vitest coverage in `tests/examples/pi-dev/jsonl-index.test.ts` proving a temporary DB receives a generic `memory_sessions` row after indexing `tests/fixtures/pi-jsonl/mixed-session.jsonl`, with assertions for every required metadata field: `source_harness = 'pi'`, expected `source_uri`, `project_id` or `cwd`, `first_message_at`, `last_message_at`, `visible_message_count`, and `updated_at`.
  - [ ] Add/extend Vitest coverage proving a second indexing pass for the same source leaves exactly one matching `memory_sessions` row.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts` and verify existing chunk/vector indexing, stale active-branch cleanup, duplicate suppression, and startup missing-file behavior still pass.
  - [ ] Run `pnpm run typecheck` and verify the shared schema/type changes compile under strict TypeScript.
- **Manual-only verification:** N/A — database writes and idempotence are automatable with temporary SQLite databases.
- **Planned commits:**
  1. `feat: add generic memory session metadata for pi jsonl index` — schema constants, indexer upsert logic, and focused tests.
- **Technical notes:** Prefer additive DDL (`CREATE TABLE IF NOT EXISTS`) and keep existing table names/columns untouched. The generic session table is a reference-example table in the Pi-dev SQLite DB, not a core SDK public API migration.

#### Story 2: Implement Latest Prior Session Discovery and Pi Message Loading
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
- **As a** Pi extension developer, **I want** a harness-agnostic session discovery boundary with a Pi implementation, **so that** relay code can select and read the latest prior session without embedding Pi-specific SQL/parsing everywhere.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [ ] A new relay/discovery module under `examples/pi-dev/` exposes a small interface for historical sessions using `sourceHarness`, `sourceUri`, `projectId` or `cwd`, and `lastMessageAt`.
  - [ ] The Pi implementation selects the latest prior session for the same repo/project by `last_message_at`, excluding the current session URI when supplied.
  - [ ] The Pi message loader reads only visible user/assistant natural-language text from the selected Pi JSONL source and excludes tool results, hidden custom/context messages, system content, images, thinking blocks, and non-text blocks.
  - [ ] The loader returns the tail of visible messages bounded by an explicit char/token-budget approximation, truncating from the front when oversized.
- **Functional verification:**
  - [ ] Add Vitest coverage proving two historical Pi session rows in a temp DB select the one with the newest `last_message_at` for the same repo/project.
  - [ ] Add Vitest coverage proving the current session URI is excluded even if it has the newest timestamp.
  - [ ] Add Vitest coverage proving no historical rows for a repo/project return `null`/no prior session without throwing.
  - [ ] Add Vitest coverage using JSONL fixtures proving visible-message extraction excludes tool/hidden/system/thinking/image/non-text content and enforces the configured tail budget.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-session-history.test.ts` and verify existing JSONL parser/source-pointer inspection expectations still pass.
  - [ ] Run `pnpm run typecheck` and verify relay/discovery interfaces compile without `any`.
- **Manual-only verification:** N/A — latest-session selection and message filtering are automatable with SQLite/JSONL fixtures.
- **Planned commits:**
  1. `feat: add pi prior session discovery` — discovery interface, Pi SQL implementation, and latest-session tests.
  2. `feat: add bounded pi relay message loader` — visible-message loader, budget handling, and filtering tests.
- **Technical notes:** Keep Codex/Claude as type-level harness values/seams only; do not add incomplete adapters. Use the same visible-message filtering rules already documented by `search-session-history`.

#### Story 3: Add Relay Generation Abstraction with Six-Section Prompt
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
- **As a** user starting a new session, **I want** the prior-session handoff to use the existing relay structure, **so that** the new agent receives concise continuity rather than raw message dumps.
- **Dependencies:** Story 2
- **Acceptance criteria:**
  - [ ] A relay generator module builds a prompt/input using the existing six-section relay format: Current task, Progress, Key files, Decisions made, Blockers/open questions, Next steps.
  - [ ] The generator is dependency-injected so tests can use a fake summarizer/model transport without calling an external provider.
  - [ ] Relay output is validated enough to reject empty/whitespace-only summaries and preserve a clear non-blocking failure result for callers.
  - [ ] Generated relay content includes a clear heading/preamble identifying the source harness/session pointer before injection.
- **Functional verification:**
  - [ ] Add Vitest coverage proving the fake summarizer receives bounded prior-session visible messages and a prompt containing all six required relay sections.
  - [ ] Add Vitest coverage proving a non-empty summarizer result is formatted as a `Prior Session Handoff` payload with source harness/session metadata.
  - [ ] Add Vitest coverage proving summarizer errors and empty summaries return a failure result without throwing to the top-level caller.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/examples/pi-dev/search-session-history.test.ts` and verify existing pointer-first exact-context skill expectations still pass.
  - [ ] Run `pnpm run typecheck` and verify the generator abstraction has explicit types and no `any`.
- **Manual-only verification:** N/A for unit behavior. Real model behavior is covered by the sprint manual smoke in Story 6 / Final Story.
- **Planned commits:**
  1. `feat: add relay handoff generator` — six-section prompt builder, injectable summarizer interface, result formatting, and tests.
- **Technical notes:** The sprint agreed to run relay fresh on every eligible new session and not check/store cached relay summaries. Keep model/provider integration thin so Pi runtime can supply the summarizer while tests supply a fake.

#### Story 4: Inject Relay Once on Eligible New Pi Sessions
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
  - Findings: P2 — AC-6 used subjective “minimal/no TUI noise” wording; functional verification did not explicitly verify audit metadata or model-visible routing.
  - Resolution: AC-6 now defines exact visible behavior, and functional verification now asserts source pointer metadata plus model-visible custom context routing.
- **As a** Pi user, **I want** a fresh new session to receive a prior-session relay only when repo history exists, **so that** continuity appears automatically without polluting resumes or projects with no history.
- **Dependencies:** Story 3
- **Acceptance criteria:**
  - [ ] A Pi reference extension/runtime hooks into the appropriate new-session/first-prompt path and injects a model-visible custom context message only when a latest prior session exists for the current repo/project.
  - [ ] The runtime injects at most once per current session, including when the relevant Pi lifecycle callback is retried or reloaded.
  - [ ] The runtime excludes the current session from prior-session selection.
  - [ ] No-history behavior is a silent no-op: no injected message, no thrown error, and no user-facing warning.
  - [ ] Relay generation failure is fail-open: no partial relay injection, session continues, and a non-blocking visible warning is sent to the user.
  - [ ] Successful injection is routed through Pi's model-visible custom context/message channel, includes source harness/session pointer metadata for auditability, and emits no success notification or visible chat/TUI message; user-visible notification is reserved for fail-open relay generation warnings only.
- **Functional verification:**
  - [ ] Add Vitest coverage with fake Pi context/session manager proving a new session with prior history returns/appends exactly one relay custom message.
  - [ ] Add Vitest coverage proving repeated lifecycle invocation for the same session does not duplicate the relay.
  - [ ] Add Vitest coverage proving no-history returns no injection and no warning.
  - [ ] Add Vitest coverage proving summarizer failure sends a non-blocking warning and returns no injection.
  - [ ] Add Vitest coverage proving successful injection includes source harness/session pointer metadata and is routed through the model-visible custom context/message channel without a success notification or visible chat/TUI message.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-memory-tool.test.ts tests/examples/pi-dev/search-session-history.test.ts` and verify existing Pi reference index/search/session-history behavior still passes.
  - [ ] Run `pnpm run typecheck` and verify the new extension/runtime types compile.
- **Manual-only verification:** N/A for core injection decisions; real Pi lifecycle smoke is covered by Story 6.
- **Planned commits:**
  1. `feat: add pi start-session relay runtime` — extension/runtime integration, once-per-session guard, injection/no-history/failure behavior, and tests.
- **Technical notes:** Prefer `before_agent_start` for model-visible custom message injection unless code inspection proves a better Pi event path. The guard may be in-memory/session-local; persistent relay cache is explicitly out of scope.

#### Story 5: Document Installation, Configuration, and Cross-Harness Boundaries
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
- **As a** developer adopting the Pi reference, **I want** clear docs for start-session relay behavior and boundaries, **so that** I know what is installed, what is automatic, and what remains out of scope.
- **Dependencies:** Story 4
- **Acceptance criteria:**
  - [ ] `examples/pi-dev/README.md` documents the new relay artifact, install/copy target, dependency install expectations, and how it interacts with existing `jsonl-index`, `search-memory`, and `search-session-history` artifacts.
  - [ ] Documentation explicitly states no-history behavior, latest-prior-session selection, fresh relay generation/no cache, failure warning behavior, and Pi-first scope with Codex/Claude deferred.
  - [ ] Documentation identifies the generic `memory_sessions` metadata contract and the meaning of `source_harness = 'pi'` for current rows.
  - [ ] A manual Pi smoke checklist is added with setup steps, pass/fail conditions, and expected evidence to record.
- **Functional verification:**
  - [ ] Add/extend docs-focused Vitest coverage (for example `tests/examples/pi-dev/install-layout.test.ts`) proving the new relay extension/docs path is represented in the install layout and README text includes the required behavior statements.
  - [ ] Run a markdown/static grep check proving the README contains `memory_sessions`, `source_harness`, no-history behavior, and manual smoke pass/fail language.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/examples/pi-dev/install-layout.test.ts` and verify existing Pi-dev artifact layout expectations still pass.
  - [ ] Run `pnpm run docs:build` or, if docs build is unrelated/unavailable for examples-only docs, run `pnpm run typecheck` and record why docs build was not the relevant regression check.
- **Manual-only verification:** N/A for docs content; the manual smoke checklist is executed in Story 6 / Final Story.
- **Planned commits:**
  1. `docs: document pi start-session relay` — README updates, install layout references, and docs/static tests.
- **Technical notes:** Keep docs explicit that this is a reference implementation: “This is one way to use Pristine primitives. You can write your own.”

#### Story 6: Real-Path Pi Smoke and Sprint Evidence Prep
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
- **As a** maintainer, **I want** a documented real-path Pi smoke and consolidated evidence hooks before final verification, **so that** the feature is proven in the actual harness path, not only unit tests.
- **Dependencies:** Story 5
- **Acceptance criteria:**
  - [ ] The sprint doc or a linked docs/checklist section records a manual Pi smoke procedure that creates prior Pi history, starts a new session in the same repo, observes relay injection, verifies no duplicate injection, and verifies no-history behavior in a temporary/empty repo.
  - [ ] The manual smoke procedure includes explicit pass/fail conditions and where to record evidence.
  - [ ] The sprint implementation includes test fixtures or helper scripts needed to make final verification reproducible without committing generated logs or local session data.
- **Functional verification:**
  - [ ] Run the documented manual Pi smoke checklist once after implementation and record pass/fail evidence path or transcript summary in the story PR and final sprint review.
  - [ ] Run all new Pi relay unit/integration tests introduced by Stories 1-5 and record the command plus pass/fail status.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-memory-tool.test.ts tests/examples/pi-dev/search-session-history.test.ts tests/examples/pi-dev/install-layout.test.ts` and verify existing Pi reference tests pass.
  - [ ] Run `pnpm run typecheck` and verify the repository still compiles.
- **Manual-only verification:** Manual Pi smoke is required because lifecycle injection must be proven in the actual Pi harness. Pass condition: a new session in a repo with prior indexed Pi history receives exactly one prior-session handoff; a new session in an empty-history repo receives none; relay generation failure, if simulated manually, warns without blocking.
- **Planned commits:**
  1. `test: add pi relay smoke evidence hooks` — any fixture/checklist refinements and evidence prep updates.
- **Technical notes:** Default noisy commands to file-backed logs and summarize only the result/path. Do not commit generated Pi session files or local DBs.

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
- **Manual-only verification:** Manual Pi smoke from Story 6 must be run or explicitly documented as unrun/blocked with rationale.
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
