# Embedder eval harness

Maintainer-facing measurement harness for scoring any `Embedder` implementation on a labelled query set with retrieval-quality metrics + paired-bootstrap confidence intervals.

> *This is one way to measure embedder quality. You can write your own — the harness lives outside `src/` because it is not part of the SDK's public surface.*

## Layout

```
tests/integration/embedder-eval/
├── README.md                 ← you are here
├── types.ts                  ← shared shapes (EvalQuery, EvalDoc, EvalResult, etc.)
├── metrics.ts                ← NDCG@K, Recall@K, MRR, percentile (pure functions)
├── metrics.test.ts           ← unit tests for the math
├── bootstrap.ts              ← bootstrap CI + paired-bootstrap delta CI
├── bootstrap.test.ts         ← unit tests for the math
├── run-eval.ts               ← runEval(embedderConfig, options) — main entry
├── report.ts                 ← markdown report writer (pure)
├── cli.ts                    ← npm run eval:embedder entry
├── mteb-sanity.ts            ← (PHASE B) BEIR/scifact reference run
├── queries.jsonl             ← (PHASE B) labelled query set, ≥50 queries
├── corpus.jsonl              ← (PHASE B) synthesized corpus
├── labelling-notes.md        ← (PHASE B) rubric, model, deviation notes
└── fixtures/
    └── mteb-reference.json   ← (PHASE B) Python `mteb` snapshot
```

## Phase A (this PR): harness mechanics

What landed:

- **Metrics** (binary-relevance, no graded variants this sprint): NDCG@K, Recall@K, MRR. Percentile helper for latency p50/p95.
- **Bootstrap CIs**: nonparametric percentile bootstrap for the mean of a single sample, paired-bootstrap delta CI for two paired samples (1000 resamples default; deterministic via mulberry32 seeded PRNG).
- **runEval**: wires `EmbedderConfig` → SQLite + sqlite-vec DB + indexer + searcher; ingests the corpus, runs each query, returns per-query metrics + aggregate metrics with bootstrap CIs. Two retrieval modes: `dense-only` (vectorSearch) and `hybrid` (hybridSearch with RRF).
- **CLI**: `npm run eval:embedder -- --candidate <name> [--baseline nomic-v1.5]` produces a markdown report under `docs/research/embedder-eval-runs/`.
- **Unit tests** for metrics + bootstrap (33 tests, run as part of `npm run test:integration` because they live under `tests/integration/`; pure-function so no model weights are pulled).

## Phase B (next PR): labelled set + sanity fixture

Outstanding deliverables (out of scope for Phase A):

- `queries.jsonl` — 50 labelled queries across 3 grade-buckets (≥15 each). LLM-judged per the sprint-017 deviation note (no human seed/spot-check).
- `corpus.jsonl` — synthesized corpus from public-domain technical-conversation content, paraphrased into 3 buckets, passed through `secureAndRedact` before commit.
- `labelling-notes.md` — rubric + model + deviation notes.
- `mteb-sanity.ts` + `fixtures/mteb-reference.json` — runs the harness on BEIR/scifact and asserts NDCG@10 CI overlaps a Python `mteb` reference snapshot. Detects harness bugs; reference fixture is regenerated out-of-band via the Python `mteb` library.

## Running the harness

```bash
# Score a candidate against the baseline (both dense-only + hybrid)
npm run eval:embedder -- --candidate gte-modernbert-base

# Custom baseline
npm run eval:embedder -- --candidate qwen3-embedding --baseline nomic-v1.5

# Custom report directory
npm run eval:embedder -- --candidate embeddinggemma --reports-dir /tmp/reports
```

The CLI fails fast if the labelled set / corpus haven't shipped yet (Phase B requirement).

## Why the harness lives in `tests/integration/` not `src/`

This is a maintainer tool, not a consumer-facing API. Same pattern as `scripts/smoke-indexer.ts` — local-run binary, not part of the SDK surface. The eval pipeline tests don't run by default in `npm run test:integration` (the math tests do, since they're fast and pure-function). The full eval lane is `npm run eval:embedder`.
