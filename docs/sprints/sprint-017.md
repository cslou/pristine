# Pristine — Sprint 017

**Date:** 2026-04-28 – TBD
**Goal:** Pick a defensible **default + alternates** for Pristine's local embedder by (a) building a domain-custom measurement harness, (b) running it head-to-head on the candidate trio surfaced in PR #172's research, (c) shipping user-facing recommendations docs that name the default + alts with benchmark numbers backing them. Replaces the prior spike framing — research is closed; this sprint is implementation + eval.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript (strict, ESM), Node 18+, `better-sqlite3` + `sqlite-vec`, `@huggingface/transformers` v3.x (in-process `LocalEmbedder`) + Ollama HTTP (`OllamaEmbedder`), Vitest. Local-first — zero outbound network calls in production code.
- **Current state:** spec-005 Phase 4 + 5 shipped (sprints 016 + 019). `client.searcher` exposes `vectorSearch` / `ftsSearch` / `hybridSearch` / `sessionVectorSearch` / `sql`. Two embedder engines plug into `PristineLocal.create({ embedder: ... })`: `LocalEmbedder` (in-process, Nomic v1.5 default) + `OllamaEmbedder` (sidecar, model-by-name). Story 7 demo (sprint-016) surfaced a real quality limitation in Nomic v1.5: top-5 result lists include 2-3 unrelated junk results; per-method score gap between "right answer" (~0.55) and noise (~0.49) is too narrow for thresholding. **The candidate trio (per PR #172 research): `Alibaba-NLP/gte-modernbert-base` (in-process), `embeddinggemma:300m` (Ollama, default candidate), `qwen3-embedding:0.6b` (Ollama, license-clean alt).** Baseline: Nomic v1.5.
- **Implementation spec:** `docs/specs/implementation-spec-005.md` §5.3 (Embedding) currently pins Nomic v1.5 as the documented default; this sprint may revise that pin based on Story 4's measurements.

### Sprint-Level Technical Context

- **Blocking precondition:** PR #172 (`docs/research/embedder-landscape-2026.md` + `docs/research/embedder-evaluation-methodology-2026.md`) MUST be merged into `main` before the `sprint-017` branch is created. This sprint cannot start otherwise — Stories 1, 2, 3, and 5 all reference artifacts PR #172 produces (candidate trio, methodology / power-analysis, bootstrap recipes, license commentary). If PR #172 is not merged at sprint kickoff, the sprint is paused; no story executes.
- **This sprint is implementation + eval, not a spike.** The research that the original sprint-017 framed as Story 1 is closed by PR #172 (`docs/research/embedder-landscape-2026.md` + `docs/research/embedder-evaluation-methodology-2026.md`). Story 1 below is a one-line acknowledgment + cross-reference; Stories 2-5 are the new work.
- **Pristine's two-engine architecture supports model swaps without interface changes.** A consumer already picks an embedder via `PristineLocal.create({ embedder: { engine: 'local' | 'ollama', model: ... } })`. **Modularization invariant for this sprint:** no change to `src/core/interfaces.ts:Embedder`, no change to `src/embedder/index.ts:EmbedderConfig` union, no new engine class. Story 5's default-swap (if conditions in Story 4 are met) changes only the **default model strings** inside the existing `LocalEmbedder` and the documented `EmbedderConfig` example — adding or swapping a model must be an additive edit to constants/config, never a breaking change to the public surface.
- **Smaller-bootstrap measurement harness.** PR #172's methodology doc names two harness sizes: 200-query labelled set with 3-judge LLM ensemble (full rigor) or 50-100-query human-judged single-seed (smaller bootstrap). **This sprint locks the smaller bootstrap.** 50 queries is the floor that's still discriminative for the 0.02-0.05 in-domain Δ NDCG@10 expected between candidates; the harness is built to be extensible to the larger size in a follow-up sprint if needed.
- **Storage schema is dim-aware but not dim-parameterized.** `vec_windows` and `vec_sessions` hardcode `embedding float[768]` in DDL (`src/conversations/store.ts`); `LocalEmbedder` hardcodes `EXPECTED_DIMENSION = 768`; `searcher.vectorSearch` validates `VEC_DIM = 768`. **All three candidates produce 768-d embeddings or have Matryoshka tunability that we'll lock to 768** — this sprint does NOT change the schema dim. If Story 4 surfaces a strong case for dim ≠ 768, that's a follow-up sprint (`vec0` requires `DROP + CREATE` of virtual tables; corpus rebuild needed).
- **Local-first contract is non-negotiable.** Candidates must run via in-process `@huggingface/transformers` OR a local Ollama daemon — no remote inference services. Models must be downloadable / pullable on first use; no auth-gated weights. License must permit local use (Apache-2.0 preferred; Gemma TOS is Story 5's recommendation-doc trade-off, not a disqualification).
- **Candidate trio is locked at sprint planning.** PR #172 produced the shortlist after two passes of the `general-research` sub-agent. **No re-litigating candidates inside the sprint.** If a Story 3 smoke-test reveals a candidate is unloadable (e.g., Ollama model-pull broken, transformers.js arch unsupported on current pinned version), the resolution is to flag-and-document, not swap in a fresh candidate.
- **Sprint-016 retro carry-over.** "FTS5 unicode61 → porter migration" and "storeAsync auto-invoke buildSessionVector" remain deferred. Out of scope.

### User Flows

- **Affected (existing):** `storeAsync(...)` and `searcher.{vector,session}VectorSearch` and `searcher.hybridSearch` all run through whichever `Embedder` the consumer wired into `PristineLocal.create`. Recommendations from Story 5 change which model the docs point consumers toward; the API shape, SDK contract, and storage schema are unchanged.
- **New (this sprint):** Story 5 ships a new doc (`docs/conventions/embedder-selection.md` or similar) with consumer-facing recommendations. Story 2's harness is invoked via a new CLI (`npm run eval:embedder`) — used by maintainers, not exposed to consumers.

### Stories
**Constraints:** Target 5-8 stories per sprint. Target ≤8 commits per story. Final Evaluation Story always last.

#### Story 1: Close research + cross-reference

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Acceptance criteria are specific and testable
  - [ ] Functional verification items have pass/fail conditions
  - [ ] Regression verification items have pass/fail conditions (N/A — doc-only story; no code paths exercised)
  - [ ] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [ ] Ready for Lou
- **Planning review:**
  - Findings: *(sprint-doc-reviewer findings, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** maintainer, **I want** the prior sprint-017 Story 1 (research) explicitly closed with a pointer to PR #172, **so that** Story 4's eval has an unambiguous candidate-list source-of-truth and reviewers don't re-litigate it.
- **Dependencies:** Sprint-Level "Blocking precondition" — PR #172 must be merged into `main` before sprint kickoff (see top of Sprint-Level Technical Context).
- **Acceptance criteria:**
  - [ ] PR #172 is merged on `main`; `docs/research/embedder-landscape-2026.md` and `docs/research/embedder-evaluation-methodology-2026.md` resolve from `main` HEAD at sprint kickoff. If either is missing, sprint-017 does not start.
  - [ ] Sprint-Level Technical Context lists exactly the three candidates: `Alibaba-NLP/gte-modernbert-base` (in-process), `embeddinggemma:300m` (Ollama, default candidate), `qwen3-embedding:0.6b` (Ollama, license-clean alt). Baseline: Nomic v1.5.
  - [ ] No code work; this is an alignment / hand-off story.
- **Functional verification:**
  - [ ] `grep -nE "gte-modernbert-base|embeddinggemma:300m|qwen3-embedding:0.6b" docs/sprints/sprint-017.md` returns ≥3 hits across the candidate trio.
- **Regression verification:** None — doc-only.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. (Already in this sprint-doc revision PR.) No further commits for Story 1.
- **Technical notes:** Story 1 closes immediately on sprint kickoff; it exists to make the candidate-list lock explicit.

#### Story 2: Embedder eval harness — 50-query labelled bootstrap

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Acceptance criteria are specific and testable
  - [ ] Functional verification items have pass/fail conditions
  - [ ] Regression verification items have pass/fail conditions
  - [ ] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [ ] Ready for Lou
- **Planning review:**
  - Findings: *(sprint-doc-reviewer findings, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** maintainer running an embedder head-to-head, **I want** a TypeScript measurement harness that scores any `Embedder` implementation on a labelled query set with NDCG@10 + Recall@K + MRR + paired bootstrap CIs, **so that** Story 4 produces deltas-with-uncertainty rather than point-rank claims.
- **Dependencies:** Story 1.
- **Acceptance criteria:**
  - [ ] **Labelled set: 50 queries minimum** (smaller bootstrap chosen at sprint planning per PR #172 methodology doc; expandable to 200 in a follow-up sprint if needed). 50 is the floor at which a paired-bootstrap 95% CI is expected to resolve a Δ NDCG@10 of ≥0.03 (per `docs/research/embedder-evaluation-methodology-2026.md` §power-analysis); deltas <0.02 are expected to surface as overlapping CIs and route to inconclusive-result handling in Story 4. Stored as `tests/integration/embedder-eval/queries.jsonl` — one JSON object per line with `{ id, query, relevant_doc_ids: string[], grade: 'pessimistic'|'typical'|'optimistic' }`. ≥15 queries per grade-bucket.
  - [ ] **Corpus: synthesized + sanitized.** `tests/integration/embedder-eval/corpus.jsonl` — one JSON object per line with `{ id, content, role, conversation_id, project_id }`. Seeded by replaying real Pristine session logs (the maintainer's own; not a colleague's), paraphrased into the 3 grade-buckets via LLM, **passed through `secureAndRedact` before commit** so PII / secrets do not land in the repo. Document in the doc header how the corpus was generated and how to regenerate it.
  - [ ] **Single-judge labels with human-curated seed.** Maintainer (Lou) hand-judges exactly 18 query/document pairs as the human seed. An LLM judge (Claude Sonnet) scores the remaining 32 pairs against the same rubric; the maintainer spot-checks ≥10% of LLM-judged labels (≥4 items) and corrects disagreements. Documented inter-judge agreement (Cohen's κ ≥ 0.6 on the spot-check) is an AC pass condition.
  - [ ] **`runEval(embedderConfig, options)` TS function** at `tests/integration/embedder-eval/run-eval.ts` — takes an `EmbedderConfig` (the existing factory shape from `src/embedder/index.ts`), runs the labelled queries against the configured embedder, returns `{ ndcg10, recall5, recall10, recall20, mrr, p50LatencyMs, p95LatencyMs, dimUsed }` plus paired-bootstrap CIs (1000 resamples) for each retrieval metric.
  - [ ] **Two configurations per candidate:** `dense-only` (embedder + cosine search, FTS5 disabled) and `hybrid` (embedder + FTS5 + RRF — Pristine's production retriever path). Report both.
  - [ ] **CLI:** `npm run eval:embedder -- --candidate <name> --baseline nomic-v1.5` produces a markdown report at `docs/research/embedder-eval-runs/<timestamp>-<candidate>-vs-baseline.md` with both configurations' numbers, deltas with CIs, and a one-paragraph summary.
  - [ ] **Sanity-check script:** `tests/integration/embedder-eval/mteb-sanity.ts` runs the harness on a small public dataset (NFCorpus or BEIR/scifact subset) and compares NDCG@10 against a reference implementation (Python `mteb` snapshot, captured into a JSON fixture). The TS harness must agree with the reference within the bootstrap CI on the same model + dataset, otherwise the harness has a bug.
  - [ ] **No PII / secrets in repo.** A pre-commit hook (or CI check) verifies queries.jsonl + corpus.jsonl pass through `secureAndRedact` cleanly with zero unresolved markers.
- **Functional verification:**
  - [ ] `npm run eval:embedder -- --candidate nomic-v1.5 --baseline nomic-v1.5` produces a self-vs-self report where deltas are within bootstrap noise (Δ NDCG@10 CI brackets 0). Validates the harness has no asymmetric bug.
  - [ ] `npx tsx tests/integration/embedder-eval/mteb-sanity.ts` exits 0; reports NDCG@10 within ±CI of the reference Python `mteb` snapshot.
  - [ ] `tests/integration/embedder-eval/queries.jsonl` has exactly the documented count (50 ± 2) and 3 grade-buckets each with ≥15 entries.
  - [ ] κ-on-spot-check is ≥0.6, recorded in `tests/integration/embedder-eval/labelling-notes.md`.
- **Regression verification:**
  - [ ] `npm run test:unit` — exit 0, no FAILED reporter line.
  - [ ] `npm run test:integration` — exit 0, all integration suites pass; new `embedder-eval` test files do NOT run by default in `test:integration` (they live as a separate `npm run eval:embedder` lane to avoid CI-time pull of model weights).
  - [ ] `bash .checks/pre-merge.sh` — exit 0.
- **Manual-only verification:** Maintainer reviews the labelled set + κ-spot-check sample for label sanity. Pass condition: maintainer signs off in PR body.
- **Planned commits:**
  1. `feat(eval): scaffold tests/integration/embedder-eval/ with corpus + queries jsonl + types`
  2. `feat(eval): implement runEval — NDCG@10 + Recall@K + MRR + paired bootstrap CIs`
  3. `feat(eval): dense-only + hybrid (RRF) configurations with shared retrieval-quality scorer`
  4. `feat(eval): npm run eval:embedder CLI + markdown report writer`
  5. `feat(eval): mteb-sanity script + reference NFCorpus fixture`
  6. `test(eval): self-vs-self regression test for nomic-v1.5 baseline`
  7. `docs(eval): labelling notes + corpus-regeneration recipe`
- **Technical notes:** The harness lives in `tests/integration/embedder-eval/` not in `src/` because it is a maintainer tool, not a consumer-facing API. Treat it like `scripts/smoke-indexer.ts` — a local-run binary, not part of the SDK surface. The 50-query bootstrap is documented as the **floor**; if Story 4 surfaces inconclusive deltas (overlapping CIs), Story 5's recommendation may include "harness needs to be expanded to 200 queries before a stronger claim can be made" as the deliverable.

#### Story 3: Verify engine integration for the candidate trio

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Acceptance criteria are specific and testable
  - [ ] Functional verification items have pass/fail conditions
  - [ ] Regression verification items have pass/fail conditions
  - [ ] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [ ] Ready for Lou
- **Planning review:**
  - Findings: *(sprint-doc-reviewer findings, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** maintainer about to benchmark, **I want** a smoke-test that proves each candidate model loads + produces a 768-d embedding via the existing `Embedder` factory, **so that** Story 4 doesn't burn time discovering a candidate is unloadable on the current pinned `@huggingface/transformers` version or via a broken Ollama model-pull.
- **Dependencies:** Story 2.
- **Acceptance criteria:**
  - [ ] `LocalEmbedder` smoke-test for `Alibaba-NLP/gte-modernbert-base`: loads via `pipeline('feature-extraction', ...)`, produces a Float32Array of length 768 for the input string `"hello world"`. Test lives at `tests/embedder/local-gte-modernbert.smoke.test.ts`. Skipped if `SKIP_SLOW_TESTS=1`.
  - [ ] `OllamaEmbedder` smoke-test for `embeddinggemma:300m`: pulls the model if not present (one-time setup; document in test header), POSTs to `/api/embed`, validates response shape + length 768. Test lives at `tests/embedder/ollama-embeddinggemma.smoke.test.ts`. Skipped if `SKIP_SLOW_TESTS=1` OR if Ollama is not running on `localhost:11434`.
  - [ ] `OllamaEmbedder` smoke-test for `qwen3-embedding:0.6b`: same shape as above, asserts dim 1024 (Qwen3 native dim, NOT 768) — because `vec_windows.embedding` is `float[768]`, this candidate must be configured to truncate to 768 via Matryoshka. **Truncation lives in the Story 2 harness wrapper (NOT inside `OllamaEmbedder`)**, to preserve the modularization invariant: no engine-class changes for new candidates. The wrapper takes the raw 1024-d vector, slices `[0:768]`, and L2-renormalizes per Matryoshka spec. Document the truncation step explicitly in the test + harness recipe.
  - [ ] `LocalEmbedder` capability-check for ModernBERT support in pinned `@huggingface/transformers` version: a one-line `node -e "import('@huggingface/transformers').then(t => console.log(Object.keys(t)))"` smoke that confirms `pipeline` is exported and `'feature-extraction'` is a known task. Document the minimum version (v3.2.1+) in `package.json` engines / docs.
  - [ ] **No production-code change.** This story validates that the candidate trio works with the existing `LocalEmbedder` + `OllamaEmbedder` engines as-shipped. If any candidate fails the smoke, the failure is documented as a follow-up sprint — NOT a fix in this sprint.
  - [ ] **Engine-config recipes (eval-team scratch):** add a recipe block at `docs/research/embedder-eval-runs/recipes.md` showing the exact `EmbedderConfig` for each candidate that Story 4 will consume. This is the eval-team scratch recipe — Story 5's `docs/conventions/embedder-selection.md` is the consumer-facing doc that *cites* this recipe; do not duplicate the recipes between the two docs.
- **Functional verification:**
  - [ ] All 3 smoke-tests pass when SKIP_SLOW_TESTS is unset and Ollama is running. Document the env-var + Ollama prerequisite in the test header.
  - [ ] `npm run test:integration -- tests/embedder/*.smoke.test.ts` exits 0 (or skips cleanly with SKIP_SLOW_TESTS=1).
- **Regression verification:**
  - [ ] `npm run test:unit` — exit 0.
  - [ ] `npm run test:integration` (with SKIP_SLOW_TESTS=1) — exit 0; smoke tests are skipped, no other regressions.
  - [ ] `bash .checks/pre-merge.sh` — exit 0.
- **Manual-only verification:**
  - Pull both Ollama models locally (`ollama pull embeddinggemma:300m && ollama pull qwen3-embedding:0.6b`) and confirm `ollama list` shows them. Pass condition: both visible in `ollama list` output, sizes match research-doc estimates within ±10%.
- **Planned commits:**
  1. `test(embedder): smoke-test gte-modernbert-base via LocalEmbedder`
  2. `test(embedder): smoke-test embeddinggemma:300m via OllamaEmbedder`
  3. `test(embedder): smoke-test qwen3-embedding:0.6b via OllamaEmbedder + 1024→768 Matryoshka truncate`
  4. `docs(eval): engine-config recipes for the candidate trio`
- **Technical notes:** This story's failure modes (a candidate is unloadable / Ollama pull broken / version mismatch) are FLAGGED, not FIXED. If a candidate fails, Story 4 either (a) drops it from the eval and notes the omission, or (b) waits for an upstream fix. The candidate trio is locked from PR #172; substituting a new candidate inside this sprint is out of scope.

#### Story 4: Run the eval

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Acceptance criteria are specific and testable
  - [ ] Functional verification items have pass/fail conditions
  - [ ] Regression verification items have pass/fail conditions
  - [ ] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [ ] Ready for Lou
- **Planning review:**
  - Findings: *(sprint-doc-reviewer findings, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** maintainer making a defensible recommendation, **I want** the harness from Story 2 executed on the candidate trio + Nomic v1.5 baseline with deltas reported under paired bootstrap 95% CIs, **so that** Story 5's recommendations doc cites real Pristine-corpus numbers, not leaderboard transfers.
- **Dependencies:** Stories 2 + 3.
- **Acceptance criteria:**
  - [ ] **4 runs total**, captured as markdown reports under `docs/research/embedder-eval-runs/` using the filename pattern from Story 2 AC-6: `<timestamp>-<candidate>-vs-baseline.md` (e.g., `2026-05-10T1500Z-gte-modernbert-base-vs-baseline.md`):
    1. Nomic v1.5 baseline (self-vs-self sanity already covered in Story 2's regression test; this run is the named comparison anchor).
    2. `gte-modernbert-base` vs Nomic v1.5.
    3. `embeddinggemma:300m` vs Nomic v1.5.
    4. `qwen3-embedding:0.6b` vs Nomic v1.5.
  - [ ] Each run reports both `dense-only` and `hybrid` configurations, with paired bootstrap 95% CIs on every metric.
  - [ ] Latency: p50/p95/p99 wall-clock per embed at batch=1 warm, captured per candidate. **Cold-start defined as: the first 10 `embed()` calls after the process starts and the model is loaded into memory (for `LocalEmbedder`) OR after the first successful `/api/embed` POST returns 200 (for `OllamaEmbedder`).** These 10 timing samples are recorded in the run log but excluded from p50/p95/p99 aggregation. For the Ollama candidates, BOTH "model compute" (subtract RPC baseline) AND "end-to-end" numbers reported.
  - [ ] **A summary table** at `docs/research/embedder-eval-runs/SUMMARY.md` collects all 4 runs into one comparison view: rows = candidates, columns = NDCG@10 (dense / hybrid), Recall@10 (dense / hybrid), MRR, p50 latency, p95 latency, dim used, license. CIs annotated where overlap with baseline.
  - [ ] **Inconclusive-result handling.** If any pairwise comparison's NDCG@10 CI overlaps the baseline's CI, the SUMMARY.md row is annotated `inconclusive on quality — falls to latency/size/license` per the methodology doc.
  - [ ] **No model-selection decision in this story.** Story 4 produces numbers; Story 5 turns them into recommendations.
- **Functional verification:**
  - [ ] All 4 markdown reports exist; each is reproducible by running `npm run eval:embedder -- --candidate <name>`.
  - [ ] SUMMARY.md exists and renders cleanly (no broken tables, all rows populated, no `?` entries).
  - [ ] Reports actually contain bootstrap CIs: `grep -nE '95%\s*CI|\[\s*-?[0-9]\.[0-9]+\s*,\s*-?[0-9]\.[0-9]+\s*\]' docs/research/embedder-eval-runs/*.md` returns ≥1 hit per metric per candidate report (catches half-baked reports that omit the CI annotation).
  - [ ] Wall-time bound: end-to-end run for all 4 candidates ≤2 hours on a typical maintainer laptop. If exceeded, document the bottleneck (model-pull time / Ollama startup / embed throughput) so the future-200-query expansion has a realistic cost estimate.
- **Regression verification:**
  - [ ] `npm run test:unit` — exit 0; no embedder-related unit tests regressed.
  - [ ] `npm run test:integration` (SKIP_SLOW_TESTS=1) — exit 0.
  - [ ] `bash .checks/pre-merge.sh` — exit 0.
- **Manual-only verification:** N/A — the harness produces deterministic markdown outputs that the next story consumes.
- **Planned commits:**
  1. `eval: run nomic-v1.5 baseline + gte-modernbert-base on Pristine corpus`
  2. `eval: run embeddinggemma:300m + qwen3-embedding:0.6b on Pristine corpus`
  3. `eval: SUMMARY.md cross-candidate comparison + inconclusive-result annotations`
- **Technical notes:** The candidate trio's expected in-domain Δ NDCG@10 from PR #172 research is 0.02-0.05; the 50-query bootstrap is sized for that range. If actual deltas are smaller (e.g., 0.01), CIs will overlap and the SUMMARY annotates inconclusive — that is the correct outcome, not a failure. Story 5 then makes a defensible recommendation on latency/size/license.

#### Story 5: Ship user-facing recommendations doc + conditional SDK default swap

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Acceptance criteria are specific and testable
  - [ ] Functional verification items have pass/fail conditions
  - [ ] Regression verification items have pass/fail conditions
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [ ] Ready for Lou
- **Planning review:**
  - Findings: *(sprint-doc-reviewer findings, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** Pristine consumer, **I want** a single doc that names the recommended embedder default + alternates with benchmark numbers backing each recommendation, AND **as a** maintainer, **I want** the SDK's no-config default to point at the empirically-best in-process model so consumers who don't pass a config get the best out-of-box quality, **so that** the recommendation in docs and the SDK behavior agree without diverging.
- **Dependencies:** Story 4.
- **Acceptance criteria:**
  - **Recommendations doc deliverable:**
    - [ ] **New doc:** `docs/conventions/embedder-selection.md`. Opens with a 4-tier recommendation table (impatient default / license-clean alt / zero-deps in-process alt / code-only escape hatch). Each tier names the exact `EmbedderConfig` shape a consumer copy-pastes into `PristineLocal.create({ embedder: ... })`. (The code-only tier names `nomic-embed-code` as the recommendation for >70% code corpora; this is recommendation-only — it is NOT one of the four candidates evaluated in Story 4.)
    - [ ] **Backed by Story 4 numbers.** Each recommendation cites the relevant SUMMARY.md row + the bootstrap CI. If a recommendation rests on inconclusive-quality (CI overlap), the doc says so explicitly and explains which secondary axis (latency / size / license) tipped the decision.
    - [ ] **License caveats surfaced.** EmbeddingGemma's Gemma TOS is documented as a deal-breaker for some downstream distribution models; the license-clean alt (`qwen3-embedding:0.6b`) is named for consumers who need strict Apache-2.0.
    - [ ] **Cross-link from `docs/specs/implementation-spec-005.md` §5.3** — wording branches on the decision rule below:
      - If the SDK default swapped: §5.3 reads "Pristine ships with the empirically-best in-process model as the no-config default (see [`docs/conventions/embedder-selection.md`](../conventions/embedder-selection.md)); consumers can override via `PristineLocal.create({ embedder: ... })`."
      - If the SDK default did NOT swap (CIs overlapped, Nomic v1.5 retained as fallback): §5.3 reads "Pristine ships Nomic v1.5 as the no-config default for backward compat; see [`docs/conventions/embedder-selection.md`](../conventions/embedder-selection.md) for the recommended alternative consumers should opt into via `PristineLocal.create({ embedder: ... })`."
  - **Conditional SDK default-swap deliverable (modularization invariant: no interface changes):**
    - [ ] **Decision rule (locked):** the SDK default-swap fires iff (a) the candidate is **in-process** (excludes Ollama candidates from eligibility because the SDK no-config default must not require a sidecar daemon), AND (b) the candidate's **dense-only** NDCG@10 paired bootstrap 95% CI lower bound is **strictly greater than** Nomic v1.5's dense-only NDCG@10 paired bootstrap 95% CI upper bound (operational test: `candidate.ndcg10.dense.ci_lower > nomic.ndcg10.dense.ci_upper`). Tie or overlap → no swap. The only Story 4 candidate that meets eligibility (a) is `gte-modernbert-base`; the two Ollama candidates (`embeddinggemma:300m`, `qwen3-embedding:0.6b`) are recommendation-only, never SDK default. If the rule fires, change the `LocalEmbedder` no-config default from Nomic v1.5 to `gte-modernbert-base`. If the rule does NOT fire, keep Nomic v1.5 as the SDK fallback; the docs still recommend the candidate but consumers must opt in via explicit config. Document the decision + which arm of the rule fired in the Story 5 PR body.
    - [ ] **Implementation constraint — no interface change.** The default-swap edits ONLY:
      - the default model-string constant in `src/embedder/local/index.ts` (currently pinned to Nomic v1.5)
      - the default-config wiring in `src/client.ts` (`PristineLocal.create` fallback)
      - the existing `LocalEmbedder` constructor parameters
      - it MUST NOT touch `src/core/interfaces.ts:Embedder`, `src/embedder/index.ts:EmbedderConfig` union, the engine factory dispatch, or the public `Embedder.embed` / `embedBatch` signatures. A reviewer checks the diff: a clean default-swap touches ≤4 files in `src/embedder/` + `src/client.ts` and 0 lines of public-API surface.
    - [ ] **Backward compat path documented.** If the SDK default switches, document in the Story 5 PR body: (a) consumers who explicitly passed `engine: 'local', model: 'nomic-embed-text-v1.5'` get unchanged behavior (Nomic still loads on request); (b) consumers with no `embedder` config in `PristineLocal.create` get the new default model on first run; (c) **existing on-disk corpora embedded with Nomic v1.5 are NOT auto-migrated** — switching the default does not silently re-embed historical messages with a different model. The `vec_windows` table will contain mixed-model embeddings if a consumer's old corpus was Nomic-embedded and new ingests use the new default. Story 5 surfaces this in a `## Known compat notes` heading and points at a follow-up sprint for any consumer-facing migration tool.
    - [ ] **Recommendations doc Tier 1 wording aligns with the SDK default decision.** If the swap fired, Tier 1 says "Pristine ships this as the no-config default; you don't need to pass an `embedder` config to get it." If the swap did NOT fire (CIs overlapped), Tier 1 says "We recommend this; pass it explicitly via `PristineLocal.create({ embedder: ... })`. The SDK fallback remains Nomic v1.5 for backward compat."
- **Functional verification:**
  - [ ] `grep -nE "embeddinggemma:300m|qwen3-embedding:0.6b|gte-modernbert-base" docs/conventions/embedder-selection.md` returns ≥3 hits across the candidate trio.
  - [ ] `grep -n "docs/conventions/embedder-selection.md" docs/specs/implementation-spec-005.md` returns ≥1 hit (the cross-link from §5.3).
  - [ ] Every recommendation row in the doc cites a SUMMARY.md anchor.
  - [ ] If the SDK default swapped: **modularization-invariant audit** — `git diff main..HEAD -- src/core/interfaces.ts src/embedder/index.ts src/index.ts` returns **zero changes** (proves no public-surface change when swapping default model). The barrel must be byte-identical, not just export-list-identical, because a type-signature change in a re-exported symbol is also a surface change.
  - [ ] If the SDK default swapped: a fresh `PristineLocal.create({})` call with no embedder config produces an embedding via the new default model end-to-end (smoke test added at `tests/integration/embedder-default-swap.test.ts`, gated on the swap firing).
  - [ ] If the SDK default swapped: **backward-compat behavioral test** at `tests/integration/embedder-mixed-model.test.ts` — open a DB with Nomic-v1.5-embedded `vec_windows` rows pre-seeded, instantiate `PristineLocal.create({})` with no embedder config (gets the new default), call `searcher.vectorSearch` for read and `storeAsync` for new ingest. Assert: (a) old rows' embedding bytes are byte-identical pre/post (no auto re-embed), (b) new rows are embedded with the new default model, (c) no migration log line / no schema change / no row rewrite occurs. Catches a future contributor sneaking in a "helpful" auto-migration that violates the documented compat contract.
- **Regression verification:**
  - [ ] `npm run test:unit` — exit 0; no Embedder-interface tests broke.
  - [ ] `npm run test:integration` — exit 0; existing tests that explicitly pass an `embedder` config (most do, including all of `searcher-sql.test.ts`, `storeasync.test.ts`, etc.) are unaffected.
  - [ ] `bash .checks/pre-merge.sh` — exit 0.
- **Manual-only verification:**
  - Maintainer reads the doc end-to-end as if they were a new consumer, validates the copy-pasteable `EmbedderConfig` recipes actually work via a 5-minute smoke (`storeAsync` → `searcher.hybridSearch` round-trip on a fresh DB). Pass condition: maintainer sign-off in PR body.
- **Planned commits:**
  1. `docs(conventions): embedder-selection.md — default + alts with benchmark numbers`
  2. `docs(spec): cross-link implementation-spec-005 §5.3 to embedder-selection doc`
  3. *(conditional, only if Story 4 decision rule fires)* `feat(embedder): swap LocalEmbedder no-config default from nomic-v1.5 to <winning-candidate>` — touches ≤4 files in `src/embedder/` + `src/client.ts`; zero public-interface changes
  4. *(conditional, only if SDK default swapped)* `test(embedder): smoke that no-config PristineLocal.create produces embeddings via new default`
- **Technical notes:** This story is the consumer-facing payoff for the whole sprint. Recommendation order: **(1) impatient default, (2) license-clean alt if Gemma TOS is a problem, (3) zero-deps in-process alt if no Ollama, (4) code-only escape hatch (`nomic-embed-code` for >70% code corpora).** The conditional SDK default-swap is the only code change in this sprint outside of the test harness — and only fires if Story 4's CIs are non-overlapping. The modularization invariant (no interface changes when adding/swapping models) is the load-bearing review check; the diff-stat constraint (`zero changes` to `interfaces.ts` + `embedder/index.ts` + `src/index.ts`) is what makes it auditable. Document any bumped `@huggingface/transformers` minimum version in `package.json` if the new default model requires it.

#### Final Verification Story: Sprint Verification & Completion

- **Story Checklist:**
  - [ ] Uses the story sections above and the existing regression suite as the source of truth
  - [ ] Defines where final verification evidence will be recorded
  - [ ] Includes full regression verification, not only areas believed to be touched
  - [ ] Ready for Lou
- **As a** maintainer, **I want** all sprint functional verification + targeted regression + the full available regression suite run, **so that** sprint integration ships with evidence that new behavior works and existing behavior did not regress.
- **Dependencies:** All implementation stories (1-5).
- **Acceptance criteria:**
  - [ ] Every story's AC is evaluated against implementation evidence.
  - [ ] Every story's FV checkbox is run / checked / explicitly marked failed/ambiguous/unrun.
  - [ ] Full regression suite runs: `npm run test:unit`, `SKIP_SLOW=1 npm run test:integration`, `SKIP_SLOW=0 npm run test:integration` (real Nomic), `npm run test:e2e`, `npx tsx scripts/smoke-indexer.ts`, `bash .checks/pre-merge.sh` — all exit 0.
  - [ ] Failed / ambiguous / unrun verification items documented in `## Final Review`.
  - [ ] **The sprint's new functional verification is identified as future regression verification** — Story 2's eval-harness regression test (self-vs-self), Story 3's three smoke-tests, and Story 5's conditional default-swap + mixed-model integration tests are flagged in `## Final Review` for inclusion in the next sprint's regression suite.
  - [ ] **Verification delta is reported by canonical type** (unit / integration / e2e / smoke / static / manual), showing five columns: before sprint, added this sprint, removed, pending/not yet run, after sprint totals.
  - [ ] **Final eval slide deck:** `docs/sprints/eval/sprint-017.html` produced with (1) the SUMMARY.md headline numbers, (2) the recommendation doc's Tier 1 conclusion, (3) which arm of Story 5's decision rule fired (swapped / did not swap). Renders without broken links via `npx serve docs/sprints/eval` smoke. (Mirrors sprint-016's `docs/sprints/eval/sprint-016/` shape.)
  - [ ] Sprint-doc Status flipped to `🟢 Complete` only if completion criteria met.
  - [ ] `## Final Review` section appended per `workflow-prompts/handle-sprint-completion.md` template (Mergeability + objective + accomplishments + verification delta table + why ready + open for decision + delivered + drift + dependencies).
- **Functional verification:**
  - [ ] All Story 1-5 FV items reported pass/fail in `## Final Review`.
- **Regression verification:**
  - [ ] All 6 commands above exit 0; logged in `## Final Review`.
- **Manual-only verification:** Story 5's maintainer-read-as-consumer smoke (link to evidence in `## Final Review`).
- **Planned commits:**
  1. `docs(sprint-017): final verification evidence + Status → 🟢 Complete + ## Final Review section`
- **Technical notes:** Use the story sections + existing regression suite as the source of truth. Do not duplicate AC/verification items here; run them, reference the evidence, compute the verification delta table, append `## Final Review`. Use `workflow-prompts/handle-sprint-completion.md` for the final completion message shape. **Conditional-test handling:** Story 5's `embedder-default-swap.test.ts` and `embedder-mixed-model.test.ts` exist iff Story 4's decision rule fired. Mark each conditional item as "fired/not-fired" in `## Final Review` so the verification delta table is unambiguous (an item that didn't need to exist isn't the same as an item that was skipped).

### Rules
- **Sprint-branch setup:** create `sprint-017` off `main` after this sprint-doc revision PR (#TBD) merges. Commit this revised sprint doc as the first commit on the branch. Story branches fork from `sprint-017`; story PRs target `sprint-017`. After Final Verification merges, open the sprint-integration PR (`sprint-017 → main`).
- Sequentially execute stories. No parallel work.
- **Review loop:** open PRs, run `/review`, address findings, re-verify via `/review-fix` (capped at 3 passes). Confirm local checks green + last review turn ≥ 4/5 with no open P0/P1. Merge into `sprint-017`, then next story.
- Record new dependencies in `## Final Review`. **Story 4 will pull candidate model files via Hugging Face Hub / Ollama on first use — those are NOT new npm dependencies, just runtime weight downloads. No new npm deps expected this sprint.**
- For everything else — commits, PR process, code quality, testing — follow AGENTS.md.

### Definition of Done
- All implementation stories pass acceptance criteria
- AGENTS.md conventions satisfied (code quality, tests, PR process, conventional commits, local checks green, last review turn ≥4/5 with no open P0/P1)
- Final Verification Story complete; `## Final Review` appended
- Sprint-integration PR (`sprint-017 → main`) reviewed, gates passed, awaiting / merged on user command
- `docs/conventions/embedder-selection.md` exists; cross-linked from `implementation-spec-005.md` §5.3
- All 4 candidate eval-run reports exist under `docs/research/embedder-eval-runs/` plus the SUMMARY.md cross-comparison
- `## Final Review` includes verification delta table by canonical type (unit / integration / e2e / smoke / static / manual) with all 5 columns populated

---

## Final Review

*(Filled in at sprint close per `workflow-prompts/handle-sprint-completion.md`.)*
