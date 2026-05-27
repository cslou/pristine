# Pristine — Sprint 032
**Date:** 2026-05-27 – 2026-06-03
**Goal:** New Pi sessions receive a bounded relay handoff from the latest prior session in the same repo through a lightweight session-relay extension that is independent of embeddings/vector search, while shared Pi JSONL helpers keep existing semantic indexing behavior intact.
**Status:** 🟢 Complete

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
  - [x] A new reference extension exists at `examples/pi-dev/extensions/session-relay/` with its own `package.json`, runtime entry point, and tests.
  - [x] The extension creates/maintains a generic `memory_sessions` table in the Pi-dev SQLite DB using shared schema constants, with fields including `source_harness`, `source_uri`, `project_id` or `cwd`, `first_message_at`, `last_message_at`, `visible_message_count`, and `updated_at`.
  - [x] Pi rows use `source_harness = 'pi'`, `source_uri = ctx.sessionManager.getSessionFile()`, and timestamps/counts derived from visible user/assistant messages parsed through shared helpers.
  - [x] Reprocessing the same Pi session upserts one metadata row idempotently and updates timestamps/counts without duplicating `memory_sessions` rows.
  - [x] `session-relay` package/runtime does not import `jsonl-index`, `search-memory`, `sqlite-vec`, local embedder modules, or `@huggingface/transformers`.
  - [x] `jsonl-index` remains usable without installing `session-relay`, and `session-relay` remains usable without installing `jsonl-index`.
- **Functional verification:**
  - [x] Add Vitest coverage proving a temporary DB receives one `memory_sessions` row after the `session-relay` metadata runtime processes `tests/fixtures/pi-jsonl/mixed-session.jsonl`, with assertions for every required metadata field: `source_harness = 'pi'`, expected `source_uri`, `project_id` or `cwd`, `first_message_at`, `last_message_at`, `visible_message_count`, and `updated_at`.
  - [x] Add Vitest coverage proving a second processing pass for the same session leaves exactly one matching `memory_sessions` row and updates it idempotently.
  - [x] Add a static/import-boundary test proving `session-relay` source files do not import vector/embedder modules or `jsonl-index`/`search-memory` extension internals.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-memory-tool.test.ts` and verify existing vector index/search tool behavior still passes despite the new independent metadata store.
  - [x] Run `pnpm run typecheck` and verify the new extension package and shared schema types compile.
- **Story 2 evidence:** PASS — `pnpm run test:unit -- tests/examples/pi-dev/session-relay-metadata.test.ts tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-memory-tool.test.ts`; PASS — `pnpm run typecheck`.
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
  - [x] `session-relay` exposes a small harness-agnostic discovery interface for historical sessions using `sourceHarness`, `sourceUri`, `projectId` or `cwd`, and `lastMessageAt`.
  - [x] The Pi implementation selects the latest prior `memory_sessions` row for the same repo/project by `last_message_at`, excluding the current session URI when supplied.
  - [x] No historical rows for the repo/project produce a clean `null`/no-prior-session result without warnings or thrown errors.
  - [x] The Pi message loader reads only visible user/assistant natural-language text from the selected Pi JSONL source and excludes tool results, hidden custom/context messages, system content, images, thinking blocks, and non-text blocks.
  - [x] The loader returns the tail of visible messages bounded by an explicit char/token-budget approximation, truncating from the front when oversized.
- **Functional verification:**
  - [x] Add Vitest coverage proving two historical Pi session rows in a temp DB select the one with the newest `last_message_at` for the same repo/project.
  - [x] Add Vitest coverage proving the current session URI is excluded even if it has the newest timestamp.
  - [x] Add Vitest coverage proving no historical rows for a repo/project return `null`/no prior session without throwing or warning.
  - [x] Add Vitest coverage using JSONL fixtures proving visible-message extraction excludes tool/hidden/system/thinking/image/non-text content and enforces the configured tail budget.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-session-history.test.ts` and verify existing JSONL parser/source-pointer inspection expectations still pass.
  - [x] Run `pnpm run typecheck` and verify relay/discovery interfaces compile without `any`.
- **Story 3 evidence:** PASS — `pnpm run test:unit -- tests/examples/pi-dev/session-relay-metadata.test.ts tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-session-history.test.ts`; PASS — `pnpm run typecheck`.
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
  - [x] A relay generator module builds a prompt/input using the existing six-section relay format: Current task, Progress, Key files, Decisions made, Blockers/open questions, Next steps.
  - [x] The generator is dependency-injected so tests can use a fake summarizer/model transport without calling an external provider.
  - [x] Relay output is validated enough to reject empty/whitespace-only summaries and preserve a clear non-blocking failure result for callers.
  - [x] Generated relay content includes a clear heading/preamble identifying the source harness/session pointer before injection.
  - [x] Relay generation does not require embeddings, vector search, `pristine_recall`, or a prior semantic index.
- **Functional verification:**
  - [x] Add Vitest coverage proving the fake summarizer receives bounded prior-session visible messages and a prompt containing all six required relay sections.
  - [x] Add Vitest coverage proving a non-empty summarizer result is formatted as a `Prior Session Handoff` payload with source harness/session metadata.
  - [x] Add Vitest coverage proving summarizer errors and empty summaries return a failure result without throwing to the top-level caller.
  - [x] Add Vitest/import-boundary coverage proving relay generation does not import vector/embedder/search-memory modules.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/examples/pi-dev/search-session-history.test.ts` and verify existing pointer-first exact-context skill expectations still pass.
  - [x] Run `pnpm run typecheck` and verify the generator abstraction has explicit types and no `any`.
- **Story 4 evidence:** PASS — `pnpm run test:unit -- tests/examples/pi-dev/session-relay-metadata.test.ts tests/examples/pi-dev/search-session-history.test.ts`; PASS — `pnpm run typecheck`.
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
  - [x] `session-relay` hooks into the appropriate new-session/first-prompt path and injects a model-visible custom context message only when a latest prior session exists for the current repo/project.
  - [x] The runtime injects at most once per current session, including when the relevant Pi lifecycle callback is retried or reloaded.
  - [x] The runtime excludes the current session from prior-session selection.
  - [x] No-history behavior is a silent no-op: no injected message, no thrown error, and no user-facing warning.
  - [x] Relay generation failure is fail-open: no partial relay injection, session continues, and a non-blocking visible warning is sent to the user.
  - [x] Successful injection is routed through Pi's model-visible custom context/message channel, includes source harness/session pointer metadata for auditability, and emits no success notification or visible chat/TUI message; user-visible notification is reserved for fail-open relay generation warnings only.
  - [x] Injection works in tests with only `session-relay` and shared helpers present; it must not require vector tables, embeddings, `jsonl-index`, `search-memory`, or `pristine_recall`.
- **Functional verification:**
  - [x] Add Vitest coverage with fake Pi context/session manager proving a new session with prior metadata returns/appends exactly one relay custom message.
  - [x] Add Vitest coverage proving repeated lifecycle invocation for the same session does not duplicate the relay.
  - [x] Add Vitest coverage proving no-history returns no injection and no warning.
  - [x] Add Vitest coverage proving summarizer failure sends a non-blocking warning and returns no injection.
  - [x] Add Vitest coverage proving successful injection includes source harness/session pointer metadata and is routed through the model-visible custom context/message channel without a success notification or visible chat/TUI message.
  - [x] Add Vitest coverage proving injection succeeds when vector tables are absent from the temporary DB.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-memory-tool.test.ts tests/examples/pi-dev/search-session-history.test.ts` and verify existing Pi reference index/search/session-history behavior still passes.
  - [x] Run `pnpm run typecheck` and verify the new extension/runtime types compile.
- **Story 5 evidence:** PASS — `pnpm run test:unit -- tests/examples/pi-dev/session-relay-metadata.test.ts tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-memory-tool.test.ts tests/examples/pi-dev/search-session-history.test.ts`; PASS — `pnpm run typecheck`.
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
  - Resolution: Replaced placeholder with concrete reviewer outcome and added Story 6 acceptance/verification items for durable boundary docs. PR review confirmed `docs/specs/` is intentionally absent from the public repo, so the public boundary addendum lives in `examples/pi-dev/README.md` instead of reintroducing internal specs.
- **As a** developer adopting the Pi reference, **I want** clear docs for start-session relay behavior and boundaries, **so that** I know what is installed, what is automatic, and which artifacts are optional.
- **Dependencies:** Story 5
- **Acceptance criteria:**
  - [x] `examples/pi-dev/README.md` documents `session-relay` as a separate optional artifact with copy/install target, dependency install expectations, and how it relates to existing `jsonl-index`, `search-memory`, and `search-session-history` artifacts.
  - [x] Documentation explicitly states that `session-relay` does not require embeddings, `sqlite-vec`, `jsonl-index`, `search-memory`, or `pristine_recall`.
  - [x] Documentation explicitly states no-history behavior, latest-prior-session selection, fresh relay generation/no cache, failure warning behavior, and Pi-first scope with Codex/Claude deferred.
  - [x] Documentation identifies the generic `memory_sessions` metadata contract and the meaning of `source_harness = 'pi'` for current rows.
  - [x] Public docs include a concise reference-flow addendum for `session-relay`, including its vector independence, generic `memory_sessions` metadata, and relationship to the source-pointer semantic index boundary; `docs/specs/implementation-spec-005.md` remains untracked per the public-repo internal-doc policy.
  - [x] A manual Pi smoke checklist is added with setup steps, pass/fail conditions, and expected evidence to record.
- **Functional verification:**
  - [x] Add/extend docs-focused Vitest coverage (for example `tests/examples/pi-dev/install-layout.test.ts`) proving the new `session-relay` extension/docs path is represented in the install layout and README text includes the required behavior statements.
  - [x] Run a markdown/static grep check proving the README contains `session-relay`, `memory_sessions`, `source_harness`, no-history behavior, vector-independence language, and manual smoke pass/fail language.
  - [x] Run a markdown/static grep check proving public docs mention `session-relay`, vector independence, and `memory_sessions` as the session-relay metadata contract.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/examples/pi-dev/install-layout.test.ts` and verify existing Pi-dev artifact layout expectations still pass.
  - [x] Run `pnpm run docs:build` or, if docs build is unrelated/unavailable for examples-only docs, run `pnpm run typecheck` and record why docs build was not the relevant regression check.
  - [x] Review the public-doc boundary update and verify it preserves the source-pointer semantic index boundary instead of reintroducing raw transcript ownership or fact extraction.
- **Story 6 evidence:** PASS — `pnpm run test:unit -- tests/examples/pi-dev/install-layout.test.ts`; PASS — static grep checks: `for s in session-relay memory_sessions source_harness "No-history behavior" "does not require embeddings" "latest prior" "fresh six-section relay" "non-blocking warning" "Pi-first" "Pass condition"; do rg -q "$s" examples/pi-dev/README.md || exit 1; done`; PASS — `pnpm run typecheck` used because docs build is unrelated/unavailable for examples-only docs.
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
  - [x] The sprint doc or a linked docs/checklist section records a manual Pi smoke procedure that installs/enables `session-relay` without `jsonl-index`, creates prior Pi history, starts a new session in the same repo, observes relay injection, verifies no duplicate injection, and verifies no-history behavior in a temporary/empty repo.
  - [x] The manual smoke procedure includes explicit pass/fail conditions and where to record evidence.
  - [x] The sprint implementation includes test fixtures or helper scripts needed to make final verification reproducible without committing generated logs, local DBs, model output dumps, or local session data.
- **Functional verification:**
  - [x] Run the documented manual Pi smoke checklist once after implementation and record pass/fail evidence path or transcript summary in the story PR and final sprint review.
  - [x] Run all new Pi relay unit/integration tests introduced by Stories 1-6 and record the command plus pass/fail status.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-memory-tool.test.ts tests/examples/pi-dev/search-session-history.test.ts tests/examples/pi-dev/install-layout.test.ts` and verify existing Pi reference tests pass.
  - [x] Run `pnpm run typecheck` and verify the repository still compiles.
- **Story 7 evidence:** PASS — `node examples/pi-dev/scripts/session-relay-smoke.mjs` (log: `/tmp/pristine-story7-fix/session-relay-smoke.log`; success evidence `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-pi-relay-smoke-pXcJ8H/evidence`, empty-history evidence `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-pi-relay-empty-v4JveR/evidence`, failure evidence `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-pi-relay-failure-ek49jP/evidence`); PASS — `pnpm run test:unit -- tests/examples/pi-dev/session-relay-metadata.test.ts tests/examples/pi-dev/install-layout.test.ts`; PASS — `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-memory-tool.test.ts tests/examples/pi-dev/search-session-history.test.ts tests/examples/pi-dev/install-layout.test.ts`; PASS — `pnpm run typecheck`.
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
  - [x] Every story’s acceptance criteria are evaluated against implementation evidence.
  - [x] Every story’s functional verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [x] Every story’s targeted regression verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [x] The full available regression verification suite is run, including existing unit, integration, e2e, smoke, simulator/browser/device, static, and manual-only checks where applicable.
  - [x] Failed, ambiguous, manual-only, or unrun verification items are documented.
  - [x] The sprint’s new functional verification is identified as future regression verification.
  - [x] Verification delta is reported by canonical type, showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals, and includes rows for every canonical verification type even when the count is zero.
  - [x] The sprint doc status is updated to `🟢 Complete` only if completion criteria are met.
  - [x] A `## Final Review` section is appended to the sprint doc with the final completion message quoted for auditability.
- **Functional verification:**
  - [x] Run all functional verification items from every story and record pass/fail evidence.
- **Regression verification:**
  - [x] Run all targeted regression verification items from every story and record pass/fail evidence.
  - [x] Run the full available regression verification suite and record pass/fail evidence.
- **Final Story evidence:** PASS — `node examples/pi-dev/scripts/session-relay-smoke.mjs` (log: `/tmp/pristine-final/session-relay-smoke.log`; evidence dirs listed in the log); PASS — `pnpm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts tests/examples/pi-dev/search-session-history.test.ts tests/examples/pi-dev/search-memory-tool.test.ts tests/examples/pi-dev/session-relay-metadata.test.ts tests/examples/pi-dev/install-layout.test.ts`; PASS — `.checks/regression.sh --tier=full` (log: `/tmp/pristine-final/full-regression.log`; includes lint, typecheck, unit, build, smoke, deterministic integration, e2e, full integration, and source-index local-model smoke).
- **Manual-only verification:** Satisfied by the reproducible real-path Pi CLI helper (`node examples/pi-dev/scripts/session-relay-smoke.mjs`), which installs only `session-relay`, creates prior history, verifies one injected handoff, verifies no duplicate injection on resume, verifies empty-history no-op, and verifies failure warning/no-partial-injection behavior.
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

## Final Review

**Mergeability:** 5/5

## Sprint objective + accomplishments

**Objective:** New Pi sessions receive a bounded relay handoff from the latest prior session in the same repo through a lightweight session-relay extension that is independent of embeddings/vector search, while shared Pi JSONL helpers keep existing semantic indexing behavior intact.

**What was accomplished:**
- **Story 1: Extract Shared Pi JSONL Helpers Without Changing Vector Indexing** — Moved reusable Pi JSONL/session parsing into `examples/pi-dev/shared/` while preserving the existing vector indexing behavior. Evidence lives in the Story 1 unit/typecheck runs and the later full sprint regression suite.
- **Story 2: Add Lightweight Session Metadata Store in a New Session Relay Extension** — Added the independent `session-relay` extension scaffold and `memory_sessions` metadata contract without embedding/vector dependencies. Evidence lives in `tests/examples/pi-dev/session-relay-metadata.test.ts` and typecheck.
- **Story 3: Select Latest Prior Session and Load Bounded Visible Context** — Implemented latest-prior-session lookup by `cwd` plus bounded visible user/assistant tail loading from authoritative Pi JSONL. Evidence lives in the session-relay metadata/prior-session unit coverage.
- **Story 4: Generate Safe Six-Section Relay Content** — Added a relay generator abstraction with six-section output, untrusted-transcript wrapping, sanitization, and failure semantics. Evidence lives in session-relay generator/runtime unit coverage.
- **Story 5: Inject Relay Once at Pi Agent Start** — Wired `before_agent_start` injection, no-history no-op behavior, once-per-session guard, and fail-open warnings while keeping relay vector-independent. Evidence lives in session-relay runtime tests and review/fix gates.
- **Story 6: Document Installation, Configuration, and Cross-Harness Boundaries** — Documented optional install/configuration for `session-relay`, its vector independence, metadata contract, Pi-first scope, and manual smoke expectations without reintroducing internal specs. Evidence lives in README assertions, grep checks, and install-layout tests.
- **Story 7: Real-Path Pi Smoke and Sprint Evidence Prep** — Added `examples/pi-dev/scripts/session-relay-smoke.mjs`, a reproducible real Pi CLI smoke using a local fake provider. It proves prior-session injection, no duplicate injection, empty-history no-op, and failure-path warning/no-partial-injection behavior without installing vector search.

## Verification delta

| Verification type | Before sprint | Added this sprint | Removed | Pending / not yet run | After sprint | Notes |
|---|---:|---:|---:|---:|---:|---|
| Unit | 4 | +2 | 0 | 0 | 6 | Added `session-relay-metadata.test.ts`; extended `install-layout.test.ts` for relay docs/helper coverage. Existing Pi JSONL/search tests remain. |
| Integration / contract | 1 | +0 | 0 | 0 | 1 | Deterministic integration suite passed in final `.checks/pre-merge.sh`; real-model integration remains intentionally outside deep tier. |
| E2E / smoke | 2 | +1 | 0 | 0 | 3 | Added `examples/pi-dev/scripts/session-relay-smoke.mjs`; existing package/API smoke, source-index local-model smoke, and e2e privacy smoke passed. |
| Simulator / device | 0 | +0 | 0 | 0 | 0 | Not applicable for this Node/Pi reference sprint. |
| AI / model evals | 0 | +0 | 0 | 0 | 0 | No model-eval suite added; smoke helper uses a local fake provider to avoid paid/provider calls. |
| Static / local checks | 2 | +0 | 0 | 0 | 2 | Lint and typecheck passed in final pre-merge gate. |
| Performance / load | 0 | +0 | 0 | 0 | 0 | No performance/load surface changed. |
| Security / dependency | 1 | +0 | 0 | 0 | 1 | Security posture verified via review; no new dependencies added. |
| Accessibility / visual | 0 | +0 | 0 | 0 | 0 | Not applicable. |
| Manual-only | 0 | +0 | 0 | 0 | 0 | The planned manual Pi lifecycle check was converted into the reproducible real-path smoke helper counted under E2E / smoke; generated evidence remains in `/tmp` and is not committed. |
| Other verification | 0 | +0 | 0 | 0 | 0 | None. |
| **Total** | **10** | **+3** | **0** | **0** | **13** |  |

Counting basis: verification surfaces/checklist rows, not individual Vitest test cases. Unit surfaces count Pi-dev test files directly relevant to this sprint; E2E/smoke includes package/API smoke, existing e2e, and the new Pi CLI smoke helper.
Regression summary: 0 existing regression verifications pending/not yet run; full available regression gate passed, including local-model smoke/integration surfaces.

## Why ready
- All story ACs are checked and have evidence recorded in their story sections.
- Sprint functional verification passed, including the real-path Pi CLI smoke (`/tmp/pristine-final/session-relay-smoke.log`).
- Full available regression verification passed via `.checks/regression.sh --tier=full` (`/tmp/pristine-final/full-regression.log`).
- Story PRs #277–#283 merged into `sprint-032` after review gates; final story review remains the last story PR gate before sprint integration.

## Open for your decision
- None — the sprint is ready for the final story PR review and then sprint-integration review.

## Delivered

| Story | Item | Status | Evidence |
|---|---|---|---|
| Story 1 | Shared Pi JSONL helpers extracted without vector behavior regression | ✅ | `tests/examples/pi-dev/jsonl-index.test.ts`, `tests/examples/pi-dev/search-session-history.test.ts`, typecheck |
| Story 2 | `memory_sessions` metadata store and extension scaffold | ✅ | `tests/examples/pi-dev/session-relay-metadata.test.ts`, typecheck |
| Story 3 | Latest-prior-session lookup and bounded visible context loading | ✅ | `tests/examples/pi-dev/session-relay-metadata.test.ts` |
| Story 4 | Safe six-section relay generation/failure handling | ✅ | `tests/examples/pi-dev/session-relay-metadata.test.ts` |
| Story 5 | Once-per-session `before_agent_start` injection and no-history/failure behavior | ✅ | `tests/examples/pi-dev/session-relay-metadata.test.ts`; PR #281 review/fix gates |
| Story 6 | Optional install/docs/boundary coverage | ✅ | `examples/pi-dev/README.md`; `tests/examples/pi-dev/install-layout.test.ts`; PR #282 review/fix gates |
| Story 7 | Real-path Pi CLI smoke helper and evidence hooks | ✅ | `node examples/pi-dev/scripts/session-relay-smoke.mjs`; PR #283 review/fix gates |
| Final Story | Full available regression suite | ✅ | `.checks/regression.sh --tier=full` log `/tmp/pristine-final/full-regression.log` |

## Drift from spec
- `docs/specs/implementation-spec-005.md` remains intentionally untracked/absent from the public repo after commit `01fdefd`; Story 6 records the DoD replacement source of truth as `examples/pi-dev/README.md` public boundary documentation rather than reintroducing internal specs.
- The relay smoke helper exports `createPiSessionRelayRuntime` from the session-relay entrypoint so the failure wrapper can verify warning behavior through the public extension module.

## New Dependencies
- None
