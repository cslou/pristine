# Pristine — Sprint 013
**Date:** 2026-04-24 – TBD
**Goal:** Execute Phase 1 of spec-005 — remove all LOCOMO-aimed memory infrastructure (extractor, consolidator, legacy subsystems, fact-ledger) and partial-delete orchestrator + retriever, preserving only the files reused in later phases
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `~/projects/pristine` (getlou-gh/pristine)
- **Tech stack:** TypeScript strict / ESM / Node 20+ / better-sqlite3 / sqlite-vec / FTS5 / Nomic Embed v1.5 via `@huggingface/transformers` / Vitest
- **Current state:** Main carries the Sprint 009 `ConversationStore`, Sprint 010 embedder engines, the Sprint 011 IngestQueue, the spec-004 privacy subsystem, and the LOCOMO-aimed extraction pipeline (extractor + consolidator + episodes + graph + temporal + query-analyzer + memory-store + orchestrator + retriever — the last two are partial-delete targets). PR #96 just landed spec-005, which pivots memory to a corpus-based architecture. Phase 1 of spec-005 removes the LOCOMO-aimed subsystem entirely.
- **Implementation spec:** `docs/specs/implementation-spec-005.md` — this sprint executes **§16 Phase 1** (stories P1-S1 through P1-S6), consolidated here into four feature stories.

### Sprint-Level Technical Context
- **Pure removal sprint.** No new functionality. No new user flows. Every story is a targeted deletion + ref cleanup.
- **What stays (do not touch):** `src/conversations/`, `src/embedder/`, `src/queue/`, `src/privacy/`, `src/engine/`, `src/core/database.ts`, `src/core/errors.ts`, the Sprint-009 FTS5 schema + triggers.
- **What must be preserved inside partial-delete targets:**
  - `src/memory/orchestrator/chunker.ts` — reused in sprint-015 (Phase 3 indexer) for oversize-message handling
  - `src/memory/retriever/ranking.ts` — reused in sprint-016 (Phase 4 searcher) for RRF fusion
- **No new dependencies** added in this sprint. `.checks/pre-commit.sh` / `.checks/pre-push.sh` must still pass after every story merge.
- **Existing LLM clients** (`src/engine/` — llamacpp, ollama) stay in the repo. They're consumed only by future reference implementations (deferred, see spec-005 §5.2 + §17). Not wired into `PristineLocal.create()` once this sprint completes.
- **Test suite expectation:** 738 tests before Sprint 013 → ~400–500 tests after (exact number TBD once we see which tests are coupled to removed modules). Zero regressions in surviving modules.

### User Flows

**None — sprint-013 is a pure code-removal sprint.** No new user-facing flows are introduced. The LOCOMO-aimed extraction flows being removed are already out of the target architecture per spec-005 §15. Surviving flows (conversation ingest into `ConversationStore`, privacy redact/reveal) are validated by regression tests, not re-demonstrated.

- **Affected (existing):** None in spec-005 §15. The removal affects the *pre-pivot* flows documented in spec-001 and spec-003 (fact-extraction pipeline), which are superseded by spec-005.
- **New (this sprint):** None.

### Stories
**Constraints:** Target 5–8 stories per sprint; 5–8 commits per story.

#### Story 1: Remove extractor + consolidator pipeline
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (5–8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** Pristine maintainer, **I want** the LLM-based fact-extraction and consolidation modules removed from the SDK, **so that** the corpus-based pivot (spec-005) has a clean slate with no competing code path and the default pipeline stops running the LOCOMO-aimed prompt.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] `src/memory/extractor/` directory deleted
  - [ ] `src/memory/consolidator/` directory deleted
  - [ ] `tests/memory/extractor/` directory deleted
  - [ ] `tests/memory/consolidator/` directory deleted
  - [ ] Root-level `tests/extractor/` and `tests/consolidator/` directories also deleted if present
  - [ ] `src/client.ts` no longer imports or wires `Extractor` or `Consolidator` — `PristineLocal.create()` skips the extractor/consolidator construction branch
  - [ ] `Extractor` and `Consolidator` interfaces removed from `src/core/interfaces.ts`
  - [ ] Fact/ConsolidationResult/ConsolidationRequest/ConsolidationBatchResult/ExtractionResult/ExtractorConfig types removed from `src/core/types.ts` (verify via grep: no stale references)
  - [ ] `buildExtractionPrompt` and all extractor/consolidator exports removed from `src/index.ts`
  - [ ] `npm run typecheck` passes
  - [ ] `npm run test:unit` passes (count may drop; no unexpected failures in surviving modules)
- **Testing approach:** Rely on the existing test suite. Post-removal, the unit tests that exercise extractor/consolidator will be gone with their source; the remaining tests (conversations, embedder, queue, privacy, core) must all pass with zero changes.
- **QA:** N/A — backend-only removal.
- **Planned commits:**
  1. `chore: delete src/memory/extractor and its tests` — whole-module removal (both `src/memory/extractor/` and `tests/{memory/extractor,extractor}/` sweep)
  2. `chore: delete src/memory/consolidator and its tests` — whole-module removal (both `src/memory/consolidator/` and `tests/{memory/consolidator,consolidator}/` sweep)
  3. `refactor: drop extractor + consolidator wiring from PristineLocal.create()` — `src/client.ts` no longer constructs or injects these modules; keeps typecheck green on sprint-013 after this story merges
  4. `refactor: remove Extractor and Consolidator interfaces from src/core/interfaces.ts`
  5. `refactor: remove fact-pipeline types from src/core/types.ts` (Fact, ExtractionResult, ConsolidationResult, ConsolidationRequest, ConsolidationBatchResult, ExtractorConfig, etc.)
  6. `refactor: remove extractor/consolidator exports from src/index.ts`
- **Technical notes:**
  - `ExtractorConfig` was exported from the public API in PR #94; callers (if any) need migration — grep `benchmarks/`, `examples/`, `scripts/`, and `tests/` for `ExtractorConfig` imports and document any external callers in the sprint retro. The spec-005 pivot deprecates this entry point entirely.
  - `buildExtractionPrompt` was exported from `pristine`; remove along with the implementation.
  - Keep `src/engine/` (LLM clients) intact — they remain available to future reference implementations.
  - Record the post-removal unit-test count in the sprint-013 evaluation deck (Slide 4).
- **Priority:** Must-have

#### Story 2: Remove legacy memory subsystems (episodes, graph, temporal, query-analyzer)
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (5–8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** Pristine maintainer, **I want** the four legacy memory subsystems (spec-001 episodic memory, entity/relationship graph, fact temporality, query analyzer) removed from the SDK, **so that** the codebase no longer carries inherited complexity from the pre-pivot architecture.
- **Dependencies:** Story 1 (must merge first so interfaces/types don't re-reference removed modules)
- **Acceptance criteria:**
  - [ ] `src/memory/episodes/` directory deleted
  - [ ] `src/memory/graph/` directory deleted
  - [ ] `src/memory/temporal/` directory deleted
  - [ ] `src/memory/query-analyzer/` directory deleted
  - [ ] Corresponding `tests/memory/{episodes,graph,temporal,query-analyzer}/` directories deleted
  - [ ] Root-level `tests/{episodes,graph,temporal,query-analyzer}/` directories also deleted if present
  - [ ] `src/client.ts` has no remaining imports or wiring of legacy memory types (verify via grep — if client doesn't reference these directly, AC is satisfied without a separate commit)
  - [ ] `Episode`, `EpisodeInput`, `Entity`, `EntityInput`, `Relationship`, `RelationshipInput`, `RankedEpisode`, `RankedRelationship`, `TraversalResult`, `AnalyzedQuery`, `QueryContext` (and any other legacy types) removed from `src/core/types.ts`
  - [ ] Related interfaces (e.g. episode store, graph store, query analyzer) removed from `src/core/interfaces.ts`
  - [ ] `npm run typecheck` passes
  - [ ] `npm run test:unit` passes
- **Testing approach:** Whole-module tests are removed alongside the source. Grep confirms no surviving reference. Typecheck catches any stale consumer.
- **QA:** N/A — backend-only removal.
- **Planned commits:**
  1. `chore: delete src/memory/episodes and its tests`
  2. `chore: delete src/memory/graph and its tests`
  3. `chore: delete src/memory/temporal and its tests`
  4. `chore: delete src/memory/query-analyzer and its tests`
  5. `refactor: remove legacy memory types and interfaces from src/core` — sweep types.ts + interfaces.ts for Episode/Entity/Relationship/TraversalResult/AnalyzedQuery/QueryContext and related
- **Technical notes:**
  - Check `benchmarks/memorybench/` for references to removed types — the benchmark harness may use Episode/Fact types for its golden-set manipulation. Update or skip affected tests within this story.
  - `tests/episodes/` and `tests/graph/` at the repo root (not under `tests/memory/`) — delete these too if present (check via `find tests -type d -name '{episodes,graph,temporal,query-analyzer}'`).
- **Priority:** Must-have

#### Story 3: Remove fact-ledger store + partial-delete orchestrator + retriever
- **Story Checklist:**
  - [ ] Follows sprint template
  - [ ] Within size limits (5–8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** Pristine maintainer, **I want** the fact-ledger storage module deleted and the orchestrator/retriever dirs trimmed down to just the files reused in later phases, **so that** only corpus-relevant infrastructure remains in `src/memory/`.
- **Dependencies:** Story 2 (legacy types must be gone so memory-store doesn't reference them)
- **Acceptance criteria:**
  - [ ] `src/memory/store/` directory deleted (the fact-ledger store — distinct from `src/conversations/store.ts`)
  - [ ] `tests/memory/store/` directory deleted
  - [ ] Root-level `tests/store/`, `tests/orchestrator/`, `tests/retriever/` directories audited — tests targeting removed source deleted; tests covering preserved `chunker.ts` / `ranking.ts` retained (and relocated under `tests/memory/` if necessary for consistency)
  - [ ] `src/client.ts` no longer imports or wires the memory-`Store` — `PristineLocal.create()` skips the memory-store construction branch
  - [ ] `Store` (memory-facts) interface removed from `src/core/interfaces.ts` (spec-005 §5.3)
  - [ ] `src/memory/orchestrator/` contains **only** `chunker.ts` (+ tests) — `pipeline.ts`, `retrieve.ts`, `ingest.ts`, `turn-order.ts` and their tests deleted
  - [ ] `src/memory/retriever/` contains **only** `ranking.ts` (+ tests) — `index.ts` (fact-retrieval path) and its tests deleted
  - [ ] `chunker.ts` and `ranking.ts` compile in isolation — verified by: `grep -E "from '\\./(pipeline|retrieve|ingest|turn-order)'" src/memory/orchestrator/chunker.ts` returns empty AND `grep -E "from '\\./index'" src/memory/retriever/ranking.ts` returns empty AND `npx tsc --noEmit src/memory/orchestrator/chunker.ts src/memory/retriever/ranking.ts` exits 0
  - [ ] `npm run typecheck` passes
  - [ ] `npm run test:unit` passes — chunker and ranking tests still green
- **Testing approach:** Run chunker + ranking tests in isolation to confirm they stand on their own after sibling-module removal. Grep confirms no surviving reference to the deleted orchestrator/retriever files.
- **QA:** N/A — backend-only removal.
- **Planned commits:**
  1. `chore: delete src/memory/store and tests (fact-ledger)` — whole-module removal (sweep root-level `tests/store/` too)
  2. `refactor: drop memory-Store wiring from PristineLocal.create()` — keeps typecheck green on sprint-013 after this story merges
  3. `refactor: remove memory-Store interface from src/core/interfaces.ts`
  4. `chore: partial-delete src/memory/orchestrator — remove pipeline, retrieve, ingest, turn-order and associated tests; preserve chunker`
  5. `chore: partial-delete src/memory/retriever — remove fact-retrieval index and associated tests; preserve ranking`
  6. `refactor: update types.ts for orphaned references in preserved files` (if chunker/ranking pulled types that now need inlining or migrating — if the audit shows no orphans, replace with a chore commit adding a `src/memory/README.md` documenting why chunker/ranking remain as solo survivors, for Phase 3/4 reuse)
- **Technical notes:**
  - The memory-`Store` interface is distinct from `ConversationStore` in `src/conversations/` — ConversationStore stays untouched.
  - Check that `chunker.ts` doesn't import anything from `pipeline.ts` / `ingest.ts` before deletion; if it does, inline the dependency or move it during this story.
  - `ranking.ts` may export RRF utilities that `retriever/index.ts` composed — preserve the exports, remove only the composing code.
- **Priority:** Must-have

#### Story 4: Update `src/client.ts` and finalize public-API cleanup
- **Story Checklist:**
  - [ ] Follows sprint template
  - [ ] Within size limits (5–8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** SDK consumer, **I want** `PristineLocal.create()` and `createLite()` to succeed after all Phase 1 removals — without requiring any LLM client or extractor/consolidator dependency, **so that** Pristine can be imported and bootstrapped with only the corpus + privacy + queue subsystems.
- **Dependencies:** Stories 1, 2, 3 (each story already de-wires its own removed modules from `src/client.ts`; this story finalizes the public API surface and adds verification)
- **Acceptance criteria:**
  - [ ] `src/client.ts` verified — `PristineLocal.create()` wires only conversations, embedder, queue, privacy; no stale references to removed modules remain (grep cleanup pass)
  - [ ] `createLite()` still works — produces a client with conversation-store + queue access, no LLM dependency
  - [ ] `src/index.ts` — public API exports only the surviving surface; no references to removed modules
  - [ ] A minimal integration smoke test demonstrates `PristineLocal.create()` succeeding with neither `llamacpp` nor `ollama` configured (whatever test exists today that forces LLM config must be updated or removed)
  - [ ] `benchmarks/memorybench/src/providers/pristine/` provider code updated (or explicitly flagged as breaking, to be rebuilt in a later sprint)
  - [ ] `npm run typecheck` passes
  - [ ] `npm run test:unit` passes
  - [ ] `npm run build` produces a clean `dist/` with the reduced surface
- **Testing approach:** Unit test for `PristineLocal.create()` with a config that does NOT specify an LLM client — must succeed. If a test exists today that ASSUMES LLM config is required, update or delete it.
- **QA:**
  - Manual: `cd /tmp && mkdir smoke && cd smoke && npm init -y && npm install /Users/lou/projects/pristine && node -e "import('@pristine/shield-local').then(m => { const c = m.PristineLocal.createLite({ dbPath: './test.db', userId: 'u1' }); console.log(Object.keys(c)); })"` — confirm it imports and instantiates. (Package name `@pristine/shield-local` is per `package.json`.)
  - Automated: N/A.
- **Planned commits:**
  1. `refactor: final grep sweep on src/client.ts — remove any remaining stale imports`
  2. `refactor: finalize src/index.ts — remove all references to deleted modules`
  3. `test: add LLM-free PristineLocal.create() smoke test; remove/update tests that required LLM config`
  4. `refactor: update benchmarks/memorybench/src/providers/pristine/ for post-Phase-1 API shape` (or mark benchmark as broken pending later sprint, with a clear TODO)
  5. `docs: note Phase 1 completion in README — SDK surface is now corpus + privacy + queue only`
- **Technical notes:**
  - Stories 1 and 3 each contributed their own `src/client.ts` de-wiring commits. Story 4's role is the final grep sweep + public-API surface cleanup + LLM-free smoke test + benchmark-provider migration + README note.
  - The `LlmClient` type and `LlmClients` collection type stay exported from `src/index.ts` — consumers building reference implementations that need an LLM still depend on them. The core SDK doesn't *call* them after Phase 1.
- **Priority:** Must-have

#### Final Evaluation Story (mandatory, runs last)

Produce visual proof that Phase 1 removal completed cleanly: nothing extraneous remains, nothing essential was taken, surviving modules still work. Assemble the artifacts into an HTML slide deck at `docs/sprints/eval/sprint-013.html`.

Because this is a pure-removal sprint with no new user flows, the evaluation focuses on **regression evidence + surface-map clarity**: the SDK's public API shape before vs. after, test-count deltas, LOC deltas, and a demonstration that surviving subsystems (conversations, privacy, queue, embedder) are fully functional in isolation.

- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, planned commits)
  - [ ] Within size limits (5–8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok
  - [ ] Each AC verified against git diff and the rendered HTML deck before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** stakeholder, **I want** embeddable visual proof that Phase 1 of spec-005 completed cleanly, **so that** Sprint 013 completion is verifiable at a glance without re-running the code.
- **Dependencies:** Stories 1, 2, 3, 4 must be merged into `sprint-013` before this story starts.
- **Acceptance criteria:**
  - [ ] Slide deck at `docs/sprints/eval/sprint-013.html` follows the 5-slide structure below. Total slide count ≤ 5.
  - [ ] Slide 1 — **Sprint Summary**: goal, four feature stories shipped, overall pass/fail count
  - [ ] Slide 2 — **Surviving Subsystems Demonstrated**: one visual (screenshot of test output or short video) per surviving module showing tests green — conversations, privacy, queue, embedder. "User Flows" proper are N/A for this sprint; this slide substitutes regression evidence on the modules that *stayed*.
  - [ ] Slide 3 — **Key Changes**: before/after SDK surface map (exported types/functions from `src/index.ts`), `src/memory/` directory tree before/after, LOC delta table
  - [ ] Slide 4 — **Test & Eval Results**: test-file count before/after, passing-test-count before/after, `npm run typecheck` + `npm run test:unit` + `npm run build` output screenshots
  - [ ] Slide 5 — **Repo Hygiene + AC Matrix**: main clean, no tmp files, no dangling branches, all story ACs with pass/fail status
  - [ ] Tool chosen per `~/projects/harness-config/templates/evaluation-matrix.md` component-type mapping
  - [ ] Bulky assets in `docs/sprints/eval/sprint-013/`
  - [ ] Images / videos ≤ 120s each; binaries ≤ 10MB
- **Testing approach:** The artifacts themselves are the tests. Open the rendered HTML deck in a browser and walk through every slide before marking this story complete.
- **QA:**
  - Manual: Open `docs/sprints/eval/sprint-013.html` in a browser. Confirm every slide loads, every embedded visual displays, every AC shows pass/fail status.
  - Automated: N/A — visual proof is the artifact.
- **Planned commits:**
  1. `feat: capture sprint-013 evaluation artifacts` — screenshots, test output, surface-map diffs into `docs/sprints/eval/sprint-013/`
  2. `feat: build sprint-013 evaluation slide deck` — single HTML file referencing the artifacts
- **Technical notes:**
  - Surface-map diff can be captured via `git show main:src/index.ts` (pre-sprint HEAD of main) vs `cat src/index.ts` (current sprint-013 HEAD). Render as side-by-side diff image or use a static HTML diff viewer.
  - LOC delta: `git diff --stat main...sprint-013 -- 'src/**/*.ts' 'tests/**/*.ts'` — render as a table.
  - The matrix at `~/projects/harness-config/templates/evaluation-matrix.md` is the reference for tool choice per component type.
- **Priority:** Must-have

### Rules
- **Sprint-branch setup (done):** `sprint-013` created off `main`; this sprint doc is the first commit. Story branches fork from `sprint-013` (e.g. `feat/remove-extractor-consolidator`); story PRs target `sprint-013`, not `main`. After the evaluation story merges, open a sprint-integration PR (`sprint-013 → main`) as the final step.
- We sequentially do the stories. We do not do parallel work.
- **Review loop:** Open PRs, run `/review` (nudged by the PostToolUse hook), address findings, re-verify via `/review-fix` (capped at 3 passes per PR — see `workflow-prompts/handle-pr-activity.md`), confirm local checks are green and the last review turn returned mergeability ≥ 4/5 with no open P0/P1 findings, merge into `sprint-013`, then move to the next story. The sprint-integration PR goes through the same loop.
- Record new dependencies in the Completion section's New Dependencies field.
- For everything else — commits, PR process, code quality, testing — follow system instructions (the conventions loaded at session start).

### Definition of Done
- All four feature-story ACs pass, evaluation-story AC passes
- System-instruction conventions satisfied (code quality, tests, PR process, conventional commits, local checks green, last review turn mergeability ≥ 4/5 with no open P0/P1 findings)
- **Final Evaluation Story complete** — `docs/sprints/eval/sprint-013.html` exists; surviving subsystems have regression evidence; repo hygiene slide shows clean state
- **Sprint-integration PR merged** (`sprint-013 → main`); `sprint-013` deleted from origin; local `main` fast-forwarded
- **No new user flows introduced** — spec-005 §15 unchanged by this sprint (removal only)

### Completion
- **Stories shipped:** *(filled at sprint close)*
- **Commits:** *(filled at sprint close)*
- **New dependencies:** None expected — sprint is pure removal
- **Retro:** *(optional — flag anything unexpected)*
