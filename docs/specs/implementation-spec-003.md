# Implementation Spec 003: Memory Architecture Refinement

## 1. Overview

This spec refines Pristine's memory architecture based on learnings from Sprints 005-007 and analysis of Mem0, Zed, and the memorybench framework. The core changes: add a conversation store as the source-of-truth layer, support both raw embedding and fact extraction as toggleable memory modes, move the embedder to a configurable engine (eliminating the need for a daemon), and fix the memorybench framework for practical local benchmarking.

### Why

- **Conversation store:** Agent frameworks (Claude Code, Pi, Codex) store conversations as JSONL files — one file per session, no search capability across sessions. An agent cannot search "what did the user say about Tokyo last week?" across past sessions. Storing conversations in SQLite with FTS5 enables keyword and date-based search across all sessions. Each extracted fact links back to its source conversation via `sourceConversationId`, so when an agent finds a relevant fact, it can retrieve the full conversation for context. This also eliminates the need for episodic memory (Phase 4 from spec-001) — conversations are directly searchable without LLM-generated summaries.

- **Memory mode toggle:** Users choose whether to use LLM-based fact extraction or lightweight raw embedding. Fact extraction + temporal produces cleaner, deduplicated, temporally-aware memories but costs 2 local LLM calls per turn (~8-12s of background Ollama processing on a 3B model). This is modest — equivalent to the user asking the LLM two extra questions, running invisibly in the background. If the user also runs their agent's inference on the same local Ollama instance, extraction calls could queue behind agent responses — though many users run their agent on a hosted LLM (Claude, GPT) so this may not apply. Raw embedding skips LLM entirely — only embedding calls, ~1s background processing. Search latency is identical in both modes (~0.2s — same embed-query + vector-search path). Both modes link memories back to source conversations. The tradeoff is memory quality vs simplicity — fact extraction handles deduplication and contradictions over months of use; raw embedding is simpler but accumulates noise over time.

- **Embedder engine config:** The current HuggingFace in-process embedder loads a 300MB model into the Node process, requiring either a persistent daemon or a 2-3 second cold start per script invocation. Shifting embedding to an engine that is already running (Ollama for LLM inference) eliminates this entirely. Pristine becomes stateless — scripts open SQLite, call Ollama for embedding/LLM, write results, and exit. No daemon process needed.

- **Memorybench fixes:** The benchmark framework has a 202x ingestion duplication bug that makes a full LOCOMO run take 40-80 hours. Fixing this brings it to ~4 hours. Adding a local Ollama judge brings the cost from $50/run to $0/run.

### What This Supersedes

From implementation-spec-001:
- **Phase 4 (Episodic Memory)** — superseded by the conversation store. Conversations are stored and searchable via SQL/FTS5 without LLM-generated summaries.
- **Phase 5 (Relational Memory / Entity Graph)** — deferred indefinitely. The conversation store + fact extraction covers the practical use cases. Entity/relationship extraction is the most error-prone LLM task and the query patterns that need it are rare.
- **Phase 6 (Retrieval Fusion)** — deferred. Without episodes and graph, fusion simplifies to vector + FTS5, which is straightforward and doesn't need a dedicated phase.
- **Phase 9 (Two-Phase Ingestion)** — dropped. The 6-10 second gap between `store()` and fact availability is not worth a second storage path. The agent has the conversation in its context window during that time. Background fire-and-forget ingestion is sufficient.

### What Stays Unchanged

- Fact extraction + temporal + consolidation pipeline (Sprints 005-006)
- Privacy pipeline (Sprints 003-004)
- PristineLocal SDK client (Sprint 007)
- SQLite + sqlite-vec + FTS5 infrastructure
- LLM engine support (Ollama, llamacpp)

---

## 2. Architecture After This Spec

```
┌──────────────────────────────────────────────────┐
│ Conversation Store (always on)                   │
│ SQLite: conversations + messages + FTS5          │
│ Search: keyword, date, sessionId, userId         │
│ Every store() call writes here                   │
└──────────────────────────────────────────────────┘
                      +
┌──────────────────────────────────────────────────┐
│ Memory Layer (user picks one via config)         │
│                                                  │
│ Mode: 'facts' (default)                          │
│   LLM extract → embed facts → consolidate        │
│   Dedup, supersession, temporal, bounded growth  │
│                                                  │
│ Mode: 'embeddings'                               │
│   Embed messages directly, no LLM                │
│   Fast, simple, linear growth                    │
│                                                  │
│ Both store source_conversation_id                │
│   → links back to Conversation Store             │
└──────────────────────────────────────────────────┘
                      +
┌──────────────────────────────────────────────────┐
│ Privacy Layer (independent, unchanged)           │
│ Classify → redact → vault → reveal               │
└──────────────────────────────────────────────────┘
                      +
┌──────────────────────────────────────────────────┐
│ Embedder Engine (configurable via models.json)   │
│ ollama: /api/embed (default, no daemon needed)   │
│ llamacpp: in-process GGUF embedding model        │
│ local: @huggingface/transformers (current)       │
└──────────────────────────────────────────────────┘
```

---

## 3. Agent Integration: No Daemon Required

Pristine does not need its own daemon process. Ollama serves as the runtime for both LLM inference and embedding. Pristine scripts are stateless — they open SQLite, talk to Ollama, write results, and exit.

Ollama runs two models in parallel (different model queues, independent):
- `llama3.2` — fact extraction + consolidation (~3-5s per call)
- `nomic-embed-text` — embedding queries and facts (~0.1s per call)

These don't block each other. Embedding calls complete in ~0.1s even while a 5-second extraction is running on the LLM model.

### How Agents Use Pristine

Two integration points — a hook for storing, a skill/tool for searching:

**Hook (runs after every agent response):**

```
Hook fires:
  → Node script starts
  → Writes conversation to SQLite conversation store (~0.1s)
  → Spawns detached child process for extraction
  → Hook script exits (~0.1s total)

Detached child process (runs in background, 8-12s):
  → Calls Ollama (llama3.2) for fact extraction
  → Calls Ollama (nomic-embed-text) for embedding (parallel, different model)
  → Calls Ollama (llama3.2) for consolidation
  → Writes facts to SQLite
  → Exits
```

The hook blocks the agent for ~0.1s (just the SQLite write). The expensive LLM work runs in a detached child process that outlives the hook. The agent continues immediately.

**Skill/tool (when the agent decides to search):**

```
Agent calls search tool:
  → Node script starts
  → Calls Ollama (nomic-embed-text) for query embedding (~0.1s)
  → SQLite vector search (~0.05s)
  → Returns results
  → Script exits (~0.2s total)
```

No cold start because Ollama keeps the embedding model hot. The script is stateless — no persistent process, no connection pool, no lifecycle management.

**Conversation search (when the agent needs full conversation context):**

```
Agent calls conversation search tool:
  → Node script starts
  → SQLite FTS5 keyword query (~0.01s)
  → Returns matching conversations as JSON
  → Script exits (~0.05s total)
```

No Ollama call — pure SQL. Used when the agent finds a fact via memory search and wants the full conversation context (via `sourceConversationId`), or when searching by keyword/date directly.

### CLI Scripts

Pristine ships scripts that agents (hooks, skills, tools) call directly:

```bash
# Store a conversation (hook — after every turn)
# Enqueues to SQLite + spawns background extraction worker
npx tsx ~/.pristine/scripts/store.ts --user-id <userId> < conversation.json

# Search memories (skill/tool — when agent needs context)
# Returns ranked facts or embedded messages as JSON
npx tsx ~/.pristine/scripts/search.ts --user-id <userId> --query "where does the user live?"
npx tsx ~/.pristine/scripts/search.ts --user-id <userId> --query "current job" --temporal-mode current

# Search conversations (skill/tool — keyword/date search, no embeddings)
npx tsx ~/.pristine/scripts/search-conversations.ts --user-id <userId> --keyword "Tokyo"
npx tsx ~/.pristine/scripts/search-conversations.ts --user-id <userId> --date-from 2026-04-01

# Get full conversation by ID (after finding sourceConversationId from a fact)
npx tsx ~/.pristine/scripts/get-conversation.ts <conversationId>

# Privacy
npx tsx ~/.pristine/scripts/secure-and-redact.ts --user-id <userId> < text.txt
npx tsx ~/.pristine/scripts/reveal.ts --user-id <userId> < redacted.txt
```

All scripts:
- TypeScript files run via `tsx` (no build step needed)
- Read input from stdin or CLI args
- Output JSON to stdout
- Exit after completion (stateless)
- Fast-path scripts (`store.ts`, `search-conversations.ts`, `get-conversation.ts`) use `createLite()` — no Ollama needed
- Full-path scripts (`search.ts`, `extract-worker.ts`) use `PristineLocal.create()` — require Ollama running
- Use `~/.pristine/data/pristine.db` by default (configurable via `--db-path`)

Agent framework configuration example (Claude Code):

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "npx tsx ~/.pristine/scripts/store.ts --user-id $USER_ID < $CONVERSATION_JSON" }]
    }]
  }
}
```

Skill definition example:

```yaml
name: search-memory
description: Search the user's long-term memory for relevant facts
command: npx tsx ~/.pristine/scripts/search.ts --user-id $USER_ID --query "$QUERY"
```

### Recovery

Because the conversation store is written first (before extraction), no data is lost if the detached child process is killed (machine sleep, reboot, crash). The raw conversation is safe in SQLite. Unextracted conversations are detectable (conversations without corresponding facts) and can be reprocessed on the next run or via a recovery sweep.

### Resource Requirements

| Component | RAM | Managed By |
|-----------|-----|-----------|
| Ollama: llama3.2 3B | ~2GB | Ollama (already running) |
| Ollama: nomic-embed-text | ~300MB | Ollama (loaded on first embed call) |
| Pristine scripts | ~50MB (Node process) | Transient — starts and exits per call |
| SQLite | Negligible | File on disk |

No persistent Pristine process. The only long-lived process is Ollama, which the user already has for LLM inference.

---

## 4. Models Config After This Spec

```json
{
  "privacy": { "engine": "ollama", "model": "llama3.2:latest" },
  "memory": { "engine": "ollama", "model": "llama3.2:latest" },
  "embedder": { "engine": "ollama", "model": "nomic-embed-text" }
}
```

The `embedder` section is new. When `engine` is `"ollama"`, Pristine calls Ollama's `/api/embed` endpoint instead of loading the HuggingFace model in-process. This eliminates the need for a persistent daemon — Ollama keeps the embedding model hot.

Default behavior when `embedder` is not present: fall back to `"engine": "local"` (current HuggingFace behavior) for backward compatibility.

---

## 5. Implementation Phases

| Phase | Name | Description | Sprint |
|-------|------|-------------|--------|
| 1 | Conversation Store | SQLite `conversations` + `messages` tables with FTS5. Replaces `user_raw` zero-vector hack. Every `store()` writes here first. | 009 |
| 2 | Conversation Search | `searchConversations()` and `getConversation()` API. Keyword + date search via FTS5/SQL. | 009 |
| 3 | Embedder Engine Support | Configurable embedder via `models.json` — Ollama (recommended), llamacpp, local HuggingFace. Eliminates daemon. | 010 |
| 4 | Search API — temporalMode | Expose `temporalMode` and `asOf` options on `search()` convenience method. | 010 |
| 5 | Durable Ingest Queue with Crash Recovery | SQLite outbox + spawn-on-demand worker for background extraction. Crash recovery via stale-row reset. | 011 |
| 6 | CLI Scripts | `store.ts`, `extract-worker.ts`, `search.ts`, `search-conversations.ts`, `get-conversation.ts`. Agent integration surface. | 011 |
| 7 | Drop Superseded Phases | Remove episodic, relational, retrieval fusion, two-phase ingestion from roadmap. Documentation only. | Any |
| 8 | Memorybench Fixes | Port framework, fix 202x ingestion duplication (55,014 → 272 sessions), create Pristine provider. | 008 |
| 9 | Memorybench Local Models | Ollama judge + answering model. $0/run. Baseline accuracy report. | 008 |
| 10 | Raw Embedding Mode *(deprioritized)* | Embed messages directly without LLM. Simplified ingest pipeline. Not needed unless users request a lighter alternative to fact extraction. | TBD |
| 11 | Memory Mode Toggle *(deprioritized)* | Config flag: `memoryMode: 'facts' \| 'embeddings'`. Only needed if Phase 10 is implemented. | TBD |

---

### Phase 1: Conversation Store

Add a structured conversation store alongside the existing memory store. Every `store()` call writes the raw conversation here before any extraction or embedding. Replaces the `user_raw` zero-vector hack.

#### Schema

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  message_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_created_at ON conversations(created_at);
CREATE UNIQUE INDEX idx_conversations_user_content_hash
  ON conversations(user_id, content_hash);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT,
  sort_order INTEGER NOT NULL
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);

CREATE VIRTUAL TABLE messages_fts
  USING fts5(content, content=messages, content_rowid=rowid);

CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER messages_fts_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
```

#### Module

- `src/conversations/store.ts` — `ConversationStore` class
  - `addConversation(messages, userId)` → stores conversation + messages, returns `conversationId`
  - `getConversation(conversationId)` → returns full conversation with messages
  - `searchConversations({ userId, keyword?, dateFrom?, dateTo?, limit? })` → FTS5 + SQL query

#### Changes to Ingest Pipeline

- `storeUser` step in `src/memory/orchestrator/ingest.ts` writes to `ConversationStore` instead of creating a `user_raw` memory with zero-vector embedding
- The returned `conversationId` is set as `sourceConversationId` on the pipeline context (same as today, but pointing to the conversations table)
- Remove `USER_RAW_MEMORY_ORIGIN`, `USER_RAW_VECTOR_DIMENSION`, and `toConversationMemoryInput()` from ingest.ts

#### Changes to Client

- `PristineLocal` exposes `searchConversations()` method
- `src/index.ts` exports the conversation search types

#### Tasks

- [ ] 1.1: Create `src/conversations/store.ts` — ConversationStore with schema, CRUD, FTS5 search
- [ ] 1.2: Modify ingest pipeline — write to ConversationStore, remove user_raw zero-vector logic
- [ ] 1.3: Modify PristineLocal client — expose `searchConversations()`, wire ConversationStore
- [ ] 1.4: Update barrel exports — conversation types
- [ ] 1.5: Tests: conversation store CRUD, FTS5 search, ingest pipeline writes conversations
- [ ] 1.6: Verify `sourceConversationId` on extracted facts points to conversations table

**Exit criteria:** Conversations stored in structured tables, searchable via keyword/date/session. `user_raw` memory records eliminated. Existing fact extraction still works, `sourceConversationId` links facts to conversations.

---

### Phase 2: Conversation Search Function

Expose a search function that agents can call to find and retrieve past conversations.

#### API

```typescript
// Search by keyword, date, or both
const results = await pristine.searchConversations({
  userId: 'user-1',
  keyword: 'Tokyo',
  dateFrom: '2026-04-01',
  dateTo: '2026-04-10',
  limit: 10,
});

// Get full conversation by ID (after finding it via memory search → sourceConversationId)
const conversation = await pristine.getConversation(conversationId);
```

#### Return Shape

```typescript
interface ConversationSearchResult {
  conversationId: string;
  createdAt: string;
  messageCount: number;
  snippet: string;       // FTS5 snippet with keyword highlights
}

interface ConversationDetail {
  id: string;
  userId: string;
  createdAt: string;
  messages: Message[];
}
```

#### Tasks

- [ ] 2.1: Implement `searchConversations()` on PristineLocal — delegates to ConversationStore
- [ ] 2.2: Implement `getConversation()` on PristineLocal — full conversation retrieval by ID
- [ ] 2.3: Add `ConversationSearchResult` and `ConversationDetail` types to core/types.ts
- [ ] 2.4: Export new types from barrel
- [ ] 2.5: Tests: search by keyword, date range, combined filters, get by ID

**Exit criteria:** Agents can search past conversations by keyword and date, and retrieve the full conversation for context. The search is SQL/FTS5 — no embeddings, no LLM.

---

### Phase 3: Embedder Engine Support

Make the embedding model configurable via `models.json`. Support Ollama (HTTP), llamacpp (in-process), and the current HuggingFace local embedder as backends.

#### Engines

**Ollama (recommended):**
```json
{ "engine": "ollama", "model": "nomic-embed-text" }
```
- Calls `POST http://localhost:11434/api/embed` with `{ model, input }`
- Ollama keeps the model hot — no cold start, no daemon needed
- Requires Ollama running (which users already have for LLM inference)

**llamacpp (in-process):**
```json
{ "engine": "llamacpp", "path": "/path/to/nomic-embed.gguf" }
```
- Loads GGUF embedding model via node-llama-cpp
- In-process — no external dependency, but needs daemon for hot loading

**local (current default, backward compatible):**
```json
{ "engine": "local" }
```
- Uses `@huggingface/transformers` with Nomic Embed v1.5
- Downloads model on first use (~300MB)
- Falls back to this when `embedder` section is not in models.json

#### Implementation

- `src/embedder/ollama/index.ts` — `OllamaEmbedder` implementing `Embedder` interface
- `src/embedder/llamacpp/index.ts` — `LlamaCppEmbedder` implementing `Embedder` interface (if node-llama-cpp supports embedding models)
- `src/embedder/index.ts` — factory: `createEmbedder(config)` reads engine from models.json, returns the appropriate implementation
- All implementations satisfy the same `Embedder` interface: `embed(text): Promise<number[]>`, `embedBatch(texts): Promise<number[][]>`

#### Config Changes

- `models.json` gains an `embedder` section (optional, defaults to `{ "engine": "local" }`)
- `loadModelConfig()` in `src/core/init.ts` updated to parse and validate the embedder section
- `PristineLocal.create()` uses `createEmbedder()` instead of hardcoded `createLocalEmbedder()`

#### Tasks

- [ ] 3.1: Implement `OllamaEmbedder` in `src/embedder/ollama/index.ts` — HTTP calls to `/api/embed`
- [ ] 3.2: Create `createEmbedder(config)` factory in `src/embedder/index.ts`
- [ ] 3.3: Update `loadModelConfig()` to parse `embedder` section from models.json
- [ ] 3.4: Update `PristineLocal.create()` to use `createEmbedder()` factory — remove hardcoded `createLocalEmbedder()`. With Ollama embedder, `create()` no longer downloads a 300MB model or needs async initialization for the embedder. The `create()` call becomes near-instant when using Ollama (just HTTP client setup, no model loading).
- [ ] 3.5: Update default models.json template to include embedder section
- [ ] 3.6: Tests: OllamaEmbedder produces correct-dimension vectors, factory selects correct engine
- [ ] 3.7: Integration test: full pipeline with Ollama embedder (embed + search round-trip)

**Exit criteria:** Embedding model is configurable via models.json. Ollama embedder works as the default when Ollama is available. `PristineLocal.create()` is near-instant with Ollama (no in-process model loading). No daemon needed. Backward compatible — missing `embedder` config falls back to local HuggingFace.

---

### Phase 4: Search API — Expose temporalMode

The `search()` convenience method on `PristineLocal` currently only accepts `topK`. Expose the full set of retrieval options so agents can filter by temporal validity.

#### API Change

```typescript
// Current
search(query: string, userId: string, topK?: number): Promise<RetrieveResult>

// After
search(query: string, userId: string, options?: SearchOptions): Promise<RetrieveResult>

interface SearchOptions {
  topK?: number;
  temporalMode?: 'current' | 'as_of' | 'full';
  asOf?: string;
}
```

Backward compatible — `topK` was the only option before, and it moves into the options object.

#### Temporal Modes

- `current` (default when using fact extraction mode): only facts with `validUntil` null or in the future
- `as_of`: facts valid at a specific point in time
- `full`: all facts including superseded/expired

#### Tasks

- [ ] 4.1: Update `search()` signature on PristineLocal and Orchestrator interface
- [ ] 4.2: Update `Orchestrator.search()` implementation to pass options through to `retrieve()`
- [ ] 4.3: Update barrel exports with `SearchOptions` type
- [ ] 4.4: Tests: search with temporalMode='current' excludes superseded facts, 'as_of' filters by date, 'full' returns everything

**Exit criteria:** Agents can pass temporal options to search. Default behavior is `current` — only return facts that are still true.

---

### Phase 5: Durable Ingest Queue with Crash Recovery

When agents fire `store()` as fire-and-forget after each turn, in-flight ingestions are lost if the session ends abruptly. A durable SQLite-backed queue ensures pending work survives process crashes and is automatically recovered on next startup.

#### Design: SQLite Outbox + Spawn-on-Demand Worker

Write the intent to a `pending_ingest_tasks` table in the same transaction as the conversation store write. A **separate worker process** (spawned on demand by `store.ts`) polls the table, claims tasks, runs the slow path (extract/embed/consolidate), marks them complete, and self-terminates when idle for 30s. No persistent daemon — the worker starts when there's work and stops when there isn't.

Crash recovery is built into every claim attempt — stale `processing` rows (from crashed workers) are automatically reset to `pending`. No coordination between workers (no PID files, no heartbeats). If two workers briefly run in parallel (race condition on spawn), the atomic `claimNext()` prevents double-processing.

This pattern is well-established in local-first apps (plainjob, liteque, claude-mem).

#### Schema

```sql
CREATE TABLE IF NOT EXISTS pending_ingest_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_tasks_status ON pending_ingest_tasks(status);
```

#### API

```typescript
const queue = pristine.ingestQueue;

// After each turn — writes conversation + pending task atomically, returns immediately
queue.enqueue(conversation, userId);

// Claim and process the next pending task (used by extract-worker.ts)
await queue.processNext();

// Observability
queue.pending;    // number of pending + processing tasks
```

#### Implementation

- `src/queue/ingest-queue.ts` — `IngestQueue` class
  - **Enqueue:** In a single `better-sqlite3` transaction: write conversation to `ConversationStore`, insert `pending` row into `pending_ingest_tasks`. Returns immediately (~0.1s).
  - **claimNext():** Reset stale `processing` rows (older than 30s) to `pending` (crash recovery), then atomically claim next `pending` row (`pending` → `processing`). Returns the claimed task or null.
  - **processNext():** Calls `claimNext()`, runs the full ingest pipeline on the claimed task, marks `completed` on success. Ollama connection errors → leave as `pending` (retryable). Other errors → mark `failed`.
  - **Concurrency:** `p-limit(1)` within the worker process — one Ollama pipeline at a time.
  - **No in-process worker/poller.** The polling loop lives in `scripts/extract-worker.ts` (a separate process, spawned on demand by `store.ts`).

- `scripts/store.ts` — CLI entry point for hooks
  - Uses `PristineLocal.createLite()` (DB + ConversationStore + IngestQueue only)
  - Calls `queue.enqueue()`, then spawns detached `extract-worker.ts` if queue was empty before enqueue
  - Exits in <0.5s

- `scripts/extract-worker.ts` — self-terminating worker process
  - Uses full `PristineLocal.create()` (needs Ollama)
  - Polls: `claimNext()` every 2s → `processNext()` → repeat
  - Self-terminates after 30s idle (queue empty, no new work)
  - `--all` mode: process all pending, exit immediately when empty
  - `--retry-failed`: reset failed tasks to pending before processing

#### Crash Recovery Flow

```
Normal: store.ts enqueues → worker claims → extract/embed/consolidate → completed
Crash:  store.ts enqueues → worker claims → worker process dies mid-extraction
        Next store.ts: enqueues new task → sees queue depth > 0 → may spawn worker
        New worker: claimNext() resets stale row → picks up crashed task + new task
```

No data is lost because the conversation is already in SQLite (written in the same transaction as the pending task). The slow path (fact extraction) is idempotent — re-running it on the same conversation produces the same facts (content hash dedup prevents duplicates).

#### Tasks

- [ ] 5.1: Implement `IngestQueue` with SQLite pending_ingest_tasks table, enqueue, claimNext, processNext
- [ ] 5.2: Implement atomic enqueue (conversation + pending task in one transaction)
- [ ] 5.3: Implement self-healing claim (reset stale processing rows on every claim attempt)
- [ ] 5.4: Implement error classification: Ollama connection errors → leave as pending (retryable), other errors → mark failed
- [ ] 5.5: Expose `ingestQueue` property on PristineLocal + `createLite()` for fast-path scripts
- [ ] 5.6: Implement `store.ts` with enqueue + spawn-on-demand worker
- [ ] 5.7: Implement `extract-worker.ts` with poll loop + self-termination + --all + --retry-failed
- [ ] 5.8: Tests: enqueue, claim, crash recovery, error classification, spawn-on-demand, CLI round-trip

**Exit criteria:** Agents can fire-and-forget `store()` calls via CLI hooks. Pending work survives process crashes and is automatically recovered. Worker self-terminates when idle. No persistent daemon. No lost memories.

---

### Phase 6: CLI Scripts for Agent Integration

Ship the scripts that agents (hooks, skills, tools) call to use Pristine. These are the actual integration surface — without them, the SDK exists but no agent can use it.

#### Scripts

**`store.ts`** — called by hooks after every agent turn

```bash
npx tsx ~/.pristine/scripts/store.ts --user-id <userId> < conversation.json
```

1. Reads conversation JSON from stdin
2. Opens SQLite via `createLite()` (no Ollama, no embedder — fast path only)
3. Writes conversation + pending ingest task atomically (via `IngestQueue.enqueue()`)
4. Spawns detached `extract-worker.ts` if queue was empty before enqueue (likely no worker running)
5. Exits immediately (<0.5s total)

**`extract-worker.ts`** — spawn-on-demand worker (spawned by `store.ts`, self-terminates when idle)

```bash
npx tsx ~/.pristine/scripts/extract-worker.ts                # poll loop, exit after 30s idle
npx tsx ~/.pristine/scripts/extract-worker.ts --all          # process all pending, exit immediately
npx tsx ~/.pristine/scripts/extract-worker.ts --retry-failed # reset failed tasks, then process
```

1. Opens SQLite, creates full `PristineLocal.create()` (Ollama embedder + LLM)
2. Default mode: polls `claimNext()` every 2s → processes claimed tasks → self-terminates after 30s idle
3. `--all` mode: processes all pending tasks, exits immediately when queue empty (no idle wait)
4. `--retry-failed`: resets failed tasks to pending before processing
5. Uses `p-limit(1)` for Ollama calls — one pipeline at a time

**`search.ts`** — called by skills/tools when agent needs memory

```bash
npx tsx ~/.pristine/scripts/search.ts --user-id <userId> --query "where does the user live?"
npx tsx ~/.pristine/scripts/search.ts --user-id <userId> --query "current job" --temporal-mode current
```

1. Creates full `PristineLocal.create()` (needs Ollama for query embedding)
2. Calls `search()` with options (~0.2s)
3. Outputs JSON results to stdout
4. Exits (<2s total including init)

**`search-conversations.ts`** — keyword/date search over raw conversations

```bash
npx tsx ~/.pristine/scripts/search-conversations.ts --user-id <userId> --keyword "Tokyo"
npx tsx ~/.pristine/scripts/search-conversations.ts --user-id <userId> --date-from 2026-04-01
```

1. Opens SQLite via `createLite()` (no Ollama needed)
2. FTS5 query (~0.01s)
3. Outputs JSON results to stdout
4. Exits (<0.5s total)

**`get-conversation.ts`** — retrieve full conversation by ID

```bash
npx tsx ~/.pristine/scripts/get-conversation.ts <conversationId>
```

1. Opens SQLite via `createLite()` (no Ollama needed)
2. Primary key lookup (~instant)
3. Outputs full conversation JSON to stdout

#### Implementation

- `scripts/store.ts` — uses `PristineLocal.createLite()` (DB + ConversationStore + IngestQueue only). Enqueues and spawns detached worker.
- `scripts/extract-worker.ts` — uses full `PristineLocal.create()` (Ollama embedder + LLM). Polls queue, processes tasks, self-terminates.
- `scripts/search.ts` — uses full `PristineLocal.create()`. Reads `~/.pristine/models.json` for engine config.
- `scripts/search-conversations.ts` — uses `PristineLocal.createLite()`. No Ollama needed.
- `scripts/get-conversation.ts` — uses `PristineLocal.createLite()`. No Ollama needed.
- Only `extract-worker.ts` and `search.ts` read `~/.pristine/models.json` (they need Ollama). Lite scripts skip it.
- All scripts use `~/.pristine/data/pristine.db` by default, configurable via `--db-path`

#### Tasks

- [ ] 6.1: Implement `scripts/store.ts` with `createLite()` enqueue + detached worker spawn
- [ ] 6.2: Implement `scripts/extract-worker.ts` with poll loop + self-termination + --all + --retry-failed
- [ ] 6.3: Implement `scripts/search.ts` with memory search + JSON output
- [ ] 6.4: Implement `scripts/search-conversations.ts` with FTS5 + JSON output via `createLite()`
- [ ] 6.5: Implement `scripts/get-conversation.ts` with conversation retrieval via `createLite()`
- [ ] 6.6: Tests: store.ts enqueues + spawns worker, extract-worker.ts claims + processes, search.ts returns JSON, all scripts handle missing args gracefully
- [ ] 6.7: Document agent framework configuration examples (hook + skill definitions)

**Exit criteria:** An agent can store conversations via a hook and search memory via a skill using these scripts. All scripts are stateless, output JSON to stdout, and require only Ollama running. No daemon.

---

### Phase 7: Drop Superseded Phases from Roadmap (Documentation)

Formally remove Phases 4 (Episodic Memory), 5 (Relational Memory), 6 (Retrieval Fusion), and 9 (Two-Phase Ingestion) from the active roadmap. Document why each was superseded.

#### What's Dropped and Why

**Phase 4 — Episodic Memory:** Superseded by the conversation store (Phase 1 of this spec). Conversations are stored as structured records and searchable via FTS5. No LLM-generated summaries needed. Agents follow `sourceConversationId` from facts to get full conversation context.

**Phase 5 — Relational Memory (Entity Graph):** Deferred indefinitely. Entity and relationship extraction is the most error-prone LLM task. The query patterns that require graph traversal ("who works at the same company as Sarah?") are rare in practice. The agent's LLM can reason about relationships from retrieved facts + conversation context without a pre-extracted graph.

**Phase 6 — Retrieval Fusion (RRF/MMR):** Deferred. Without episodes and graph, there are only two search channels: vector similarity and FTS5 keyword. Simple score combination or re-ranking is sufficient. Full RRF/MMR is overengineered for two channels.

**Phase 9 — Two-Phase Ingestion:** Dropped. The 6-10 second gap between `store()` and fact availability is not worth a second storage/search path. The agent has the conversation in its context window during ingestion. Background fire-and-forget is sufficient.

#### Tasks

- [ ] 7.1: Update implementation-spec-001.md — mark Phases 4, 5, 6, 9 as superseded with reference to this spec
- [ ] 7.2: Update backlog.md — remove episodic and relational items, add reference to this spec
- [ ] 7.3: Update docs/architecture/memory-approaches.md — reflect simplified architecture
- [ ] 7.4: Remove type stubs for episodes and graph: `src/memory/episodes/types.ts`, `src/memory/graph/types.ts`

**Exit criteria:** Roadmap reflects current architecture decisions. No orphaned type stubs or backlog items for dropped features.

---

### Phase 8: Memorybench — Fix 202x Ingestion Duplication

Port the memorybench framework into pristine and fix the per-question ingestion isolation that causes 55,014 session ingestions instead of 272.

#### The Problem

The LOCOMO benchmark creates a separate memory namespace per question by generating a unique `containerTag` per question. All conversation sessions from that question's parent conversation are ingested into each namespace. With 1,986 questions across 10 conversations, this creates a 202x duplication:

| Conversation | Sessions | Questions | Ingestions (current) | Ingestions (fixed) |
|-------------|----------|-----------|---------------------|-------------------|
| conv-42 | 29 | 260 | 7,540 | 29 |
| All 10 | 272 | 1,986 | 55,014 | 272 |

Ingestion is 85-98% of total benchmark wall time.

#### The Fix

Change `containerTag` from per-question to per-conversation. All questions from the same conversation share the same memory namespace. This is semantically correct — a user's memory persists across questions about that user.

#### Tasks

- [ ] 8.1: Port memorybench framework into `benchmarks/memorybench/` — copy src/, data/, configs; strip vendor-specific providers (ourmemory, supermemory, mem0, zep)
- [ ] 8.2: Fix containerTag generation — per-conversation instead of per-question
- [ ] 8.3: Update search phase to use conversation-level containerTag
- [ ] 8.4: Update clear phase to clear per-conversation
- [ ] 8.5: Update checkpoint schema for conversation-level ingest tracking; reject old-format checkpoints with clear error
- [ ] 8.6: Create Pristine provider — imports PristineLocal SDK directly, no HTTP server
- [ ] 8.7: Tests: verify 272 ingestions for full LOCOMO, not 55,014

**Exit criteria:** Full LOCOMO ingest completes with 272 session ingestions. Pristine provider works end-to-end. Framework compiles and runs in the pristine repo.

---

### Phase 9: Memorybench — Local Model Support

Add Ollama as a judge and answering model backend so the full benchmark runs for $0 using local models.

#### Cost Comparison

| Configuration | Judge | Answering Model | Cost/run | Time (LOCOMO sampled) |
|--------------|-------|-----------------|----------|----------------------|
| Current | GPT-4o | GPT-4o | ~$50 | ~3-4 hours |
| Local | ollama:llama3.2 | ollama:llama3.2 | $0 | ~4-5 hours |
| Hybrid | Haiku (API) | ollama:llama3.2 | ~$3-5 | ~3-4 hours |

#### Implementation

- `benchmarks/memorybench/src/judges/ollama.ts` — Ollama judge backend calling `/api/chat` with `format: "json"`
- Answering model support for `ollama:modelname` format in the answer phase
- Retry logic for malformed JSON from local models (3 attempts)
- CLI: `bun run src/index.ts run -p pristine -b locomo -j ollama -m ollama:llama3.2`

#### Tasks

- [ ] 9.1: Implement Ollama judge backend with JSON retry logic
- [ ] 9.2: Support `ollama:modelname` as answering model
- [ ] 9.3: Register Ollama judge, update CLI help
- [ ] 9.4: Run sampled LOCOMO benchmark (`--sample 10`) end-to-end with local models
- [ ] 9.5: Commit baseline report to `benchmarks/memorybench/data/baselines/pristine-local-v1.json`
- [ ] 9.6: Document benchmark run instructions in README

**Exit criteria:** Full benchmark runs with local models for $0. Baseline accuracy report committed. Reproducible via documented command.

---

### Phase 10: Raw Embedding Memory Mode *(deprioritized)*

> **Status:** Deprioritized. Fact extraction + temporal is the default and only mode. Raw embedding will be implemented if users request a lighter alternative. The architecture supports adding it later — the `Embedder` interface and conversation store don't change.

Add a second memory mode that embeds conversation messages directly without LLM extraction. Each message becomes a searchable vector.

#### Implementation

```
store() in 'embeddings' mode:
  For each message in conversation:
    text = message.content
    embedding = embedder.embed(text)
    store as memory with source_conversation_id
```

No LLM calls. No chunking. No extraction. No consolidation. Each message is stored as-is with its embedding.

#### New Pipeline

- `src/memory/orchestrator/ingest-raw.ts` — simplified pipeline: embed each message → store
  - Skips: LLM extraction, temporal validation, consolidation, turn-order validation
  - Keeps: content hash dedup (don't re-embed identical messages), source conversation ID linking

#### Tasks

- [ ] 10.1: Implement `createRawIngestPipeline()` in `src/memory/orchestrator/ingest-raw.ts`
- [ ] 10.2: Raw pipeline embeds each message, stores with content hash dedup
- [ ] 10.3: Raw pipeline writes `source_conversation_id` linking to conversation store
- [ ] 10.4: Tests: raw ingest stores one memory per message, embeddings are correct dimension, content hash dedup works

**Exit criteria:** A conversation can be ingested via raw embedding — each message becomes a searchable vector. No LLM calls. Content hash prevents duplicates.

---

### Phase 11: Memory Mode Toggle *(deprioritized)*

> **Status:** Deprioritized. Only needed if Phase 10 (raw embedding) is implemented. Depends on Phase 10.

Make the memory mode configurable. Users pick `'facts'` (default) or `'embeddings'` at client creation time.

#### Config

```typescript
const pristine = await PristineLocal.create({
  memoryMode: 'facts',        // LLM extraction + temporal (default)
  // or
  memoryMode: 'embeddings',   // raw message embedding, no LLM
});
```

#### Implementation

- `PristineLocal.create()` reads `memoryMode` from config
- In `'facts'` mode: orchestrator uses `createIngestPipeline()` (existing, unchanged)
- In `'embeddings'` mode: orchestrator uses `createRawIngestPipeline()` (from Phase 10)
- Search works the same in both modes — vector similarity against whatever was stored
- Both modes write to the conversation store — the conversation is always preserved regardless of memory mode
- Both modes set `source_conversation_id` on stored memories

#### Tasks

- [ ] 11.1: Add `memoryMode` to `PristineLocalConfig` — `'facts' | 'embeddings'`, default `'facts'`
- [ ] 11.2: Modify `createOrchestrator()` to accept mode and select the appropriate ingest pipeline
- [ ] 11.3: Modify PristineLocal.create() to pass mode through
- [ ] 11.4: Tests: create client in each mode, verify correct pipeline is used
- [ ] 11.5: Tests: search returns results in both modes, sourceConversationId links work in both

**Exit criteria:** Users can choose between fact extraction and raw embedding via a single config field. Both modes store conversations and link memories back to them.

---

## 6. Build Order

Phases are designed to be implemented as sprints. Dependencies:

```
Phase 1 (conversation store)
    → Phase 2 (conversation search)

Phase 3 (embedder engines) — independent, can parallel with 1-2
Phase 4 (temporalMode API) — independent, can parallel with 1-3
Phase 5 (ingest queue) — independent, can parallel with 1-4

Phase 6 (CLI scripts) — depends on Phases 1, 2, 3 (needs conversation store + search + Ollama embedder)

Phase 7 (drop superseded phases) — depends on Phase 1 (conversation store replaces episodic)

Phase 8 (memorybench fixes) — independent of 1-7
    → Phase 9 (local models) — depends on Phase 8

Phase 10 (raw embedding) — deprioritized, implement on demand
    → Phase 11 (mode toggle) — depends on Phase 10
```

Suggested sprint grouping:
- **Sprint 008:** Phases 8 + 9 (memorybench — already planned as sprint-008.md)
- **Sprint 009:** Phases 1 + 2 (conversation store + search)
- **Sprint 010:** Phases 3 + 4 (embedder engines + temporalMode API)
- **Sprint 011:** Phases 5 + 6 (ingest queue + CLI scripts)
- **Phase 7** (roadmap cleanup) can be done in any sprint as a documentation task
- **Phases 10 + 11** (raw embedding + toggle) — deprioritized, not scheduled

---

## 7. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Ollama embedder quality differs from HuggingFace local | Search quality regression | Both use Nomic Embed v1.5 — same model, same dimensions. Verify with benchmark before switching default. |
| Conversation store grows unbounded | Disk usage on long-running agents | Add optional retention policy (delete conversations older than N days). Not in this spec — future work. |
| Memorybench per-conversation ingest changes scoring semantics | Benchmark results not comparable to upstream | Document the change. Per-conversation is semantically correct — a user's memory persists across questions. The upstream per-question isolation is the bug. |
| Ingest queue drain timeout | Agent hangs on shutdown if LLM is slow | Add configurable timeout to drain (default: 15s). After timeout, log warning and exit. Remaining tasks stay in `processing` and are recovered on next startup. |
| Process crash during extraction | In-flight extraction lost | Conversation + pending task are safe in SQLite (written atomically before extraction starts). Stale `processing` rows are automatically recovered on next claim attempt — no manual intervention needed. |
