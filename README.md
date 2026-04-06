# Pristine Local

Local-first privacy and memory SDK for AI agents. No API calls, no server, no data leaving the device.

Pristine gives agents persistent memory (remember facts from conversations) and privacy protection (detect, redact, and encrypt PII) using local LLM inference and SQLite storage. Everything runs on-device.

## Table of Contents

- [Architecture](#architecture)
- [Directory Structure](#directory-structure)
- [Getting Started](#getting-started)
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

## Directory Structure

```
src/
  core/                     Shared types, interfaces, errors, SQLite factory
    types.ts                All type definitions (Fact, Memory, Message, etc.)
    interfaces.ts           All module contracts (LlmClient, Embedder, Store, etc.)
    errors.ts               Domain error hierarchy (AppError + subclasses)
    database.ts             createDatabase() with WAL, integrity check, sqlite-vec

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
    keys/
      filesystem.ts         FileSystemKeyManager — persists RSA keys to disk
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
# Run all tests (286+ should pass)
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

---

## How Privacy Works

The privacy pipeline detects PII in text, replaces it with encrypted placeholders, and stores the original values in an encrypted vault. The original values can be recovered with the private key.

### Flow

```
Input: "My email is alice@example.com and I live at 123 Main St"
  |
  v
1. CLASSIFY (deterministic regex + LLM in parallel)
   Detected: [email_address @ 12-31, physical_address @ 45-56]
  |
  v
2. REDACT (replace PII spans with placeholders)
   "My email is [SENSITIVE:email_address:abc-123] and I live at [SENSITIVE:physical_address:def-456]"
  |
  v
3. ENCRYPT + VAULT (per placeholder: AES-256-GCM + RSA key wrapping)
   Original values encrypted and stored in SQLite vault
  |
  v
4. Output: redacted text + placeholder IDs (safe to send to any LLM)
```

### Usage

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { OllamaClient } from './src/engine/ollama/index.js';
import { SqliteVaultStore } from './src/privacy/vault/sqlite/index.js';
import { FileSystemKeyManager } from './src/privacy/keys/filesystem.js';
import { secureAndRedact, reveal, scrubOutput } from './src/privacy/index.js';

// One-time setup
const db = new Database('./privacy.db');
const vaultStore = new SqliteVaultStore(db);
const client = new OllamaClient({ model: 'llama3.2:latest' });
const keyManager = new FileSystemKeyManager({ keysDir: join(homedir(), '.pristine/keys') });

// Redact PII before sending to an LLM
const { redactedText, placeholderIds } = await secureAndRedact(
  'My email is alice@example.com and my SSN is 123-45-6789',
  { client, vaultStore, keyManager, userId: 'user-1' },
);
// redactedText: "My email is [SENSITIVE:email_address:...] and my SSN is [SENSITIVE:identity_number:...]"
// Safe to send to any LLM — no PII exposed

// Later: recover original values
const originalText = await reveal(redactedText, {
  vaultStore, keyManager, userId: 'user-1',
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
- Works across languages (Mandarin, Japanese, Spanish, Hindi, etc.)

Both run in parallel. Results are merged with overlap deduplication.

### Encryption

Each PII value is encrypted with AES-256-GCM using a random data encryption key (DEK). The DEK is wrapped with the user's RSA-4096 public key (RSA-OAEP-256). Only the holder of the private key can decrypt. Encrypted values are stored in SQLite — even if the database is compromised, PII is protected.

### Key Management

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
3. Update `src/engine/index.ts` auto-detect factory

Existing implementations for reference:
- `src/engine/llamacpp/` — in-process, grammar-constrained via `node-llama-cpp`
- `src/engine/ollama/` — HTTP-based, structured output via Ollama API

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
npm test              # Run all tests (286+)
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
| 004b | Key Management (KeyManager interface, FileSystemKeyManager) | In Progress |
| 004c | KEK Intermediary (AES-256-KW wrapping, key rotation) | Planned |
| 005 | Memory Pipeline — Processing (consolidator, query analyzer, retriever) | Planned |
| 006 | Memory Pipeline — Orchestrator (ingest + retrieve pipelines) | Planned |

---

## Benchmarks

Local micro-benchmarks live in `benchmarks/` (e.g., embedder throughput). Comprehensive quality benchmarks comparing local vs hosted inference are planned in Phase 8 via the MemoryBench repository. The benchmark suite has not been created yet.

---

## License

TBD
