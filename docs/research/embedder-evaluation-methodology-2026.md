# Embedder Evaluation Methodology — 2026

**Status:** Research artifact for sprint-017 Story 2 (the measurement harness)
**Date:** 2026-05-02
**Method:** Single-pass general-research-agent dispatch (`general-research` sub-agent), scoped to local-CPU + developer-memory-retrieval + hybrid-stack eval
**Companion:** [`embedder-landscape-2026.md`](./embedder-landscape-2026.md) — candidate shortlist this harness will benchmark

This document is the methodology input for sprint-017 Story 2. The Story-2 deliverable is a labelled query set + scoring metric that lets us pick between candidate embedders on actual Pristine corpus data, not on leaderboard scores. Story 4 (the spike) consumes this harness to head-to-head benchmark the Track A and Track B picks against the Nomic v1.5 baseline.

## TL;DR

**Build a 200-query labelled set seeded from real Pristine session logs**, label it via a 3-judge LLM ensemble calibrated against a 30-50-query human-judged seed, and score each candidate model on **NDCG@10 (primary)**, **Recall@5/10/20**, and **MRR (secondary)** with **paired bootstrap 95% CIs (1000 resamples)**. Run the harness in **two configurations** — `dense-only` and `dense+FTS5+RRF` — and report deltas. Use a **custom TypeScript harness** in the SDK (matching the production retriever path), with a one-off Python `mteb` sanity check on a public small dataset (e.g., NFCorpus) as a harness-correctness regression test. The single biggest pitfall to avoid: **trusting any single number — leaderboard rank, single-eval NDCG, or small-N eval — at the third decimal**. If two candidates' NDCG@10 CIs overlap, the comparison is *inconclusive on quality* and the decision falls to latency/size — that is the correct outcome, not a fake winner.

## 1. Standard eval frameworks (what serious teams use in 2026)

- **MTEB / MMTEB / MTEB v2.** De-facto leaderboard. MTEB v2 (Oct 2025) added a unified `mteb.evaluate(model, tasks)` API and `ResultCache` for offline+remote caching. MMTEB (Feb 2025) extended to 500+ tasks across 250+ languages with explicit "long-document retrieval" and "code retrieval" task categories. Run locally if you want results comparable to leaderboards; expect cost dominated by encoding the corpus (BEIR retrieval splits alone are ~50M+ passages aggregated).
- **BEIR.** Subsumed under MTEB v2 as the 18-dataset retrieval slice. v2.2.0 (Jun 2025) added multi-GPU HF support, an `encode_and_retrieve` flow that pickles embeddings for reuse, and vLLM/LoRA evaluation. **NDCG@10 remains the headline metric.**
- **CoIR (Code Information Retrieval).** Closest public benchmark to "code-aware retrieval": 10 datasets, 8 retrieval tasks, 7 domains, schema-aligned with BEIR/MTEB. Python pip-installable. The CoIR paper explicitly notes that even SOTA models struggle on code retrieval — **do not assume MTEB-English ranks transfer**.
- **Domain-custom benchmarks.** Now the **recommended primary signal for production decisions**. Algolia (Feb 2025) showed top MTEB performers do not reliably win on domain-specific data. Vespa's LLM-as-judge pipeline (2024) is the canonical open-source template: human-judge a small seed → calibrate LLM judge against humans → scale judgments via the LLM judge. Red Hat's SDG Hub (Feb 2026) is a newer synthetic-QA-context generator.
- **RAG-specific evals (RAGAS, TruLens, DeepEval, ARES).** Measure end-to-end pipeline quality (faithfulness, answer relevance, context precision, context recall). They are **not embedder-layer evaluators** — `context_precision` and `context_recall` *are* downstream proxies for retrieval quality, but they require an LLM in the loop and add cost + variance. **Use these for Story 4's end-to-end evals, not Story 2's harness.**

## 2. Metrics that matter for memory retrieval

For a labelled query → relevant-message mapping with an LLM-context-injection consumer:

| Metric | Use | Why |
|---|---|---|
| **NDCG@10** | Primary | Rewards graded relevance and rank position. With binary labels NDCG saturates and loses discriminative power between top models — graded labels (0-10 from multi-judge ensemble) restore it (per ZeroEntropy's March 2026 work on graded MTEB). |
| **Recall@K** at K=5, 10, 20 | Primary secondary | "Did the right context end up in the top-K we inject" is the operational question for an LLM consumer. Track multiple Ks because the K injected depends on context budget. |
| **MRR (Mean Reciprocal Rank)** | Secondary | Useful when there's typically one correct answer and rank-1 vs rank-3 matters for token efficiency. Cited as load-bearing by Vespa and the LongMemEval community. |
| Precision@1 | Sanity check | Only useful if the consumer takes a single result; for context-injection RAG it's noisy. |
| Hit Rate / Recall@1 | Sanity check | Too coarse for model selection. |

**Correlation with downstream LLM success.** No clean published study showing one retrieval metric strictly dominates as a predictor of LLM-task success. Pragmatic consensus: NDCG@10 + Recall@K give ranking + coverage; pair them with end-to-end RAGAS scores in Story 4 for the final pick.

## 3. Building a labelled set for a developer-memory corpus

### Sample size

The April 2026 power-analysis paper (`clawrxiv:2604.01075`) is unambiguous:

| Sample N | Power to detect Δ NDCG@10 = 0.01 | Power to detect Δ NDCG@10 = 0.02 |
|---|---|---|
| 100 | 13% | 37% |
| 500 | ~80% | ≥95% |

For sprint-017's frontier (gte-modernbert-base vs nomic-embed-text-v1.5 vs qwen3-embedding:0.6b vs embeddinggemma:300m), expected in-domain deltas are **0.02-0.05** (larger than leaderboard-frontier comparisons). **150-300 labelled queries is therefore discriminative**; under 100 is statistically unsupported.

### Query generation

**Replay from real session logs > human-authored > LLM-synthesized from scratch.** Synthetic queries are scalable but the dominant failure modes are:

1. **Circularity** — the LLM judge derives criteria from the same model that generated the queries.
2. **Coverage gaps** — synthetic queries cluster around the seed prompt's flavour, missing real query distributions.

Recommended pattern (per IBM EvalAssist + Red Hat SDG Hub guidance):

1. **Seed with real user queries** from existing Pristine usage logs.
2. **Paraphrase + stress-test via LLM**: for each seed query, generate 3 paraphrases (pessimistic / typical / optimistic phrasing) — this gives ~3× expansion on a known-coverage base, not invention from a blank slate.
3. **Redact PII** before the eval set leaves a developer's machine. Pristine's own sanitizer (`secureAndRedact`) is the right tool — pass every seed query through it before label generation.

### Relevance labels

Human-pooled is gold but expensive. **Vespa's pipeline is the practical compromise:**

1. **Human-judge a small seed set (50-100 query/document pairs).** Two annotators minimum, resolve disagreements.
2. **Validate that an LLM judge agrees with humans** on the seed (Cohen's κ or Pearson correlation; ZeroEntropy reports r ≈ 0.7-0.8 across three judges).
3. **Scale via LLM-as-judge with multi-judge ensemble** (e.g., Claude / GPT / Gemini in parallel) to mitigate single-model bias.

**Known LLM-judge biases to mitigate explicitly:**

- **Position bias** — randomize document order before judging.
- **Verbosity bias** — judges prefer longer responses; normalize doc length or use length-controlled prompts.
- **Self/family-model bias** — single-family judges score same-family generations higher.
- **Agreeableness bias** — high TPR, low TNR on open-ended evals (the "Beyond Consensus" paper shows minority-veto ensembles outperform majority voting under this bias).

### Sliding-window-message corpora (the Pristine shape)

A specific gotcha: **near-duplicates across overlapping windows**. Adjacent message-windows share 60-80% of their content (windowSize=3 with overlap=1 means each message appears in ~3 windows). The LongMemEval critique flags this directly:

- **K-sensitivity inflated**: Recall@10 looks great because near-duplicate windows fill K with redundant content.
- **Mitigation**: dedupe within a session-context boundary at label-time. Report **Recall@1 alongside Recall@10** to expose K-inflation — if Recall@10 is high but Recall@1 is much lower, the model is finding the right *neighbourhood* but not the right *window*.

## 4. Latency / size benchmarking

### CPU embed latency

- Report **p50/p95/p99 wall-clock per embed** at:
  - **batch=1 warm** — the write-time path; this is the user-facing number.
  - **batch=8 / batch=32 warm** — the backfill / reindex path; matters for migration UX.
- **Discard the first 5-10 calls** (cold start: tokenizer JIT, weight-load, BLAS warm-up).
- Snowflake's analysis: for small embedders, **~90% of CPU time is tokenization + serialization**, not matmul. A fair benchmark must include these steps end-to-end, not just `model.encode()` time.

### Matryoshka quality-vs-dim sweep

For Matryoshka-trained models (gte-modernbert-base full=768, embeddinggemma full=768, qwen3-embedding 32-1024):

1. Measure NDCG@10 at full dim.
2. Measure NDCG@10 at 512, 256, 128 with the same eval set.
3. Plot quality vs dim; pick the smallest dim where quality CI overlaps full-dim CI.
4. **Always renormalize after truncation** (per Matryoshka paper convention).
5. **Do not trust model-card claims of "99% quality preserved at 256d"** — Joe Sack's 2026 experiment showed STS-preserved quality does *not* imply retrieval-rank stability (only 57% of top-10 results matched 768d at 256d). **Empirical NDCG@10 on your data is the only authoritative answer.**

### In-process (transformers.js) vs Ollama HTTP fairness

- Subtract HTTP+JSON round-trip overhead from Ollama by measuring an empty/warm `/api/embed` echo round-trip; report Ollama latency as `total - rpc_baseline` for **model-compute** comparisons.
- For **user-facing** numbers, **do not subtract** — the RPC cost is real to a consumer.
- **Report both numbers**: "model compute" (apples-to-apples) and "end-to-end" (deployment-realistic).

### Size on disk

Report three numbers per candidate:

1. **Raw weight file bytes** (FP32 / FP16 / Q8 / Q4 — different ONNX vs GGUF vs Safetensors footprints).
2. **Effective RAM-resident footprint** (different for ONNX-quantized vs FP16 vs Q4_K_M GGUF).
3. **Per-vector storage cost** = `dim × bytes_per_scalar × n_messages` — this is what scales with corpus growth.

Vespa's quantization study: INT8 on CPU = 2.7-3.4× speedup with 94-98% quality retention; bfloat16 = ~2× storage reduction with negligible quality loss. **Worth a column in the harness output.**

## 5. Hybrid-retrieval eval

Pristine fuses dense + FTS5 + session-vector RRF. **Evaluate both isolated and hybrid; report the delta.**

### Isolated dense-only eval

Answers "did the embedder improve". Use the same labelled set with FTS5 disabled and RRF off. **This is the model-selection question for Story 4** — if the embedder doesn't improve in isolation, no amount of fusion will rescue it.

### Hybrid stack eval

Answers "does the embedder improvement survive fusion". Sometimes a stronger embedder is *masked* by FTS5 carrying recall on lexical-match queries (SurePrompts, koray-kaya benchmark). Report 4 rows per candidate model:

| Configuration | What it isolates |
|---|---|
| `dense-only` | The embedder in isolation. |
| `BM25-only` (FTS5) | Constant baseline; should be identical across candidates. |
| `RRF-fused` (dense + FTS5 + session-vec) | Production retriever output. |
| `RRF + reranker` (if applicable) | Future cross-encoder lane (not yet in Pristine). |

The `dense-only` row isolates the embedder; `RRF-fused − BM25-only` quantifies the embedder's marginal contribution to the production stack.

### Reference implementations to copy

- **BEIR's `encode_and_retrieve` flow** (v2.2.0+) — cleanest "encode once, search many configurations" pattern.
- **elinor (Rust)** — cleanest paired bootstrap + Wilcoxon + effect size CLI for IR eval.
- **Vespa LLM-as-judge pipeline** — canonical methodology for scaling labels from a small human seed.
- **ZeroEntropy graded MTEB** — public dataset of graded relabels; forcing function for what graded labels look like.
- **LongMemEval MTEB issue #4415** (April 2026, in-progress) — directly relevant template for formatting conversation-memory retrieval as an MTEB-compatible task.

## 6. Concrete recommendations for the sprint-017 harness

### Methodology recommendation (1 paragraph)

Build a 200-query labelled set seeded from real Pristine session logs (paraphrased into pessimistic/typical/optimistic forms via LLM, ~67 each), with relevance labels from a 3-judge LLM ensemble (Claude / GPT / Gemini) calibrated against a 30-50-query human-judged seed where κ ≥ 0.7. Score each candidate model on **NDCG@10 (primary)**, **Recall@5/10/20**, **MRR (secondary)** in two configurations — `dense-only` and `dense+FTS5+RRF` — and report each with **paired bootstrap 95% CIs (1000 resamples)** so model deltas are presented with uncertainty. Run latency benchmarks at batch=1 (warm) for p50/p95 reporting. For Matryoshka models, sweep dims at {128, 256, 512, full} on the same eval set.

### Build vs use existing

**Build a custom TypeScript harness in the SDK** rather than wiring up the Python `mteb` library. Reasons:

1. Pristine's hybrid retriever, FTS5 wiring, RRF fusion, and embed-write path all live in TS — running through them is the only honest measurement.
2. `mteb` would force re-implementing the BERT/Ollama backend dispatch already in the SDK.
3. The harness needs to live in CI to catch regressions when the embedder is swapped — it has to be in the project's test runner.

**Use Python `mteb` as a one-off sanity check** on a public small dataset (e.g., NFCorpus) — that's the harness-correctness regression test. If TS NDCG@10 disagrees with `mteb`'s NDCG@10 by more than the bootstrap CI on the same model + dataset, the TS harness has a bug.

### Reference templates worth reading before writing code

- BEIR `encode_and_retrieve` — encode-once-search-many pattern.
- elinor — paired bootstrap CI + Wilcoxon + effect size in a clean CLI.
- Vespa LLM-as-judge — label-scaling methodology.
- ZeroEntropy graded-MTEB dataset — graded label format.
- LongMemEval MTEB task (in-progress) — conversation-memory MTEB task shape.

### Single biggest pitfall to avoid

**Trusting any single number — leaderboard rank, single-eval NDCG, or small-N eval — at the third decimal.** The April 2026 power analysis is unambiguous: <500 instance benchmarks cannot reliably distinguish models that differ by 0.01-0.02. Report **deltas with confidence intervals**, not point ranks. **If two candidates' NDCG@10 CIs overlap, declare the comparison inconclusive on quality and decide on latency / size / license.** That is the correct outcome, not a fake winner.

## Where sources disagree

- **Whether retrieval metrics predict downstream LLM success.** Practitioner consensus (LlamaIndex, RAGAS authors, Maxim AI) says retrieval metrics are necessary but insufficient — you need end-to-end evals. Academic literature (Cisco whitepaper, Vespa) treats high NDCG/Recall as a strong predictor. **Reconciliation**: both right at different scales. NDCG/Recall predicts whether the right context is in K; only end-to-end evals predict whether the LLM uses it correctly. For Story 2 (model-selection between embedders), retrieval metrics suffice; for Story 4 (production decision), pair with RAGAS.
- **RRF vs alternative fusions.** TopK (July 2025) shows up to 7.8% NDCG@10 gain over RRF on BEIR using true-hybrid scoring. SurePrompts and most practitioners still recommend RRF as the robust default. **Reconciliation**: RRF is parameter-light and robust; weighted/true-hybrid wins when you can calibrate, but introduces tuning cost. For Pristine's existing RRF stack, this is not the sprint-017 fight.
- **Matryoshka quality preservation.** Model cards claim 99% quality at 256d. Empirical retrieval-overlap tests (Joe Sack 2026) show only 57% top-10 overlap at 256d vs 768d. **Reconciliation**: STS scores ≠ retrieval-rank stability. **Trust empirical NDCG@10 on your data, not the model card.**

## Confidence summary

**HIGH** on:
- Building a domain-custom labelled set is the correct primary approach.
- ≥500 instances needed to discriminate models at Δ ~0.01 NDCG; 100-200 sufficient at Δ ~0.03-0.05.
- NDCG@10 + Recall@K + MRR with paired bootstrap CIs is the right metric package.
- Hybrid eval requires both isolated and fused measurements with ablation rows.
- Matryoshka quality must be measured on your data, not trusted from model cards.

**MEDIUM** on:
- Which specific metric (NDCG vs Recall vs MRR) best predicts downstream LLM success — no published correlation study with statistical rigor.
- Single vs multi-judge LLM ensembles for label generation — multi-judge is more rigorous but 3× the cost; single-judge with human-calibrated seed is widely used and often acceptable.
- Sample size lower bound for Pristine's specific delta — the 500-instance number is for Δ ~0.01; a pilot run is needed to confirm.

**LOW** on:
- Which Track A / Track B candidate will actually win on conversation+code memory data. CoIR shows even SOTA models struggle on code retrieval; gte-modernbert-base, embeddinggemma:300m, and qwen3-embedding:0.6b have not been head-to-head benchmarked on developer-conversation corpora in any public source. **You will be the first to do this comparison; budget for empirical surprises.**

## Unknowns & limits

- **No published study correlates retrieval metric Δ with downstream LLM-task success Δ on developer-conversation data.**
- **No public benchmark numbers for the candidate trio on CoIR or any conversation-memory benchmark** as of 2026-05-02. Leaderboard ranks for these are MTEB-English-aggregate, which Algolia has shown does not transfer to specialized domains.
- **No clean methodology for fairly comparing in-process transformers.js vs Ollama HTTP latency.** Subtract-RPC-baseline is a defensible choice, not a published standard.
- **MTEB's LongMemEval task is in-progress** (issue #4415, April 2026) but not yet merged. If the sprint-017 timeline can wait, this would be the most directly relevant public benchmark to add to the harness; if not, treat the absence as motivation to build the custom set.
- **Real-message-PII and label-leakage in synthetic queries.** If real session logs seed queries, the labelled set may contain user secrets. **Redact via Pristine's own sanitizer before sharing the eval set** — bites the moment the harness leaves a single developer's machine.

## Sources

Primary references used in this brief (full citations + URLs in the dispatch transcript on the sprint-017 PR thread):

- Algolia 2025 — _Re-evaluating LLM Encoders for Semantic Search_
- Power-analysis paper (clawrxiv:2604.01075, April 2026) — sample-size guidance
- ZeroEntropy 2026-03 — graded MTEB methodology
- HF / Isaac Chung 2025-10 — MTEB v2 release
- BEIR v2.2.0 release notes 2025-06
- ACL 2025 — CoIR paper
- Vespa 2024-07 — LLM-as-judge pipeline
- Red Hat 2026-02 — synthetic data for RAG eval / SDG Hub
- IBM EMNLP 2025 — EvalAssist
- arXiv 2503.19092 — LLM-judge bias study
- arXiv 2510.11822 — minority-veto ensemble
- Vespa 2026-01 — embedding-tradeoffs-quantified (quantization + Matryoshka)
- Snowflake 2025-05 — Arctic 16× embedding inference (tokenization-dominant)
- Joe Sack 2026-01 — Matryoshka retrieval-overlap experiment
- TopK 2025-07 — Beyond RRF
- LongMemEval MTEB issue #4415 (April 2026, in-progress)
- elinor (kampersanda/elinor) — Rust IR-eval CLI

## Story-2 AC seed (for the sprint-017 author)

Based on this methodology, the Story-2 deliverable should be:

- [ ] `tests/integration/embedder-eval/` directory containing the harness.
- [ ] `tests/integration/embedder-eval/queries.jsonl` — 200 labelled queries (replay-seeded + LLM-paraphrased + ensemble-judged).
- [ ] `tests/integration/embedder-eval/corpus.jsonl` — the message corpus the queries are scored against.
- [ ] A `runEval(embedderConfig, options)` TypeScript function that returns `{ ndcg10, recall5, recall10, recall20, mrr, p50LatencyMs, p95LatencyMs }` per configuration (`dense-only` | `hybrid`).
- [ ] Paired bootstrap CIs (1000 resamples) reported with each metric.
- [ ] A Matryoshka-dim sweep helper for models that support it.
- [ ] A `npm run eval:embedder -- --candidate <name>` CLI that compares one candidate against the v1.5 baseline and emits a markdown report.
- [ ] A one-off sanity-check script that runs the harness on a small public dataset (NFCorpus) and compares against `mteb`'s output to validate scoring correctness.
