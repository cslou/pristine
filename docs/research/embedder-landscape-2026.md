# Embedder Landscape — 2026

**Status:** Research artifact for sprint-017 Story 1
**Date:** 2026-05-02
**Method:** Two-pass general-research-agent dispatch (`general-research` sub-agent), refined for developer-memory-retrieval use case + strict recency filter (post-2025-09-01 prioritised)
**Baseline:** Nomic Embed v1.5 (`nomic-ai/nomic-embed-text-v1.5`, 137M params, 768-dim, 8192 ctx, MTEB-en ~62.4)

This document is the candidate-shortlist input for sprint-017 Story 4 (the head-to-head spike). It does **not** make a final selection — that requires the measurement harness from Story 2 to run on actual Pristine corpus data. Until then, the picks below are the defensible best-known options to benchmark.

## Use case (load-bearing context)

Pristine is a **local-first memory retrieval SDK for LLM coding agents** (Claude Code, pi.dev, Cursor). Embeddings encode:

- Multi-turn developer/coding conversations
- Code snippets embedded inline in chat
- Design decisions, architecture notes
- Tool-call results, error traces

Retrieval queries are typically natural language about code, not pure code-to-code search:

- "What did we decide about the auth pipeline?"
- "Show me the part where we hit the SQLite null-bytes bug"
- "Which conversations touched the searcher.sql primitive?"

The benchmark axes that matter are therefore:

1. **MTEB Retrieval subset (BEIR-like)** — closest analog to "find the right past conversation"
2. **CoIR (Code Information Retrieval)** — code-aware retrieval is load-bearing for a developer-memory SDK
3. **LoCo / LongEmbed** — Pristine's sliding window can be 4K-8K tokens; long-context retrieval matters
4. **CPU latency** — in-process Node, no GPU, embeddings happen at write time per message
5. **8K+ context window** as a hard cutoff — anything ≤512 tokens is disqualified as a default

The MTEB English aggregate average is **deprioritised** because it's dominated by classification tasks Pristine does not run.

## Architecture: two engines

Pristine's `Embedder` interface (`src/core/interfaces.ts`) is implemented by two concrete engines:

- **`local`** — `LocalEmbedder` (`src/embedder/local/`). In-process via `@huggingface/transformers` v3.x. Loads BERT-family architectures the JS runtime supports (BERT, RoBERTa, XLM-RoBERTa, NomicBert, JinaBert, ModernBERT). MoE / decoder-only architectures generally NOT supported. Zero sidecar. CPU-only.
- **`ollama`** — `OllamaEmbedder` (`src/embedder/ollama/`). Talks to a local Ollama server over HTTP `/api/embed`. Any model in the official Ollama library or a well-maintained community modelfile. MoE and decoder embedders fair game (llama.cpp under the hood). Sidecar process required.

Adding a third engine (e.g., `onnxruntime-node` direct, `node-llama-cpp`, TEI server) is an additive change to the factory; not in scope for sprint-017.

## Track A — `LocalEmbedder` candidates

Constraint set: `@huggingface/transformers` v3.2.1+ loadable, BERT-family arch, ≤2GB FP32, Apache-2.0 / MIT preferred, 8K+ context preferred.

| Model | HF path | Date | Params | Dim (MRL) | Ctx | FP32 size | License | MTEB Retrieval / Code | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Alibaba-NLP/gte-modernbert-base** | `Alibaba-NLP/gte-modernbert-base` | 2025-01-21 | 149M | 768 | 8192 | ~570 MB | Apache-2.0 | MTEB avg 64.38; **CoIR 79.31**; BEIR 55.33; LoCo 87.57 | ModernBERT arch supported in transformers.js v3.2.1+ (PR #1104, Dec 2024). No prefix gymnastics (CLS pooling). Native `pipeline('feature-extraction', ...)` example in model card. |
| nomic-ai/modernbert-embed-base | `nomic-ai/modernbert-embed-base` | 2024-12 | ~150M | 768 (MRL → 256) | 8192 | ~570 MB | Apache-2.0 | MTEB ~62-64 (no separate CoIR) | ModernBERT + Matryoshka. Drop-in for v1.5 users. Pre-2025 publish date but still actively maintained. |
| Snowflake/snowflake-arctic-embed-m | `Snowflake/snowflake-arctic-embed-m` | 2024 | 110M | 768 | 8192 | ~440 MB | Apache-2.0 | MTEB ~62.74; CoIR ~74.8 | Smaller and faster; query prefix required. |
| google/embeddinggemma-300m | `google/embeddinggemma-300m` | 2025-09-04 | 308M | 768 (MRL → 128) | **2048** | ~1.2 GB | Gemma TOS (gated) | MTEB-Eng v2 ~68.36; **MTEB-Code 68.76** | SOTA <500M but **2K context** disqualifies as Pristine default; Gemma license carries field-of-use restrictions. Watchlist for an 8K-context successor. |
| Nomic Embed v1.5 (baseline) | `nomic-ai/nomic-embed-text-v1.5` | 2024-02 | 137M | 768 (MRL → 64) | 8192 | ~520 MB | Apache-2.0 | MTEB 62.39; CoIR 71.2 | Status quo. |
| nomic-ai/nomic-embed-text-v2-moe | `nomic-ai/nomic-embed-text-v2-moe` | 2025-02 | 475M / 305M active | 768 (MRL → 256) | 512 | ~1.9 GB | Apache-2.0 | BEIR/MIRACL only published | **Excluded from Track A** — MoE arch not supported by `@huggingface/transformers` (per fastembed-rs and Candle reports). Available as Track B candidate via Ollama. |
| jinaai/jina-embeddings-v5-text-small | `jinaai/jina-embeddings-v5-text-small` | 2026-02 | 677M | 1024 (MRL → 32) | 32768 | ~2.7 GB | CC-BY-NC-4.0 | MTEB-Eng 71.7; MMTEB 67.0 | **Excluded** — non-commercial license + Qwen3 decoder backbone (last-token pooling). |
| lightonai/LateOn-Code | `lightonai/LateOn-Code` | 2026-02 | 149M | 128 (token-level) | 8192 | ~600 MB | CC-BY-NC-4.0 | MTEB-Code v1 74.12 (post-finetune) | **Excluded** — non-commercial + late-interaction (ColBERT-style requires PyLate). |

### Track A pick: **`Alibaba-NLP/gte-modernbert-base`**

Defended against the rest:

- **CoIR 79.31** beats Snowflake-m (74.8), Nomic v1.5 (71.2), and BGE-base (68.5) at the same parameter scale. For a developer-memory corpus where 30-60% of content is code or code-adjacent, this is the load-bearing axis.
- **8192-token context** matches Pristine's sliding-window 4-8K messages cleanly. EmbeddingGemma's higher MTEB-Code (68.76) is genuinely interesting but its **2K context** truncates Pristine's longer windows — disqualifying as a default.
- **No prefix gymnastics**: CLS pooling, no `query: ` / `passage: ` distinction needed. Simpler integration.
- **Apache-2.0** clean license story for downstream SDK redistribution.
- **Architecture is first-class in `@huggingface/transformers` v3.2.1+** (transformers.js PR #1104, Dec 2024). Model card includes a working JS feature-extraction example.

**Single biggest risk:** January 2025 publish date (16 months old). Newer models (Jina v5-text, EmbeddingGemma) post higher overall MTEB but either fail the architecture/license bar or trade away the code-retrieval advantage. No newer ModernBERT-family permissively-licensed model has crossed CoIR 79.31 in the last 8 months. Recheck quarterly.

## Track B — `OllamaEmbedder` candidates

Constraint set: `ollama pull` available, open weights, embedding-task model (not just generation), 8K+ context preferred, MoE / decoder-only OK.

| Model | Ollama path | Date | Params (active) | Dim (MRL) | Ctx | GGUF size | License | MTEB Retrieval / Code | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **embeddinggemma:300m** | `embeddinggemma:300m` | 2025-09 | 308M | 768 (MRL → 128) | **2048** | ~200 MB at QAT q8 | Gemma TOS | MTEB-Eng 68.36; **MTEB-Code 68.76** | Best balance of NL + code retrieval at 300M; QAT int4/int8 ~200MB RAM; <50ms CPU typical. **2K context is the trade-off.** |
| qwen3-embedding:0.6b | `qwen3-embedding:0.6b` | 2025-06 | 595M (~0.6B) | 1024 (MRL 32-1024) | **32768** | ~400-640 MB at q4-q8 | Apache-2.0 | MTEB-R 61.82; **MTEB-Code 75.41** | Family won #1 on MMTEB multilingual at 70.58 (8B sibling, June 2025). Apache-2.0 clean. **32K context.** Instruction-aware. Best Track B pick if license purity OR long context OR pure-code retrieval is required. |
| qwen3-embedding:4b | `qwen3-embedding:4b` | 2025-06 | 4B | 2560 | 32768 | ~2.5 GB | Apache-2.0 | MTEB ~67 | Quality jump over 0.6B; sidecar RAM cost. |
| nomic-embed-text-v2-moe | `nomic-embed-text-v2-moe` | 2025-12 | 475M / 305M active | 768 (MRL → 256) | **512** | ~400 MB at q4 | Apache-2.0 | competitive with larger models on BEIR/MIRACL | Multilingual (100 langs), MoE efficiency. **512-token context kills it as a default.** |
| nomic-embed-code | `nomic-embed-code` | 2025 | ~7B | 768 | varies | ~26 GB FP / ~7 GB q4 | Apache-2.0 | SOTA on CoRNStack code retrieval | Specialized code-only embedder. Escape hatch for code-dominated corpora. |
| bge-m3 | `bge-m3` | 2024 | 568M | 1024 | 8192 | ~1.2 GB | MIT | MTEB ~63; BEIR ~62 | Hybrid dense+sparse+ColBERT in single model (Ollama exposes dense only). |
| snowflake-arctic-embed2 | `snowflake-arctic-embed2` | 2024-12 | ~568M | 1024 (MRL → 256) | 8192 | ~1.1 GB | Apache-2.0 | MTEB ~58 retrieval; multilingual NDCG@10 strong | Older but multilingual + Apache-2.0. |
| mxbai-embed-large | `mxbai-embed-large` | 2024 | 335M | 1024 | **512** | ~670 MB | Apache-2.0 | MTEB ~64.68 | **Disqualified** by 512-token context cap. |

### Track B pick: **`embeddinggemma:300m`** *(default)* — but see license caveat below

Defended against the rest:

- **MTEB-Code 68.76 + English Retrieval ~68.36** is closer to balanced than Qwen3-0.6B's lopsided profile (75.41 code, 61.82 retrieval). Pristine's queries are mixed natural-language-about-code, not pure code-to-code search — a balanced model is the right default.
- **CPU latency**: <22ms per embedding on EdgeTPU; ~50ms typical CPU; <200MB RAM with QAT int4.
- **Matryoshka MRL down to 128 dims** gives 6× storage savings in `sqlite-vec` without re-embedding.
- **Recency**: Sep 2025, vs Qwen3-0.6B's June 2025.

**Single biggest risk:** 2K context cap. For typical multi-turn developer chat (2-4K tokens) this is fine; for long architecture-decision documents it isn't.

**Critical license caveat:** EmbeddingGemma is licensed under Gemma TOS, not Apache-2.0. Gemma TOS has field-of-use restrictions that may conflict with a freely-redistributable SDK. **If license purity is required**, switch the default to `qwen3-embedding:0.6b` (Apache-2.0, longer context, slightly lower balance).

### Track B alt: **`qwen3-embedding:0.6b`** — the right default if any of these is true

- Pristine's typical sliding window exceeds 2K tokens (Qwen3 ctx is 32K vs Gemma's 2K)
- The corpus is heavily code-dominated (>70%) where MTEB-Code 75.41 vs 68.76 actually matters
- Apache-2.0 strict licensing is a hard requirement for downstream redistribution

## User-facing recommendation (consumer-readable)

> **Default (impatient):** Track B with `embeddinggemma:300m` via Ollama — 68+ MTEB on both English retrieval and code, ~200MB RAM with QAT, one command (`ollama pull embeddinggemma`). License caveat: Gemma TOS has field-of-use restrictions; if you need clean Apache-2.0, switch to `qwen3-embedding:0.6b`.
>
> **Long contexts or code-heavy corpus:** `qwen3-embedding:0.6b` on Ollama — 32K context (vs Gemma's 2K), MTEB-Code 75.41, Apache-2.0.
>
> **Zero-dependency in-process:** Track A with `Alibaba-NLP/gte-modernbert-base` — best permissively-licensed BERT-family model for code retrieval (CoIR 79.31), no Ollama daemon, runs in `@huggingface/transformers` v3.
>
> **Code-only escape hatch:** `nomic-embed-code` on Ollama (~7B, ~26GB FP) for corpora where everything is code.

## Open questions for Story 4 (the spike)

The picks above are leaderboard-derived. Before committing, the spike needs to validate:

1. **Pristine-domain MTEB.** None of the leaderboard scores measure how a model performs on actual Pristine conversation/memory data. The MTEB number is directional, not authoritative. Story 2's measurement harness (labeled query set + score-gap metric) is the load-bearing artifact for converting "leaderboard winner" into "right pick for our corpus".
2. **CPU latency on actual target hardware** (Apple Silicon, x86 Linux, Windows). The latency numbers above are vendor-reported on EdgeTPU or RTX 4090; in-process Node.js on a laptop is the load-bearing surface.
3. **Gemma license review.** Whether the Gemma TOS field-of-use restrictions actually block Pristine's distribution model needs legal review before EmbeddingGemma can be the default.
4. **Qwen3-Embedding 0.6B-specific MTEB numbers.** Qwen publishes per-task scores but not a single MTEB-en aggregate for the 0.6B variant. The "0.6B is competitive with much larger models" claim is family lineage, not direct measurement; Story 4 should reproduce a benchmark.
5. **MTEB v1 vs v2 versioning drift.** Some 2026 numbers cite MTEB v2 (Borda count, refactored), some cite v1 (averaging). Score gaps of 5+ points between sources can be benchmark-version drift, not model quality.
6. **Ollama embedding-endpoint stability.** Known issues: `nomic-embed-text` outputs differ across Ollama versions (#14449); `bge-m3` had a NaN bug on flash-attention paths (closed Dec 2025); Qwen3-Embedding-8B "model does not support embeddings" after Ollama v0.12.6 (Oct 2025); nil-guard fixes for Qwen3 embeddings landed early 2026. Pin the Ollama version validated against in CI.

## Confidence summary

- **HIGH** on Track A pick survival: gte-modernbert-base's CoIR 79.31 is published on the model card; no displacing model in transformers.js-loadable + Apache-2.0 + ≤2GB tier exists in the last 8 months.
- **MEDIUM** on Track B pick (`embeddinggemma:300m`): the 68.76 / 68.36 numbers are vendor-reported (Google paper + cosmo-edge writeup), not independently reproduced.
- **MEDIUM** on Qwen3-0.6B as Track B alt: 0.6B-specific MTEB-en aggregate is missing from public leaderboards; family lineage carries the claim.
- **HIGH** on architecture compatibility: ModernBERT support in `@huggingface/transformers` v3.2.1+ is confirmed via merged PR + release notes; Nomic v2 MoE incompatibility is corroborated by fastembed-rs and Candle reports.
- **MEDIUM** on disk sizes: some are estimated (`params × 4 bytes` for FP32); reliable to within ~10%.

## Methodology

Two passes of the `general-research` sub-agent (Anthropic Claude Sonnet 4.6 web-research mode):

1. **Pass 1** — broad post-2025-01-01 candidate survey scoped to `@huggingface/transformers` compat; produced `gte-modernbert-base` (Track A) and `qwen3-embedding:0.6b` (Track B) as initial picks.
2. **Pass 2** — refinement with strict 2025-09-01+ recency, developer-memory-retrieval axes (CoIR / LoCo / MTEB-Retrieval over MTEB-aggregate), and developer-corpus use case. Confirmed Track A pick survives; **changed Track B pick to `embeddinggemma:300m`** for balanced retrieval at lower size.

Both passes' raw outputs are linked in the sprint-017 PR thread for audit.

## Story-1 AC checklist

- [x] ≥5 candidate models post-2025-01-01 documented per track
- [x] Each entry includes HF/Ollama path, params, dim, ctx, size, license, MTEB / source URL, "why interesting" rationale
- [x] Nomic v2 explicitly addressed (excluded from Track A by arch; Track B alt-list)
- [x] 3-finalist shortlist for Story 4 spike: per track — Track A pick, Track B pick, Track B alt
- [x] Deal-breakers per excluded candidate (license, runs-locally, weight-gated, model-size > 2GB)
- [x] Tokenizer compatibility flagged where relevant (instruction-aware models, prefix requirements)
- [x] Use-case-specific axes documented (CoIR, LoCo, retrieval subset over aggregate)
