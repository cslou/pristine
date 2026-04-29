# Pristine — Sprint 017
**Date:** 2026-04-28 – TBD
**Goal:** Spike on switching the local embedder to a higher-dimension / higher-quality model — research the current landscape, build the measurement infrastructure, run a head-to-head, decide go/no-go.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript (strict, ESM), Node 18+, `better-sqlite3` + `sqlite-vec`, `@huggingface/transformers` (Nomic Embed v1.5, 768-d), Vitest. Local-first — zero outbound network calls in production code.
- **Current state:** spec-005 Phase 4 shipped in sprint-016. `Pristine.create({...}).storeAsync(...)` populates the corpus end-to-end; `pristine.searcher` exposes `vectorSearch`, `ftsSearch`, `hybridSearch`, and `sessionVectorSearch` with filter-first scoping + RRF fusion. Cross-cutting integration suite locks the contract. The Story 7 ad-hoc retrieval demo (`scripts/demo-search.ts`, real Nomic v1.5 against a 6-conversation × 2-project synthetic corpus) surfaced a real quality limitation: top-5 result lists consistently include 2-3 unrelated junk results, and the per-method score gap between "right answer" (~0.55) and noise (~0.49) is too narrow to use for thresholding. Root cause is the embedder's narrow score distribution — Nomic v1.5's 768-d compresses subtly-related concepts and unrelated concepts into near-adjacent regions of the embedding space.
- **Implementation spec:** `docs/specs/implementation-spec-005.md` (§5.3 Embedding — currently pins Nomic v1.5; this sprint may revise that pin)

### Sprint-Level Technical Context

- **This sprint is a SPIKE, not a feature ship.** The goal is to gather data and make a decision, not to harden a new feature. Story 5's "ship the swap" is conditional on Story 4's measurement showing a clear winner. If no candidate beats Nomic v1.5 on the score-gap metric, Story 5 ships nothing — just a documented decision with the criteria for revisiting.
- **Storage schema must become dim-parameterized.** `vec_windows` and `vec_sessions` currently hardcode `embedding float[768]` in DDL (`src/conversations/store.ts:154,196`); `LocalEmbedder` hardcodes `EXPECTED_DIMENSION = 768` (`src/embedder/local/index.ts:6`); `searcher.vectorSearch` validates `VEC_DIM = 768` (`src/memory/searcher/index.ts`). `vec0` does NOT support `ALTER` on the typed column — switching dim requires `DROP + CREATE` of the virtual tables plus a corpus rebuild. Story 3 builds the parameterization + a one-shot migration helper.
- **Local-first contract is non-negotiable.** Any candidate must run via `@huggingface/transformers` (or equivalent in-process inference) — no remote inference services. Models must be downloadable on first use; no auth-gated weights. License must permit local commercial use (Apache 2.0 / MIT preferred; Llama-style "research-only" excluded).
- **Model size budget.** Cap candidate model file size at ≤2GB on-disk. Nomic v1.5 is ~140MB; Stella v5 1.5B ~3GB (excluded by this rule); bge-large-en-v1.5 ~1.3GB; mxbai-embed-large ~670MB. Story 1's research output respects this.
- **No new top-level dependencies in production code paths.** Candidate evaluation (Story 4) may install candidate models into `node_modules` via `@huggingface/transformers`; the production `LocalEmbedder` keeps the same single dep.
- **The score-gap metric is the load-bearing measurement.** Recall@K and MRR require labeled relevance judgments; for a 1-week spike we use a leaner proxy: for each labeled query, measure (a) top-1 score against (b) score of the highest-ranked irrelevant hit in top-5. A wider gap = better noise rejection. Story 2 builds this; Story 4 runs it.
- **Sprint-016 retro carry-over.** Sprint-016 close logged "FTS5 unicode61 → porter migration" and "storeAsync auto-invoke buildSessionVector" as deferred items. Both are OUT OF SCOPE for sprint-017 — embedder spike only.

### User Flows

- **Affected (existing):** `storeAsync(...)` and `searcher.{vector,session}VectorSearch` and `searcher.hybridSearch` all run through `LocalEmbedder` and write/read to fixed-dim `vec_windows` / `vec_sessions`. If Story 5 ships a swap, every flow that touches those primitives gets the new model + dim under the hood. Filter behavior, API shape, and SDK contract all stay identical — only the embedding numbers change.
- **New (this sprint):** None. Sprint is research + measurement + conditional swap; no new SDK-public surface.

### Stories
**Constraints:** Target a maximum of 5-8 stories per sprint. Target a maximum of 5-8 commits per story. If a story needs more than 8 commits during planning, try to split it unless it makes sense for them to not be split.

#### Story 1: Embedder landscape research (post-2025 model survey)

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (5-8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** maintainer evaluating an embedder swap, **I want** a current survey of post-2025 open-weights embedding models that meet our local-first + ≤2GB constraints, **so that** Story 4's spike has a defensible candidate shortlist instead of a vibe-driven pick.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] New file `docs/research/embedder-landscape-2026.md` documenting at minimum 5 candidate models published after 2025-01-01. Each entry includes: model name + Hugging Face path, parameter count, embedding dimension, max context window, model file size on disk (rounded to MB), `@huggingface/transformers` compatibility status (verified on a representative model — load via `pipeline('feature-extraction', ...)` and confirm `output.data` is a Float32Array), license, MTEB / leaderboard score (if reported by the publisher; cite source URL), and a one-paragraph "why we'd consider this" rationale.
  - [ ] Doc explicitly addresses Nomic v2 if it exists (per user direction "many were recently released"). If Nomic v2 is published, include it as a candidate; if not, document the search and the most-recent Nomic-family release.
  - [ ] Doc shortlists 3 finalist candidates that Story 4 will benchmark, with selection rationale per finalist (e.g., "highest MTEB score in the ≤1GB tier", "best context-window for long conversations", "smallest while still > 1024d").
  - [ ] Doc lists explicit DEAL-BREAKERS for each candidate considered (license, runs-locally, weight-gated, model-size > 2GB) so the shortlist's exclusions are auditable.
  - [ ] Confirms each finalist's tokenizer compatibility with `@huggingface/transformers` — some sentence-transformers models require tokenizer-config gymnastics; document if so.
- **Testing approach:** Manual research artifact, not code. Reviewer reads the doc and verifies each candidate's claims map to a public Hugging Face model card or paper. No code tests.
- **QA:**
  - Manual: read `docs/research/embedder-landscape-2026.md` end-to-end. Click through each model's HF link. Verify the shortlist rationale.
  - Automated: N/A — research output. **THIS IS IMPORTANT** the doc IS the artifact; downstream stories cite it.
- **Planned commits:**
  1. `docs(research): scaffold embedder-landscape-2026 with Nomic v1.5 baseline + criteria`
  2. `docs(research): survey candidate models (≥5 entries, ≤2GB tier)`
  3. `docs(research): shortlist 3 finalists for Story 4 spike`
- **Technical notes:** The `@huggingface/transformers` README maintains a list of supported architectures. Cross-reference with MTEB English leaderboard (https://huggingface.co/spaces/mteb/leaderboard) for objective scoring. For models that exceed our constraints (e.g., gte-Qwen2-7B at >7GB), call them out as "considered, excluded by size" — don't silently omit them; the exclusion record is part of the audit trail. **Do NOT install any models in this story** — that's Story 4's job. Story 1 produces ONLY the doc.
- **Priority:** Must-have

#### Story 2: Measurement harness — labeled query set + score-gap metric

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Within size limits (5-8 commits)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** spike runner, **I want** a small labeled query set + a measurement harness that takes any `Embedder` and returns score-gap metrics, **so that** Story 4's candidates are compared on the same yardstick instead of eyeballing demo output.
- **Dependencies:** None (corpus reuses Story 7's `scripts/demo-search.ts` content; expand if needed)
- **Acceptance criteria:**
  - [ ] New file `tests/eval/embedder-spike-corpus.json` containing 8-12 conversations across 3 projects (extends the demo-search corpus). Hand-labeled `expected_top1_conversation` per query in `tests/eval/embedder-spike-queries.json` — 15-20 queries spanning literal-token recall, paraphrased semantic recall, cross-conversation thematic recall, and out-of-domain.
  - [ ] New script `scripts/embedder-spike.ts` that takes an `Embedder` factory, runs the corpus + queries, and prints a results table per primitive (`vectorSearch`, `ftsSearch`, `hybridSearch`) including: recall@5 (top-1 conversation matches expected), score-gap (top-1 score minus highest-ranked-irrelevant-in-top-5), out-of-domain ceiling (max score for queries where expected = `none`).
  - [ ] Harness verified against current Nomic v1.5 baseline — produces a results table; the baseline numbers go into the docs/research doc as the bar to beat.
  - [ ] No production-code changes in this story — harness is purely under `scripts/` and `tests/eval/`.
  - [ ] Score-gap metric documented in a JSDoc on the harness — what it measures, why it's a useful proxy, what its limitations are vs full Phase 7 recall@K with labeled relevance judgments.
- **Testing approach:** The harness IS the test infrastructure. Verify it runs end-to-end against the current Nomic embedder and produces a coherent results table.
- **QA:**
  - Manual: `npx tsx scripts/embedder-spike.ts` against the default `LocalEmbedder` — confirm the results table prints, score-gap numbers are non-zero, recall@5 is reasonable for the labeled corpus.
  - Automated: N/A — script + JSON, no test suite. **THIS IS IMPORTANT** but the harness IS Story 4's load-bearing measurement.
- **Planned commits:**
  1. `feat(eval): hand-label embedder-spike corpus + query set`
  2. `feat(scripts): embedder-spike harness — score-gap + recall@5 per primitive`
  3. `feat(scripts): baseline Nomic v1.5 results table captured in research doc`
- **Technical notes:** Hand-labeling 15-20 queries is the load-bearing manual step. For each query, the labeler picks ONE expected top-1 conversation (the one most relevant to the query) and optionally a list of "also-acceptable" conversations. Out-of-domain queries have `expected_top1_conversation: null`. Don't try to label individual messages or windows — conversation-level labeling is sufficient for the spike's purposes and avoids the per-window labeling quagmire. The harness's score-gap is a PROXY, not a benchmark — Phase 7 will replace it with proper recall@K against a labeled dataset (LOCOMO-style); this sprint just needs enough signal to differentiate candidates.
- **Priority:** Must-have

#### Story 3: Embedder profile abstraction + dim-parameterized schema

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** Story 4 spike runner, **I want** the embedder dimension to be a runtime parameter rather than a hardcoded `768` baked into DDL + validation, **so that** swapping to a 1024-d or 1536-d candidate doesn't require a manual schema rewrite per spike attempt.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] New `EmbedderProfile` interface in `src/core/interfaces.ts` with at minimum `dim: number`, `modelName: string`, `maxContextTokens: number`. Profile is exposed on the `Embedder` interface as a `readonly profile: EmbedderProfile` field; consumers read `embedder.profile.dim` to know what dim the embedder produces.
  - [ ] `LocalEmbedder` exposes a static profile for Nomic v1.5 (`{dim: 768, modelName: 'nomic-ai/nomic-embed-text-v1.5', maxContextTokens: 8192}`). Constructor accepts an optional override `LocalEmbedderConfig.profile?: EmbedderProfile`; if absent, defaults to Nomic v1.5.
  - [ ] `vec_windows` and `vec_sessions` DDL becomes a function of the embedder profile — `ConversationStore` constructor accepts an `EmbedderProfile` argument and injects `embedding float[${profile.dim}]` into the CREATE VIRTUAL TABLE statement. **Profile dim is treated as trusted internal config — the storage layer asserts it's a positive integer ≤ 4096 (vec0's reasonable upper bound) but does NOT defend against caller-controlled SQL injection (the dim isn't user-facing input).** Document the trust boundary in a JSDoc on the profile-accepting overload.
  - [ ] `searcher.vectorSearch` and `searcher.sessionVectorSearch` validate the query embedding against `embedder.profile.dim` instead of the hardcoded `VEC_DIM = 768`.
  - [ ] One-shot migration helper `migrateEmbedderDim(db, oldProfile, newProfile)` in a new `src/conversations/migrations.ts` (or appropriate location): drops + recreates `vec_windows` + `vec_sessions` virtual tables with the new dim, deletes existing rows, and resets `pending_ingest_tasks` to re-trigger embed work. Documented as DESTRUCTIVE — the existing corpus's vectors are gone after this; a re-embed pass via `runEmbedWorker` is required. Returns row counts pre/post for caller verification.
  - [ ] All existing tests pass with `EmbedderProfile.dim = 768` (no behavior change for the default path).
  - [ ] At least 2 new tests exercising `dim ≠ 768` — one with a stub `EmbedderProfile { dim: 1024 }` to confirm the schema parameterization works; one with the migration helper round-trip (768 → 1024 → re-ingest → searcher returns hits at the new dim).
- **Testing approach:** Unit tests for the profile factory + migration helper. Integration test exercising the round-trip — ingest at 768, migrate to 1024, re-ingest, vectorSearch returns hits at 1024.
- **QA:**
  - Manual: `npx tsx scripts/smoke-indexer.ts` still passes with the default profile (no behavior regression).
  - Automated: new tests above. **THIS IS IMPORTANT** — Story 4's spike script can't run without this parameterization.
- **Planned commits:**
  1. `feat(core): EmbedderProfile interface + Embedder.profile field`
  2. `feat(embedder/local): expose Nomic v1.5 profile + accept profile override`
  3. `refactor(store): vec_windows + vec_sessions DDL parameterized by EmbedderProfile.dim`
  4. `refactor(searcher): validate query embedding against runtime profile.dim, not constant`
  5. `feat(store): migrateEmbedderDim helper — drop+recreate vec0 tables, reset pending tasks`
  6. `test(integration): dim-swap round-trip — 768 → 1024 → re-ingest → search`
- **Technical notes:** The `dim` validation upper bound (4096) covers all candidates we care about — Stella v5 maxes at 8192d but is excluded by the size budget. `vec0` itself accepts arbitrary dims; the constraint is what the candidates need. The migration helper is intentionally destructive because preserving 768d vectors when migrating to 1024d is meaningless (the vectors aren't comparable). Re-embed cost on a real corpus is ~0.1s × N messages; for the spike corpus (~50 messages) it's negligible.
- **Priority:** Must-have

#### Story 4: Run the spike — install + benchmark 3 candidates

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** maintainer making the embedder-swap decision, **I want** the 3 finalist candidates from Story 1 evaluated against the Story 2 harness with concrete numbers, **so that** Story 5's go/no-go has data to act on.
- **Dependencies:** Stories 1 + 2 + 3
- **Acceptance criteria:**
  - [ ] Each of Story 1's 3 finalist candidates loaded successfully via `@huggingface/transformers` (modulo any tokenizer config Story 1 flagged). Loading failure for any finalist is itself a result and gets documented.
  - [ ] Each candidate run through `scripts/embedder-spike.ts` (Story 2's harness) at its native dim. Results captured in `docs/research/embedder-landscape-2026.md` as a comparative table: model name | dim | recall@5 | score-gap-mean | out-of-domain-ceiling | embed latency (ms/call) | first-load latency (s) | model file size MB | rank-1 winner count (queries where this candidate had the unambiguous best top-1).
  - [ ] Each candidate's spike-run preserved as a separate artifact under `docs/research/embedder-spike-runs/` — JSON dump from the harness so the data can be re-analyzed later.
  - [ ] **A "no clear winner" outcome is acceptable.** If Nomic v1.5 wins or ties on score-gap-mean, the story documents that and Story 5's decision is "no-swap, defer until next eval cycle" — not a failure mode.
  - [ ] Latency observation included for each candidate — embedder swap with a 5x slower model materially changes the storeAsync wall-time on agent-integration; if a candidate is dramatically slower, that's a swap-blocker even if recall is better.
  - [ ] Tests: existing 537-unit + 666-integration suite still passes (the spike runs DON'T modify production defaults — only Story 5 does that).
- **Testing approach:** Spike script runs are the artifact. No new test code beyond what Story 2 added.
- **QA:**
  - Manual: run `npx tsx scripts/embedder-spike.ts --embedder=<each finalist>` (script gains a `--embedder` flag in Story 2 or here). Capture output. Read the comparative table.
  - Automated: existing suite stays green. **THIS IS IMPORTANT** — production-default unchanged in Story 4.
- **Planned commits:**
  1. `feat(scripts): embedder-spike --embedder flag for runtime model selection`
  2. `chore(research): finalist 1 spike-run results`
  3. `chore(research): finalist 2 spike-run results`
  4. `chore(research): finalist 3 spike-run results`
  5. `docs(research): comparative table + decision-grade observations`
- **Technical notes:** First-call latency for some candidates can be 30-60s on a fresh machine while @huggingface/transformers downloads weights — budget for this. Run on a warm cache for repeat runs to isolate per-call latency. If a candidate's recall@5 is dramatically worse than Nomic v1.5 on the labeled corpus, document quickly and move on rather than tuning. **DO NOT modify production defaults in this story** — that's Story 5.
- **Priority:** Must-have

#### Story 5: Ship the swap (or document no-swap decision)

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** SDK consumer, **I want** the default embedder updated to the spike's winner — or, if no winner emerged, an explicit "still Nomic v1.5" decision with criteria for revisiting — **so that** retrieval quality improves where the data justifies it without the SDK silently switching models.
- **Dependencies:** Story 4
- **Acceptance criteria:**
  - [ ] **Conditional AC depending on Story 4 outcome:**
    - **If a clear winner emerged** (≥10% improvement in score-gap-mean AND no >2x latency regression): default `EmbedderProfile` switched to the winner. Spec-005 §5.3 updated with the new model + dim. Migration guidance for existing corpora (`migrateEmbedderDim` + re-ingest) documented in spec-005 §15 Flow 1's "operational notes" subsection. Backward-compat: `LocalEmbedder` constructor still accepts a `profile` override so callers pinned to Nomic v1.5 can stay there.
    - **If no clear winner emerged:** new file `docs/research/embedder-decision-2026.md` documenting the spike findings, the decision to keep Nomic v1.5, and the criteria that would trigger re-evaluation (e.g., "consider re-evaluating when a model with ≥1024d, ≤500MB, MTEB-en > X is published"). No production-code changes.
  - [ ] Existing test suite (537 unit + 666 integration) passes regardless of branch taken.
  - [ ] If swapping: `scripts/demo-search.ts` re-run on the new default, output captured as a sibling-dir artifact for the eval deck. Side-by-side comparison with the Nomic v1.5 baseline shows the score-gap improvement.
  - [ ] If swapping: at least one integration test in `tests/integration/searcher.test.ts` exercises `LocalEmbedder` with the OLD profile to confirm the override path still works (downgrade safety).
- **Testing approach:** Conditional. If swapping, full integration suite re-runs with the new default + an explicit profile-override test. If not swapping, the documentation IS the artifact.
- **QA:**
  - Manual: if swap, re-run smoke + demo + eval; capture for slide deck.
  - Automated: existing suite + the new override test (if swap branch). **THIS IS IMPORTANT** — production-default change touches every retrieval flow.
- **Planned commits (swap branch):**
  1. `feat(embedder): switch default profile to <winner>`
  2. `docs(spec): update spec-005 §5.3 to reflect new default embedder`
  3. `docs(spec): migration guidance for existing 768d corpora in §15 Flow 1`
  4. `test(integration): pin override path to old Nomic v1.5 profile`
  5. `chore: re-run smoke + demo on new default; capture artifacts`
- **Planned commits (no-swap branch):**
  1. `docs(research): no-swap decision + re-evaluation criteria`
- **Technical notes:** The "≥10% improvement in score-gap-mean" is a defensible threshold — smaller deltas don't justify the operational cost of an embedder change (consumer corpus re-ingest, doc updates, support burden). The ">2x latency regression" guard prevents shipping a slower-but-marginally-better model that hurts the agent-integration <0.5s startup path. If both candidates and Nomic land within the noise — that IS the no-swap branch. Do NOT tune the threshold post-hoc to force a swap.
- **Priority:** Must-have

#### Final Evaluation Story (mandatory, runs last)

Produce visual proof that the sprint's deliverables are real. This sprint has no new user flows, so the eval emphasis shifts to documenting the research output + measurement results + decision rationale.

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified against git diff and the rendered HTML deck
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** stakeholder, **I want** an at-a-glance summary of the spike's research, measurement, and decision, **so that** the swap-or-no-swap call is auditable without re-running anything.
- **Dependencies:** All feature stories merged.
- **Acceptance criteria:**
  - [ ] Slide deck at `docs/sprints/eval/sprint-017.html` follows the 5-slide structure. Total slide count ≤5.
  - [ ] Slide 1 — **Sprint Summary**: goal, stories shipped, decision outcome (swap or no-swap)
  - [ ] Slide 2 — **Research Output**: candidate-shortlist table from Story 1's research doc; finalist selection rationale
  - [ ] Slide 3 — **Measurement Results**: comparative table from Story 4 (recall@5, score-gap, latency, model size); side-by-side smoke-output if swapped
  - [ ] Slide 4 — **Decision**: go/no-go with the criteria that drove it; if swap, link to the migration guidance; if no-swap, link to the re-evaluation criteria
  - [ ] Slide 5 — **Repo Hygiene + AC Matrix**: standard hygiene checklist + every story's AC pass/fail table
  - [ ] Tool chosen per `~/projects/harness-config/templates/evaluation-matrix.md` — research artifact mapping is "documentation deliverable → markdown table embedded in HTML"; no screenshots/videos needed
  - [ ] Bulky assets (per-candidate JSON dumps) live in `docs/sprints/eval/sprint-017/` or `docs/research/embedder-spike-runs/`
- **Testing approach:** The deck is the artifact. Open in browser, walk every slide, confirm each links/embeds resolve.
- **QA:**
  - Manual: open `docs/sprints/eval/sprint-017.html` in a browser; confirm slides + tables render.
  - Automated: N/A. **THIS IS IMPORTANT** — the artifact is read-by-eye.
- **Planned commits:**
  1. `feat: capture evaluation artifacts for sprint-017` — research doc + spike-run JSONs + comparative table
  2. `feat: build sprint-017 evaluation slide deck`
- **Technical notes:** This sprint's eval is documentation-heavy by nature — the deliverable is the data + the decision, not a UI. Keep slides text + table heavy; no need for video.
- **Priority:** Must-have

### Rules
- **Sprint-branch setup (before Story 1):** create `sprint-017` off `main` after sprint-016 integration PR merges. Commit this sprint doc as the first commit on the branch. Story branches fork from `sprint-017`; story PRs target `sprint-017`. After eval merges, open sprint-integration PR (`sprint-017 → main`) as the final step. See AGENTS.md §3.
- We sequentially do the stories. We do not do parallel work.
- **Review loop:** Open PRs, run `/review`, address findings, re-verify via `/review-fix` (capped at 3 passes). Confirm local checks green + last review turn ≥ 4/5 with no open P0/P1. Merge into `sprint-017`, then next story.
- Record new dependencies in the Completion section's New Dependencies field. **Story 4 is expected to add candidate model files via Hugging Face Hub auto-download — those are NOT new npm dependencies, just runtime weight downloads. Story 5's swap (if it ships) keeps the same `@huggingface/transformers` dep at the same version.**
- For everything else — commits, PR process, code quality, testing — follow your system instructions.

### Definition of Done
- All must-have stories pass acceptance criteria
- System-instruction conventions satisfied (code quality, tests, PR process, conventional commits, local checks green, last review turn returned mergeability ≥ 4/5 with no open P0/P1)
- **Final Evaluation Story complete** — `docs/sprints/eval/sprint-017.html` exists; decision documented; repo hygiene slide shows clean state
- **Sprint-integration PR merged** (`sprint-017 → main`); `sprint-017` deleted from origin; local main fast-forwarded
- **Spec-005 §5.3 updated** if Story 5 shipped a swap; otherwise unchanged

---

## Completion

*(Filled in at sprint close)*

### Stories shipped
*(List as merged)*

### New dependencies
*(None expected — surface during /sprint review if otherwise)*

### Retro highlights
*(Filled at close)*
