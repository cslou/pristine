# Pristine Local

Local-first privacy and memory SDK for AI agents. No API calls, no server, no data leaving the device.

Pristine gives agents persistent memory (remember facts from conversations) and privacy protection (detect, redact, and encrypt PII) using local LLM inference and SQLite storage. Everything runs on-device.

## Table of Contents

- [Architecture](#architecture)
- [Storage Layout](#storage-layout)
- [Directory Structure](#directory-structure)
- [Getting Started](#getting-started)
- [Initialization](#initialization)
- [Model Configuration](#model-configuration)
- [How Privacy Works](#how-privacy-works)
- [How Memory Works](#how-memory-works)
- [Multi-User and Multi-Agent](#multi-user-and-multi-agent)
- [SDK Integration Guide](#sdk-integration-guide)
- [Extension Guide](#extension-guide)
- [Development](#development)
- [Benchmarks](#benchmarks)

---

## Architecture

Pristine has two pipelines that share common infrastructure:

```
                    +-------------------+
                    |   Agent Harness   |
                    | (Claude Code, Pi) |
                    +--------+----------+
                             |
              +--------------+--------------+
              |                             |
     +--------v--------+          +--------v--------+
     |  Privacy Pipeline |          |  Memory Pipeline |
     +------------------+          +------------------+
     | secureAndRedact()|          | extract()        |
     | reveal()         |          | store.addMemory()|
     | scrubOutput()    |          | searchSimilar()  |
     +--------+---------+          +--------+---------+
              |                             |
              +--------------+--------------+
                             |
              +--------------+--------------+
              |              |              |
     +--------v--+  +-------v----+  +------v-------+
     | LLM Engine |  | Embedder   |  | SQLite + Vec |
     | (Ollama or |  | (Nomic     |  | (better-     |
     |  llama.cpp)|  |  Embed 1.5)|  |  sqlite3)    |
     +-----------+  +------------+  +--------------+
```

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
      user_keks table                  Wrapped KEK per user (512-byte RSA-wrapped blob)
      vault_entries table              Wrapped DEK + encrypted PII per value
      memories table                   Memory facts + embeddings
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
  core/                     Shared types, interfaces, errors, SQLite factory
    init.ts                 initPristine(), ModelConfig types, loadModelConfig()
    types.ts                All type definitions (Fact, Memory, Message, etc.)
    interfaces.ts           All module contracts (LlmClient, Embedder, Store, etc.)
    errors.ts               Domain error hierarchy (AppError + subclasses)
    database.ts             createDatabase(), createDefaultDatabase()

  engine/                   LLM inference backends
    llamacpp/               node-llama-cpp v3 (in-process, grammar-constrained)
    ollama/                 Ollama HTTP API (structured output via format: schema)
    index.ts                Auto-detect factory: tries Ollama, falls back to llama.cpp

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
      redaction.ts          Smart redaction with entity filtering
      sqlite/               SQLite vault store

  memory/                   Memory pipeline
    temporal/               Temporal field validation (ISO dates, bounds, confidence)
    extractor/              Fact extraction from conversations via LLM
    store/
      sqlite/               Memory persistence (SQLite + sqlite-vec + FTS5)
    orchestrator/
      chunker.ts            Conversation chunking with overlap
    consolidator/           Fact deduplication (coming: Sprint 005)
    query-analyzer/         Search query classification (coming: Sprint 005)
    retriever/              Vector + keyword search + ranking (coming: Sprint 005)

tests/                      Mirrors src/ structure
  integration/              End-to-end pipeline tests
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

The engine auto-detects: if Ollama is running with a model available, it uses Ollama. Otherwise, it looks for a GGUF file in `~/.pristine/models/`.

### Verify Setup

```bash
# Run all tests (357+ should pass)
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

The memory pipeline extracts facts from conversations, embeds them as vectors, and stores them in SQLite for semantic search.

### Flow

```
Input: [{ role: 'user', content: 'I just moved to Tokyo and started at Google' }]
  |
  v
1. CHUNK (split long conversations into overlapping windows of 20 messages)
  |
  v
2. EXTRACT (LLM extracts atomic facts with temporal metadata)
   Facts: [
     { text: "The user lives in Tokyo", validFrom: "2026-04-06T...", temporalConfidence: "implied" },
     { text: "The user works at Google", validFrom: "2026-04-06T...", temporalConfidence: "implied" }
   ]
  |
  v
3. VALIDATE (temporal field validation — reject bad dates, apply confidence policies)
  |
  v
4. EMBED (768-dim vector via Nomic Embed v1.5)
  |
  v
5. STORE (SQLite: memories table + sqlite-vec for vectors + FTS5 for keywords)
   Content hash dedup prevents duplicate facts
  |
  v
6. SEARCH (vector similarity + keyword match + temporal filtering)
   Query: "Where does the user live?" -> "The user lives in Tokyo" (score: 0.94)
```

### Usage

```typescript
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { OllamaClient } from './src/engine/ollama/index.js';
import { LocalEmbedder } from './src/embedder/local/index.js';
import { createDatabase } from './src/core/database.js';
import { SqliteStore } from './src/memory/store/sqlite/index.js';
import { createExtractor } from './src/memory/extractor/index.js';

// Setup
const db = createDatabase({ path: './memory.db' });
const client = new OllamaClient({ model: 'llama3.2:latest' });
const embedder = new LocalEmbedder();
const store = new SqliteStore(db);
const extractor = createExtractor(client);

// STORE: Extract facts from a conversation
const conversation = [
  { role: 'user' as const, content: 'I just moved to Tokyo and started working at Google.' },
  { role: 'assistant' as const, content: 'That sounds exciting! How are you settling in?' },
];

const { facts } = await extractor.extract(conversation);

for (const fact of facts) {
  const embedding = await embedder.embed(fact.text);
  const contentHash = createHash('sha256').update(fact.text).digest('hex');
  await store.addMemory({
    userId: 'user-1',
    text: fact.text,
    embedding,
    contentHash,
    validFrom: fact.validFrom,
    validUntil: fact.validUntil,
  });
}

// RECALL: Search for relevant memories
const queryEmbedding = await embedder.embed('Where does the user live?');
const results = await store.searchSimilar({
  embedding: queryEmbedding,
  limit: 5,
  userId: 'user-1',
  temporalMode: 'current',
});

// results[0].text -> "The user lives in Tokyo"
```

### Temporal Modes

Every fact can have `validFrom` and `validUntil` timestamps, extracted by the LLM with a confidence level:

| Mode | What it returns | Use case |
|------|----------------|----------|
| `current` | Facts valid now (no `validUntil`, `validFrom` in the past) | Default — "What does the user like?" |
| `as_of` | Facts valid at a specific date | "Where did the user live in 2024?" |
| `full` | All facts including expired/superseded | Debug, audit, history |

### Supersession

When a fact changes ("User moved from Tokyo to London"), the old memory is superseded:
- Old memory gets `validUntil` + `supersededBy` link
- New memory gets `supersedes` link back
- `getSupersessionChain()` traverses the full history

---

## Multi-User and Multi-Agent

### User isolation

Every memory and vault entry is scoped by `userId`. Two users sharing the same database file are fully isolated — queries always filter by `userId`.

```typescript
// Agent A stores a memory for user-1
await store.addMemory({ userId: 'user-1', text: 'Likes sushi', ... });

// Agent B searches for user-2 — sees nothing from user-1
const results = await store.searchSimilar({ userId: 'user-2', ... });
// results: []
```

### Shared memory across agents

Multiple agents serving the **same user** share the same memory pool automatically — they all read from and write to the same SQLite file. SQLite WAL mode handles concurrent reads safely.

```typescript
// Agent A (personal assistant) stores a fact
await store.addMemory({ userId: 'user-1', text: 'User is vegetarian on weekdays', ... });

// Agent B (meal planner) searches — finds the fact stored by Agent A
const results = await store.searchSimilar({ userId: 'user-1', ... });
// results[0].text -> "User is vegetarian on weekdays"
```

No configuration needed — if both agents point to the same database path (`~/.pristine/data/memory.db`), memories are shared.

### Per-agent memory (if needed)

If you want isolated memory per agent, use different `userId` values:

```typescript
// Personal assistant uses "user-1:assistant"
await store.addMemory({ userId: 'user-1:assistant', ... });

// Meal planner uses "user-1:meal-planner"
await store.addMemory({ userId: 'user-1:meal-planner', ... });
```

Or use separate database files per agent.

---

## SDK Integration Guide

### Current State

Pristine is a TypeScript library — you import modules directly. There is no `npm install` package yet (coming in Phase 7). The orchestrator (`orchestrator.ingest()` / `orchestrator.retrieve()`) is coming in Sprint 006. Today, you wire modules manually as shown in the usage examples above.

### How Agent Harnesses Will Use Pristine

Agent harnesses (Claude Code, Pi, custom agents) integrate Pristine as **tools** the agent can call. Here's the pattern:

**Tool definitions:**

```typescript
const pristineTools = [
  {
    name: 'remember',
    description: 'Store facts from the current conversation into long-term memory',
    parameters: {
      type: 'object',
      properties: {
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['user', 'assistant'] },
              content: { type: 'string' },
            },
          },
          description: 'The conversation messages to extract facts from',
        },
      },
      required: ['messages'],
    },
  },
  {
    name: 'recall',
    description: 'Search long-term memory for facts relevant to a query',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for in memory' },
      },
      required: ['query'],
    },
  },
];
```

**Tool handler:**

```typescript
import { createHash } from 'node:crypto';

async function handleTool(name: string, params: Record<string, unknown>) {
  if (name === 'remember') {
    const messages = params.messages as { role: string; content: string }[];

    // Optional: redact PII before extraction
    // const { redactedText } = await secureAndRedact(text, { client, vaultStore, keyManager, userId });

    const { facts } = await extractor.extract(messages);
    for (const fact of facts) {
      const embedding = await embedder.embed(fact.text);
      const contentHash = createHash('sha256').update(fact.text).digest('hex');
      await store.addMemory({ userId, text: fact.text, embedding, contentHash, ...fact });
    }
    return { stored: facts.length };
  }

  if (name === 'recall') {
    const query = params.query as string;
    const embedding = await embedder.embed(query);
    const memories = await store.searchSimilar({
      embedding, limit: 10, userId, temporalMode: 'current',
    });
    return { memories: memories.map((m) => ({ text: m.text })) };
  }
}
```

**After Sprint 006** (orchestrator), this simplifies to:

```typescript
async function handleTool(name: string, params: Record<string, unknown>) {
  if (name === 'remember') {
    return orchestrator.ingest(params.messages, userId);
  }
  if (name === 'recall') {
    return orchestrator.retrieve(params.query, userId);
  }
}
```

### MCP Server Pattern

For harnesses that support [Model Context Protocol](https://modelcontextprotocol.io), Pristine can be exposed as an MCP server with `remember` and `recall` tools. The MCP server is not built yet but would wrap the same tool handler above.

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
npm test              # Run all tests (357+)
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

### Sprint Structure

Work is organized into sprints (see `docs/sprints/`). Each sprint has stories with acceptance criteria, planned commits, and Greptile code review. The implementation spec (`docs/specs/implementation-spec-001.md`) defines all phases.

| Sprint | Phase | Status |
|--------|-------|--------|
| 001 | Foundation (scaffold, types, interfaces) | Complete |
| 002 | Shared Infrastructure (LLM engines, embedder, models) | Complete |
| 003 | Privacy Pipeline (sanitizer, classifier, vault) | Complete |
| 004 | Memory Pipeline — Foundations (temporal, extractor, store) | Complete |
| 004b | Key Management (KeyManager interface, FileSystemKeyManager) | Complete |
| 004c | KEK Intermediary (AES-256-KW wrapping, key rotation) | Complete |
| 005 | Memory Pipeline — Processing (consolidator, query analyzer, retriever) | Planned |
| 006 | Memory Pipeline — Orchestrator (ingest + retrieve pipelines) | Planned |

---

## Benchmarks

Local micro-benchmarks live in `benchmarks/` (e.g., embedder throughput). Comprehensive quality benchmarks comparing local vs hosted inference are planned in Phase 8 via the MemoryBench repository. The benchmark suite has not been created yet.

---

## License

TBD
