# Pristine — Sprint 022
**Date:** 2026-05-06 – TBD
**Goal:** Build the Pi reference implementation as a proof before core architecture cleanup: parse Pi JSONL user/assistant messages, index semantic snippets/windows with JSONL source pointers using the current Pristine primitives where practical, expose vector search plus a search-session-history skill, and verify the repo-local `.pi` install in `~/projects/test-pristine`.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript strict ESM, Node 18+, `better-sqlite3` + `sqlite-vec`, `@huggingface/transformers` with Nomic Embed v1.5 default, Vitest, Pi TypeScript extensions loaded by `@mariozechner/pi-coding-agent`.
- **Current state:** This sprint intentionally runs before the core architecture cleanup. Pi stores authoritative sessions as JSONL under `~/.pi/agent/sessions/.../*.jsonl`; raw JSONL is grep/jq-readable and should remain the source of truth. Use the current Pristine primitives with the smallest adapter needed, and record architecture-cleanup evidence for sprint-023.
- **Implementation spec:** `docs/specs/implementation-spec-005.md` current state, plus sprint output notes that will inform sprint-023 source-pointer cleanup. Reference layout convention: `docs/conventions/reference-implementation-layout.md`.

### Sprint-Wide Context
- **Sprint type:** Feature / Tooling / Docs.
- **Shared context:** Pi-only reference implementation. Pristine indexes Pi JSONL snippets/windows with source pointers through the least-invasive current-architecture adapter; it does not add a Pi SQL mirror of raw conversations. Vector search finds candidate memories; the `search-session-history` skill teaches the agent to inspect surrounding raw JSONL context with existing Pi tools such as `bash`, `read`, grep, and jq. Default index DB path is `~/.pi/pristine/pristine.db`, overrideable. Reference lives under convention-compliant `examples/pi-dev/<tool>/` directories (for example `jsonl-index`, `search-memory`, and `search-session-history`) and is installed into `~/projects/test-pristine/.pi` for real repo-local verification.
- **Non-goals:** No SQL mirror/tool. No session-start injection. No proactive memory injection. No multi-harness implementation. No default embedder swap. No published package.

### Affected Flows

- **Existing flows affected:** Pristine public API from an external consumer; Pi extension startup/reload; Pi session JSONL parsing; vector search over indexed source chunks.
- **New flows introduced:**
  - Pi JSONL parser extracts user/assistant natural-language messages and source pointers.
  - Pi extension indexes new message/window snippets into Pristine after the deterministic Pi capture hook and active-session discovery contract chosen in Story 1.
  - Pi custom tool `pristine_vector_search` returns source-pointer results.
  - Pi skill `search-session-history` guides raw JSONL context inspection around a vector hit using existing tools.
  - Repo-local install flow under `~/projects/test-pristine/.pi`.

### Verification Strategy

Every story defines functional verification for its new behavior and targeted regression verification for affected existing behavior. The Final Verification Story runs all sprint functional verification plus the full available regression suite.

### Stories
**Constraints:** Target 5-8 stories per sprint. Each story should be independently reviewable and verifiable.

#### Story 1: Confirm Pi JSONL parser and source-pointer contract
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
  - Findings: *(sprint-doc-reviewer findings for this story, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** maintainer, **I want** Pi JSONL message shapes and source pointers documented, **so that** the reference indexes raw Pi sessions without guessing or duplicating transcripts.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] Implement testable Pi JSONL parser functions that extract user/assistant text and source pointers from fixture files without running Pi.
  - [ ] Read `/Users/lou/.nvm/versions/node/v22.18.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/session-format.md` and `/Users/lou/.nvm/versions/node/v22.18.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`; document JSONL fields used in `examples/pi-dev/README.md`: file path, line number, entry ID, parent ID, role, content text, timestamp, session file path.
  - [ ] Document in `examples/pi-dev/README.md` the chosen ingestion contract: primary indexing runs on Pi `agent_end` after each completed turn; reconciliation runs on `session_start`/reload/resume for the active session only; active session path comes from `ctx.sessionManager.getSessionFile()`; v1 does not background-scan all historical sessions.
  - [ ] Define supported pointer metadata/filter keys shared by Stories 2–3: `sourceUri`, `entryId`, `parentId`, `lineNumber`, `timestamp`, and `cwd` when available; `timestampFrom` and `timestampTo` are search filter parameters derived from stored `timestamp`.
  - [ ] Define parser behavior for user/assistant natural-language only; tool results, system/custom hidden messages, images, and thinking blocks are ignored for indexing.
  - [ ] Define source pointer shape that this prototype stores/returns and sprint-023 will formalize: `sourceKind: 'pi-jsonl'`, `sourceUri`, optional `entryId`, `parentId`, `lineNumber`, `timestamp`, `cwd/session directory metadata` when available.
  - [ ] `examples/pi-dev/README.md` design note explains vector-search → search-session-history flow.
- **Functional verification:**
  - [ ] Add parser fixture tests from small JSONL samples. **Pass condition:** user/assistant text and pointers are extracted; ignored roles/blocks are skipped.
  - [ ] Run `for term in 'file path' 'line number' 'entry ID' 'parent ID' 'role' 'content text' 'timestamp' 'session file path' 'agent_end' 'session_start' 'reload' 'resume' 'ctx.sessionManager.getSessionFile()' 'active session only' 'no background scan' 'sourceUri' 'entryId' 'parentId' 'lineNumber' 'cwd' 'vector search' 'search-session-history' 'jsonl-index'; do grep -q "$term" examples/pi-dev/README.md; done`. **Pass condition:** documented fields, chosen ingestion/reconciliation contract, pointer/filter keys, and vector-search → search-session-history workflow are present.
- **Regression verification:**
  - [ ] Run `npm run typecheck` and `npm run lint`. **Pass condition:** both exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `docs(pi): define JSONL source pointer contract`
  2. `test(pi): add JSONL parser fixtures`
- **Technical notes:** Prefer parser functions that are testable without running Pi. Ingestion contract is already chosen for the sprint: implement `agent_end` as the primary trigger and idempotent active-session reconciliation on `session_start`/reload/resume.

#### Story 2: Build Pi JSONL indexing extension
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
  - Findings: *(sprint-doc-reviewer findings for this story, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** Pi user, **I want** new Pi user/assistant messages indexed into Pristine with JSONL pointers, **so that** past sessions become semantically searchable while raw context stays in Pi files.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [ ] `examples/pi-dev/jsonl-index/` contains a self-contained Pi extension that discovers the active session JSONL file via `ctx.sessionManager.getSessionFile()` and indexes completed user/assistant natural-language messages/windows on `agent_end`.
  - [ ] Index records include snippet/indexed text plus source pointers back to Pi JSONL.
  - [ ] Default DB path is `~/.pi/pristine/pristine.db`, with documented explicit config and env override.
  - [ ] Indexing is synchronous/deterministic for first-version verification, reconciles the active session idempotently on `session_start`/reload/resume, and surfaces clear Pi-facing errors on failure.
  - [ ] Re-indexing the same JSONL entry is idempotent or deduplicated by stable source pointer.
- **Functional verification:**
  - [ ] Add mocked extension-event tests. **Pass condition:** `agent_end` indexes completed user/assistant messages with pointers; ignored roles are skipped.
  - [ ] Add active-session reconciliation tests. **Pass condition:** `session_start` startup/reload/resume handlers use `ctx.sessionManager.getSessionFile()`, reconcile only that active session file idempotently, and do not scan the all-sessions directory.
  - [ ] Add DB path resolution tests. **Pass condition:** default path, explicit config, and env override resolve in documented precedence order.
  - [ ] Add deterministic failure-surfacing test. **Pass condition:** mocked indexing/embed failure produces a clear Pi-facing error/notification and is not reported as successful.
  - [ ] Add temporary-DB integration test with stub embedder. **Pass condition:** indexed rows contain vector embeddings, snippets, and Pi source metadata.
  - [ ] Add duplicate-source test. **Pass condition:** reprocessing the same entry does not create duplicate search hits.
- **Regression verification:**
  - [ ] Run `npm run test:integration -- tests/integration/dim-default.test.ts tests/integration/dim-parameterization.test.ts tests/integration/searcher-vector.test.ts` plus `npm run test:unit -- tests/examples/pi-dev/jsonl-index.test.ts`. **Pass condition:** retained dim/vector behavior and Pi indexing adapter tests pass.
  - [ ] Run `npm run typecheck` and `npm run lint`. **Pass condition:** both exit 0.
- **Manual-only verification:** N/A unless Pi active-session discovery cannot be automated; if so, document exact local command and pass/fail evidence.
- **Planned commits:**
  1. `feat(pi): index JSONL messages with source pointers`
  2. `test(pi): verify JSONL indexing extension`
- **Technical notes:** Do not copy raw full sessions into Pristine; store only snippets/windows and source pointers.

#### Story 3: Add Pi vector search tool returning JSONL pointers
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
  - Findings: *(sprint-doc-reviewer findings for this story, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** Pi agent, **I want** `pristine_vector_search` to return semantically relevant snippets and JSONL source pointers, **so that** I can find likely sessions without exact grep terms.
- **Dependencies:** Story 2
- **Acceptance criteria:**
  - [ ] `examples/pi-dev/search-memory/` contains the `pristine_vector_search` tool. Tool schema includes `query` non-empty string, optional filters `sourceUri`, `entryId`, `parentId`, `lineNumber`, `timestampFrom`, `timestampTo`, and `cwd`, plus `limit` default `5`, min `1`, max `20`.
  - [ ] Tool returns snippet, score/rank, chunk ID, and canonical Pi source pointer fields either directly or under `sourcePointer`: `sourceKind: 'pi-jsonl'`, `sourceUri`, optional `entryId`, `parentId`, `lineNumber`, `timestamp`, and `cwd` when available.
  - [ ] Empty query, invalid limit, unavailable DB, and empty index produce clear errors or empty result messages.
- **Functional verification:**
  - [ ] Seed temporary DB with Pi JSONL-derived chunks. **Pass condition:** semantic query returns expected chunk with JSONL pointer fields.
  - [ ] Add supported-filter tests. **Pass condition:** matching `sourceUri`/metadata filters return expected chunks and non-matching filters return empty results.
  - [ ] Add negative-case tests. **Pass condition:** invalid query/limit/unavailable DB paths behave as documented, and an empty index returns an empty result message without opaque sqlite errors.
- **Regression verification:**
  - [ ] Run `npm run test:integration -- tests/integration/searcher-vector.test.ts tests/integration/dim-mismatch.test.ts` plus `npm run test:unit -- tests/examples/pi-dev/search-memory.test.ts`. **Pass condition:** existing vector behavior still passes and Pi vector results include JSONL pointers.
  - [ ] Run `npm run typecheck`, `npm run lint`, and `npm run test:unit -- tests/examples/pi-dev/`. **Pass condition:** all exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `feat(pi): add pointer-aware vector search tool`
  2. `test(pi): verify pointer-aware vector results`
- **Technical notes:** This is the value-proposition tool: semantic search where grep would require guessed keywords.

#### Story 4: Add search-session-history skill for post-search investigation
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
  - Findings: *(sprint-doc-reviewer findings for this story, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** Pi agent, **I want** a `search-session-history` skill, **so that** after vector search identifies a session hit I can inspect nearby raw user/assistant context from Pi’s authoritative JSONL file using existing Pi tools.
- **Dependencies:** Story 3
- **Acceptance criteria:**
  - [ ] `examples/pi-dev/search-session-history/` contains a Pi skill named `search-session-history`.
  - [ ] The skill instructs the agent to use `pristine_vector_search` first when the target session is unknown, then inspect returned `sourceUri`/`lineNumber`/`entryId` using existing `bash`/`read`/grep/jq tools.
  - [ ] The skill includes concrete jq/grep command templates for extracting nearby user/assistant natural-language messages while excluding tool results, hidden custom messages, system/context content, images, and thinking blocks.
  - [ ] The skill defines bounded context guidance: default nearby context is 5 messages before and 10 after; do not dump entire session files unless the user explicitly asks.
  - [ ] Missing file, invalid pointer, or no nearby natural-language messages are handled by reporting a clear limitation and trying an alternate vector hit when available.
- **Functional verification:**
  - [ ] Run `test -f examples/pi-dev/search-session-history/SKILL.md && grep -q "pristine_vector_search" examples/pi-dev/search-session-history/SKILL.md && grep -q "jq" examples/pi-dev/search-session-history/SKILL.md && grep -q "user/assistant" examples/pi-dev/search-session-history/SKILL.md`. **Pass condition:** skill exists and documents vector-first plus jq-based search-session-history.
  - [ ] Add fixture/script tests for the documented jq command templates. **Pass condition:** commands extract exact surrounding user/assistant messages for line-number and entry-ID lookup from known JSONL fixtures and exclude tool/thinking/custom blocks.
  - [ ] Add negative-case checks for the documented workflow. **Pass condition:** missing file, invalid pointer, and ignored-role-only ranges produce clear fallback/limitation guidance in the skill text.
- **Regression verification:**
  - [ ] Run `npm run test:unit -- tests/examples/pi-dev/jsonl-parser.test.ts`. **Pass condition:** parser behavior remains consistent.
  - [ ] Run `npm run typecheck`, `npm run lint`, and `npm run test:unit -- tests/examples/pi-dev/search-session-history.test.ts`. **Pass condition:** all exit 0.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `docs(pi): add search-session-history skill`
  2. `test(pi): verify search-session-history jq templates`
- **Technical notes:** This replaces the prior SQL-search-tool and custom JSONL-inspection-tool concepts for Pi.

#### Story 5: Document the vector-search plus session-history workflow
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
  - Findings: *(sprint-doc-reviewer findings for this story, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** Pi user, **I want** clear docs for vector-search then search-session-history, **so that** I understand why Pristine indexes snippets but does not mirror raw sessions.
- **Dependencies:** Stories 3 and 4
- **Acceptance criteria:**
  - [ ] Each `examples/pi-dev/<tool>/README.md` opens with: "This is one way to use Pristine primitives. You can write your own."
  - [ ] README docs explain Pi JSONL remains source of truth and Pristine stores semantic index records plus source pointers.
  - [ ] README docs document install/config, DB path, reset, `pristine_vector_search`, and `search-session-history` examples.
  - [ ] README docs include deterministic known-phrase verification steps.
  - [ ] `docs/specs/implementation-spec-005.md` flow section is updated or cross-referenced to mention Pi JSONL/source-pointer reference flow before sprint integration.
- **Functional verification:**
  - [ ] Run `rg '^### .*Pi|Pi JSONL|source-pointer|source pointer|examples/pi-dev' docs/specs/implementation-spec-005.md`. **Pass condition:** the implementation spec flow/reference section specifically mentions the Pi JSONL/source-pointer reference flow or cross-references `examples/pi-dev`.
  - [ ] Run README structural loop: `for f in examples/pi-dev/README.md examples/pi-dev/jsonl-index/README.md examples/pi-dev/search-memory/README.md examples/pi-dev/search-session-history/README.md; do head -1 "$f" | grep -q 'This is one way to use Pristine primitives. You can write your own.' && grep -q 'source of truth' "$f" && grep -Eq 'PRISTINE_DB_PATH|~/.pi/pristine/pristine.db' "$f" && grep -q 'reset' "$f" && grep -q 'known phrase' "$f"; done; grep -q 'pristine_vector_search' examples/pi-dev/search-memory/README.md; grep -q 'search-session-history' examples/pi-dev/search-session-history/README.md`. **Pass condition:** command exits 0 and covers every README AC.
- **Regression verification:**
  - [ ] Run `test -f examples/pi-dev/README.md && test -d examples/pi-dev/jsonl-index && test -d examples/pi-dev/search-memory && test -d examples/pi-dev/search-session-history` plus `npm run typecheck` and `npm run lint`. **Pass condition:** aggregate README and tool directories exist and checks exit 0, preserving reference-layout convention.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `docs(pi): document vector search plus search-session-history workflow`
- **Technical notes:** The workflow has one custom search tool (`pristine_vector_search`) plus one skill (`search-session-history`) that teaches JSONL inspection with existing Pi tools.

#### Story 6: Verify repo-local `.pi` installation in `~/projects/test-pristine`
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
  - Findings: *(sprint-doc-reviewer findings for this story, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** Pi test-account user, **I want** the reference installed into `~/projects/test-pristine/.pi`, **so that** we verify the exact repo-local shape a real consumer would use.
- **Dependencies:** Stories 2–5
- **Acceptance criteria:**
  - [ ] Create or reuse `~/projects/test-pristine` as a disposable non-production repo with `.pi/` directory.
  - [ ] Copy/install `examples/pi-dev/` reference artifacts into `~/projects/test-pristine/.pi` using documented commands: `mkdir -p ~/projects/test-pristine/.pi && rsync -a --delete examples/pi-dev/. ~/projects/test-pristine/.pi/`.
  - [ ] Launch/reload Pi from `~/projects/test-pristine` with the documented command, e.g. `cd ~/projects/test-pristine && pi` then `/reload`, and verify the extension plus skill load.
  - [ ] Type known unique messages, verify they are indexed into `~/.pi/pristine/pristine.db`, run vector search, then inspect JSONL context around the hit.
  - [ ] Record install/runtime gotchas back into `examples/pi-dev/README.md`, or explicitly record `Install/runtime gotchas: None` after verification.
- **Functional verification:**
  - [ ] Execute `mkdir -p ~/projects/test-pristine/.pi && rsync -a --delete examples/pi-dev/. ~/projects/test-pristine/.pi/`, then launch/reload Pi from `~/projects/test-pristine`. **Pass condition:** Pi exposes `pristine_vector_search` and loads the `search-session-history` skill from repo-local `.pi`.
  - [ ] Execute known-phrase E2E using the checklist in `examples/pi-dev/README.md`: type the documented phrase, run `pristine_vector_search`, then follow `search-session-history` on the returned pointer. **Pass condition:** vector search returns the known phrase pointer and the skill-guided search-session-history returns surrounding context.
  - [ ] Run `grep -q 'Install/runtime gotchas:' examples/pi-dev/README.md`. **Pass condition:** README records concrete gotchas or `Install/runtime gotchas: None`.
- **Regression verification:**
  - [ ] Verify copied files do not import this repo's `src/` internals. **Pass condition:** `rg '\.\./src|/src/' ~/projects/test-pristine/.pi` exits 1.
  - [ ] Run `npm run typecheck`, `npm run lint`, and `npm run test:unit -- tests/examples/pi-dev/`. **Pass condition:** all exit 0.
- **Manual-only verification:** Required: interactive Pi repo-local extension discovery, `pristine_vector_search` invocation, and `search-session-history` skill usage. Record exact commands and observed pass/fail evidence.
- **Planned commits:**
  1. `test(pi): verify repo-local installation workflow`
  2. `docs(pi): record repo-local install notes`
- **Technical notes:** Do not commit `~/projects/test-pristine` files to this repo unless generalized into `examples/pi-dev/`.

#### Final Story: Sprint Verification & Completion
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Uses the story sections above and the existing regression suite as the verification source of truth
  - [ ] Defines where final verification evidence will be recorded
  - [ ] Includes full regression verification, not only areas believed to be touched
  - [ ] Ready for Lou
- **As a** maintainer, **I want** all sprint functional verification and all available regression verification run, **so that** the Pi reference can be integrated with evidence that new behavior works and existing behavior did not regress.
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
  - [ ] Run the full available regression verification suite and record pass/fail evidence.
- **Manual-only verification:** Includes Story 6 repo-local Pi install, `pristine_vector_search` tool invocation, and `search-session-history` skill evidence.
- **Planned commits:**
  1. `docs(sprint-022): record final verification and completion`
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
