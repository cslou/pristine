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
| `src/classifier/deterministic/` | **New** | Rule-based classifier replacing Presidio. Same `SensitivityClassifier` interface. Custom regex patterns, no Docker. |
| `src/classifier/llm/` | **Modify** | Replace Anthropic SDK client with local LLM client. Same tool schema, same output types. Prompt configurable via `PromptConfig.classifier`. |
| `src/classifier/index.ts` | **Keep** | `CombinedClassifier` merge logic stays — still runs both classifiers in parallel and deduplicates. |
| `src/vault/` | **Modify** | Replace PostgreSQL backend with SQLite backend. Same interface. |
| `src/privacy/` | **Modify** | Replace PostgreSQL key store with SQLite. Same interface. |

### 3.4 What Stays the Same

- `SensitivityClassifier` interface (unchanged)
- `DetectedEntity` type (unchanged)
- Redaction logic in `src/sanitizer/` (unchanged)
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
| `src/extractor/` | **Modify** | Replace Anthropic client with local LLM client. Extend tool schema to also extract entities + relationships (Phase 6). Same `Extractor` interface. |
| `src/embedder/` | **Replace** | New `LocalEmbedder` using ONNX Runtime + Nomic Embed. Implements same `Embedder` interface. Output dimension changes from 1536 to 768. |
| `src/consolidator/` | **Modify** | Replace Anthropic client with local LLM client. Same `Consolidator` interface, same tool schema. Retry logic unchanged. |
| `src/store/` | **New impl** | New `SqliteStore` implementing existing `Store` interface. SQLite + sqlite-vec for vector search. Same schema shape. |
| `src/vault/` | **Modify** | Replace PostgreSQL backend with SQLite (shared DB file with store). |
| `src/retriever/` | **Modify** | Extend to support episode search + graph-enhanced retrieval + RRF fusion. |
| `src/orchestrator/` | **Modify** | Add episode storage step (parallel with extraction). Add entity resolution + relationship storage step (after extraction). |
| `src/episodes/` | **New** | `EpisodeStore` interface + `SqliteEpisodeStore`. Summary generation, episode search, fact-episode linking. |
| `src/graph/` | **New** | `EntityStore` + `RelationshipStore` interfaces + SQLite implementations. Entity resolution (name/alias/embedding match). Graph traversal queries. Replaces the planned Neo4j integration from spec 002. |

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

New repo, clean slate. Interfaces, types, prompts, and tool schemas are ported from the existing `getlou-gh/memory` repo. Server infrastructure (Express, Supabase, auth, rate limiting) is left behind.

```
pristine-local/
├── src/
│   ├── index.ts                        # Public API: PristineLocal.create()
│   │
│   ├── core/                           # Shared types and interfaces
│   │   ├── types.ts                    #   Fact, Memory, Message, Episode, Entity, Relationship
│   │   └── interfaces.ts              #   All module interfaces (see below)
│   │
│   ├── engine/                         # LLM inference engines (swappable)
│   │   ├── types.ts                    #   LlmClient interface
│   │   ├── llamacpp/                   #   In-process engine (node-llama-cpp)
│   │   │   └── index.ts
│   │   └── ollama/                     #   HTTP engine (Ollama API)
│   │       └── index.ts
│   │
│   ├── embedder/                       # Embedding inference (swappable)
│   │   ├── types.ts                    #   Embedder interface
│   │   └── local/                      #   @huggingface/transformers + Nomic Embed
│   │       └── index.ts
│   │
│   ├── store/                          # Memory persistence (swappable)
│   │   ├── types.ts                    #   Store interface
│   │   └── sqlite/                     #   SQLite + sqlite-vec implementation
│   │       ├── index.ts
│   │       ├── schema.ts              #   Table definitions + migrations
│   │       └── vectors.ts             #   sqlite-vec queries
│   │
│   ├── extractor/                      # Fact extraction from conversations (swappable)
│   │   ├── types.ts                    #   Extractor interface
│   │   ├── index.ts                    #   Implementation (uses LlmClient)
│   │   └── prompts.ts                  #   Default extraction prompt
│   │
│   ├── consolidator/                   # Fact dedup/merge decisions (swappable)
│   │   ├── types.ts                    #   Consolidator interface
│   │   ├── index.ts                    #   Implementation (uses LlmClient)
│   │   └── prompts.ts                  #   Default consolidation prompt
│   │
│   ├── classifier/                     # PII detection (swappable)
│   │   ├── types.ts                    #   SensitivityClassifier interface
│   │   ├── deterministic/              #   Rule-based classifier (regex patterns)
│   │   │   └── index.ts
│   │   ├── llm/                        #   LLM-based classifier (uses LlmClient)
│   │   │   ├── index.ts
│   │   │   └── prompts.ts             #   Default classification prompt
│   │   └── combined/                   #   Runs both in parallel, merges results
│   │       └── index.ts
│   │
│   ├── vault/                          # Encrypted PII storage (swappable)
│   │   ├── types.ts                    #   VaultStore interface
│   │   └── sqlite/                     #   SQLite implementation
│   │       └── index.ts
│   │
│   ├── episodes/                       # Episodic memory (swappable)
│   │   ├── types.ts                    #   EpisodeStore interface
│   │   └── sqlite/                     #   SQLite implementation
│   │       └── index.ts
│   │
│   ├── graph/                          # Entity graph / relational memory (swappable)
│   │   ├── types.ts                    #   EntityStore, RelationshipStore interfaces
│   │   └── sqlite/                     #   SQLite implementation
│   │       └── index.ts
│   │
│   ├── retriever/                      # Search + fusion (swappable)
│   │   ├── types.ts                    #   Retriever interface
│   │   └── index.ts                    #   Fused retrieval (vector + keyword + episodes + graph)
│   │
│   ├── orchestrator/                   # Pipeline coordination
│   │   ├── types.ts                    #   Pipeline interfaces
│   │   ├── ingest.ts                   #   Ingest pipeline (extract → embed → consolidate → store)
│   │   ├── retrieve.ts                 #   Retrieve pipeline (analyze → embed → search → fuse)
│   │   └── chunker.ts                  #   Conversation chunking
│   │
│   ├── sanitizer/                      # Redaction + LLM reentry guards
│   │   └── index.ts
│   │
│   ├── temporal/                       # Temporal validation
│   │   └── index.ts
│   │
│   └── models/                         # Model registry + download manager
│       ├── registry.ts                 #   Model name → URL + checksum mapping
│       └── download.ts                 #   Download + cache logic
│
├── tests/                              # Mirrors src/ structure
│   ├── engine/
│   ├── embedder/
│   ├── store/
│   ├── extractor/
│   ├── consolidator/
│   ├── classifier/
│   ├── vault/
│   ├── episodes/
│   ├── graph/
│   ├── retriever/
│   ├── orchestrator/
│   └── integration/                    #   End-to-end pipeline tests
│
├── benchmarks/                         #   MemoryBench integration
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
  messages: {
    create(params: LlmRequest): Promise<LlmResponse>;
  };
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

Each phase is scoped to be independently shippable and testable.

---

### Phase 0: Repository Setup

New repo with project scaffolding, all interfaces defined, all module directories created. Source files are ported from the existing `getlou-gh/memory` repo.

#### Source File Reference (getlou-gh/memory)

**Types to port (~633 lines):**

| Source file | What to port | Lines |
|---|---|---|
| `src/extractor/types.ts` | Message, Fact, TemporalConfidence, ExtractionResult | 88 |
| `src/store/types.ts` | Memory, TemporalMode, Store, StoreTransaction, supersession types | 78 |
| `src/consolidator/types.ts` | ConsolidationResult, ConsolidationAction, Consolidator interfaces | 85 |
| `src/classifier/types.ts` | DetectedEntity, SensitivityReport, SensitivityClassifier | 22 |
| `src/classifier/llm/types.ts` | LlmSensitivityFinding, LlmClassifierConfig | 33 |
| `src/vault/types.ts` | VaultEntry, ZkV2EncryptedValue, encryption metadata | 67 |
| `src/retriever/types.ts` | RankedMemory, RetrieveFilters, Retriever | 23 |
| `src/query-analyzer/types.ts` | AnalyzedQuery, QueryAnalyzer, tool input schemas | 141 |
| `src/orchestrator/types.ts` | Orchestrator, PipelineStep, IngestResult | 62 |
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
| `src/extractor/index.ts` lines 22-63 | `EXTRACT_FACTS_TOOL` — facts array with temporal fields | 41 |
| `src/consolidator/index.ts` lines 118-166 | `consolidateFactsTool` — decisions array with actions | 48 |
| `src/classifier/llm/index.ts` lines 21-60 | `CLASSIFY_SENSITIVITY_TOOL` — findings array with type/confidence | 39 |
| `src/query-analyzer/types.ts` lines 62-114 | `analyze_query` tool — intent/filters/rewrittenQuery | 52 |

**Utilities to port (~580 lines):**

| Source file | What to port | Lines |
|---|---|---|
| `src/sanitizer/index.ts` | PLACEHOLDER_REGEX, resolve(), sanitizeText(), assertNoLlmReentry() | 390 |
| `src/sanitizer/types.ts` | SensitiveField, SanitizedMemory, ResolveInput | 40 |
| `src/temporal/index.ts` | validateTemporalFields() — ISO date validation, confidence rules | 111 |
| `src/temporal/types.ts` | TemporalValidationOptions, TemporalValidationResult | 13 |
| `src/orchestrator/chunker.ts` | chunkConversation(), CHUNK_SIZE, CHUNK_OVERLAP | 26 |

**Tests to port (~3,254 lines, all mocked — no DB/API dependencies):**

| Source file | Coverage | Lines |
|---|---|---|
| `tests/pipeline/chunker.test.ts` | Chunking boundaries, overlaps, custom params | 86 |
| `tests/pipeline/sanitizer.test.ts` | Placeholder replacement, field ordering, approval flow | 335 |
| `tests/pipeline/temporal-validator.test.ts` | Date validation, confidence handling, edge cases | 227 |
| `tests/pipeline/extractor.test.ts` | Mocked Claude client — fact extraction, temporal parsing | 542 |
| `tests/pipeline/consolidator.test.ts` | Mocked Claude client — consolidation decisions, batch handling | 712 |
| `tests/pipeline/embedder.test.ts` | Mocked embedding client — batch embedding, retries | 362 |
| `tests/pipeline/query-analyzer.test.ts` | Mocked Claude client — query analysis, intent detection | 506 |
| `tests/pipeline/classifier.test.ts` | Sensitivity classification logic | 22 |
| `tests/pipeline/llm-classifier.test.ts` | Mocked Claude client — finding detection, confidence | 462 |

**Total portable: ~4,628 lines of source + ~3,254 lines of tests**

#### Tasks

- [ ] 0.1: Create repo (`pristine-local`), initialize with TypeScript, Vitest, ESLint, Prettier
- [ ] 0.2: Set up `tsconfig.json` (strict mode, ESM, path aliases)
- [ ] 0.3: Create `src/core/types.ts` — consolidate all shared types from the source files listed above into unified type definitions. Add new types for Episode, Entity, Relationship (not in the existing repo).
- [ ] 0.4: Create `src/core/interfaces.ts` — define all module interfaces (LlmClient, Embedder, Store, Extractor, Consolidator, SensitivityClassifier, VaultStore, EpisodeStore, EntityStore, RelationshipStore, Retriever). The `LlmClient` interface uses the new `generate<T>()` shape (see Section 5.2), not the Anthropic SDK shape from the source repo.
- [ ] 0.5: Create directory structure for all modules (see Section 9) with placeholder `types.ts` files re-exporting from `core/interfaces.ts`
- [ ] 0.6: Create `tests/` directory structure mirroring `src/`
- [ ] 0.7: Port prompts — copy from source `src/prompts/*.ts`, place into module-local `prompts.ts` files (e.g., `src/extractor/prompts.ts`, `src/consolidator/prompts.ts`)
- [ ] 0.8: Port tool schemas — extract from source implementation files (see table above), place into module-local `schema.ts` files. Adapt to work with the new `LlmClient.generate<T>()` interface (JSON Schema objects, not Anthropic tool format).
- [ ] 0.9: Port sanitizer (`src/sanitizer/`) and temporal validation (`src/temporal/`) from source — these are pure logic, copy directly
- [ ] 0.10: Port chunker (`src/orchestrator/chunker.ts`) + its tests — pure logic, copy directly
- [ ] 0.11: Port tests — copy all test files from the table above. Adapt mocked clients to use the new `LlmClient` interface instead of the Anthropic SDK shape. Tests for sanitizer, temporal, and chunker need no changes.
- [ ] 0.12: Set up `CLAUDE.md` with coding conventions
- [ ] 0.13: Verify: `npm test` runs, `npm run typecheck` passes, `npm run lint` passes

**Exit criteria:** Repo compiles, lints, and has all interfaces defined. Every module directory exists with its `types.ts`. Ported tests pass. A developer can pick any module, read the interface, and start implementing without touching other modules.

---

### Phase 1a: Local LLM Runtime (In-Process)

Stand up the in-process LLM inference layer via node-llama-cpp.

- [ ] 1a.1: Add `node-llama-cpp` dependency, verify GGUF model loading on Mac (M-series) and Linux
- [ ] 1a.2: Define `LocalLlmClient` interface matching `ConsolidatorClient` / Anthropic SDK `messages.create()` shape
- [ ] 1a.3: Implement `LlamaCppClient` (in-process engine) with grammar-constrained generation (JSON grammar from tool schema)
- [ ] 1a.4: Test: pass existing extractor tool schema, verify structured JSON output from Qwen2.5 7B / Llama 3.2
- [ ] 1a.5: Test: pass existing consolidator tool schema, verify decisions array output
- [ ] 1a.6: Test: pass existing LLM classifier tool schema, verify PII entity detection output
- [ ] 1a.7: Model config interface (`LocalConfig`) + model path resolution (`~/.pristine/models/`)
- [ ] 1a.8: Model singleton — load once on `create()`, keep resident, reuse across calls

**Exit criteria:** `LlamaCppClient` can produce valid tool-call responses for all three existing tool schemas (extractor, consolidator, classifier).

---

### Phase 1b: Ollama Engine Support

Add Ollama as an alternative LLM engine for users who already have it installed. Same `LocalLlmClient` interface, HTTP backend instead of in-process.

- [ ] 1b.1: Implement `OllamaClient` implementing `LocalLlmClient` interface
- [ ] 1b.2: HTTP client targeting `localhost:11434` (configurable via `OLLAMA_HOST` env var)
- [ ] 1b.3: Map `LocalLlmClient.messages.create()` to Ollama's `/api/chat` endpoint with `tools` parameter
- [ ] 1b.4: Parse Ollama's tool-call response format back into the `LocalLlmClient` response shape
- [ ] 1b.5: Auto-detect rule: if `llmEngine` is not set in config and Ollama is reachable at `localhost:11434` (or `OLLAMA_HOST`), default to Ollama engine and skip model download. Otherwise fall back to `llamacpp`.
- [ ] 1b.6: Test: same three tool schema tests as Phase 1a, but via Ollama with `qwen2.5:7b`
- [ ] 1b.7: Engine selection config: `llmEngine: 'llamacpp' | 'ollama'`

**Exit criteria:** `OllamaClient` passes the same tool-call tests as `LlamaCppClient`. User with Ollama already running can use Pristine with zero model download — just `npm install` + config.

```typescript
// In-process (self-contained, ~4.5 GB download on first use)
PristineLocal.create({ llmEngine: 'llamacpp', llmModel: 'qwen2.5-7b-instruct-q4_k_m' });

// Ollama (zero download if user already has the model)
PristineLocal.create({ llmEngine: 'ollama', llmModel: 'qwen2.5:7b' });
```

---

### Phase 2: Local Embedder

Stand up local embedding inference.

- [ ] 2.1: Add `@huggingface/transformers` dependency (wraps ONNX Runtime + handles tokenization + model download)
- [ ] 2.2: Verify Nomic Embed v1.5 model loads and runs via `@huggingface/transformers` on Mac M-series
- [ ] 2.3: Implement `LocalEmbedder` class matching `Embedder` interface (`embed()` + `embedBatch()`)
- [ ] 2.4: Output 768-dim vectors (vs current 1536-dim). Document dimension change.
- [ ] 2.5: Benchmark: measure throughput on M-series Mac (target: >500 embeddings/sec for short texts)
- [ ] 2.6: Test: verify cosine similarity ranking quality against a small hand-curated test set

**Exit criteria:** `LocalEmbedder` passes existing embedder unit tests (adapted for 768-dim output).

---

### Phase 3: SQLite Store

Replace PostgreSQL + pgvector with SQLite + sqlite-vec.

- [ ] 3.1: Add `better-sqlite3` + `sqlite-vec` dependencies
- [ ] 3.2: Create SQLite schema: `memories` table (mirrors PostgreSQL schema, minus pgvector types)
- [ ] 3.3: Create `memory_vectors` virtual table (sqlite-vec, 768-dim)
- [ ] 3.4: Implement `SqliteStore` matching existing `Store` interface (addMemory, getMemory, searchSimilar, updateMemory, deleteMemory, supersedeMemory, getSupersessionChain, clearAll)
- [ ] 3.5: Implement `searchSimilar` using sqlite-vec cosine distance query
- [ ] 3.6: Implement content hash dedup (same SHA-256 + ON CONFLICT logic)
- [ ] 3.7: WAL mode + file locking for concurrent access safety
- [ ] 3.8: Test: port existing store unit tests to run against `SqliteStore`
- [ ] 3.9: Test: verify temporal queries (valid_from/valid_until filtering, supersession chains)

**Exit criteria:** `SqliteStore` passes all existing store interface tests. Single-file database created at configurable path.

---

### Phase 4: Local Ingest Pipeline (Semantic + Temporal Memory)

Wire phases 1-3 together into a working local ingest pipeline.

- [ ] 4.1: Create `LocalExtractor` wrapping `LocalLlmClient` with existing `extract_facts` tool schema
- [ ] 4.2: Create `LocalConsolidator` wrapping `LocalLlmClient` with existing `consolidate_facts` tool schema
- [ ] 4.3: Wire `LocalExtractor` + `LocalEmbedder` + `SqliteStore` + `LocalConsolidator` into orchestrator via dependency injection
- [ ] 4.4: Verify chunking works with local LLM (adjust prompts if needed for smaller model)
- [ ] 4.5: Verify temporal extraction (validFrom, validUntil, temporalConfidence) with local LLM
- [ ] 4.6: Verify supersession chains (SUPERSEDE action + supersessionReason) with local LLM
- [ ] 4.7: Verify retrieval pipeline (embed query + sqlite-vec search + temporal filtering)
- [ ] 4.8: End-to-end test: ingest a multi-turn conversation, search, verify correct facts returned

**Exit criteria:** Full ingest + retrieve cycle works locally. No API calls. All data in SQLite.

---

### Phase 5: MemoryBench Integration

Ensure MemoryBench can benchmark the local memory pipeline (extraction + retrieval). Privacy benchmarking is separate and comes after Phase 6.

- [ ] 5.1: Add `pristine-local` as a new MemoryBench provider in `benchmarks/memorybench/src/providers/`
- [ ] 5.2: Provider implements the same `Provider` interface (ingest sessions, search, clear)
- [ ] 5.3: Provider uses `LocalExtractor` + `LocalEmbedder` + `SqliteStore` + `LocalConsolidator` directly (no HTTP, in-process)
- [ ] 5.4: Run LongMemEval smoke test (1-2 questions) with local provider, verify end-to-end scoring
- [ ] 5.5: Compare local vs hosted accuracy on same question set (document quality delta)
- [ ] 5.6: Add benchmark config flag: `--provider pristine-local --model <model-path>`

**Exit criteria:** `bun run src/index.ts run -p pristine-local -b longmemeval -j gpt-4o -s 1` completes end-to-end and produces scored results.

---

### Phase 6: Local Privacy (PII Redaction)

Replace Presidio + Claude classifier with two local classifiers: deterministic (rule-based) and non-deterministic (local LLM).

- [ ] 6.1: Implement `DeterministicClassifier` implementing `SensitivityClassifier` interface — regex/rule-based patterns for structural PII (credit cards, emails, phone numbers, common ID formats). No Docker, no Presidio.
- [ ] 6.2: Implement `LocalLlmClassifier` implementing `SensitivityClassifier` interface, using `LocalLlmClient` with existing `classify_sensitivity` tool schema. Prompt configurable via `PromptConfig.classifier`.
- [ ] 6.3: Wire both into `CombinedClassifier` (parallel execution + span dedup merge, same pattern as current Presidio + LLM)
- [ ] 6.4: Create `SqliteVaultStore` implementing `VaultStore` interface (same encryption scheme, SQLite backend)
- [ ] 6.5: Create `SqlitePublicKeyStore` implementing `UserPublicKeyStore` interface
- [ ] 6.6: Test: PII detection on English text (compare against current Presidio + LLM baseline)
- [ ] 6.7: Test: PII detection on multilingual text (Mandarin, Hindi, Japanese, Spanish) — the main improvement over Presidio
- [ ] 6.8: Test: vault encrypt/decrypt round-trip with SQLite backend
- [ ] 6.9: Test: full privacy flow (classify -> redact -> vault store -> reveal -> decrypt)

**Exit criteria:** PII detection works across multiple languages using both classifiers. Vault encrypt/decrypt works with SQLite. No Presidio, no external API calls.

---

### Phase 7: Episodic Memory

Full conversation preservation + summary-based search (Phase 5 from spec 002).

- [ ] 7.1: Add `episodes` + `episode_vectors` + `memory_episodes` tables to SQLite schema
- [ ] 7.2: Define `Episode` type + `EpisodeStore` interface
- [ ] 7.3: Implement `SqliteEpisodeStore` (CRUD + summary embedding search)
- [ ] 7.4: Episode summary generation via local LLM (1-3 sentence summary per conversation)
- [ ] 7.5: Embed summary via `LocalEmbedder`, store in `episode_vectors`
- [ ] 7.6: Add episode storage step to ingest pipeline (runs in parallel with extraction)
- [ ] 7.7: Link extracted facts to source episode via `memory_episodes` junction
- [ ] 7.8: Implement episode search (cosine similarity on summary embeddings)
- [ ] 7.9: Test: ingest conversation, verify episode created with correct summary + links
- [ ] 7.10: Test: search "remember that conversation about X?" returns correct episode

**Exit criteria:** Episodes stored alongside facts. Summary search finds relevant conversations. Facts linked to source episodes.

---

### Phase 8: Relational Memory (Entity Graph)

Entity extraction, resolution, and graph queries (Phase 6 from spec 002, SQLite replaces Neo4j).

- [ ] 8.1: Add `entities` + `entity_vectors` + `relationships` + `relationship_vectors` tables to SQLite schema
- [ ] 8.2: Define `Entity`, `Relationship` types + `EntityStore`, `RelationshipStore` interfaces
- [ ] 8.3: Implement `SqliteEntityStore` (CRUD + embedding-based resolution)
- [ ] 8.4: Implement `SqliteRelationshipStore` (CRUD + temporal fields + soft delete)
- [ ] 8.5: Extend extractor tool schema to output entities + relationships alongside facts (single LLM pass)
- [ ] 8.6: Entity resolution logic in `EntityStore.resolve()`: exact name match -> alias match -> embedding similarity (deterministic, no LLM). LLM disambiguation deferred to a future phase — it adds latency and complexity to the write path.
- [ ] 8.7: Relationship storage with temporal fields (valid_from/valid_until, inherits from Phase 4 temporal)
- [ ] 8.8: Graph traversal via recursive CTEs (multi-hop queries, configurable depth)
- [ ] 8.9: Wire entity extraction + resolution into ingest pipeline (runs after fact extraction)
- [ ] 8.10: Test: extract entities from "Sarah works at Google", verify entity nodes + relationship edge created
- [ ] 8.11: Test: entity resolution merges "my wife" and "Sarah" into same entity
- [ ] 8.12: Test: multi-hop query "who works at the same company as Sarah?" traverses graph correctly

**Exit criteria:** Entities and relationships stored in SQLite. Multi-hop graph queries work via recursive CTEs. Entity resolution handles aliases and embedding-based matching.

---

### Phase 9: Retrieval Fusion

Unified search across all memory types.

- [ ] 9.1: Add FTS5 tables (`memories_fts`, `relationships_fts`) and triggers to keep them in sync with base tables
- [ ] 9.2: Implement keyword search channel (FTS5 BM25 ranking)
- [ ] 9.3: Implement RRF (Reciprocal Rank Fusion) to merge ranked results from: fact vector search, keyword search, episode search, graph search
- [ ] 9.4: Implement MMR (Maximal Marginal Relevance) diversification to reduce redundant results
- [ ] 9.5: Retriever accepts `sources` parameter: `['facts', 'keywords', 'episodes', 'graph']` (default: all)
- [ ] 9.6: Configurable per-source weights (e.g., vector: 0.4, keyword: 0.2, episode: 0.2, graph: 0.2)
- [ ] 9.7: Extend query analyzer to detect new intents: `relational_query`, `broad_query` (from spec 002) for routing to graph channel
- [ ] 9.8: All retrieval channels run in parallel, fusion step runs after all return
- [ ] 9.9: Test: query that matches a fact, an episode, and a graph entity returns fused results
- [ ] 9.10: Benchmark: measure retrieval latency with all channels active (target: <200ms at 100K memories, accounting for brute-force sqlite-vec across multiple vector tables)

**Exit criteria:** Single search query returns fused results from all memory types. Latency within target.

---

### Phase 10: SDK Package + Distribution

Package everything for `npm install`.

- [ ] 10.1: Create `packages/ts-sdk-local/` workspace package
- [ ] 10.2: `PristineLocal` client class wrapping all local components (extractor, embedder, store, classifier, vault, episodes, graph)
- [ ] 10.3: Public API: `store()`, `search()`, `secureAndRedact()`, `reveal()`, `scrubOutput()`
- [ ] 10.4: Model download manager (check `~/.pristine/models/`, download on first use, progress reporting)
- [ ] 10.5: `npx pristine-local download-models` CLI command
- [ ] 10.6: Platform-specific native binary distribution (darwin-arm64, darwin-x64, linux-x64)
- [ ] 10.7: `postinstall` script for native dependency setup
- [ ] 10.8: Integration test: `npm install` from scratch on clean machine, run full pipeline
- [ ] 10.9: Dogfooding test: Lou uses it in a real agent project on his laptop

**Exit criteria:** `npm install @pristine/shield-local` + `PristineLocal.create()` works end-to-end. No server, no API keys, no Docker.

---

### Phase 11: MemoryBench Full Benchmark

Comprehensive quality measurement of the local pipeline.

- [ ] 11.1: Run full LongMemEval (10+ questions) with local provider, compare accuracy against hosted baseline
- [ ] 11.2: Run multilingual PII detection benchmark (compare against Presidio + Haiku baseline)
- [ ] 11.3: Run episodic retrieval evaluation (custom test set)
- [ ] 11.4: Run entity resolution accuracy test
- [ ] 11.5: Document results: quality deltas, latency, storage, and recommendations
- [ ] 11.6: If accuracy is below threshold, identify which model/prompt changes would close the gap

**Exit criteria:** Published benchmark report comparing local vs hosted across all memory types and privacy.

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
