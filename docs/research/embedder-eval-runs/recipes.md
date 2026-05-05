# Embedder eval — engine-config recipes

Eval-team scratch reference. Lists the exact `EmbedderConfig` (and any harness wrapping) for each candidate the eval CLI consumes. The consumer-facing selection doc cites this recipe rather than duplicating its contents.

## Candidate trio

### `nomic-v1.5` (baseline + sanity)

```ts
import type { EmbedderConfig } from '@pristine/shield-local';

const config: EmbedderConfig = {
  engine: 'local',
  model: 'nomic-ai/nomic-embed-text-v1.5',
  dim: 768,
};
```

- Engine: in-process (HuggingFace `@huggingface/transformers`)
- Native dim: 768
- License: Apache-2.0
- Notes: SDK default; downloads ~300 MB on first use; output is L2-normalized.

### `gte-modernbert-base`

```ts
const config: EmbedderConfig = {
  engine: 'local',
  model: 'Alibaba-NLP/gte-modernbert-base',
  dim: 768,
};
```

- Engine: in-process (HuggingFace `@huggingface/transformers` ≥ 3.2.1, ModernBERT support)
- Native dim: 768 (NOT MRL-trained — fixed at 768)
- License: Apache-2.0
- Notes: Highest CoIR scorer in the trio. Downloads ~600 MB on first use. Output is L2-normalized.

### `embeddinggemma:300m`

```ts
const config: EmbedderConfig = {
  engine: 'ollama',
  model: 'embeddinggemma:300m',
  dim: 768,
};
```

- Engine: Ollama HTTP (`/api/embed`)
- Native dim: 768 (MRL-trained; truncation possible but not used here)
- License: Gemma TOS — review before downstream use
- Manual prerequisite: `ollama pull embeddinggemma:300m`
- Notes: Default Ollama candidate. Output is L2-normalized.

### `qwen3-embedding:0.6b` (with truncating-wrapper)

```ts
import { OllamaEmbedder } from '@pristine/shield-local/embedder/ollama';
import { createTruncatingEmbedder } from 'tests/integration/embedder-eval/wrappers/truncating-wrapper';

const native = new OllamaEmbedder({
  model: 'qwen3-embedding:0.6b',
  host: 'http://localhost:11434',
  dim: 1024,                  // matches model native dim — passes strict-validate
});
const wrapped = createTruncatingEmbedder(native, 768);
// `wrapped.dim === 768`. The eval harness `runEval` accepts the
// wrapped embedder via `embedderOverride` so the SDK's storage path
// sees float[768] DDL.
```

- Engine: Ollama HTTP (`/api/embed`) → truncating-wrapper (slice + L2 renorm)
- Native dim: 1024 (MRL-trained; sliced to 768 by the wrapper)
- License: Apache-2.0
- Manual prerequisite: `ollama pull qwen3-embedding:0.6b`
- Notes: The truncation lives in the harness wrapper to preserve the SDK modularization invariant — no per-candidate engine-class changes. Documented MRL truncation loss is ~1-3% NDCG@10 (within bootstrap CI noise).

## How the harness consumes these

The CLI maps candidate names to configs via `tests/integration/embedder-eval/candidates.ts`. Adding a new candidate is one switch arm there + one recipe block here.

For Qwen3 specifically, the CLI's mapping returns a config with `dim: 768` but the harness then constructs the underlying 1024-d Ollama embedder + the truncating-wrapper internally before handing it to `runEval`'s `embedderOverride`. The wrapper instantiation lives in the eval orchestration layer (see `tests/integration/embedder-eval/wrappers/truncating-wrapper.ts`) and is invoked from the CLI when the candidate name is `qwen3-embedding`.

## Manual prerequisites

```bash
# In-process candidates download model weights to the HF cache on first use.
# No manual step needed — just expect a one-time ~300-600 MB download.

# Ollama candidates require pulling models locally:
ollama pull embeddinggemma:300m
ollama pull qwen3-embedding:0.6b

# Confirm they are visible:
ollama list
```

## Out of scope here

- Hyperparameter tuning (RRF k, top-K, FTS5 tokenizer choice) — eval-orchestration concern, not a candidate-config concern.
- Per-candidate index sharing — the harness rebuilds the corpus per (candidate × config) combination today; reusing an index across the dense-only and hybrid runs of the same candidate is a follow-up performance optimisation if eval wall-time becomes a problem.
- Real session-log corpus + LLM-judge labelling — covered by Story 2 Phase B.
