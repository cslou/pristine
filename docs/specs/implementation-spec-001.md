# Implementation Spec 003: Local-First Privacy & Memory

## 1. Overview

This spec proposes moving Pristine's privacy and memory pipelines from a server-dependent architecture (Anthropic API + OpenAI API + PostgreSQL + Presidio) to a fully local architecture where everything runs on the user's machine. No API calls, no server, no data leaving the device.

### Why

- **Privacy by architecture:** Sensitive data never leaves the device. No trust required in external APIs or servers.
- **Cost:** Zero API spend per inference. Models run on device.
- **Offline capability:** Works without internet. Useful for air-gapped environments, mobile, edge.
- **Future-proofing:** Small models are improving rapidly (e.g., Bonsai-8B: 8B params in 1.15 GB via 1-bit quantization). Building the local architecture now means we benefit automatically as models shrink and improve. The architecture is model-agnostic — swap the GGUF file, everything else stays the same.

### Scope

Two independent workstreams:

1. **Privacy (PII redaction):** Replace Presidio + Claude Haiku classifier with a local LLM. Drop Presidio entirely -- it only covers English/US PII patterns. A local LLM handles all languages and PII types natively.

2. **Memory (extraction + embedding + storage + search):** Replace Anthropic extractor/consolidator + OpenAI embedder + PostgreSQL/pgvector with local LLM + local embedding model + SQLite/sqlite-vec.

Both workstreams share the same local LLM runtime, so the infrastructure investment is shared.

### Tradeoffs: Privacy

*Note: Local quality estimates are projected. Actual numbers will be validated in Phase 5 (MemoryBench) and Phase 11 (full benchmark).*

| | Hosted (current) | Local |
|---|---|---|
| **Data exposure** | Raw text sent to Anthropic API + Presidio service | Never leaves device |
| **Language coverage** | English only (Presidio hardcoded to `en`). LLM covers more but via external API. | All languages the local model was trained on — no regex limitations |
| **PII types** | ~15 hardcoded patterns (US SSN, UK NHS, SG NRIC, etc.) + LLM contextual detection | LLM contextual detection for any PII type in any format — no regex to maintain |
| **Setup** | Presidio Docker container + Anthropic API key | Single npm package, no Docker |
| **Detection quality** | Presidio (high precision, low recall for non-English) + Claude Haiku (high quality) | 7B local model (good, improving). Grammar-constrained output ensures structured results. |
| **Cost per classification** | ~$0.0005/call (Haiku) | $0 |
| **Latency** | ~500ms (network + Presidio + LLM) | ~200-400ms (local inference only) |
| **Offline** | No | Yes |

### Tradeoffs: Memory

| | Hosted (current) | Local |
|---|---|---|
| **Data exposure** | Conversations sent to Anthropic + OpenAI APIs, stored in server PostgreSQL | All data stays on device in a single SQLite file |
| **Extraction quality** | Claude Haiku (strong fact + temporal extraction) | 7B local model (good, improving). Same tool schemas, grammar-constrained. |
| **Embedding quality** | OpenAI text-embedding-3-small (MTEB ~62) | Nomic Embed v1.5 (MTEB ~59-61). ~3% quality gap, acceptable for retrieval. |
| **Search latency** | ~10-20ms (pgvector HNSW) | ~30-50ms at 100K vectors (sqlite-vec brute-force). Acceptable for local use. |
| **Memory types** | Semantic + temporal (shipped). Episodic + relational (planned, requires Neo4j). | Semantic + temporal + episodic + relational — all in one SQLite file, no Neo4j |
| **Scale** | Unlimited (PostgreSQL) | ~100K memories per user before brute-force search becomes slow |
| **Setup** | PostgreSQL + Supabase + API keys | Single npm package, single file on disk |
| **Cost per ingest** | ~$0.002/conversation (Haiku + OpenAI embeddings) | $0 |
| **Offline** | No | Yes |

---

## 2. Current vs. Local Architecture

### 2.1 Current Architecture (Server-Dependent)

```
SDK (client)
  ├── secureAndRedact() ──→ POST /privacy/v1/secure-and-redact
  │                              ├── Presidio HTTP service (localhost:5001)
  │                              ├── Claude Haiku API (Anthropic)
  │                              └── Vault (PostgreSQL)
  ├── store() ─────────────→ POST /memory
  │                              ├── Extractor (Claude Haiku API)
  │                              ├── Embedder (OpenAI API)
  │                              ├── Consolidator (Claude Haiku API)
  │                              └── Store (PostgreSQL + pgvector)
  ├── search() ────────────→ GET /memory/search
  │                              ├── Embedder (OpenAI API)
  │                              └── Store (PostgreSQL + pgvector)
  └── reveal() ────────────→ POST /memory/vault/reveal
                                 └── Vault (PostgreSQL) → client-side decrypt
```

**External dependencies:** 3 API services (Anthropic, OpenAI, Presidio) + 1 database (PostgreSQL).

### 2.2 Proposed Architecture (Local-First)

```
SDK (client) — everything in-process
  ├── secureAndRedact()
  │       └── Local LLM classifier (Qwen2.5/Llama via node-llama-cpp)
  │
  ├── store()
  │       ├── Extractor (Local LLM via llama.cpp)
  │       ├── Embedder (Nomic Embed via ONNX Runtime)
  │       ├── Consolidator (Local LLM via llama.cpp)
  │       └── Store (SQLite + sqlite-vec)
  │
  ├── search()
  │       ├── Embedder (Nomic Embed via ONNX Runtime)
  │       └── Store (SQLite + sqlite-vec)
  │
  └── reveal()
          └── Vault (SQLite, same file) → in-process decrypt
```

**External dependencies:** None. Single SQLite file for all data. Model weights on disk.

### 2.3 Hardware Requirements

| Resource | Usage | Notes |
|---|---|---|
| **RAM** | ~6.5 GB (5.5 LLM + 0.5 embedder + 0.5 Node/SQLite) | Apple Silicon unified memory — GPU and CPU share the same pool |
| **Minimum** | 16 GB Mac | Leaves ~5 GB for macOS + other apps. Comfortable. |
| **Not recommended** | 8 GB Mac | Would exceed physical RAM, heavy swap, significant slowdown. |
| **Disk** | ~5.3 GB (models + data) | See storage footprint below |
| **CPU/GPU** | Apple Silicon M-series or x86_64 with AVX2 | Metal acceleration automatic on Mac. CUDA/Vulkan on Linux/Windows. |

Using a smaller model (Llama 3.2 3B at ~2 GB) reduces RAM to ~3.5 GB total, making 8 GB Macs viable.

### 2.4 Storage Footprint

**Model weights (static, shared):**

| Component | Size |
|---|---|
| LLM weights (Qwen2.5 7B Q4_K_M GGUF) | ~4.5 GB |
| Embedding model (Nomic Embed v1.5) | ~300 MB |
| **Total models** | **~4.8 GB** |

**Data storage per user (100K memories, heavy usage over 5 years):**

| Data Type | Estimate |
|---|---|
| Memories (facts + temporal fields) | ~10 MB |
| Memory embeddings (100K x 768d float32) | ~300 MB |
| Episodes (full conversations, 10K episodes) | ~50 MB |
| Episode summary embeddings (10K x 768d) | ~30 MB |
| Entities (~5K nodes + embeddings) | ~20 MB |
| Relationships (~15K edges + embeddings) | ~50 MB |
| Vault entries (encrypted PII) | ~5 MB |
| **Total data** | **~465 MB** |

**Grand total: ~5.3 GB** (models + data for a heavy user). Most of the cost is the LLM weights. A smaller model (Llama 3.2 3B Q4_K_M at ~2 GB, or future 1-bit models like Bonsai-8B at ~1.15 GB) would reduce this significantly.

For comparison: a typical VS Code installation is ~500 MB. Xcode is ~35 GB. Docker Desktop is ~2-4 GB.

---

## 3. Privacy: Local PII Redaction

### 3.1 Why Drop Presidio

Presidio has fundamental coverage limitations that a local LLM solves:

| Aspect | Presidio | Local LLM |
|---|---|---|
| **Languages** | English primarily. 13 via spaCy but recognizers are English-centric | All languages the model was trained on |
| **PII types** | Hardcoded regex patterns. US SSN, UK NHS, SG NRIC, and ~15 others | Contextual understanding of any PII type in any format |
| **India, Asia, LATAM** | No Aadhaar, PAN, My Number, CPF, etc. | Understands these natively from training data |
| **Context** | Cannot detect "my salary is 150k" as financial PII | Understands semantic meaning |
| **Setup** | Requires running a separate Docker service | Bundled in the SDK |

The pipeline keeps two classifiers running in parallel — same pattern as today, but both run locally:

- **Deterministic classifier** (rule-based): Fast, predictable, no LLM cost. Handles structural patterns (regex for credit cards, emails, phone formats, etc.). Replaces Presidio with a custom implementation we control — no Docker dependency, extensible to any region's ID formats.
- **Non-deterministic classifier** (LLM): Catches contextual PII that rules miss ("my salary is 150k", "I was diagnosed with..."). Prompt is user-configurable via `prompts.classifier` in config. Uses a two-stage approach: LLM returns `{ type, text }` pairs (no character offsets — LLMs hallucinate positions), then a deterministic post-processing step resolves exact offsets via string matching.

Both implement the same `SensitivityClassifier` interface. Either can be swapped, extended, or disabled independently.

### 3.2 New Privacy Pipeline

```
Input: raw messages
  │
  ├──────────────────────────────┐
  ▼                              ▼
Deterministic Classifier     Local LLM Classifier
  ├── Regex/rule-based           ├── Contextual/semantic detection
  ├── Fast, predictable          ├── Prompt-configurable (see 5.4)
  └── Custom rules, no Docker    └── Multilingual, catches what rules miss
  │                              │
  └──────────┬───────────────────┘
             ▼
  Merge (deduplicate overlapping spans, prefer wider spans + higher confidence)
             │
             ▼
  Redactor (unchanged)
    ├── Replaces spans with [SENSITIVE:type:placeholder_id]
    └── Pure local computation (already is)
             │
             ▼
  Vault (local SQLite)
    ├── Encrypts original values with user's public key
    ├── Stores encrypted envelopes in SQLite
    └── Same zk-v2 encryption scheme (AES-256-GCM + RSA-OAEP-256)
             │
             ▼
  Output: redacted messages + placeholder IDs
```

### 3.3 Modules That Change

| Module | Change | Details |
|---|---|---|
| `src/privacy/classifier/deterministic/` | **New** | Rule-based classifier replacing Presidio. Same `SensitivityClassifier` interface. Custom regex patterns, no Docker. |
| `src/privacy/classifier/llm/` | **Modify** | Replace Anthropic SDK client with local LLM client. Same tool schema, same output types. Prompt configurable via `PromptConfig.classifier`. |
| `src/privacy/classifier/index.ts` | **Keep** | `CombinedClassifier` merge logic stays — still runs both classifiers in parallel and deduplicates. |
| `src/privacy/vault/` | **Modify** | Replace PostgreSQL backend with SQLite backend. Same interface. |
| `src/privacy/` | **Modify** | Replace PostgreSQL key store with SQLite. Same interface. |

### 3.4 What Stays the Same

- `SensitivityClassifier` interface (unchanged)
- `DetectedEntity` type (unchanged)
- Redaction logic in `src/privacy/sanitizer/` (unchanged)
- Vault encryption scheme: zk-v2 (unchanged)
- SDK's `secureAndRedact()`, `reveal()`, `scrubOutput()` functions (unchanged API)
- RSA key management in SDK (unchanged)

---

## 4. Memory: Local Extraction, Embedding & Storage

### 4.1 New Memory Pipeline

The local pipeline supports all four memory types from spec 002:
- **Semantic** (facts) — already working, swap to local LLM + local embedder
- **Temporal** (valid_from/valid_until, supersession chains) — already working, unchanged
- **Episodic** (full conversation preservation + summary search) — Phase 5 from spec 002
- **Relational** (entity graph + multi-hop queries) — Phase 6 from spec 002, SQLite replaces Neo4j

```
Input: conversation messages
  │
  ├──────────────────────────────────────────────┐
  │                                              ▼
  ▼                                     Episode Store (Phase 5)
Chunker (unchanged)                       ├── Store full messages in episodes table
  │                                       ├── Generate summary via local LLM
  ▼                                       ├── Embed summary via local embedder
Local LLM Extractor                       └── Link to extracted facts via memory_episodes
  ├── Extracts atomic facts + temporal signals
  ├── Extracts entities + relationships (Phase 6)
  ├── Single LLM pass for all of the above
  └── Same tool schema, extended for entities
  │
  ├──────────────────────────┐
  ▼                          ▼
Local Embedder         Entity Resolution (Phase 6)
  ├── 768-dim vectors    ├── Match by name/alias/embedding
  └── Nomic Embed v1.5   ├── Merge or create entity
  │                      └── Store relationships with temporal fields
  ▼
Vector Search (sqlite-vec, brute-force cosine)
  ├── Top-K similar memories per fact
  └── ~30-50ms at 100K vectors (brute-force; acceptable for local use)
  │
  ▼
Local LLM Consolidator
  ├── Same actions: ADD / UPDATE / DELETE / NOOP / SUPERSEDE
  ├── Supersession chains with temporal fields
  └── Retry logic carries over
  │
  ▼
SQLite Store (single file)
  ├── memories + memory_vectors (semantic + temporal)
  ├── episodes + episode_vectors + memory_episodes (episodic)
  ├── entities + entity_vectors + relationships + relationship_vectors (relational)
  └── vault_entries + user_public_keys (privacy)
  │
  ▼
Output: { facts, memoryIds, decisions, episodeId, entities }
```

**Retrieval** also spans all four memory types (from spec 002 end-state):

```
Query comes in
  │
  ├─1─→ Vector search on facts (sqlite-vec, memories)
  │      apply temporal filter (current / as-of / full)
  │
  ├─2─→ Keyword search on facts (FTS5, memories_fts)
  │      exact-match for names, IDs, codes that embedding search misses
  │
  ├─3─→ Vector search on episode summaries (sqlite-vec, episodes)
  │      → ranked episodes + linked facts
  │
  ├─4─→ Extract entities from query → graph traversal (SQLite recursive CTEs)
  │      follow relationships 1-N hops
  │      rank by hop distance + relationship embedding similarity
  │
  └─5─→ Fuse all channels via RRF + MMR diversification
         → unified ranked results
```

Steps 1-4 run in parallel. All local, all in-process.

### 4.2 Modules That Change

| Module | Change | Details |
|---|---|---|
| `src/memory/extractor/` | **Modify** | Replace Anthropic client with local LLM client. Extend tool schema to also extract entities + relationships (Phase 6). Same `Extractor` interface. |
| `src/embedder/` | **Replace** | New `LocalEmbedder` using ONNX Runtime + Nomic Embed. Implements same `Embedder` interface. Output dimension changes from 1536 to 768. |
| `src/memory/consolidator/` | **Modify** | Replace Anthropic client with local LLM client. Same `Consolidator` interface, same tool schema. Retry logic unchanged. |
| `src/memory/store/` | **New impl** | New `SqliteStore` implementing existing `Store` interface. SQLite + sqlite-vec for vector search. Same schema shape. |
| `src/privacy/vault/` | **Modify** | Replace PostgreSQL backend with SQLite (shared DB file with store). |
| `src/memory/retriever/` | **Modify** | Extend to support episode search + graph-enhanced retrieval + RRF fusion. |
| `src/memory/orchestrator/` | **Modify** | Add episode storage step (parallel with extraction). Add entity resolution + relationship storage step (after extraction). |
| `src/memory/episodes/` | **New** | `EpisodeStore` interface + `SqliteEpisodeStore`. Summary generation, episode search, fact-episode linking. |
| `src/memory/graph/` | **New** | `EntityStore` + `RelationshipStore` interfaces + SQLite implementations. Entity resolution (name/alias/embedding match). Graph traversal queries. Replaces the planned Neo4j integration from spec 002. |

### 4.3 What Stays the Same

- Core TypeScript interfaces (`Extractor`, `Embedder`, `Store`, `Consolidator`)
- Orchestrator pipeline pattern (composable steps)
- Chunker (`chunkConversation()`)
- Temporal validation (`validateTemporalFields()`)
- Temporal fields and supersession chain logic
- Content hash dedup (SHA-256)
- Sanitizer / LLM reentry guards
- Query analyzer (already local)

---

## 5. Shared Infrastructure: Local LLM Runtime

Both privacy and memory need a local LLM. This should be a single shared component.

### 5.1 Runtime Options

| Runtime | Platform | Language Bindings | Tool Calling | Notes |
|---|---|---|---|---|
| **llama.cpp** | All (CPU/GPU/Metal) | C++ with Node.js bindings (node-llama-cpp v3) | JSON Schema grammar constraints (`createGrammarForJsonSchema()`) + `defineChatSessionFunction()` | Most mature, widest GGUF model support. Metal auto-detected on Apple Silicon. |
| **Ollama** | All | HTTP API (localhost:11434) | Via tool calling API | Zero-download path for devs who already have Ollama. User manages models via `ollama pull`. |
| **MLX** | Apple Silicon only | Python, Swift | Via structured output | Fastest on Mac, but Apple-only. Future engine option. |
| **@huggingface/transformers** | All | Node.js (wraps ONNX Runtime) | N/A (embeddings only) | Handles tokenization + model download automatically. CoreML on Mac. |

**Two LLM engine paths:**
- **In-process (node-llama-cpp):** Self-contained — we download and manage the model. No external dependencies. Best for production, offline, CI.
- **Ollama:** Zero-download — if the user already has Ollama running with models pulled, it's just a config change. Best onboarding experience for developers.

Both implement the same `LocalLlmClient` interface. The rest of the pipeline doesn't know which engine is behind it.

**Embedding inference:** `@huggingface/transformers` (wraps ONNX Runtime, handles tokenization + model download)

### 5.1.1 Model Count and Concurrency

**Models loaded in memory: 2**

| Model | Purpose | Size (RAM) |
|---|---|---|
| LLM (e.g., Qwen2.5 7B) | Extraction, consolidation, classification, episode summaries, entity extraction | ~5.5 GB |
| Embedding (Nomic Embed v1.5) | All embedding tasks (facts, episodes, entities, queries) | ~0.5 GB |

One LLM serves both privacy and memory pipelines. No separate models needed per task.

**Parallel chunk extraction:**

When a long conversation is chunked (e.g., 40 messages → 2 chunks of 20), the extraction of each chunk requires an LLM call. The concurrency depends on the engine:

| Engine | Concurrency | Tradeoff |
|---|---|---|
| **node-llama-cpp (in-process)** | Serial — one inference at a time | No extra RAM. 2 chunks = ~2x latency (~6-10s total at 130 tok/s). |
| **Ollama** | Parallel — configurable via `OLLAMA_NUM_PARALLEL` | Each parallel slot needs its own KV cache (~0.5-1 GB extra RAM per slot). |

**Realistic latency budget for a single `store()` call** (40-message conversation, 2 chunks, ~10 facts, M4 Pro at ~130 tok/s):

| Step | LLM calls | Est. time |
|---|---|---|
| Chunk extraction (2 chunks, serial) | 2 | ~8s |
| Embedding (10 facts, batched) | 0 (ONNX) | <0.5s |
| Similar memory search (10 queries) | 0 (SQLite) | <0.5s |
| Consolidation (1 batched call) | 1 | ~4s |
| Episode summary generation | 1 | ~3s |
| Entity extraction + resolution | 1 | ~3s |
| Store (SQLite writes) | 0 | <0.1s |
| **Total** | **5 LLM calls** | **~19s** |

This is slower than hosted (~2-3s with Haiku). Acceptable for background ingest after a conversation ends. Not suitable for real-time per-message processing. Parallelism via Ollama or faster future models will reduce this.

### 5.2 Local LLM Client Interface

```typescript
interface LlmClient {
  /** Generate a structured response matching the given JSON schema.
      The engine enforces the schema via grammar constraints (llama.cpp)
      or structured output (Ollama format parameter). */
  generate<T>(params: {
    systemPrompt: string;
    userPrompt: string;
    schema: JsonSchema;       // JSON Schema for the expected output
    maxTokens?: number;
  }): Promise<T>;
}
```

Engine-neutral — no coupling to Anthropic's wire format. Each engine adapter (`LlamaCppClient`, `OllamaClient`) maps this to its own native API:
- **llama.cpp:** `createGrammarForJsonSchema(schema)` → grammar-constrained generation
- **Ollama:** `format: schema` parameter on `/api/chat` → structured output

The extractor, consolidator, LLM classifier, episode summarizer, and entity extractor all use this same interface — each passes its own schema and prompts.

Retry policy: 3 attempts with exponential backoff (500ms base). If all retries fail, the operation throws. The orchestrator decides whether to return partial results (e.g., 3 of 5 chunks extracted) or fail the entire ingest.

### 5.3 Model Management

```
~/.pristine/
  ├── models/
  │   ├── qwen2.5-7b-instruct-q4_k_m.gguf   # LLM (~4.5 GB)
  │   └── nomic-embed-text-v1.5/             # Embedding model (~300 MB, managed by @huggingface/transformers)
  └── data/
      └── <user-id>.db                       # SQLite database (memories + vault + keys)
```

Default model is Qwen2.5 7B Instruct (strong tool calling, widely available as GGUF). Users can swap to smaller models for faster inference:
- Llama 3.2 3B Instruct (~2 GB Q4_K_M) — faster, lower quality
- Phi-3.5 Mini 3.8B (~2.3 GB Q4_K_M) — good structured output
- Future: Bonsai-8B (~1.15 GB, 1-bit) — when llama.cpp adds native 1-bit support

Models are downloaded on first use or bundled with the package. A model registry config specifies which models to use:

```typescript
interface LocalConfig {
  llmEngine: 'llamacpp' | 'ollama';  // default: 'llamacpp'
  llmModel: string;       // path, model ID, or Ollama model name
  embedModel: string;     // path or model ID
  dataDir: string;        // default: ~/.pristine/data
  modelsDir: string;      // default: ~/.pristine/models
  prompts?: PromptConfig; // override default prompts (see 5.4)
}
```

### 5.4 Prompt Customization

Every LLM prompt in the pipeline is user-configurable. This is important because:

- Different domains have different PII definitions (healthcare vs fintech vs social)
- Users may want stricter or looser extraction behavior
- Consolidation strategy varies by use case (some want full history, others want latest-wins)
- Prompt tuning may be needed when swapping to different local models

```typescript
interface PromptConfig {
  /** System prompt for PII classification. Defines what counts as sensitive
      and what entity types to detect. Override to add domain-specific PII
      types (e.g., HIPAA identifiers, financial account formats). */
  classifier?: string;

  /** System prompt for fact extraction. Defines what to extract from
      conversations and how to handle temporal signals. Override to focus
      extraction on specific domains or ignore certain content. */
  extractor?: string;

  /** System prompt for consolidation decisions. Defines when to ADD,
      UPDATE, SUPERSEDE, DELETE, or NOOP. Override to change dedup
      strategy (e.g., always SUPERSEDE preference changes). */
  consolidator?: string;

  /** System prompt for episode summary generation. Defines how to
      summarize conversations for search. Override to control summary
      length, focus, or style. */
  episodeSummary?: string;

  /** System prompt for entity extraction and resolution. Defines entity
      types and how to handle disambiguation. Override to add custom
      entity types or resolution rules. */
  entityExtractor?: string;
}
```

Each field has a built-in default (what we ship today in `src/prompts/`). When a user provides an override, it replaces the default entirely — no merge, no template variables. This keeps it simple and predictable.

```typescript
// Example: healthcare app with strict PII detection
PristineLocal.create({
  prompts: {
    classifier: `You are a HIPAA-compliant PII detector.
      Detect all standard PII plus: medical record numbers (MRN),
      ICD-10 diagnosis codes, insurance policy numbers, provider NPIs,
      and any Protected Health Information (PHI).
      Classify medical identifiers as type "health".
      Classify insurance identifiers as type "financial".`,
  }
});

// Example: preference-focused memory for a recommendation agent
PristineLocal.create({
  prompts: {
    extractor: `Extract user preferences, tastes, and opinions from
      this conversation. Ignore factual Q&A, small talk, and anything
      the assistant said. Focus only on what the user likes, dislikes,
      wants, or has decided.`,
    consolidator: `When a user preference changes, always use SUPERSEDE
      (not UPDATE) so the full preference history is preserved.
      For non-preference facts, use standard consolidation logic.`,
  }
});
```

---

## 6. SQLite Schema

Single SQLite file per user, containing all tables.

**Data safety:**
- WAL mode enabled for crash safety (writes are atomic)
- `PRAGMA integrity_check` on startup to detect corruption
- If corruption is detected, log a warning and create a fresh database (memories are rebuilt from conversations if episode data is available)
- WAL checkpoint runs automatically (SQLite default: 1000 pages)
- Users can export/backup the database file at any time — it's a single file, just copy it

```sql
-- Memories (mirrors PostgreSQL schema)
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB,                          -- sqlite-vec compatible
  content_hash TEXT NOT NULL,
  source_conversation_id TEXT,
  metadata TEXT,                           -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT,
  valid_until TEXT,
  superseded_by TEXT REFERENCES memories(id),
  supersedes TEXT REFERENCES memories(id),
  supersession_reason TEXT,
  UNIQUE(user_id, content_hash)
);

-- sqlite-vec virtual table for vector search
CREATE VIRTUAL TABLE memory_vectors USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[768]                     -- Nomic Embed dimension
);

-- Vault entries
CREATE TABLE vault_entries (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id),
  user_id TEXT NOT NULL,
  placeholder_id TEXT NOT NULL,
  sensitive_type TEXT NOT NULL,
  encrypted_value BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  encryption_mode TEXT NOT NULL DEFAULT 'client_v2',
  encryption_metadata TEXT,                -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User public keys
CREATE TABLE user_public_keys (
  user_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Episodes (Phase 5 — full conversation context)
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  messages TEXT NOT NULL,                  -- JSON array [{role, content, timestamp}]
  summary TEXT,                            -- LLM-generated summary
  summary_embedding BLOB,                 -- embedding of summary for search
  participant_count INTEGER,
  message_count INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  storage_tier TEXT NOT NULL DEFAULT 'hot', -- hot/warm/cold (for future tiering)
  metadata TEXT NOT NULL DEFAULT '{}',     -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sqlite-vec virtual table for episode summary search
CREATE VIRTUAL TABLE episode_vectors USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[768]
);

-- Facts-to-episodes junction (many-to-many)
CREATE TABLE memory_episodes (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, episode_id)
);

-- Entities (Phase 6 — knowledge graph nodes, replaces Neo4j)
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,                      -- canonical name
  type TEXT NOT NULL,                      -- PERSON, ORGANIZATION, LOCATION, EVENT, PRODUCT, OTHER
  aliases TEXT NOT NULL DEFAULT '[]',      -- JSON array of alternative names
  summary TEXT,                            -- LLM-generated entity summary
  embedding BLOB,                          -- for entity resolution via similarity
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name, type)
);

-- sqlite-vec virtual table for entity resolution
CREATE VIRTUAL TABLE entity_vectors USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[768]
);

-- Relationships (Phase 6 — knowledge graph edges, replaces Neo4j)
CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_entity_id TEXT NOT NULL REFERENCES entities(id),
  target_entity_id TEXT NOT NULL REFERENCES entities(id),
  relation TEXT NOT NULL,                  -- 'works_at', 'married_to', 'lives_in', etc.
  fact TEXT,                               -- natural language: "Sarah works at Google"
  source_memory_id TEXT REFERENCES memories(id),
  embedding BLOB,                          -- for semantic search over relationships
  valid_from TEXT,
  valid_until TEXT,
  is_invalid INTEGER NOT NULL DEFAULT 0,   -- soft-delete
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sqlite-vec virtual table for relationship search
CREATE VIRTUAL TABLE relationship_vectors USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[768]
);

CREATE INDEX idx_rel_source ON relationships(source_entity_id);
CREATE INDEX idx_rel_target ON relationships(target_entity_id);
CREATE INDEX idx_rel_type ON relationships(relation);
CREATE INDEX idx_rel_memory ON relationships(source_memory_id);
CREATE INDEX idx_memories_user ON memories(user_id);
CREATE INDEX idx_memories_temporal ON memories(user_id, valid_from, valid_until);
CREATE INDEX idx_episodes_user_conv ON episodes(user_id, conversation_id);
CREATE INDEX idx_episodes_user_started ON episodes(user_id, started_at);

-- Full-text search (FTS5) for keyword/exact-match queries
CREATE VIRTUAL TABLE memories_fts USING fts5(text, content=memories, content_rowid=rowid);
CREATE VIRTUAL TABLE relationships_fts USING fts5(fact, content=relationships, content_rowid=rowid);

-- FTS5 sync triggers (required for content= tables)
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER relationships_ai AFTER INSERT ON relationships BEGIN
  INSERT INTO relationships_fts(rowid, fact) VALUES (new.rowid, new.fact);
END;
CREATE TRIGGER relationships_ad AFTER DELETE ON relationships BEGIN
  INSERT INTO relationships_fts(relationships_fts, rowid, fact) VALUES('delete', old.rowid, old.fact);
END;
CREATE TRIGGER relationships_au AFTER UPDATE ON relationships BEGIN
  INSERT INTO relationships_fts(relationships_fts, rowid, fact) VALUES('delete', old.rowid, old.fact);
  INSERT INTO relationships_fts(rowid, fact) VALUES (new.rowid, new.fact);
END;
CREATE INDEX idx_vault_placeholder ON vault_entries(placeholder_id);
CREATE INDEX idx_vault_memory ON vault_entries(memory_id);
```

**Architectural simplification vs spec 002:** Spec 002 uses PostgreSQL + Neo4j with a `graph_sync_queue` for eventual consistency between the two databases. The local-first design eliminates this entirely — all data lives in one SQLite file, so there's no cross-database consistency problem. No sync queue, no background retry worker, no eventual consistency lag.

Graph traversal via recursive CTEs:

```sql
-- Find all entities related to an entity, 2 hops deep
-- Bidirectional: follows both outgoing and incoming edges
-- Cycle detection via path tracking
WITH RECURSIVE related(id, relation, depth, path) AS (
  -- Outgoing edges
  SELECT target_entity_id, relation, 1, ? || ',' || target_entity_id
  FROM relationships
  WHERE source_entity_id = ? AND is_invalid = 0
  UNION ALL
  -- Incoming edges (reverse traversal)
  SELECT source_entity_id, relation, 1, ? || ',' || source_entity_id
  FROM relationships
  WHERE target_entity_id = ? AND is_invalid = 0
  UNION ALL
  -- Recursive step (both directions)
  SELECT r2.target_entity_id, r2.relation, rel.depth + 1,
         rel.path || ',' || r2.target_entity_id
  FROM relationships r2 JOIN related rel ON r2.source_entity_id = rel.id
  WHERE rel.depth < 2 AND r2.is_invalid = 0
    AND INSTR(rel.path, r2.target_entity_id) = 0
  UNION ALL
  SELECT r2.source_entity_id, r2.relation, rel.depth + 1,
         rel.path || ',' || r2.source_entity_id
  FROM relationships r2 JOIN related rel ON r2.target_entity_id = rel.id
  WHERE rel.depth < 2 AND r2.is_invalid = 0
    AND INSTR(rel.path, r2.source_entity_id) = 0
)
SELECT DISTINCT e.*, rel.relation, rel.depth
FROM related rel JOIN entities e ON e.id = rel.id;
```

```sql
-- Entity resolution: find existing entity by name or alias
SELECT id, name, type, aliases FROM entities, json_each(entities.aliases)
WHERE user_id = ? AND (name = ? OR json_each.value = ?);
-- If no exact match, fall back to embedding similarity via entity_vectors
```

---

## 7. Distribution: How Users Get This

### 7.1 npm Package

The local-first SDK ships as an npm package with native dependencies:

```bash
npm install @pristine/shield-local
```

On `postinstall`:
1. Detects platform (darwin-arm64, darwin-x64, linux-x64, etc.)
2. Downloads pre-built native binaries for `node-llama-cpp` and `onnxruntime-node`
3. Does NOT download model weights yet (deferred to first use)

### 7.2 First Run

```typescript
import { PristineLocal } from '@pristine/shield-local';

const pristine = await PristineLocal.create({
  // Optional: override defaults
  dataDir: '~/.pristine/data',
  modelsDir: '~/.pristine/models',
});
// First call triggers model download (~4.8 GB one-time)

await pristine.store([
  { role: 'user', content: 'I live in Tokyo and my phone is 090-1234-5678' },
  { role: 'assistant', content: 'Got it!' }
]);

const results = await pristine.search('where do I live?');
// [{ text: 'User lives in Tokyo', score: 0.92, ... }]
```

### 7.3 Model Download

**Recommended:** Pre-download models before first use:

```bash
npx pristine-local download-models
# Downloads Qwen2.5-7B-Instruct (4.5 GB) + Nomic Embed v1.5 (300 MB)
# Shows progress bar, supports resume on network failure
# Verifies checksums after download
```

**Auto-download fallback:** If `PristineLocal.create()` is called without pre-downloaded models, it downloads them automatically. The `create()` call will take several minutes on the first run. A `DownloadError` is thrown if the download fails (network, disk full, checksum mismatch).

**Downloads are resumable.** Partial downloads are kept on disk. If interrupted, the next attempt resumes from where it left off (HTTP Range headers).

Models are cached permanently in `~/.pristine/models/`. Delete the directory to force re-download.

Or point to custom models:

```typescript
PristineLocal.create({
  llmModel: '/path/to/my-model.gguf',
  embedModel: '/path/to/my-embed.onnx',
});
```

### 7.4 Agent Tool Usage

The primary consumption pattern is agents calling `search` as a tool. The SDK should be designed to work as a tool handler:

```typescript
// Agent framework registers Pristine search as a tool
const tools = [
  {
    name: 'search_memory',
    description: 'Search the user\'s memory for relevant facts, preferences, and past conversations.',
    parameters: {
      query: { type: 'string', description: 'What to search for' },
      temporal_mode: { type: 'string', enum: ['current', 'full'], default: 'current' },
    },
    handler: async ({ query, temporal_mode }) => {
      const results = await pristine.search(query, { temporalMode: temporal_mode });
      return results.memories.map(m => m.text);
    }
  }
];
```

Similarly, `store` is called after each conversation turn to ingest new memories, and `secureAndRedact` is called before passing user messages to the LLM.

### 7.5 Dogfooding Setup

For Lou to use this on his laptop:

```bash
cd ~/projects/my-agent
npm install @pristine/shield-local
```

```typescript
// In agent code
import { PristineLocal } from '@pristine/shield-local';

const memory = await PristineLocal.create();

// Ingest a conversation
await memory.store(messages);

// Search memories
const results = await memory.search('what does the user prefer?');

// PII redaction (same API as hosted)
const redacted = await memory.secureAndRedact(messages);
```

No Docker, no PostgreSQL, no API keys, no server. Just `npm install` and go.

---

## 8. Build Order

Local first. The modular architecture (interfaces for each component) means a hosted version could be supported in the future by swapping implementations, but that is out of scope for this spec.

---

## 9. Repository Structure

New repo at `~/projects/pristine`. Interfaces, types, prompts, and tool schemas are ported from the existing memory repo at `~/projects/memory` (GitHub: `getlou-gh/memory`). Server infrastructure (Express, Supabase, auth, rate limiting) is left behind.

```
pristine-local/
├── src/
│   ├── index.ts                        # Public API: PristineLocal.create()
│   │
│   ├── core/                           # Shared types, interfaces, errors, database
│   │   ├── types.ts                    #   Fact, Memory, Message, Episode, Entity, Relationship, PromptConfig
│   │   ├── interfaces.ts              #   All module interfaces (LlmClient, Embedder, Store, etc.)
│   │   ├── errors.ts                  #   Domain error hierarchy (AppError base + subclasses)
│   │   └── database.ts               #   SQLite connection factory (WAL, integrity check, sqlite-vec)
│   │
│   ├── engine/                         # LLM inference engines (swappable — see Extension Guide)
│   │   ├── index.ts                    #   Auto-detect factory: createLlmClient()
│   │   ├── types.ts                    #   LlamaCppConfig, OllamaConfig
│   │   ├── llamacpp/                   #   In-process engine (node-llama-cpp v3, grammar-constrained)
│   │   │   └── index.ts
│   │   └── ollama/                     #   HTTP engine (Ollama /api/chat, structured output)
│   │       └── index.ts
│   │
│   ├── embedder/                       # Embedding inference (swappable — see Extension Guide)
│   │   ├── types.ts                    #   Embedder interface re-export
│   │   └── local/                      #   @huggingface/transformers + Nomic Embed v1.5 (768-dim)
│   │       └── index.ts
│   │
│   ├── models/                         # Model registry + download manager
│   │   ├── registry.ts                 #   Model name → URL + SHA-256 + size mapping
│   │   └── download.ts                 #   Resumable HTTP download with checksum verification
│   │
│   ├── privacy/                        # Privacy pipeline (classify → redact → encrypt → vault)
│   │   ├── index.ts                    #   secureAndRedact(), reveal(), scrubOutput()
│   │   ├── sanitizer/                  #   Placeholder detection, resolution, LLM reentry guards
│   │   │   ├── index.ts
│   │   │   └── types.ts
│   │   ├── classifier/                 #   PII detection (deterministic + LLM + combined)
│   │   │   ├── types.ts
│   │   │   ├── deterministic/          #   Regex patterns (credit card, email, SSN, phone)
│   │   │   │   └── index.ts
│   │   │   ├── llm/                    #   LLM-based classifier (uses LlmClient.generate<T>())
│   │   │   │   ├── index.ts
│   │   │   │   ├── prompts.ts          #   Default classification prompt (configurable)
│   │   │   │   └── schema.ts           #   classify_sensitivity JSON Schema
│   │   │   └── combined/               #   Runs both in parallel, merges + deduplicates
│   │   │       └── index.ts
│   │   └── vault/                      #   Encrypted PII storage (RSA-4096 + AES-256-GCM)
│   │       ├── types.ts
│   │       ├── asymmetric-crypto.ts    #   RSA key gen, wrap/unwrap DEK
│   │       ├── asymmetric-encrypt.ts   #   AES-256-GCM envelope encryption
│   │       ├── base64url.ts            #   URL-safe Base64 encoding
│   │       ├── redaction.ts            #   Smart redaction with entity filtering
│   │       └── sqlite/                 #   SQLite vault + public key store
│   │           └── index.ts
│   │
│   └── memory/                         # Memory pipeline (ingest → extract → store → search)
│       ├── temporal/                   #   Temporal field validation (ISO dates, bounds)
│       │   ├── index.ts
│       │   └── types.ts
│       ├── extractor/                  #   Fact extraction from conversations (uses LlmClient)
│       │   ├── types.ts
│       │   ├── index.ts
│       │   ├── prompts.ts              #   Default extraction prompt (configurable)
│       │   └── schema.ts               #   extract_facts JSON Schema
│       ├── store/                      #   Memory persistence (SQLite + sqlite-vec + FTS5)
│       │   ├── types.ts
│       │   └── sqlite/
│       │       └── index.ts
│       ├── consolidator/               #   Fact dedup/merge decisions (uses LlmClient)
│       │   ├── types.ts
│       │   ├── index.ts
│       │   ├── prompts.ts              #   Default consolidation prompt (configurable)
│       │   └── schema.ts               #   consolidate_facts JSON Schema
│       ├── query-analyzer/             #   Query intent analysis + rewriting (uses LlmClient)
│       │   ├── types.ts
│       │   ├── index.ts
│       │   ├── prompts.ts              #   Default query analysis prompt (configurable)
│       │   └── schema.ts               #   analyze_query JSON Schema
│       ├── retriever/                  #   Search + fusion (vector + keyword + temporal ranking)
│       │   ├── types.ts
│       │   ├── index.ts
│       │   └── ranking.ts              #   Temporal boost functions
│       ├── orchestrator/               #   Pipeline coordination
│       │   ├── types.ts                #   PipelineStep, IngestResult, RetrieveResult
│       │   ├── index.ts                #   Orchestrator class with ingest() + retrieve()
│       │   ├── ingest.ts               #   Ingest pipeline (chunk → extract → embed → consolidate → store)
│       │   ├── retrieve.ts             #   Retrieve pipeline (analyze → embed → search → rank)
│       │   ├── chunker.ts              #   Conversation chunking
│       │   └── turn-order.ts           #   Message ordering within chunks
│       ├── episodes/                   #   Episodic memory (conversation summaries)
│       │   ├── types.ts
│       │   └── sqlite/
│       │       └── index.ts
│       └── graph/                      #   Entity graph / relational memory
│           ├── types.ts
│           └── sqlite/
│               └── index.ts
│
├── tests/                              # Mirrors src/ structure
│   ├── core/
│   ├── engine/
│   ├── embedder/
│   ├── sanitizer/
│   ├── classifier/
│   ├── vault/
│   └── integration/                    #   End-to-end pipeline tests (engine, embedder, privacy)
│
├── benchmarks/                         #   Local micro-benchmarks (embedder throughput, etc.)
│
├── docs/
│   └── specs/
│       └── implementation-spec-001.md  #   This file
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── CLAUDE.md                           #   Coding conventions
└── README.md
```

### Module Interfaces

Every module exports an interface from its `types.ts`. Implementations live in subdirectories. This is the contract that enables parallel development — two developers (or coding agents) can work on different modules simultaneously as long as the interfaces don't change.

```typescript
// core/interfaces.ts — all module contracts in one place

export interface LlmClient {
  /** Generate a structured response matching the given JSON schema.
      The engine enforces the schema via grammar constraints (llama.cpp)
      or structured output (Ollama format parameter). */
  generate<T>(params: {
    systemPrompt: string;
    userPrompt: string;
    schema: JsonSchema;
    maxTokens?: number;
  }): Promise<T>;
}

export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: readonly string[]): Promise<number[][]>;
}

export interface Store {
  addMemory(memory: AddMemoryInput): Promise<Memory>;
  getMemory(id: string, userId: string): Promise<Memory | null>;
  searchSimilar(params: SearchParams): Promise<Memory[]>;
  updateMemory(id: string, updates: UpdateMemoryInput, userId: string): Promise<Memory>;
  deleteMemory(id: string, userId: string): Promise<void>;
  supersedeMemory(oldId: string, newMemory: AddMemoryInput, reason: string, validUntil?: string): Promise<SupersedeResult>;
  clearAll(userId?: string): Promise<void>;
}

export interface Extractor {
  extract(conversation: Message[], referenceTimestamp?: string): Promise<ExtractionResult>;
}

export interface Consolidator {
  consolidate(newFact: Fact, similarMemories: readonly Fact[]): Promise<ConsolidationResult>;
  consolidateBatch(requests: ConsolidationRequest[]): Promise<ConsolidationBatchResult>;
}

export interface SensitivityClassifier {
  classify(text: string): Promise<SensitivityReport>;
}

export interface VaultStore {
  addEntries(entries: VaultEntryInput[]): Promise<VaultEntry[]>;
  getEntriesByPlaceholderIds(userId: string, placeholderIds: string[]): Promise<VaultEntry[]>;
  deleteEntriesByMemoryId(memoryId: string): Promise<void>;
}

export interface EpisodeStore {
  addEpisode(episode: EpisodeInput): Promise<Episode>;
  searchByEmbedding(embedding: number[], topK: number): Promise<RankedEpisode[]>;
  linkMemory(memoryId: string, episodeId: string): Promise<void>;
}

export interface EntityStore {
  addEntity(entity: EntityInput): Promise<Entity>;
  resolve(name: string, type: string, userId: string, embedding?: number[]): Promise<Entity | null>;
  getEntity(id: string): Promise<Entity | null>;
}

export interface RelationshipStore {
  addRelationship(rel: RelationshipInput): Promise<Relationship>;
  traverse(entityId: string, maxDepth: number): Promise<TraversalResult[]>;
  searchByEmbedding(embedding: number[], topK: number): Promise<RankedRelationship[]>;
}

export interface Retriever {
  retrieve(query: string, userId: string, options?: RetrieveOptions): Promise<RetrieveResult>;
}
```

Each interface can be implemented independently. The orchestrator wires them together via dependency injection — same pattern as the existing codebase.

---

## 10. Implementation Phases

Phases are organized by workstream (privacy, then memory) with each module built end-to-end including its storage and inference. Shared infrastructure (SQLite connection, LLM engine, embedder) is scaffolded early. Each module creates its own SQLite tables when it needs them.

Each phase is scoped to be independently shippable and testable.

#### Source File Reference

Source repo: `~/projects/memory` (GitHub: `getlou-gh/memory`). All paths below are relative to that directory. Source files are ported into the appropriate module as each phase is built — not in a single bulk port.

**Types to port (~633 lines):**

| Source file | What to port | Lines |
|---|---|---|
| `src/memory/extractor/types.ts` | Message, Fact, TemporalConfidence, ExtractionResult | 88 |
| `src/memory/store/types.ts` | Memory, TemporalMode, Store, StoreTransaction, supersession types | 78 |
| `src/memory/consolidator/types.ts` | ConsolidationResult, ConsolidationAction, Consolidator interfaces | 85 |
| `src/privacy/classifier/types.ts` | DetectedEntity, SensitivityReport, SensitivityClassifier | 22 |
| `src/privacy/classifier/llm/types.ts` | LlmSensitivityFinding, LlmClassifierConfig | 33 |
| `src/privacy/vault/types.ts` | VaultEntry, ZkV2EncryptedValue, encryption metadata | 67 |
| `src/memory/retriever/types.ts` | RankedMemory, RetrieveFilters, Retriever | 23 |
| `src/memory/query-analyzer/types.ts` | AnalyzedQuery, QueryAnalyzer, tool input schemas | 141 |
| `src/memory/orchestrator/types.ts` | Orchestrator, PipelineStep, IngestResult | 62 |
| `src/embedder/types.ts` | Embedder, EmbeddingClient, EmbeddingResponse | 34 |

**Prompts to port (~161 lines):**

| Source file | What to port | Lines |
|---|---|---|
| `src/prompts/extraction.ts` | `buildExtractionPrompt()` — temporal extraction rules | 67 |
| `src/prompts/consolidation.ts` | `buildConsolidationPrompt()` — UPDATE vs SUPERSEDE decision tree | 50 |
| `src/prompts/classification.ts` | `buildClassificationPrompt()` — privacy/PII detection | 21 |
| `src/prompts/query-analysis.ts` | `buildQueryAnalysisPrompt()` — query intent analysis | 19 |

**Tool schemas to port (embedded in implementation files):**

| Source file | Schema | Lines |
|---|---|---|
| `src/memory/extractor/index.ts` lines 22-63 | `EXTRACT_FACTS_TOOL` — facts array with temporal fields | 41 |
| `src/memory/consolidator/index.ts` lines 118-166 | `consolidateFactsTool` — decisions array with actions | 48 |
| `src/privacy/classifier/llm/index.ts` lines 21-60 | `CLASSIFY_SENSITIVITY_TOOL` — findings array with type/confidence | 39 |
| `src/memory/query-analyzer/types.ts` lines 62-114 | `analyze_query` tool — intent/filters/rewrittenQuery | 52 |

**Utilities to port (~1,449 lines):**

| Source file | What to port | Lines |
|---|---|---|
| `src/privacy/sanitizer/index.ts` | PLACEHOLDER_REGEX, resolve(), sanitizeText(), assertNoLlmReentry() | 390 |
| `src/privacy/sanitizer/types.ts` | SensitiveField, SanitizedMemory, ResolveInput | 40 |
| `src/memory/temporal/index.ts` | validateTemporalFields() — ISO date validation, confidence rules | 111 |
| `src/memory/temporal/types.ts` | TemporalValidationOptions, TemporalValidationResult | 13 |
| `src/memory/orchestrator/chunker.ts` | chunkConversation(), CHUNK_SIZE, CHUNK_OVERLAP | 26 |
| `src/memory/retriever/ranking.ts` | applyTemporalBoosts(), recencyBoost(), currentFactBoost(), confidenceBoost() | 50 |
| `src/privacy/classifier/index.ts` | extractCleanSpans(), mergeReports(), CombinedClassifier merge/dedup logic | 117 |
| `src/privacy/vault/asymmetric-crypto.ts` | RSA key generation, validation, DEK wrap/unwrap, key fingerprint | 115 |
| `src/privacy/vault/asymmetric-encrypt.ts` | AES-256-GCM + RSA-OAEP envelope encryption | 42 |
| `src/privacy/vault/base64url.ts` | base64url encoding/decoding utilities | 69 |
| `src/privacy/vault/redaction.ts` | Redaction/reveal logic, placeholder-to-vault flow | 228 |
| `src/privacy/vault/index.ts` | VaultStore implementation (adapt from PostgreSQL to SQLite) | 248 |

**Tests to port (~5,826 lines):**

Tests are ported alongside their module in each phase, not in bulk. Mocked tests adapt `messages.create` to `generate<T>()`. Store tests (PostgreSQL-specific) are rewritten for SQLite rather than ported.

*Directly portable (mock-based or pure logic, ~5,826 lines):*

| Source file | Coverage | Lines |
|---|---|---|
| `tests/pipeline/chunker.test.ts` | Chunking boundaries, overlaps, custom params | 86 |
| `tests/pipeline/sanitizer.test.ts` | Placeholder replacement, field ordering, approval flow | 335 |
| `tests/pipeline/temporal-validator.test.ts` | Date validation, confidence handling, edge cases | 227 |
| `tests/pipeline/extractor.test.ts` | Mocked Claude client — fact extraction, temporal parsing | 542 |
| `tests/pipeline/consolidator.test.ts` | Mocked Claude client — consolidation decisions, batch handling | 712 |
| `tests/pipeline/embedder.test.ts` | Mocked embedding client — batch embedding, retries | 362 |
| `tests/pipeline/query-analyzer.test.ts` | Mocked Claude client — query analysis, intent detection | 506 |
| `tests/pipeline/classifier.test.ts` | Sensitivity classification logic + extractCleanSpans | 462 |
| `tests/pipeline/llm-classifier.test.ts` | Mocked Claude client — reentry guard | 22 |
| `tests/pipeline/orchestrator.test.ts` | Mocked pipeline — ingest/retrieve wiring, step composition | 1,071 |
| `tests/pipeline/retriever.test.ts` | Mocked store/embedder — retrieval logic | 355 |
| `tests/pipeline/retriever-ranking.test.ts` | Temporal boost functions — pure logic | 283 |
| `tests/pipeline/temporal-extraction-accuracy.test.ts` | Temporal extraction edge cases | 305 |
| `tests/vault/asymmetric-crypto.test.ts` | RSA key operations — pure crypto | 194 |
| `tests/vault/asymmetric-encrypt.test.ts` | AES-256-GCM envelope — pure crypto | 182 |
| `tests/vault/vault-redaction.test.ts` | Redaction/reveal flow — pure logic | 275 |

*Rewrite for SQLite (PostgreSQL-specific, ~1,150 lines — used as behavioral reference):*

| Source file | Coverage | Lines |
|---|---|---|
| `tests/pipeline/store.test.ts` | PostgreSQL UUID error handling | 33 |
| `tests/pipeline/store-supersede.test.ts` | Supersession with DB transactions | 283 |
| `tests/pipeline/store-temporal-modes.test.ts` | Temporal mode queries with pgvector | 148 |
| `tests/pipeline/supersession-chains.test.ts` | Chain traversal with DB | 403 |
| `tests/pipeline/supersession-chain-retrieval.test.ts` | Chain retrieval integration | 283 |

*Intentionally dropped:*

| Source file | Reason |
|---|---|
| `tests/pipeline/presidio-classifier.test.ts` | Presidio replaced by deterministic classifier |
| `tests/pipeline/turn-order-contract.test.ts` | Server-specific turn ordering, not needed in local-first |

**Total portable: ~5,497 lines of source + ~5,826 lines of tests (+ ~1,150 lines rewrite reference)**

---

### Phase 0: Foundation

Scaffold + contracts. No module implementations yet, but everything compiles.

#### Tasks

- [ ] 0.1: Init TypeScript project (package.json, tsconfig strict + ESM, vitest, eslint, prettier)
- [ ] 0.2: Set up `CLAUDE.md` with project-specific coding conventions
- [ ] 0.3: Create `src/core/types.ts` — consolidate all shared types from the source files listed above into unified type definitions. Add new types for Episode, Entity, Relationship (not in the existing repo — defined in the Section 6 SQLite schema and Section 9 interfaces). Include `PromptConfig` interface (see Section 5.4) and `LocalConfig` interface (see Section 5.3).
- [ ] 0.4: Create `src/core/interfaces.ts` — define all module interfaces (LlmClient, Embedder, Store, Extractor, Consolidator, SensitivityClassifier, VaultStore, EpisodeStore, EntityStore, RelationshipStore, Retriever). The `LlmClient` interface uses the new `generate<T>()` shape (see Section 5.2), not the Anthropic SDK shape from the source repo.
- [ ] 0.5: Create `src/core/errors.ts` — define base error class and domain-specific errors: `LlmClassificationError`, `DownloadError`, `ResolveApprovalError`, `ResolveApprovalTimeoutError`, and others as needed. Per coding conventions: explicit error types, never throw generic `Error`.
- [ ] 0.6: Create directory structure for all modules (see Section 9) with placeholder `types.ts` files re-exporting from `core/interfaces.ts`
- [ ] 0.7: SQLite connection scaffolding — `better-sqlite3` dependency, connection factory, WAL mode, integrity check. No tables yet.
- [ ] 0.8: Verify: `npm run typecheck` passes, `npm run lint` passes

**Exit criteria:** Repo compiles, lints. All interfaces defined. A developer can read any module's contract and know what to implement.

---

### Phase 1: Shared Infrastructure

LLM engine + embedder. Everything that uses inference depends on these.

#### Tasks

- [ ] 1.1: `src/engine/llamacpp/` — `LlamaCppClient` implementing `LlmClient.generate<T>()` with grammar-constrained generation via `createGrammarForJsonSchema()`
- [ ] 1.2: `src/engine/ollama/` — `OllamaClient` implementing `LlmClient.generate<T>()` via HTTP (`/api/chat` with `format: schema`)
- [ ] 1.3: Model config (`LocalConfig`), model path resolution (`~/.pristine/models/`), model singleton (load once on `create()`, keep resident)
- [ ] 1.4: `src/models/` — model registry (model name -> URL + checksum mapping) + download manager (resumable, progress reporting)
- [ ] 1.5: Engine auto-detect: if `llmEngine` is not set in config and Ollama is reachable at `localhost:11434` (or `OLLAMA_HOST`), default to Ollama engine and skip model download. Otherwise fall back to `llamacpp`.
- [ ] 1.6: `src/embedder/local/` — `LocalEmbedder` with `@huggingface/transformers` + Nomic Embed v1.5, 768-dim output
- [ ] 1.7: Tests: engine produces valid structured output for sample schemas; embedder produces correct-dimension vectors
- [ ] 1.8: Benchmark: measure embedder throughput on M-series Mac (target: >500 embeddings/sec for short texts)

```typescript
// In-process (self-contained, ~4.5 GB download on first use)
PristineLocal.create({ llmEngine: 'llamacpp', llmModel: 'qwen2.5-7b-instruct-q4_k_m' });

// Ollama (zero download if user already has the model)
PristineLocal.create({ llmEngine: 'ollama', llmModel: 'qwen2.5:7b' });
```

**Exit criteria:** `LlmClient.generate<T>()` works with both engines. `Embedder.embed()` produces 768-dim vectors. Model download works.

---

### Phase 2: Privacy Pipeline

End-to-end: text in -> classified -> redacted -> encrypted PII stored in SQLite -> revealable. Each module built completely with its own storage.

#### Phase 2a: Sanitizer

- [ ] 2a.1: Port `src/privacy/sanitizer/` from source — pure logic: PLACEHOLDER_REGEX, resolve(), sanitizeText(), assertNoLlmReentry(), approval flow
- [ ] 2a.2: Port `src/privacy/sanitizer/types.ts` — SensitiveField, SanitizedMemory, ResolveInput
- [ ] 2a.3: Port sanitizer tests (drop the 2 API endpoint tests that import from `src/api/`)
- [ ] 2a.4: Verify: sanitizer tests pass

#### Phase 2b: Classifier

- [ ] 2b.1: Port classification prompt (`buildClassificationPrompt()`) into `src/privacy/classifier/llm/prompts.ts`
- [ ] 2b.2: Port classify_sensitivity schema into `src/privacy/classifier/llm/schema.ts` — adapted to plain JSON Schema for `LlmClient.generate<T>()` (not Anthropic tool format)
- [ ] 2b.3: Implement LLM classifier using `LlmClient` — port parsing/validation logic from source `src/privacy/classifier/llm/index.ts`, adapt from Anthropic SDK `messages.create()` to `generate<T>()`
- [ ] 2b.4: Implement deterministic classifier (new — regex/rule-based patterns for structural PII replacing Presidio). No Docker dependency.
- [ ] 2b.5: Implement combined classifier — port `extractCleanSpans()` + `mergeReports()` from source `src/privacy/classifier/index.ts`, parallel execution of deterministic + LLM, span dedup merge
- [ ] 2b.6: Port + adapt classifier tests — mock `generate<T>()` instead of `messages.create`
- [ ] 2b.7: Test: PII detection on multilingual text (Mandarin, Hindi, Japanese, Spanish) — the main improvement over Presidio

#### Phase 2c: Vault

- [ ] 2c.1: Port vault crypto utilities from source: `asymmetric-crypto.ts` (RSA key ops), `asymmetric-encrypt.ts` (AES-256-GCM + RSA-OAEP wrapping), `base64url.ts` (encoding), `redaction.ts` (redaction/reveal logic)
- [ ] 2c.2: Create vault SQLite tables (`vault_entries`, `user_public_keys`) — module creates its own tables on init
- [ ] 2c.3: Implement `SqliteVaultStore` adapting source `src/privacy/vault/index.ts` from PostgreSQL to SQLite (same zk-v2 encryption scheme)
- [ ] 2c.4: Implement `SqlitePublicKeyStore`
- [ ] 2c.5: Port vault crypto tests (`asymmetric-crypto.test.ts`, `asymmetric-encrypt.test.ts`, `vault-redaction.test.ts`)
- [ ] 2c.6: Tests: encrypt/decrypt round-trip, entry CRUD, placeholder lookup

#### Phase 2d: Privacy Integration

- [ ] 2d.1: Wire sanitizer + classifier + vault into `secureAndRedact()`, `reveal()`, `scrubOutput()` public API methods
- [ ] 2d.2: End-to-end test: raw text -> PII detected -> redacted -> vault stored -> revealed with decrypted values

**Exit criteria:** Full privacy pipeline works. Classify, redact, vault encrypt/decrypt. No Presidio, no external APIs. SQLite vault tables created and populated.

---

### Phase 3: Memory Pipeline — Core

End-to-end: conversation in -> chunked -> facts extracted -> embedded -> consolidated -> stored in SQLite -> searchable.

#### Phase 3a: Pure Logic Utilities

- [ ] 3a.1: Port `src/memory/temporal/` (validateTemporalFields, pure logic) + types + tests
- [ ] 3a.2: Port `src/memory/orchestrator/chunker.ts` (chunkConversation, CHUNK_SIZE, CHUNK_OVERLAP) + tests

#### Phase 3b: Extractor

- [ ] 3b.1: Port extraction prompt (`buildExtractionPrompt()`) into `src/memory/extractor/prompts.ts`
- [ ] 3b.2: Port extract_facts schema into `src/memory/extractor/schema.ts` — adapted to plain JSON Schema for `generate<T>()`
- [ ] 3b.3: Implement extractor using `LlmClient` — port parsing, validation, pronoun filter, temporal field extraction from source `src/memory/extractor/index.ts`, adapt from Anthropic SDK to `generate<T>()`
- [ ] 3b.4: Port + adapt extractor tests — mock `generate<T>()` instead of `messages.create`

#### Phase 3c: Store

- [ ] 3c.1: Create memories SQLite tables (`memories`, `memory_vectors` via sqlite-vec 768-dim, `memories_fts` via FTS5 + sync triggers) — module creates its own tables on init
- [ ] 3c.2: Implement `SqliteStore` matching `Store` interface (addMemory, getMemory, searchSimilar via sqlite-vec cosine distance, updateMemory, deleteMemory, supersedeMemory, getSupersessionChain, clearAll)
- [ ] 3c.3: Content hash dedup (SHA-256 + UNIQUE constraint on user_id + content_hash)
- [ ] 3c.4: Tests: CRUD, vector search ranking, temporal queries (valid_from/valid_until filtering), supersession chains

#### Phase 3d: Consolidator

- [ ] 3d.1: Port consolidation prompt (`buildConsolidationPrompt()`) into `src/memory/consolidator/prompts.ts`
- [ ] 3d.2: Port consolidate_facts schema into `src/memory/consolidator/schema.ts` — adapted to plain JSON Schema
- [ ] 3d.3: Implement consolidator using `LlmClient` — port batch logic, integer-to-UUID ID remapping, retry with exponential backoff, validation, post-validation downgrades (SUPERSEDE->ADD, UPDATE->ADD, DELETE->NOOP) from source `src/memory/consolidator/index.ts`
- [ ] 3d.4: Port + adapt consolidator tests — mock `generate<T>()` instead of `messages.create`

#### Phase 3e: Query Analyzer

**Latency note:** Each LLM-based query analysis adds ~3-4s to search latency. The source implementation already has a heuristic fallback path (empty/failed queries return defaults without an LLM call). For the local version, consider making LLM analysis optional — use heuristic-only by default and LLM analysis when the query is complex or ambiguous. This decision can be made during implementation.

- [ ] 3e.1: Port query analysis prompt (`buildQueryAnalysisPrompt()`) into `src/memory/query-analyzer/prompts.ts`
- [ ] 3e.2: Port analyze_query schema into `src/memory/query-analyzer/schema.ts` — adapted to plain JSON Schema
- [ ] 3e.3: Implement query analyzer using `LlmClient` — port validation, fallback logic from source `src/memory/query-analyzer/index.ts`. Include heuristic-only mode for low-latency search.
- [ ] 3e.4: Port + adapt query analyzer tests — mock `generate<T>()` instead of `messages.create`

#### Phase 3f: Embedder Integration

- [ ] 3f.1: Port + adapt embedder tests (mock EmbeddingClient interface, test batching/chunking/retry logic). Note: `LocalEmbedder` implementation already exists from Phase 1 — this step ports the test coverage from the source repo.

#### Phase 3g: Retriever

- [ ] 3g.1: Port retriever ranking logic from source `src/memory/retriever/ranking.ts` — applyTemporalBoosts(), recencyBoost(), currentFactBoost(), confidenceBoost()
- [ ] 3g.2: Implement basic retriever (vector search via sqlite-vec + temporal filtering + keyword search via FTS5 BM25 + temporal boost re-ranking)
- [ ] 3g.3: Port + adapt retriever tests (`retriever.test.ts`, `retriever-ranking.test.ts`)
- [ ] 3g.4: Tests: search returns ranked results with correct scores, temporal filtering and boost re-ranking works

#### Phase 3h: Orchestrator + Integration

- [ ] 3h.1: Wire chunker + extractor + embedder + store + consolidator + temporal validation into ingest pipeline via dependency injection
- [ ] 3h.2: Wire query analyzer + embedder + retriever into retrieve pipeline
- [ ] 3h.3: `store()` and `search()` public API methods
- [ ] 3h.4: Port + adapt orchestrator tests from source `tests/pipeline/orchestrator.test.ts` (mocked pipeline wiring — adapt to local interfaces)
- [ ] 3h.5: End-to-end test: ingest a multi-turn conversation, search, verify correct facts returned with temporal fields

**Exit criteria:** Full memory ingest + retrieve cycle works. Conversation in, facts stored in SQLite, searchable by vector + keyword + temporal. No external APIs.

---

### Phase 4: Episodic Memory

Extends memory pipeline with full conversation preservation + summary search (Phase 5 from spec 002).

#### Tasks

- [ ] 4.1: Create episodes SQLite tables (`episodes`, `episode_vectors` via sqlite-vec 768-dim, `memory_episodes` junction) — module creates its own tables on init
- [ ] 4.2: Implement `SqliteEpisodeStore` (CRUD + summary embedding search via cosine similarity)
- [ ] 4.3: Episode summary generation via `LlmClient` (1-3 sentence summary per conversation). Prompt configurable via `PromptConfig.episodeSummary`.
- [ ] 4.4: Embed summary via `Embedder`, store in `episode_vectors`
- [ ] 4.5: Add episode storage step to ingest pipeline (runs in parallel with extraction)
- [ ] 4.6: Link extracted facts to source episode via `memory_episodes` junction
- [ ] 4.7: Extend retriever with episode search channel
- [ ] 4.8: Test: ingest conversation, verify episode created with correct summary + links
- [ ] 4.9: Test: search "remember that conversation about X?" returns correct episode

**Exit criteria:** Episodes stored alongside facts. Summary search finds relevant conversations. Facts linked to source episodes.

---

### Phase 5: Relational Memory (Entity Graph)

Extends memory pipeline with entity extraction + graph queries (Phase 6 from spec 002, SQLite replaces Neo4j).

#### Tasks

- [ ] 5.1: Create graph SQLite tables (`entities`, `entity_vectors` via sqlite-vec, `relationships`, `relationship_vectors` via sqlite-vec, `relationships_fts` via FTS5 + sync triggers) — module creates its own tables on init
- [ ] 5.2: Implement `SqliteEntityStore` (CRUD + embedding-based resolution)
- [ ] 5.3: Implement `SqliteRelationshipStore` (CRUD + temporal fields valid_from/valid_until + soft delete via is_invalid)
- [ ] 5.4: Entity resolution logic in `EntityStore.resolve()`: exact name match -> alias match (via json_each on aliases JSON array) -> embedding similarity via entity_vectors. Deterministic, no LLM. LLM disambiguation deferred to a future phase.
- [ ] 5.5: Extend extractor tool schema to output entities + relationships alongside facts (single LLM pass). Prompt configurable via `PromptConfig.entityExtractor`.
- [ ] 5.6: Relationship storage with temporal fields (valid_from/valid_until, same validation as memory temporal)
- [ ] 5.7: Graph traversal via recursive CTEs (multi-hop queries, configurable depth, bidirectional, cycle detection via path tracking — see Section 6)
- [ ] 5.8: Wire entity extraction + resolution into ingest pipeline (runs after fact extraction)
- [ ] 5.9: Extend retriever with graph search channel
- [ ] 5.10: Test: extract entities from "Sarah works at Google", verify entity nodes + relationship edge created
- [ ] 5.11: Test: entity resolution merges "my wife" and "Sarah" into same entity
- [ ] 5.12: Test: multi-hop query "who works at the same company as Sarah?" traverses graph correctly

**Exit criteria:** Entities and relationships stored in SQLite. Multi-hop graph queries work via recursive CTEs. Entity resolution handles aliases and embedding-based matching.

---

### Phase 6: Retrieval Fusion

Unifies all search channels into a single ranked result set.

#### Tasks

- [ ] 6.1: Implement RRF (Reciprocal Rank Fusion) to merge ranked results from: fact vector search, keyword search (FTS5), episode summary search, graph traversal search
- [ ] 6.2: Implement MMR (Maximal Marginal Relevance) diversification to reduce redundant results
- [ ] 6.3: Retriever accepts `sources` parameter: `['facts', 'keywords', 'episodes', 'graph']` (default: all)
- [ ] 6.4: Configurable per-source weights (e.g., vector: 0.4, keyword: 0.2, episode: 0.2, graph: 0.2)
- [ ] 6.5: Extend query analyzer to detect new intents: `relational_query`, `broad_query` (from spec 002) for routing to graph channel
- [ ] 6.6: All retrieval channels run in parallel, fusion step runs after all return
- [ ] 6.7: Test: query that matches a fact, an episode, and a graph entity returns fused results
- [ ] 6.8: Benchmark: measure retrieval latency with all channels active (target: <200ms at 100K memories)

**Exit criteria:** Single search query returns fused results from all memory types. Latency within target.

---

### Phase 7: SDK Package + Distribution

Package everything for `npm install`.

#### Tasks

- [ ] 7.1: `PristineLocal` client class wrapping all local components (extractor, embedder, store, classifier, vault, episodes, graph)
- [ ] 7.2: Public API: `store()`, `search()`, `secureAndRedact()`, `reveal()`, `scrubOutput()`
- [ ] 7.3: `npx pristine-local download-models` CLI command
- [ ] 7.4: Platform-specific native binary distribution (darwin-arm64, darwin-x64, linux-x64)
- [ ] 7.5: `postinstall` script for native dependency setup
- [ ] 7.6: Integration test: `npm install` from scratch on clean machine, run full pipeline
- [ ] 7.7: Dogfooding test: use in a real agent project

**Exit criteria:** `npm install @pristine/shield-local` + `PristineLocal.create()` works end-to-end. No server, no API keys, no Docker.

---

### Phase 8: Benchmarking

Comprehensive quality measurement of the local pipeline. MemoryBench is a separate repository (`getlou-gh/memorybench`) — the pristine-local provider is added there, not in this repo. The `benchmarks/` directory in this repo is reserved for local micro-benchmarks (latency, throughput).

#### Tasks

- [ ] 8.1: Add `pristine-local` as a new MemoryBench provider in the MemoryBench repo (`memorybench/src/providers/`)
- [ ] 8.2: Provider implements the same `Provider` interface (ingest sessions, search, clear) using local components directly (no HTTP, in-process)
- [ ] 8.3: Run LongMemEval smoke test (1-2 questions) with local provider, verify end-to-end scoring
- [ ] 8.4: Run full LongMemEval (10+ questions), compare accuracy against hosted baseline
- [ ] 8.5: Run multilingual PII detection benchmark (compare against Presidio + Haiku baseline)
- [ ] 8.6: Run episodic retrieval evaluation (custom test set)
- [ ] 8.7: Run entity resolution accuracy test
- [ ] 8.8: Document results: quality deltas, latency, storage, and recommendations
- [ ] 8.9: If accuracy is below threshold, identify which model/prompt changes would close the gap

**Exit criteria:** Published benchmark report comparing local vs hosted across all memory types and privacy.

---

### Phase 9: Two-Phase Ingestion

Optimize ingest latency by making content searchable immediately via FTS5 keyword index, then running the full LLM extraction pipeline asynchronously. Inspired by memvid's two-phase enrichment pattern (Searchable -> Enriched).

Currently `store()` blocks until the full pipeline completes (~19s on M4 Pro). For background ingest after a conversation ends this is acceptable, but for interactive use cases (agent mid-conversation) the latency is a UX problem. Two-phase ingestion decouples search availability from extraction latency.

#### Tasks

- [ ] 9.1: On `store()`, immediately index raw conversation text in `memories_fts` (FTS5) and return a pending ingest handle
- [ ] 9.2: Run the LLM pipeline (chunk -> extract -> embed -> consolidate) asynchronously in the background
- [ ] 9.3: `search()` returns both FTS5 keyword matches (available immediately) and vector/fact matches (available after extraction completes), with a flag indicating enrichment status
- [ ] 9.4: Ingest handle exposes `await completion()` for callers that need to wait for full extraction
- [ ] 9.5: Track enrichment state per conversation: `pending` -> `extracting` -> `enriched` -> `failed`
- [ ] 9.6: On startup, detect incomplete enrichments and resume them (crash recovery)
- [ ] 9.7: Test: store() returns before extraction completes, keyword search works immediately, fact search works after enrichment
- [ ] 9.8: Benchmark: measure time-to-first-search-result with two-phase vs current pipeline

**Exit criteria:** `store()` returns in <100ms. Keyword search available immediately. Fact/vector search available after background enrichment (~19s). Enrichment state tracked and resumable.

---

### Phase 10: PII Detection Evaluation

Measure precision, recall, and span accuracy of the privacy classifier (deterministic + LLM combined) against a curated fixture set. The classifier is only as good as its weakest detection — this phase quantifies gaps before they reach production.

#### Tasks

- [ ] 10.1: Build PII evaluation fixture set — 50+ annotated text samples with ground-truth entity annotations (type, start, end, text). Cover: structural PII (credit cards, SSN, email, phone), contextual PII (health, financial, legal, relationship), multilingual PII (Mandarin, Japanese, Hindi, Spanish), edge cases (partial addresses, dates vs DOB, travel phrases, mixed PII density)
- [ ] 10.2: Implement eval runner — takes fixture set + classifier, computes per-entity-type precision, recall, F1, and span IoU (intersection over union for positional accuracy)
- [ ] 10.3: Run deterministic classifier eval — measure regex pattern coverage, false positive rate on clean text, span accuracy
- [ ] 10.4: Run LLM classifier eval with target model (Llama 3.2 3B, Qwen 2.5 7B) — measure detection rate across all PII categories, confidence calibration, type label consistency
- [ ] 10.5: Run combined classifier eval — measure merge quality (does overlap dedup lose entities?), combined precision/recall vs individual classifiers
- [ ] 10.6: Measure false positive rate — run classifier on 50+ clean text samples (news articles, code, casual conversation) and verify near-zero false detections
- [ ] 10.7: Measure redaction fidelity — run full secureAndRedact -> reveal round-trip on fixture set, verify all original values recovered exactly
- [ ] 10.8: Document baseline metrics and identify gaps — which PII types are under-detected, which models perform best, recommended confidence thresholds per type
- [ ] 10.9: If accuracy is below threshold on any category, iterate on prompts, regex patterns, or recommend model upgrades

**Exit criteria:** Published PII detection report with per-type precision/recall. Combined classifier F1 >= 0.85 on structural PII, >= 0.75 on contextual PII. False positive rate < 5% on clean text. All round-trip reveal tests pass.

---

## 11. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Small model quality for extraction/consolidation | Incorrect facts, bad dedup decisions | Fine-tune on Pristine's existing data. Use larger models (13B) if quality insufficient. Models will improve. Users can swap models via config. |
| node-llama-cpp stability / cross-platform issues | Build failures on some platforms | Pre-built binaries per platform (v3 ships them). Fallback to Ollama HTTP API as escape hatch. |
| ~4.8 GB model download on first use | Poor first-run experience | Show progress bar. Offer download-models CLI. Support custom model paths and connection to existing models from huggingface and Ollama that users may have already downloaded. |
| SQLite concurrent write limitations | SQLITE_BUSY errors if multiple processes write | SQLite WAL mode + busy timeout (5s retry). Document single-writer constraint. If two agent processes share the same DB, writes are serialized — reads are concurrent. |
| Model loading latency | 4.5 GB GGUF takes several seconds to load | `PristineLocal.create()` loads the model once and keeps it resident (singleton). Subsequent calls reuse the loaded model. Document that first call is slow (~3-5s). |
| Embedding dimension change (1536 -> 768) | Existing hosted memories incompatible | Local and hosted are separate data stores by design. No migration needed. |
| Tool calling quality with small models | Malformed JSON from local LLM | node-llama-cpp's `createGrammarForJsonSchema()` forces valid JSON at the grammar level. Retry logic already exists. |
| sqlite-vec brute-force search | Latency increases linearly with vector count | ~30-50ms at 100K vectors is acceptable for local use. If scale exceeds this, migrate to LanceDB or wait for sqlite-vec ANN support (on their roadmap). |
| Bonsai-8B / 1-bit models not yet GGUF-compatible | Can't use smallest models today | Use Qwen2.5 7B or Llama 3.2 3B now. When llama.cpp adds 1-bit support (or BitNet.cpp matures), swap model file — no code changes needed. |
