# Pristine Local

Local-first privacy and memory SDK for AI agents. No API calls, no server, no data leaving the device.

Pristine gives agents persistent memory (remember facts from conversations) and privacy protection (detect, redact, and encrypt PII) using local LLM inference and SQLite storage. Everything runs on-device.

> **Status — spec-005 Phase 1 complete (sprint-013).** The SDK surface has been trimmed to the **corpus + privacy + queue** subsystems. The LOCOMO-aimed fact-extraction pipeline (extractor / consolidator / fact-ledger store / legacy memory subsystems / orchestrator retrieval path) has been removed to make room for the corpus-based architecture defined in `docs/specs/implementation-spec-005.md`. The Phase-1 public API is: `PristineLocal.create()` / `PristineLocal.createLite()`, `storeAsync()`, `searchConversations()`, `getConversation()`, and the privacy triad (`secureAndRedact` / `reveal` / `scrubOutput`). The Phase-2 indexer + Phase-3/4 searcher primitives are deferred to upcoming sprints; the "How Memory Works → Fact Extraction Pipeline" section below describes the **pre-pivot** behavior and will be rewritten when those primitives land.

## Table of Contents

- [Architecture](#architecture)
- [Storage Layout](#storage-layout)
- [Directory Structure](#directory-structure)
- [Getting Started](#getting-started)
- [Initialization](#initialization)
- [Model Configuration](#model-configuration)
- [How Privacy Works](#how-privacy-works)
- [How Memory Works](#how-memory-works)
  - [Conversation Store](#conversation-store)
  - [Fact Extraction Pipeline](#fact-extraction-pipeline)
- [Multi-User and Multi-Agent](#multi-user-and-multi-agent)
- [SDK Integration Guide](#sdk-integration-guide)
- [Extension Guide](#extension-guide)
- [Development](#development)
- [Benchmarks](#benchmarks)

---

## Architecture

Pristine has three layers — conversation storage, memory extraction, and privacy — accessed through a single `PristineLocal` SDK client:

```
                    +-------------------+
                    |   Agent Harness   |
                    | (Claude Code, Pi) |
                    +--------+----------+
                             |
                    +--------v----------+
                    |  PristineLocal    |
                    |  SDK Client       |
                    |  store() search() |
                    +--------+----------+
                             |
         +-------------------+-------------------+
         |                   |                   |
+--------v--------+ +-------v--------+ +--------v--------+
| Conversation    | | Memory Pipeline| | Privacy Pipeline |
| Store           | | (Ingest)       | | secureAndRedact()|
| SQLite + FTS5   | | extract, embed,| | reveal()         |
| searchConvs()   | | consolidate,   | | scrubOutput()    |
| getConv()       | | store facts    | |                  |
+-----------------+ +----------------+ +-----------------+
         |                   |                   |
         +-------------------+-------------------+
                             |
              +--------------+--------------+
              |              |              |
     +--------v--+  +-------v----+  +------v-------+
     | LLM Engine |  | Embedder   |  | SQLite + Vec |
     | (Ollama or |  | (Nomic     |  | (better-     |
     |  llama.cpp)|  |  Embed 1.5)|  |  sqlite3)    |
     +-----------+  +------------+  +--------------+
```

**Layers:**
- **Conversation Store** (`src/conversations/`) — Persists raw conversations in SQLite with FTS5 full-text search. Every `store()` call writes the conversation here first, before any extraction. Searchable by keyword and date. Each extracted fact links back to its source conversation via `sourceConversationId`.
- **Memory Pipeline** (`src/memory/`) — 7-step ingest pipeline: store conversation, extract facts via LLM, embed, find similar, consolidate (dedup/supersede), store facts, validate. Retrieval via vector similarity + temporal filtering.
- **Privacy Pipeline** (`src/privacy/`) — Detect PII (regex + LLM), redact with encrypted placeholders, store originals in AES-256-GCM vault, reveal on demand.

**Shared infrastructure:**
- **LLM Engine** (`src/engine/`) — Two backends: `node-llama-cpp` (in-process GGUF) or Ollama (HTTP). Both implement the `LlmClient` interface with grammar-constrained JSON output via `generate<T>()`.
- **Embedder** (`src/embedder/`) — Nomic Embed v1.5 via `@huggingface/transformers`. 768-dimensional vectors, runs in-process.
- **SQLite** (`src/core/database.ts`) — Single database file with WAL mode, `sqlite-vec` for vector search, FTS5 for keyword search.

---

## Storage Layout

`initPristine()` bootstraps the full `~/.pristine/` directory tree on first run. Everything Pristine needs is under this single directory.

```
~/.pristine/                         (0o700) Root — created by initPristine()
  models.json                        Model configuration (auto-created with Ollama defaults)
  keys/                              (0o700) RSA key pairs
    {userId}-private.pem             (0o600) RSA-4096 private key
    {userId}-public.pem              (0o644) RSA-4096 public key
  data/                              (0o700) SQLite database
    pristine.db                      WAL-mode database containing:
      conversations table              Raw conversations (id, user_id, content_hash)
      messages table                   Conversation messages (role, content, sort_order)
      messages_fts table               FTS5 full-text index on message content
      memories table                   Extracted facts + embeddings
      memory_vectors table             sqlite-vec vector index (768-dim)
      memories_fts table               FTS5 full-text index on fact text
      user_keks table                  Wrapped KEK per user (512-byte RSA-wrapped blob)
      vault_entries table              Wrapped DEK + encrypted PII per value
  models/                            GGUF model files (optional, for llama.cpp)
```

**What lives where:**

| Key | Storage | Persistence |
|-----|---------|-------------|
| RSA-4096 key pair | PEM files in `keys/` | On disk, survives restarts |
| Wrapped KEK | SQLite `user_keks` table (512-byte blob) | On disk in `pristine.db` |
| Wrapped DEK | SQLite `vault_entries.encryption_metadata` (40 bytes per value) | On disk in `pristine.db` |
| Plaintext KEK | `KekManager` in-memory cache | Process memory only, never on disk |
| Plaintext DEK | Ephemeral during encrypt/decrypt | Never persisted anywhere |

### Backup

A single `cp -r ~/.pristine/ backup/` captures everything needed to restore: keys, wrapped keys, encrypted data, memories, and model configuration. No external dependencies.

To restore: copy the backup to `~/.pristine/` on the new machine. All encrypted data is recoverable as long as the RSA private keys are present.

### Security

Pristine validates directory and file permissions on every key load, following the OpenSSH model:

- **Keys directory** (`~/.pristine/keys/`): must be `0o700` (owner-only). Rejects if group or others have any access.
- **Private key files**: must have no group/other bits set (`mode & 0o077 === 0`). Rejects with an error including the exact `chmod` command.
- **Data directory** (`~/.pristine/data/`): must be `0o700`. Contains wrapped encryption keys.
- **Windows**: all permission checks are skipped (`process.platform === 'win32'`).

If permissions are wrong, Pristine refuses to proceed with a descriptive error:
```
Permissions 0755 for '~/.pristine/keys/' are too open.
It is required that your key directory is NOT accessible by others.
Run: chmod 700 ~/.pristine/keys/
```

---

## Directory Structure

```
src/
  client.ts                 PristineLocal SDK client — create(), store(), search(), etc.
  index.ts                  Public API barrel exports

  core/                     Shared types, interfaces, errors, SQLite factory
    init.ts                 initPristine(), ModelConfig types, loadModelConfig()
    types.ts                All type definitions (Fact, Memory, Message, ConversationDetail, etc.)
    interfaces.ts           All module contracts (LlmClient, Embedder, Store, etc.)
    errors.ts               Domain error hierarchy (AppError + subclasses)
    database.ts             createDatabase(), createDefaultDatabase()

  conversations/            Conversation store
    store.ts                ConversationStore — addConversation(), getConversation(), searchConversations()

  engine/                   LLM inference backends
    llamacpp/               node-llama-cpp v3 (in-process, grammar-constrained)
    ollama/                 Ollama HTTP API (structured output via format: schema)
    index.ts                createLlmClients() — reads models.json, returns per-pipeline clients

  embedder/
    local/                  @huggingface/transformers + Nomic Embed v1.5 (768-dim)

  models/
    registry.ts             Model name -> URL + SHA-256 mapping
    download.ts             Resumable HTTP download with checksum verification

  privacy/                  Privacy pipeline
    index.ts                secureAndRedact(), reveal(), scrubOutput()
    rotation.ts             rotateKey() — O(1) RSA key rotation via KEK re-wrapping
    migration.ts            migrateToKek() — migrate legacy RSA-wrapped entries
    keys/
      filesystem.ts         FileSystemKeyManager — persists RSA keys to disk
    kek/
      kek-manager.ts        KekManager — KEK generation, caching, AES-256-KW wrapping
    sanitizer/              Placeholder detection, resolution, LLM reentry guards
    classifier/             PII detection
      deterministic/        Regex patterns (credit cards, emails, SSN, phone)
      llm/                  LLM-based contextual PII detection
      combined/             Runs both in parallel, deduplicates overlapping spans
    vault/                  Encrypted PII storage
      asymmetric-crypto.ts  RSA-4096 key generation, DEK wrapping (OAEP-256)
      asymmetric-encrypt.ts AES-256-GCM envelope encryption
      redaction.ts          Placeholder replacement (no filtering — redacts all entities)
      sqlite/               SQLite vault store

  memory/                   Memory pipeline
    temporal/               Temporal field validation (ISO dates, bounds, confidence)
    extractor/              Fact extraction from conversations via LLM
    consolidator/           Fact deduplication and supersession via LLM
    query-analyzer/         Search query rewriting and intent classification via LLM
    retriever/              Vector similarity search + temporal ranking
    store/
      sqlite/               Memory persistence (SQLite + sqlite-vec + FTS5)
    orchestrator/           Pipeline coordination
      index.ts              createOrchestrator() factory
      ingest.ts             7-step ingest pipeline (storeUser, extract, embed, search, consolidate, store, validate)
      retrieve.ts           2-step retrieve pipeline (analyze query, retrieve memories)
      pipeline.ts           Generic pipeline runner
      chunker.ts            Conversation chunking with overlap

tests/                      Mirrors src/ structure
  e2e/                      End-to-end tests via PristineLocal public API
  integration/              Pipeline integration tests (mocked LLM, real embedder)
  helpers/                  Test utilities (InMemoryKeyManager, etc.)
```

---

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **Ollama** (recommended) or a GGUF model file for llama.cpp

### Install

```bash
git clone https://github.com/getlou-gh/pristine.git
cd pristine
npm install
```

### Download Models

Pristine needs two models: an LLM for extraction/classification and an embedding model.

**Option A: Ollama (recommended — easiest setup)**

```bash
# Install Ollama (macOS)
brew install ollama

# Pull a model (llama3.2 is small and fast for testing)
ollama pull llama3.2

# Start the server
ollama serve
```

The embedding model (Nomic Embed v1.5) downloads automatically on first use via `@huggingface/transformers` — no manual step needed.

**Option B: GGUF model for llama.cpp (no Ollama dependency)**

```bash
# Create models directory
mkdir -p ~/.pristine/models

# Download a GGUF model (example: Qwen 2.5 7B, ~4.7GB)
curl -L -o ~/.pristine/models/qwen2.5-7b-instruct-q4_k_m.gguf \
  https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf

# Or a smaller model for testing (~2GB)
curl -L -o ~/.pristine/models/llama-3.2-3b-instruct-q4_k_m.gguf \
  https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf
```

The embedding model (Nomic Embed v1.5) downloads automatically on first use via `@huggingface/transformers` — no manual step needed.

### Verify Setup

```bash
# Run all tests (585+ should pass)
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

---

## Initialization

Call `initPristine()` once at startup. It creates the full `~/.pristine/` directory tree, writes a default `models.json` if one doesn't exist, and creates the SQLite database.

```typescript
import { initPristine } from './src/core/init.js';

const { config, baseDir, databasePath } = initPristine();
// Creates: ~/.pristine/, keys/ (0o700), data/ (0o700), models/,
//          models.json (Ollama defaults), data/pristine.db
```

Idempotent: safe to call on every startup. Existing config and data are preserved.

---

## Model Configuration

Pristine uses `~/.pristine/models.json` as the source of truth for which LLM engine and model to use. It is auto-created by `initPristine()` with Ollama defaults.

### Default config (auto-created)

```json
{
  "privacy": { "engine": "ollama", "model": "llama3.2:latest" },
  "memory": { "engine": "ollama", "model": "llama3.2:latest" }
}
```

Each pipeline (`privacy` for PII classification, `memory` for fact extraction) can use a different engine or model.

### Using Ollama

Install Ollama, pull a model, and Pristine works out of the box:

```bash
ollama pull llama3.2
ollama serve
```

Optional fields: `host` (defaults to `OLLAMA_HOST` env var or `localhost:11434`).

### Using llama.cpp

Edit `~/.pristine/models.json` to point to your GGUF file:

```json
{
  "privacy": { "engine": "llamacpp", "path": "/absolute/path/to/model.gguf" },
  "memory": { "engine": "llamacpp", "path": "/absolute/path/to/model.gguf" }
}
```

Optional fields: `gpu` (`auto`, `metal`, `cuda`, `vulkan`, or `false`).

Common GGUF locations if you already have models: `~/.lmstudio/models/`, `~/llama.cpp/models/`.

### Loading clients

```typescript
import { createLlmClients } from './src/engine/index.js';

const { privacyClient, memoryClient } = createLlmClients();
// Reads models.json, returns one or two LlmClient instances
// Same instance returned when both pipelines have identical config
```

### SDK escape hatch

SDK developers can construct clients directly, bypassing `models.json`:

```typescript
import { OllamaClient } from './src/engine/ollama/index.js';
import { LlamaCppClient } from './src/engine/llamacpp/index.js';

const client = new OllamaClient({ model: 'llama3.2:latest' });
const llamaClient = new LlamaCppClient({ modelPath: '/path/to/model.gguf' });
```

---

## How Privacy Works

The privacy pipeline detects PII in text, replaces it with encrypted placeholders, and stores the original values in an encrypted vault. The original values can be recovered with the private key.

### Pipeline Architecture

```
Input text
  |
  +---> Deterministic classifier (regex: credit cards, emails, SSN, phone)
  |     src/privacy/classifier/deterministic/
  |
  +---> LLM classifier (contextual: health, financial, relationships)
  |     src/privacy/classifier/llm/
  |
  v (both run in parallel)
+---------------------------+
| MERGE + DEDUP             |   Combine results, deduplicate overlapping spans
| classifier/combined/      |   Wider spans + higher confidence win
+---------------------------+
  |
  | SensitivityReport (entities with type, span, confidence)
  v
+---------------------------+
| REDACT                    |   Replace every entity with [SENSITIVE:type:id]
| vault/redaction.ts        |   No filtering — redacts all entities it receives
+---------------------------+
  |
  | RedactionResult (redacted text + placeholders)
  v
+---------------------------+
| ENCRYPT + VAULT           |   AES-256-GCM per value, KEK wrapping (AES-256-KW)
| vault/sqlite/             |   Store encrypted entries in SQLite
+---------------------------+
  |
  v
Output: redacted text + placeholder IDs (safe to send to any LLM)
```

### Module Responsibilities

Each module has a single responsibility. This allows contributors to optimize classifiers, redaction, or vault independently.

| Module | Responsibility | Does NOT do |
|--------|---------------|-------------|
| **Deterministic classifier** (`classifier/deterministic/`) | Regex-based PII detection: credit cards (Luhn-validated), emails, US SSN, phone numbers. High confidence, no LLM needed. | Contextual analysis, false positive filtering |
| **LLM classifier** (`classifier/llm/`) | Contextual PII detection via LLM: health conditions, financial info, legal matters, relationships, identity documents. Catches what regex misses. | Pattern matching (that's the deterministic classifier's job) |
| **Combined classifier** (`classifier/combined/`) | Runs both classifiers in parallel, merges reports, deduplicates overlapping spans. Returns final `SensitivityReport`. | Entity filtering or suppression |
| **Redaction** (`vault/redaction.ts`) | Replaces detected entities with `[SENSITIVE:type:id]` placeholders. Pure function: entities in, placeholders out. | Classification decisions, false positive filtering, heuristic checks |
| **Vault** (`vault/sqlite/`, `vault/asymmetric-encrypt.ts`) | Encrypts original PII values (AES-256-GCM + KEK wrapping) and stores in SQLite. | Detection, redaction |

**Design principle:** Classifiers decide what is PII. The redaction layer only executes replacements. Over-redaction (fail-closed) is preferred over under-redaction — if a classifier flags something, it gets redacted. False positive improvements belong in the classifier modules, not downstream.

### Flow Example

```
Input: "My email is alice@example.com and I live at 123 Main St"
  |
  v
1. CLASSIFY (deterministic regex + LLM in parallel)
   Detected: [email_address @ 12-31, physical_address @ 45-56]
  |
  v
2. REDACT (replace every detected entity with placeholders)
   "My email is [SENSITIVE:email_address:abc-123] and I live at [SENSITIVE:physical_address:def-456]"
  |
  v
3. ENCRYPT + VAULT (per placeholder: AES-256-GCM + KEK wrapping via AES-256-KW)
   Original values encrypted and stored in SQLite vault
  |
  v
4. Output: redacted text + placeholder IDs (safe to send to any LLM)
```

### Usage

```typescript
import Database from 'better-sqlite3';
import { initPristine } from './src/core/init.js';
import { createLlmClients } from './src/engine/index.js';
import { SqliteVaultStore } from './src/privacy/vault/sqlite/index.js';
import { FileSystemKeyManager } from './src/privacy/keys/filesystem.js';
import { KekManager } from './src/privacy/kek/kek-manager.js';
import { secureAndRedact, reveal, scrubOutput } from './src/privacy/index.js';

// One-time setup
const { databasePath, baseDir } = initPristine();
const db = new Database(databasePath);
const vaultStore = new SqliteVaultStore(db);
const { privacyClient } = createLlmClients();
const keyManager = new FileSystemKeyManager({ keysDir: `${baseDir}/keys` });
const kekManager = new KekManager(db, keyManager);

// Redact PII before sending to an LLM
const { redactedText, placeholderIds } = await secureAndRedact(
  'My email is alice@example.com and my SSN is 123-45-6789',
  { client: privacyClient, vaultStore, keyManager, kekManager, userId: 'user-1' },
);
// redactedText: "My email is [SENSITIVE:email_address:...] and my SSN is [SENSITIVE:identity_number:...]"
// Safe to send to any LLM — no PII exposed

// Later: recover original values
const originalText = await reveal(redactedText, {
  vaultStore, keyManager, kekManager, userId: 'user-1',
});
// originalText: "My email is alice@example.com and my SSN is 123-45-6789"

// Safety net: strip any remaining placeholders before showing to user
const clean = scrubOutput(someText);
```

### What Gets Detected

**Deterministic classifier** (regex, high confidence):
- Credit cards (Luhn-validated), emails, US SSN, phone numbers

**LLM classifier** (contextual, catches what regex misses):
- Health conditions, financial info, legal matters, relationships, identity documents
- System prompt (what to look out for) is configurable by user

Both run in parallel. Results are merged with overlap deduplication.

### Encryption

Pristine uses a three-layer encryption scheme:

```
RSA-4096 key pair (per user, persisted to disk)
  |
  v wraps (RSA-OAEP-256)
KEK — Key Encryption Key (per user, 256-bit AES, stored in user_keks table)
  |
  v wraps (AES-256-KW, RFC 3394)
DEK — Data Encryption Key (per PII value, random 256-bit)
  |
  v encrypts (AES-256-GCM)
PII plaintext
```

Each PII value gets its own random DEK. The DEK is wrapped by a per-user KEK using AES-256-KW (Key Wrap). The KEK itself is wrapped once by the user's RSA-4096 public key and stored in the `user_keks` SQLite table. Only the holder of the RSA private key can decrypt.

This design enables **O(1) key rotation** — rotating the RSA key pair only re-wraps the single KEK, not every DEK in the vault.

### Key Management

#### RSA Key Pairs

RSA key pairs are managed via the `KeyManager` interface. The default `FileSystemKeyManager` persists keys to disk:

- **Auto-generation:** On first use per userId, an RSA-4096 key pair is generated and saved to `{keysDir}/{userId}-private.pem` and `{userId}-public.pem`. Subsequent calls load from disk (cached in memory).
- **Default location:** `~/.pristine/keys/`
- **File permissions:** Private keys are written with `0o600` (owner-only read/write). On Windows, the mode parameter is a no-op.
- **Atomic writes:** Keys are written to a temp file and renamed to prevent corruption on crash.
- **`created` flag:** `getOrCreateKeyPair()` returns `{ publicKey, privateKey, created }`. When `created` is `true`, it's the first time a key was generated for that user — useful for showing a one-time setup notice:

```typescript
const { created } = await keyManager.getOrCreateKeyPair(userId);
if (created) {
  console.log('New encryption keys generated. Back up ~/.pristine/keys/');
}
```

The `KeyManager` interface is swappable — the `FileSystemKeyManager` can be replaced with an OS Keychain backend (macOS Keychain, Windows Credential Manager) without changing any consumer code.

#### KEK (Key Encryption Key)

The `KekManager` handles the KEK intermediary layer:

- **Auto-generation:** On first use per userId, a random 256-bit KEK is generated, wrapped with the user's RSA public key, and stored in the `user_keks` SQLite table. Subsequent calls return the cached plaintext KEK.
- **Storage:** `user_keks` table with columns: `user_id`, `wrapped_kek` (512-byte RSA-wrapped blob), `key_id` (RSA fingerprint), `algorithm`, `created_at`.
- **Caching:** Plaintext KEK is held in memory after first retrieval (same threat model as RSA private key in process memory). `clearCache()` forces re-read from DB.

#### Key Rotation

`rotateKey()` generates a new RSA key pair and re-wraps the existing KEK — O(1) regardless of vault size:

```typescript
import { rotateKey } from './src/privacy/rotation.js';

// Rotate the RSA key pair for a user
// Generates new RSA-4096 key pair, re-wraps KEK, saves new keys
await rotateKey(userId, keyManager, kekManager);

// All existing vault entries remain decryptable — KEK unchanged, only its RSA wrapping changed
const original = await reveal(redactedText, { vaultStore, keyManager, kekManager, userId });
```

#### Migrating Legacy Entries

Entries created before the KEK layer (wrapped directly by RSA) can be migrated:

```typescript
import { migrateToKek } from './src/privacy/migration.js';

// Re-wraps all RSA-wrapped DEKs with the user's KEK
// Runs in a single transaction, idempotent
const { migrated, skipped } = await migrateToKek(userId, keyManager, kekManager, db);
```

---

## How Memory Works

Memory has two layers: a **conversation store** that persists raw conversations, and a **fact extraction pipeline** that produces searchable, temporally-aware memories. Both are written to on every `store()` call.

### Conversation Store

Every `store()` call writes the raw conversation to SQLite first, before any LLM processing. This gives you:
- **Keyword search** across all past conversations via FTS5 (`searchConversations()`)
- **Date filtering** — find conversations from a specific time range
- **Full context retrieval** — when you find a fact via semantic search, follow `sourceConversationId` back to the original conversation (`getConversation()`)

This replaces the need for episodic memory — conversations are directly searchable without LLM-generated summaries.

### Fact Extraction Pipeline

> **Pre-pivot behavior — removed in spec-005 Phase 1 (sprint-013).** The pipeline described below was removed along with `client.store()` / `client.search()`. Phase 1 has no synchronous ingest pipeline; use `storeAsync()` to enqueue conversations into the durable `IngestQueue`, and `searchConversations()` / `getConversation()` for raw-conversation lookup. This section stays as a historical record until the Phase-2 indexer + Phase-4 searcher primitives land and the body is rewritten around the new architecture.

After the conversation is stored, the ingest pipeline runs a 7-step process:

```
store() called with conversation + userId
  |
  v
1. STORE CONVERSATION (write raw messages to conversation store, get conversationId)
  |
  v
2. EXTRACT (LLM extracts atomic facts with temporal metadata)
   Facts: [
     { text: "The user lives in Tokyo", validFrom: "2026-04-13T..." },
     { text: "The user works at Google", validFrom: "2026-04-13T..." }
   ]
  |
  v
3. EMBED (768-dim vectors via Nomic Embed v1.5)
  |
  v
4. SEARCH SIMILAR (find existing memories that overlap with new facts)
  |
  v
5. CONSOLIDATE (LLM decides: ADD new, UPDATE existing, SUPERSEDE outdated, or NOOP)
  |
  v
6. STORE FACTS (execute consolidation decisions — write to memories table)
   Each fact carries sourceConversationId linking back to the conversation
  |
  v
7. VALIDATE (turn-order validation — verify pipeline steps ran correctly)
```

### Usage

```typescript
import { PristineLocal } from '@pristine/shield-local';

// Create client — wires all modules automatically
const client = await PristineLocal.create();

// Store a conversation (writes to conversation store + extracts facts)
const result = await client.store(
  [
    { role: 'user', content: 'I just moved to Tokyo and started working at Google.' },
    { role: 'assistant', content: 'That sounds exciting! How are you settling in?' },
  ],
  'user-1',
);
// result.facts -> extracted facts
// result.memoryIds -> IDs of stored memories
// result.errors -> any pipeline step errors (partial failures are non-fatal)

// Search for relevant facts (semantic vector search)
const searchResult = await client.search('Where does the user live?', 'user-1');
// searchResult.memories[0].memory.text -> "The user lives in Tokyo"

// Follow sourceConversationId to get the full original conversation
const convId = searchResult.memories[0].memory.sourceConversationId;
const conversation = client.getConversation(convId);
// conversation.messages -> the original user + assistant messages

// Search conversations by keyword (no embeddings, pure FTS5)
const convResults = client.searchConversations({
  userId: 'user-1',
  keyword: 'Tokyo',
  dateFrom: '2026-04-01',
});
// convResults[0].snippet -> "...moved to <b>Tokyo</b> and started..."
```

### Temporal Modes

Every fact can have `validFrom` and `validUntil` timestamps, extracted by the LLM with a confidence level:

| Mode | What it returns | Use case |
|------|----------------|----------|
| `current` | Facts valid now (no `validUntil`, `validFrom` in the past) | Default — "What does the user like?" |
| `as_of` | Facts valid at a specific date | "Where did the user live in 2024?" |
| `full` | All facts including expired/superseded | Debug, audit, history |

Temporal modes are available via `client.orchestrator.retrieve(query, userId, { temporalMode: 'as_of', asOf: '2024-06-01' })`. The convenience `search()` method uses `current` mode by default.

### Supersession

When a fact changes ("User moved from Tokyo to London"), the consolidation step detects the contradiction and supersedes the old memory:
- Old memory gets `validUntil` + `supersededBy` link
- New memory gets `supersedes` link back
- `getSupersessionChain()` traverses the full history

---

## Multi-User and Multi-Agent

### User isolation

Every memory, conversation, and vault entry is scoped by `userId`. Two users sharing the same database file are fully isolated — queries always filter by `userId`.

```typescript
// Agent stores a conversation for user-1
await client.store([{ role: 'user', content: 'I like sushi' }], 'user-1');

// Searching for user-2 sees nothing from user-1
const results = await client.search('food preferences', 'user-2');
// results.memories: []
```

### Shared memory across agents

Multiple agents serving the **same user** share the same memory pool automatically — they all read from and write to the same SQLite file (`~/.pristine/data/pristine.db`). SQLite WAL mode handles concurrent reads safely.

```typescript
// Agent A (personal assistant) stores a conversation
await client.store(
  [{ role: 'user', content: 'I am vegetarian on weekdays' }],
  'user-1',
);

// Agent B (meal planner) searches — finds the fact stored by Agent A
const results = await client.search('dietary preferences', 'user-1');
// results.memories[0].memory.text -> "The user is vegetarian on weekdays"
```

### Per-agent memory (if needed)

If you want isolated memory per agent, use different `userId` values:

```typescript
await client.store(conversation, 'user-1:assistant');   // personal assistant
await client.store(conversation, 'user-1:meal-planner'); // meal planner
```

Or point each agent at a separate database file via `PristineLocal.create({ baseDir })` with different base directories.

---

## SDK Integration Guide

### Quick Start

```typescript
import { PristineLocal } from '@pristine/shield-local';

const client = await PristineLocal.create();

// Store a conversation (extracts facts + stores raw conversation)
await client.store(conversation, userId);

// Search memories (semantic vector search)
const result = await client.search('query', userId);

// Search conversations (keyword + date, no embeddings)
const convs = client.searchConversations({ userId, keyword: 'Tokyo' });

// Get full conversation by ID
const detail = client.getConversation(conversationId);

// Privacy: redact PII
const { redactedText } = await client.secureAndRedact(text, userId);
const original = await client.reveal(redactedText, userId);
const clean = client.scrubOutput(text);

// Cleanup
await client.dispose();
```

### Public API

| Method | Returns | Description |
|--------|---------|-------------|
| `store(conversation, userId)` | `IngestResult` | Store conversation + extract facts. Returns `{ facts, memoryIds, decisions, errors }` |
| `search(query, userId, topK?)` | `RetrieveResult` | Semantic search for relevant facts. Returns `{ memories, metadata }` |
| `searchConversations(params)` | `ConversationSearchResult[]` | FTS5 keyword + date search across raw conversations |
| `getConversation(id)` | `ConversationDetail \| null` | Retrieve full conversation with messages by ID |
| `secureAndRedact(text, userId)` | `SecureAndRedactResult` | Detect and encrypt PII, return redacted text |
| `reveal(redactedText, userId)` | `string` | Decrypt PII placeholders back to original text |
| `scrubOutput(text)` | `string` | Strip any remaining `[SENSITIVE:...]` placeholders |
| `dispose()` | `void` | Clean up embedder, LLM clients, and database connections |

**Advanced access:** `client.orchestrator` exposes the full pipeline API for temporal queries, custom pipeline steps, and direct `ingest()`/`retrieve()` calls with options.

### Configuration

`PristineLocal.create()` accepts an optional config for testing and custom deployments:

```typescript
interface PristineLocalConfig {
  baseDir?: string;      // Root directory (default: ~/.pristine)
  keysDir?: string;      // RSA key directory (default: ~/.pristine/keys)
  db?: Database;         // Inject database (for testing with :memory:)
  llmClients?: LlmClients; // Inject LLM clients (for mocking)
  embedder?: Embedder;   // Inject embedder (for mocking)
}
```

When all three DI fields (`db`, `llmClients`, `embedder`) are provided, `create()` skips filesystem initialization entirely — no `~/.pristine/` directory needed. This is how tests run without side effects.

### Agent Integration Pattern

Agent harnesses (Claude Code, Pi, custom agents) integrate Pristine via hooks and tools:

**Hook (after every agent response — stores conversation):**
```typescript
// Runs in ~0.1s — just the SQLite write. Fact extraction runs in background.
await client.store(conversationMessages, userId);
```

**Tool/skill (when the agent needs context):**
```typescript
// Semantic search — ~0.2s (embed query + vector search)
const result = await client.search('What does the user prefer?', userId);

// Keyword search — ~0.05s (pure SQL, no embedding)
const convs = client.searchConversations({ userId, keyword: 'preferences' });
```

### Hook Timestamp Contract

Pristine uses `REFERENCE_TIME` to resolve relative temporal expressions ("yesterday", "last month") during fact extraction. If `REFERENCE_TIME` is always "now", facts from historical conversations get wrong dates. Every hook that feeds conversations into Pristine must pass timestamps.

**Two timestamp patterns:**

| Pattern | When to use | How |
|---------|-------------|-----|
| Per-message | Each message has its own timestamp (Claude Code, Pi.dev) | Set `Message.timestamp` on each message |
| Per-session | All messages share one date (LOCOMO benchmark) | Pass `{ referenceTimestamp: date }` via `IngestOptions` to `orchestrator.ingest()` |

**Three-tier resolution chain** (in `extractFactsStep`):
1. Explicit `referenceTimestamp` from `IngestOptions` (caller wins)
2. `deriveTimestamp(messages)` — chronologically latest `Message.timestamp`
3. `new Date().toISOString()` — fallback to "now"

**Hook status:**

| Hook | Source | Timestamp Location | Status |
|------|--------|--------------------|--------|
| Claude Code | `.jsonl` transcript at `transcript_path` | `entry.timestamp` per message | Documented (future implementation) |
| Pi.dev | `.jsonl` sessions at `~/.pi/agent/sessions/` | `entry.timestamp` per message | Documented (future implementation) |
| LOCOMO benchmark | `locomo10.json` | `session.metadata.date` per session | Implemented |

**Timestamp format:** ISO 8601 UTC with Z suffix (e.g., `"2023-05-08T13:56:00.000Z"`).

**Reference implementation:** See `benchmarks/memorybench/src/providers/pristine/index.ts` for the LOCOMO per-session pattern using `orchestrator.ingest()` with `referenceTimestamp`.

### Exported Types

The barrel (`src/index.ts`) exports types that consumers need for typing tool handlers, test mocks, and DI overrides:

```typescript
// Core types
import type { Message, Fact, Memory, IngestResult, RetrieveResult } from '@pristine/shield-local';
import type { ConversationSearchResult, ConversationDetail } from '@pristine/shield-local';

// Interfaces for DI and test mocks
import type { LlmClient, Embedder, Orchestrator, Store } from '@pristine/shield-local';

// Errors
import { AppError, ConfigError, EmbedderError, OrchestratorError } from '@pristine/shield-local';
```

---

## Extension Guide

### Adding a New LLM Engine

All LLM modules use the `LlmClient` interface — implement it to add a new backend:

```typescript
// src/core/interfaces.ts
interface LlmClient {
  generate<T>(params: {
    systemPrompt: string;
    userPrompt: string;
    schema: JsonSchema;    // JSON Schema for structured output
    maxTokens?: number;
  }): Promise<T>;
}
```

1. Create `src/engine/<name>/index.ts` implementing `LlmClient`
2. Add config type to `src/engine/types.ts`
3. Add engine name to `models.json` validation in `src/core/init.ts`

Existing implementations for reference:
- `src/engine/llamacpp/` — in-process, grammar-constrained via `node-llama-cpp`
- `src/engine/ollama/` — HTTP-based, structured output via Ollama API

### Adding a New Classifier

The combined classifier merges results from multiple sources. To add a third classifier (e.g., a rules engine or industry-specific patterns):

1. Implement the `SensitivityClassifier` interface:

```typescript
// src/core/interfaces.ts
interface SensitivityClassifier {
  classify(text: string): Promise<SensitivityReport>;
}
```

2. Create `src/privacy/classifier/<name>/index.ts` implementing the interface
3. Update `src/privacy/classifier/combined/index.ts` to run your classifier in parallel with the existing two and merge the results

The combined classifier's `mergeReports()` handles overlap deduplication automatically — wider spans and higher confidence entities win when two classifiers detect the same region.

The redaction layer does not filter entities. If your classifier reports an entity, it will be redacted. Tune precision in your classifier, not downstream.

### Adding a New Model

Add a `ModelEntry` to `src/models/registry.ts`:

```typescript
{
  name: 'my-model-q4',
  filename: 'my-model-q4.gguf',
  url: 'https://huggingface.co/.../my-model-q4.gguf',
  sha256: '...',
  sizeBytes: 4_500_000_000,
  description: 'My Model Q4 quantization',
}
```

The download manager (`src/models/download.ts`) handles resumable downloads and SHA-256 verification.

### Adding a New Embedding Model

Implement the `Embedder` interface:

```typescript
interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: readonly string[]): Promise<number[][]>;
}
```

The output dimension must match the `sqlite-vec` table configuration (currently 768). See `src/embedder/local/index.ts` for the reference implementation.

---

## Development

### Commands

```bash
npm test              # Run all tests (585+)
npm run typecheck     # TypeScript strict mode check
npm run lint          # ESLint + Prettier
npm run test:watch    # Watch mode
```

### Conventions

- **TypeScript strict mode**, ESM only
- **No `any`** — use `unknown` + type guards
- **No `console.log`** in production code
- **Conventional commits**: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`
- **Rebase, don't merge** — linear history
- **One PR per story**, branch naming: `feat/<name>`, `fix/<name>`

---

## Benchmarks

Local micro-benchmarks live in `benchmarks/` (e.g., embedder throughput). Comprehensive quality benchmarks comparing local vs hosted inference are planned in Phase 8 via the MemoryBench repository. The benchmark suite has not been created yet.

---

## License

TBD
