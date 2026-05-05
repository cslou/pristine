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
- **Pristine's two-engine architecture supports model swaps without interface changes (after Story 0).** A consumer already picks an embedder via `PristineLocal.create({ embedder: { engine: 'local' | 'ollama', model: ... } })`. **Modularization invariant for Stories 1-5:** no change to `src/core/interfaces.ts:Embedder` (the embed contract), no new engine class, and after Story 0 lands, no change to `src/embedder/index.ts:EmbedderConfig` shape. Story 0 makes a **one-time additive change** to `EmbedderConfig` (adds optional `dim` field, default 768); after Story 0 merges into `sprint-017`, Stories 1-5 run under the strict invariant. Story 5's conditional default-swap then changes only the **default `EmbedderConfig` value** in `src/client.ts` — never the `EmbedderConfig` shape itself.
- **Smaller-bootstrap measurement harness.** PR #172's methodology doc names two harness sizes: 200-query labelled set with 3-judge LLM ensemble (full rigor) or 50-100-query human-judged single-seed (smaller bootstrap). **This sprint locks the smaller bootstrap.** 50 queries is the floor that's still discriminative for the 0.02-0.05 in-domain Δ NDCG@10 expected between candidates; the harness is built to be extensible to the larger size in a follow-up sprint if needed.
- **Storage schema becomes dim-parameterized in Story 0.** Pre-sprint: `vec_windows` and `vec_sessions` hardcode `embedding float[768]` in DDL (`src/conversations/store.ts`); `LocalEmbedder` hardcodes `EXPECTED_DIMENSION = 768`; `searcher.vectorSearch` validates `VEC_DIM = 768`. **Story 0 templates the DDL by `dim`, drops the `EXPECTED_DIMENSION` and `VEC_DIM` constants in favor of per-instance + per-deps config, and ships SDK default `dim: 768`** — chosen because the highest CoIR scorer in the candidate trio (`gte-modernbert-base`) is fixed at 768 and the two MRL-trained Ollama candidates truncate gracefully (1-3% NDCG loss at 768 vs native, below bootstrap CI noise). 33% lower per-query cosine cost vs 1024 is an additional win on consumer hardware. **Cross-dim migration of existing on-disk corpora is explicitly out of scope this sprint** — a consumer who later changes `dim` must create a fresh DB; document this in Story 5's selection doc.
- **Local-first contract is non-negotiable.** Candidates must run via in-process `@huggingface/transformers` OR a local Ollama daemon — no remote inference services. Models must be downloadable / pullable on first use; no auth-gated weights. License must permit local use (Apache-2.0 preferred; Gemma TOS is Story 5's recommendation-doc trade-off, not a disqualification).
- **Candidate trio is locked at sprint planning.** PR #172 produced the shortlist after two passes of the `general-research` sub-agent. **No re-litigating candidates inside the sprint.** If a Story 3 smoke-test reveals a candidate is unloadable (e.g., Ollama model-pull broken, transformers.js arch unsupported on current pinned version), the resolution is to flag-and-document, not swap in a fresh candidate.
- **Sprint-016 retro carry-over.** "FTS5 unicode61 → porter migration" and "storeAsync auto-invoke buildSessionVector" remain deferred. Out of scope.

### Story 0 baseline sha

*(Filled in by the maintainer on Story 0 PR merge into `sprint-017`. Owner: whoever merges Story 0's PR.)*

- **Story 0 merge-commit sha:** `<TBD — record `git rev-parse origin/sprint-017` immediately after the Story 0 PR merges, before opening the Story 1 branch>`
- **`EmbedderConfig` post-Story-0 type signature snapshot** (paste verbatim from `src/embedder/index.ts` after the dim-field addition):
  ```ts
  // <fill in: the TS type-alias / discriminated-union as it lands in Story 0>
  ```

Story 5's modularization-invariant audit (AC-9) uses this sha + this snapshot as its diff baseline. The Final Verification Story re-records both in `## Final Review` for the durable audit copy.

### User Flows

- **Affected (existing):** `storeAsync(...)` and `searcher.{vector,session}VectorSearch` and `searcher.hybridSearch` all run through whichever `Embedder` the consumer wired into `PristineLocal.create`. The `EmbedderConfig` shape gains an optional `dim: number` field in Story 0 (default 768; backward-compatible — omitting the field selects the default). The DDL for `vec_windows` and `vec_sessions` becomes templated by `dim` at table-create time. The `Embedder` interface (`embed` / `embedBatch` signatures) is unchanged.
- **New (this sprint):** Story 0 ships dim-parameterized storage. Story 5 ships a new doc (`docs/conventions/embedder-selection.md`) with consumer-facing recommendations. Story 2's harness is invoked via a new CLI (`npm run eval:embedder`) — used by maintainers, not exposed to consumers.

### Stories
**Constraints:** Target 5-8 stories per sprint. Target ≤8 commits per story. Final Evaluation Story always last.

**Execution order:** Story 0 → Story 1 (alignment, no commits — pure cross-reference) → Story 2 → Story 3 → Story 4 → Story 5 → Final Verification Story. The file places Story 1 first because it documents the closure of the prior research framing (which is the conceptual entry point for the sprint); Story 0 is the foundational architectural change and runs first in execution. This deviates from strict file-order = execution-order convention; if you're an executing agent, follow the execution order above.

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
  - [ ] PR #172 is merged on `main`. Verified at the moment `sprint-017` is branched from `main`: `git show main:docs/research/embedder-landscape-2026.md` and `git show main:docs/research/embedder-evaluation-methodology-2026.md` both succeed (exit 0, non-empty output). If either fails, sprint-017 does not start.
  - [ ] Sprint-Level Technical Context lists exactly the three candidates: `Alibaba-NLP/gte-modernbert-base` (in-process), `embeddinggemma:300m` (Ollama, default candidate), `qwen3-embedding:0.6b` (Ollama, license-clean alt). Baseline: Nomic v1.5.
  - [ ] No code work; this is an alignment / hand-off story.
- **Functional verification:**
  - [ ] `grep -nE "gte-modernbert-base|embeddinggemma:300m|qwen3-embedding:0.6b" docs/sprints/sprint-017.md` returns ≥3 hits across the candidate trio.
- **Regression verification:** None — doc-only.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. (Already in this sprint-doc revision PR.) No further commits for Story 1.
- **Technical notes:** Story 1 closes immediately on sprint kickoff; it exists to make the candidate-list lock explicit.

#### Story 0: Parameterize embedding dim across storage + retrieval

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
- **As a** maintainer of a pre-launch local-first SDK, **I want** the embedding dim to be a configured value rather than a global constant, **so that** future model swaps that ship at non-768 native dims (or different Matryoshka truncation budgets) don't require a schema-migration sprint, AND **as a** Pristine consumer, **I want** the SDK default dim to remain 768 (no opt-in needed), **so that** existing example code and the documented `EmbedderConfig` shape don't break.
- **Dependencies:** Sprint-Level Blocking Precondition (PR #172 merged on `main`). No story dependency. Story 0 is foundational and runs first; Stories 1-5 consume the parameterized surface.
- **Acceptance criteria:**
  - [ ] **`EmbedderConfig` gains an optional `dim` field** in `src/embedder/index.ts`. Type: `dim?: number`. The factory (`createEmbedder`) defaults to `768` when omitted. Adding the field is the **only** shape change to `EmbedderConfig` this sprint; both the `local` and `ollama` engine variants accept it.
  - [ ] **DDL templated by `dim`.** `src/conversations/store.ts` builds the `CREATE VIRTUAL TABLE vec_windows USING vec0(embedding float[N])` and `vec_sessions` DDL strings from the configured `dim` (passed in via the `Database` deps or store init). Validation: `Number.isInteger(dim) && dim >= 64 && dim <= 4096`, throw `InvalidArgumentError` otherwise — protects against SQL-injection or absurd values being string-interpolated into DDL.
  - [ ] **`LocalEmbedder` and `OllamaEmbedder` constructors accept the configured `dim`** and validate at first `embed()` call: model output length must equal configured dim. Throw `InvalidArgumentError` with a message naming both expected + actual dims on mismatch (e.g., `"LocalEmbedder configured dim=1024 but model 'gte-modernbert-base' produced 768"`).
  - [ ] **`searcher.vectorSearch` reads dim from deps**, not from a top-level `VEC_DIM` constant. The `MAX_LIMIT = 1000` constant stays as-is; the dim constant is removed and replaced by `searcher.deps.dim`.
  - [ ] **Default dim is 768.** The default is set in exactly one place — `src/client.ts` (the `EmbedderConfig` literal that `PristineLocal.create({})` falls back to). Document the default + the chosen-because-of-CoIR-scoring reason in a one-paragraph comment block at the default-config site.
  - [ ] **Cross-dim migration is NOT supported.** A consumer who creates a DB with `dim=768` and later passes `dim=1024` must hit a clear runtime error from `searcher.vectorSearch` (dim-mismatch) on first query. Document the limitation in the `Embedder` interface JSDoc + Story 5's selection doc.
  - [ ] **No public-API surface change beyond the optional `dim` field.** The `Embedder` interface (`embed`, `embedBatch` signatures) is byte-identical pre/post.
- **Functional verification:**
  - [ ] Default-dim regression: `npm run test:integration` with no test changes passes — every existing test that doesn't pass an explicit `dim` gets 768 and works exactly as before. Positive observable: a new integration assertion in `tests/integration/dim-default.test.ts` opens a default-config DB and queries `SELECT sql FROM sqlite_master WHERE name = 'vec_windows'`; the returned DDL string contains `float[768]` (proves the default-768 path was actually exercised, not a no-op pass-through).
  - [ ] Custom-dim happy path: a new unit test at `tests/embedder/dim-parameterization.test.ts` creates `PristineLocal.create({ embedder: { engine: 'local', model: '<test-model>', dim: 1024 } })`, verifies the resulting `vec_windows` DDL contains `float[1024]` (via `SELECT sql FROM sqlite_master`), and a `storeAsync` → `searcher.vectorSearch` round-trip succeeds.
  - [ ] Mismatch error path (embed): configure `dim=1024` with an embedder that produces 768; assert `embed()` throws `InvalidArgumentError` with both dims named in the message.
  - [ ] **Mismatch error path (searcher across pre-existing corpus):** seed a DB with `vec_windows` created at `dim=768` (use the default-config path to seed real rows), then re-instantiate `PristineLocal.create({ embedder: { engine: 'local', model: '...', dim: 1024 } })` against the same DB file and call `searcher.vectorSearch`. Assert `InvalidArgumentError` (or a clearly-named subclass) is thrown with both expected (1024) and actual (768) dims named in the message — proves the documented "consumer who later changes dim must hit a clear runtime error" behavior from AC-6.
  - [ ] DDL injection guard: configure `dim` as `'768; DROP TABLE messages;--' as any` (TS bypass); assert `InvalidArgumentError` is thrown before any DDL is built.
  - [ ] Dim out-of-range: `dim=63` and `dim=4097` both throw `InvalidArgumentError`.
- **Regression verification:**
  - [ ] `npm run test:unit` — exit 0; no `Embedder`-interface or `searcher` tests broke.
  - [ ] `npm run test:integration` — exit 0; `searcher-sql.test.ts`, `storeasync.test.ts`, `client.test.ts`, etc. all pass with the default-768 path.
  - [ ] `bash .checks/pre-merge.sh` — exit 0.
  - [ ] **Public-barrel diff:** `git diff main..HEAD -- src/index.ts` shows zero new exports and zero removed exports (the `dim` field is exposed via the existing `EmbedderConfig` re-export — no new symbol).
- **Manual-only verification:** N/A — fully automatable.
- **Planned commits:**
  1. `feat(embedder): add optional dim field to EmbedderConfig (default 768) + per-instance dim validation`
  2. `feat(storage): template vec_windows + vec_sessions DDL by configured dim with bounds-validated integer guard`
  3. `refactor(searcher): read dim from deps, drop VEC_DIM and EXPECTED_DIMENSION constants`
  4. `test(embedder): unit + integration tests for dim parameterization (default 768, custom 1024, mismatch + injection-guard error paths)`
- **Technical notes:** Story 0 is the foundational architectural change that unblocks the modularization invariant for Stories 1-5. Without it, Story 5's "default-swap" would be a string-constant edit on a hardcoded dim, and any future candidate at dim ≠ 768 would require a follow-up sprint. With it, default-swap becomes a config-default change and any future dim-aware candidate slots in via existing config. **Why 768 as default**: the highest CoIR scorer in the candidate trio (`gte-modernbert-base`) is fixed at 768 (not MRL-trained); the two MRL-trained Ollama candidates truncate to 768 with 1-3% loss (within bootstrap CI noise). Picking 1024 would exclude the best CoIR candidate; picking 768 keeps all three runnable and is 33% cheaper per cosine. Document this rationale in the default-config site comment (per AC-5). Cross-dim migration is explicitly deferred — `vec0` virtual tables do not support `ALTER`, so a dim change requires `DROP + CREATE` + corpus rebuild; a follow-up sprint will ship a migration tool when a real consumer needs it. **Bounds rationale (AC-2)**: 64 rejects single-byte-aligned absurdities (no practical embedder ships <64-d) and 4096 covers all current open-weight embedder native dims (`text-embedding-3-large` is 3072) plus headroom; revisit if a candidate ships >4096. **Story 0 baseline sha capture (cross-story dependency for Story 5 AC-9):** when this story's PR merges into `sprint-017`, the maintainer immediately runs `git rev-parse origin/sprint-017` and pastes the resulting sha into the `### Story 0 baseline sha` section of this sprint doc, along with a verbatim copy of the post-Story-0 `EmbedderConfig` TS signature from `src/embedder/index.ts`. Both must land before Story 1 opens, so Story 5's audit (which executes much later) has a stable baseline to diff against.

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
- **Dependencies:** Stories 0 + 1. Story 0's parameterized `dim` is what `EmbedderConfig` consumers (including the harness) pass in for storage compatibility. **Truncation path for Qwen3 (locked):** the harness wrapper passes `dim=768` to `EmbedderConfig` (so `vec_windows` is created at 768) but the underlying Ollama `/api/embed` call returns the model's native 1024-d vector — Ollama's API does not accept a per-call truncation parameter. The wrapper performs the `[0:768]` slice and L2-renormalization on the 1024-d response **before** the vector reaches storage. This wrapper is the ONLY place the slice happens; neither `OllamaEmbedder` nor the storage layer mutates the vector.
- **Acceptance criteria:**
  - [ ] **Labelled set: 50 queries minimum** (smaller bootstrap chosen at sprint planning per PR #172 methodology doc; expandable to 200 in a follow-up sprint if needed). 50 is the floor at which a paired-bootstrap 95% CI is expected to resolve a Δ NDCG@10 of ≥0.03 (per `docs/research/embedder-evaluation-methodology-2026.md` §power-analysis); deltas <0.02 are expected to surface as overlapping CIs and route to inconclusive-result handling in Story 4. Stored as `tests/integration/embedder-eval/queries.jsonl` — one JSON object per line with `{ id, query, relevant_doc_ids: string[], grade: 'pessimistic'|'typical'|'optimistic' }`. ≥15 queries per grade-bucket.
  - [ ] **Corpus: synthesized + sanitized.** `tests/integration/embedder-eval/corpus.jsonl` — one JSON object per line with `{ id, content, role, conversation_id, project_id }`. Seeded by replaying real Pristine session logs (the maintainer's own; not a colleague's), paraphrased into the 3 grade-buckets via LLM, **passed through `secureAndRedact` before commit** so PII / secrets do not land in the repo. Document in the doc header how the corpus was generated and how to regenerate it.
  - [ ] **Single-judge labels with human-curated seed.** Maintainer (Lou) hand-judges exactly 18 query/document pairs as the human seed. An LLM judge (Claude Sonnet) scores the remaining 32 pairs against the same rubric; the maintainer spot-checks ≥10 LLM-judged labels (i.e., ~31% of the LLM set) and corrects disagreements. Pass condition: ≥80% raw agreement on the spot-check (Cohen's κ on n<10 has very wide CIs and can swing on a single label flip; raw agreement is more robust at this sample size). Record the spot-check sample, agreement %, and any corrections in `tests/integration/embedder-eval/labelling-notes.md`.
  - [ ] **`runEval(embedderConfig, options)` TS function** at `tests/integration/embedder-eval/run-eval.ts` — takes an `EmbedderConfig` (the existing factory shape from `src/embedder/index.ts`), runs the labelled queries against the configured embedder, returns `{ ndcg10, recall5, recall10, recall20, mrr, p50LatencyMs, p95LatencyMs, dimUsed }` plus paired-bootstrap CIs (1000 resamples) for each retrieval metric.
  - [ ] **Two configurations per candidate:** `dense-only` (embedder + cosine search, FTS5 disabled) and `hybrid` (embedder + FTS5 + RRF — Pristine's production retriever path). Report both.
  - [ ] **CLI:** `npm run eval:embedder -- --candidate <name> --baseline nomic-v1.5` produces a markdown report at `docs/research/embedder-eval-runs/<timestamp>-<candidate>-vs-baseline.md` with both configurations' numbers, deltas with CIs, and a one-paragraph summary.
  - [ ] **Sanity-check script:** `tests/integration/embedder-eval/mteb-sanity.ts` runs the harness on `BEIR/scifact` test split using `nomic-embed-text-v1.5` (the SDK's current default model — guaranteed loadable). Reference: a Python `mteb` v1.x snapshot of the same model + dataset's NDCG@10 captured to `tests/integration/embedder-eval/fixtures/mteb-reference.json` with **1000 bootstrap resamples** + the resulting paired-bootstrap 95% CI. The TS harness's NDCG@10 paired-bootstrap CI must overlap the reference CI; non-overlap surfaces a harness bug.
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
  - [ ] `OllamaEmbedder` smoke-test for `embeddinggemma:300m`: POSTs to `/api/embed`, validates response shape + length 768. Test header documents `ollama pull embeddinggemma:300m` as a manual prerequisite; the test does NOT auto-pull and exits with a clear error message ("model not found locally; run `ollama pull embeddinggemma:300m` first") if the model is absent. Test lives at `tests/embedder/ollama-embeddinggemma.smoke.test.ts`. Skipped if `SKIP_SLOW_TESTS=1` OR if Ollama is not running on `localhost:11434`.
  - [ ] `OllamaEmbedder` smoke-test for `qwen3-embedding:0.6b`: same shape as above, asserts dim 1024 (Qwen3 native dim, NOT 768) — because `vec_windows.embedding` is `float[768]`, this candidate must be configured to truncate to 768 via Matryoshka. **Truncation lives in the Story 2 harness wrapper at `tests/integration/embedder-eval/wrappers/truncating-wrapper.ts`** (NOT inside `OllamaEmbedder`), to preserve the modularization invariant: no engine-class changes for new candidates. The wrapper takes the raw 1024-d vector from the `OllamaEmbedder.embed()` return, slices `[0:768]`, and L2-renormalizes per Matryoshka spec, then hands the 768-d vector to `runEval`'s storage path. The wrapper signature is documented in the harness recipe (`docs/research/embedder-eval-runs/recipes.md`); same `ollama pull qwen3-embedding:0.6b` manual-prerequisite pattern as above (test does NOT auto-pull).
  - [ ] `LocalEmbedder` capability-check for ModernBERT support in pinned `@huggingface/transformers` version: a smoke at `tests/embedder/transformers-capability.smoke.test.ts` imports `@huggingface/transformers` and asserts (a) `pipeline` is exported as a function, (b) `'feature-extraction'` is accepted by `pipeline()` without throwing, (c) the package version (read from `node_modules/@huggingface/transformers/package.json`) is `>=3.2.1`. Document the minimum version (v3.2.1+) in `package.json` engines / docs.
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
  - [ ] Latency: p50/p95/p99 wall-clock per embed at batch=1 warm, captured per candidate. **Cold-start defined as: the first 10 `embed()` calls after the process starts and the model is loaded into memory (for `LocalEmbedder`) OR after the first successful `/api/embed` POST returns 200 (for `OllamaEmbedder`).** These 10 timing samples are recorded in the run log but excluded from p50/p95/p99 aggregation. For the Ollama candidates, BOTH "model compute" (subtract RPC baseline) AND "end-to-end" numbers reported. Sanity check: if the first 10 calls' p50 is within 10% of the post-warmup p50 (warmup didn't matter), record the observation in the run log — not a failure but flagged for harness tuning in a follow-up.
  - [ ] **A summary table** at `docs/research/embedder-eval-runs/SUMMARY.md` collects all 4 runs into one comparison view: rows = candidates, columns = NDCG@10 (dense / hybrid), Recall@10 (dense / hybrid), MRR, p50 latency, p95 latency, dim used, license. License strings come verbatim from `docs/research/embedder-landscape-2026.md`'s license commentary, using the SPDX identifier where available (e.g., `Apache-2.0`, not `Apache 2.0`). CIs annotated where overlap with baseline.
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
  - [ ] Story is small enough to review and merge independently
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
  - **Conditional SDK default-config change deliverable (modularization invariant: shape unchanged from Story 0 baseline):**
    - [ ] **Decision rule (locked):** the SDK default-config change fires iff (a) the candidate is **in-process** (excludes Ollama candidates from eligibility because the SDK no-config default must not require a sidecar daemon), AND (b) the candidate's **dense-only** NDCG@10 paired bootstrap 95% CI lower bound is **strictly greater than** Nomic v1.5's dense-only NDCG@10 paired bootstrap 95% CI upper bound (operational test: `candidate.ndcg10.dense.ci_lower > nomic.ndcg10.dense.ci_upper`). The operational input is the **pooled** (across grade-buckets) dense-only NDCG@10 reported in SUMMARY.md's headline column; per-grade-bucket CIs are informational only and do NOT trigger the rule. Tie or overlap → no change. The only Story 4 candidate that meets eligibility (a) is `gte-modernbert-base`; the two Ollama candidates (`embeddinggemma:300m`, `qwen3-embedding:0.6b`) are recommendation-only, never SDK default. If the rule fires, change the **default `EmbedderConfig` value** in `src/client.ts` from `{ engine: 'local', model: 'nomic-embed-text-v1.5', dim: 768 }` to `{ engine: 'local', model: 'gte-modernbert-base', dim: 768 }`. If the rule does NOT fire, keep Nomic v1.5 as the SDK fallback; the docs still recommend the candidate but consumers must opt in via explicit config. Document the decision + which arm of the rule fired in the Story 5 PR body.
    - [ ] **Implementation constraint — config-value change only, no shape change.** The default-config change edits ONLY:
      - the default `EmbedderConfig` literal in `src/client.ts` (the value `PristineLocal.create({})` falls back to)
      - any per-engine default-model documentation comment that names the old default
      - it MUST NOT touch `src/core/interfaces.ts:Embedder`, `src/embedder/index.ts:EmbedderConfig` *shape* (Story 0 already added `dim`; Story 5 only changes the *value*), the engine factory dispatch, or the public `Embedder.embed` / `embedBatch` signatures. A reviewer checks the diff against the **post-Story-0 baseline** (the merge-commit sha of Story 0 into `sprint-017`): a clean default-config change touches ≤2 files (`src/client.ts` + optional doc comment) and 0 lines of public-API surface.
    - [ ] **Backward compat path documented.** If the SDK default-config changes, document in the Story 5 PR body: (a) consumers who explicitly passed `engine: 'local', model: 'nomic-embed-text-v1.5'` get unchanged behavior (Nomic still loads on request); (b) consumers with no `embedder` config in `PristineLocal.create` get the new default model on first run; (c) **existing on-disk corpora embedded with Nomic v1.5 are NOT auto-migrated** — switching the default does not silently re-embed historical messages with a different model. The `vec_windows` table will contain mixed-model embeddings if a consumer's old corpus was Nomic-embedded and new ingests use the new default. (Story 0 already documented that cross-`dim` migration is unsupported; Story 5 documents the cross-`model` mixed-embedding case.) Story 5 surfaces both compat notes in a `## Known compat notes` heading and points at a follow-up sprint for any consumer-facing migration tool.
    - [ ] **Recommendations doc Tier 1 wording aligns with the SDK default decision.** If the rule fired, Tier 1 says "Pristine ships this as the no-config default; you don't need to pass an `embedder` config to get it." If the rule did NOT fire (CIs overlapped), Tier 1 says "We recommend this; pass it explicitly via `PristineLocal.create({ embedder: ... })`. The SDK fallback remains Nomic v1.5 for backward compat."
- **Functional verification:**
  - [ ] `grep -nE "embeddinggemma:300m|qwen3-embedding:0.6b|gte-modernbert-base" docs/conventions/embedder-selection.md` returns ≥3 hits across the candidate trio.
  - [ ] `grep -n "docs/conventions/embedder-selection.md" docs/specs/implementation-spec-005.md` returns ≥1 hit (the cross-link from §5.3).
  - [ ] Every recommendation row in the doc cites a SUMMARY.md anchor.
  - [ ] If the SDK default-config changed: **modularization-invariant audit** — `STORY0_SHA` is read from the `### Story 0 baseline sha` section of this sprint doc (filled in by the maintainer when Story 0 PR merges into `sprint-017`; see Story 0 Tech notes). The audit asserts: `git log $STORY0_SHA..HEAD --oneline -- src/core/interfaces.ts src/embedder/index.ts src/index.ts` lists **zero commits attributable to Story 5's branch** (a benign doc-only commit on those files between Story 0's merge and Story 5's open is acceptable; what's prohibited is Story 5's own commits modifying these files). Additionally, the post-Story-5 `EmbedderConfig` TS signature in `src/embedder/index.ts` is byte-identical to the snapshot recorded in `### Story 0 baseline sha`. Together these prove Story 5 introduced no public-surface change.
  - [ ] If the SDK default-config changed: a fresh `PristineLocal.create({})` call with no embedder config produces an embedding via the new default model end-to-end (smoke test added at `tests/integration/embedder-default-swap.test.ts`, gated on the rule firing).
  - [ ] If the SDK default-config changed: **backward-compat behavioral test** at `tests/integration/embedder-mixed-model.test.ts` — open a DB with Nomic-v1.5-embedded `vec_windows` rows pre-seeded, instantiate `PristineLocal.create({})` with no embedder config (gets the new default), call `searcher.vectorSearch` for read and `storeAsync` for new ingest. Assert: (a) old rows' embedding bytes are byte-identical pre/post (no auto re-embed), (b) new rows are embedded with the new default model, (c) no migration log line / no schema change / no row rewrite occurs. Catches a future contributor sneaking in a "helpful" auto-migration that violates the documented compat contract.
- **Regression verification:**
  - [ ] `npm run test:unit` — exit 0; no Embedder-interface tests broke.
  - [ ] `npm run test:integration` — exit 0; existing tests that explicitly pass an `embedder` config (most do, including all of `searcher-sql.test.ts`, `storeasync.test.ts`, etc.) are unaffected.
  - [ ] `bash .checks/pre-merge.sh` — exit 0.
- **Manual-only verification:**
  - Maintainer reads the doc end-to-end as if they were a new consumer, validates the copy-pasteable `EmbedderConfig` recipes actually work via a 5-minute smoke (`storeAsync` → `searcher.hybridSearch` round-trip on a fresh DB). Pass condition: maintainer sign-off in PR body.
- **Planned commits:**
  1. `docs(conventions): embedder-selection.md — default + alts with benchmark numbers`
  2. `docs(spec): cross-link implementation-spec-005 §5.3 to embedder-selection doc`
  3. *(conditional, only if Story 4 decision rule fires)* `feat(client): change default EmbedderConfig from nomic-v1.5 to <winning-candidate>` — value-only change in `src/client.ts`; zero public-interface changes (Story 0 already absorbed the `dim` field addition)
  4. *(conditional, only if SDK default-config changed)* `test(embedder): smoke + mixed-model behavioral tests for the new no-config default`
- **Technical notes:** This story is the consumer-facing payoff for the whole sprint. Recommendation order: **(1) impatient default, (2) license-clean alt if Gemma TOS is a problem, (3) zero-deps in-process alt if no Ollama, (4) code-only escape hatch (`nomic-embed-code` for >70% code corpora).** The conditional SDK default-config change is the only production-code change in Stories 1-5 — and only fires if Story 4's CIs are non-overlapping. **Why it's a config-value change, not a string-constant edit:** Story 0 already templated the storage by `dim` and surfaced `EmbedderConfig` as the single source of truth for engine + model + dim; Story 5 only flips the default literal. The modularization invariant (no shape changes to `Embedder` or `EmbedderConfig` after Story 0 lands) is the load-bearing review check; the post-Story-0-baseline diff-stat constraint (`zero changes` to `interfaces.ts` + `embedder/index.ts` + `src/index.ts`) is what makes it auditable. Document any bumped `@huggingface/transformers` minimum version in `package.json` if the new default model requires it.

#### Final Verification Story: Sprint Verification & Completion

- **Story Checklist:**
  - [ ] Uses the story sections above and the existing regression suite as the source of truth
  - [ ] Defines where final verification evidence will be recorded
  - [ ] Includes full regression verification, not only areas believed to be touched
  - [ ] Ready for Lou
- **As a** maintainer, **I want** all sprint functional verification + targeted regression + the full available regression suite run, **so that** sprint integration ships with evidence that new behavior works and existing behavior did not regress.
- **Dependencies:** All implementation stories (0-5).
- **Acceptance criteria:**
  - [ ] Every story's AC is evaluated against implementation evidence.
  - [ ] Every story's FV checkbox is run / checked / explicitly marked failed/ambiguous/unrun. **Conditional FV items** (Story 5's `embedder-default-swap.test.ts` + `embedder-mixed-model.test.ts`) are recorded as `fired / pass`, `fired / fail`, or `did-not-fire` — never silently skipped.
  - [ ] **Targeted regression verification checkboxes** from each story's Regression verification section are run / checked / explicitly marked failed/ambiguous/unrun, separately from the full-suite run below.
  - [ ] Full regression suite runs: `npm run test:unit`, `SKIP_SLOW=1 npm run test:integration`, `SKIP_SLOW=0 npm run test:integration` (real Nomic), `npm run test:e2e`, `npx tsx scripts/smoke-indexer.ts`, `bash .checks/pre-merge.sh` — all exit 0.
  - [ ] Failed / ambiguous / unrun verification items documented in `## Final Review`.
  - [ ] **The sprint's new functional verification is identified as future regression verification** — Story 0's dim-parameterization tests, Story 2's eval-harness regression test (self-vs-self), Story 3's three smoke-tests, and Story 5's conditional default-config-change + mixed-model integration tests are flagged in `## Final Review` for inclusion in the next sprint's regression suite.
  - [ ] **Verification delta is reported by full canonical type** showing all 11 canonical rows (Unit / Integration-contract / E2E-smoke / Simulator-device / AI-model-evals / Static-local-checks / Performance-load / Security-dependency / Accessibility-visual / Manual-only / Other), with five columns each: before sprint, added this sprint, removed, pending/not yet run, after sprint totals. Zero-count rows are populated as `0 → 0` (e.g., Simulator/device, Accessibility/visual this sprint). Story 4's eval reports populate the **AI / model evals** row; Story 4's latency captures populate **Performance / load**.
  - [ ] **Story 0 baseline sha re-recorded** in `## Final Review` for the durable audit copy (transcribed from the `### Story 0 baseline sha` section).
  - [ ] Sprint-doc Status flipped to `🟢 Complete` only if completion criteria met.
  - [ ] `## Final Review` section appended per `workflow-prompts/handle-sprint-completion.md` template (Mergeability + objective + accomplishments + verification delta table + why ready + open for decision + delivered + drift + dependencies).
- **Functional verification:**
  - [ ] All Story 1-5 FV items reported pass/fail in `## Final Review`.
- **Regression verification:**
  - [ ] All 6 commands above exit 0; logged in `## Final Review`.
- **Manual-only verification:** Story 5's maintainer-read-as-consumer smoke (link to evidence in `## Final Review`).
- **Planned commits:**
  1. `docs(sprint-017): final verification evidence + Status → 🟢 Complete + ## Final Review section`
- **Technical notes:** Use the story sections + existing regression suite as the source of truth. Do not duplicate AC/verification items here; run them, reference the evidence, compute the verification delta table, append `## Final Review`. Use `workflow-prompts/handle-sprint-completion.md` for the final completion message shape. **Conditional-test handling:** Story 5's `embedder-default-swap.test.ts` and `embedder-mixed-model.test.ts` exist iff Story 4's decision rule fired. Mark each conditional item as "fired/not-fired" in `## Final Review` so the verification delta table is unambiguous (an item that didn't need to exist isn't the same as an item that was skipped). **Story 0 sha capture:** record the merge-commit sha of Story 0 into `sprint-017` in `## Final Review` — Story 5's modularization-invariant audit uses this sha as the diff baseline.

### Rules
- **Sprint-branch setup:** create `sprint-017` off `main` after this sprint-doc revision PR (#TBD) merges. Commit this revised sprint doc as the first commit on the branch. Story branches fork from `sprint-017`; story PRs target `sprint-017`. After Final Verification merges, open the sprint-integration PR (`sprint-017 → main`).
- Sequentially execute stories. No parallel work.
- **Review loop:** open PRs, run `/review`, address findings, re-verify via `/review-fix` (capped at 3 passes). Confirm local checks green + last review turn ≥ 4/5 with no open P0/P1. Merge into `sprint-017`, then next story.
- Record new dependencies in `## Final Review`. **Story 4 will pull candidate model files via Hugging Face Hub / Ollama on first use — those are NOT new npm dependencies, just runtime weight downloads. No new npm deps expected this sprint.**
- For everything else — commits, PR process, code quality, testing — follow AGENTS.md.

### Definition of Done
- All implementation stories (0-5) pass acceptance criteria
- AGENTS.md conventions satisfied (code quality, tests, PR process, conventional commits, local checks green, last review turn ≥4/5 with no open P0/P1)
- Final Verification Story complete; `## Final Review` appended
- Sprint-integration PR (`sprint-017 → main`) reviewed, gates passed, awaiting / merged on user command
- `EmbedderConfig.dim` field exists with default 768; `vec_windows` + `vec_sessions` DDL templated by configured dim
- `docs/conventions/embedder-selection.md` exists; cross-linked from `implementation-spec-005.md` §5.3
- All 4 candidate eval-run reports exist under `docs/research/embedder-eval-runs/` plus the SUMMARY.md cross-comparison
- `## Final Review` includes verification delta table by canonical type (unit / integration / e2e / smoke / static / manual) with all 5 columns populated, plus the Story 0 merge-commit sha (used as Story 5's modularization-invariant audit baseline)

---

## Final Review

*(Filled in at sprint close per `workflow-prompts/handle-sprint-completion.md`.)*
