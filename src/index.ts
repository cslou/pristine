/**
 * # Pristine — local-first privacy and memory SDK
 *
 * Pristine is a local-first SDK for storing conversations + retrieving
 * relevant context (windows, messages, sessions) for LLM agents. No API
 * calls, no server, no data leaving the device. The corpus lives in a
 * single SQLite file (`better-sqlite3` + `sqlite-vec`); embeddings are
 * computed in-process via Nomic Embed v1.5 (768-d). Spec:
 * `docs/specs/implementation-spec-005.md`.
 *
 * ## Primary entry points
 *
 * - **`Pristine.create({...})`** — full client. Includes the embedder, LLM
 *   clients (privacy + memory pipelines), indexer, and searcher. Use when
 *   the consumer wants ingestion + retrieval.
 * - **`Pristine.createLite({...})`** — lightweight client. DB,
 *   `ConversationStore`, and `IngestQueue` only. No embedder, no LLM
 *   clients, no indexer. Supports `searchConversations()` and
 *   `getConversation()` for read-only flows; `storeAsync()` throws
 *   `InvalidArgumentError` on lite clients.
 *
 * ## Lifecycle (the load-bearing recipe)
 *
 * The canonical "store + drain + retrieve" pattern for a synchronous CLI
 * or a one-shot script:
 *
 * ```ts
 * const conversationId = client.storeAsync(messages, userId, projectId);
 * await client.drainEmbedQueue();          // flush per-message embeds
 * await client.buildSessionVector(conversationId); // populate vec_sessions
 * const hits = await client.searcher!.hybridSearch(query, { projectId }, 10);
 * ```
 *
 * - `storeAsync` is fire-and-forget at the SDK level — message rows land
 *   synchronously, embed-message tasks queue for the worker to drain.
 * - `drainEmbedQueue()` runs the worker in-process until the queue is
 *   idle. Skip if the consumer runs `scripts/embed-worker.ts` as a
 *   detached daemon — same pipeline, just async.
 * - `buildSessionVector(conversationId)` is a separate explicit call per
 *   spec §5.1.2; `storeAsync` does NOT auto-build session vectors. Skip
 *   if the session leg of `hybridSearch` is not needed.
 * - `searcher.hybridSearch(query, filters, k)` returns `HybridHit[]`
 *   spanning `kind: 'window' | 'message' | 'session'` via RRF fusion.
 *
 * ## Dependency injection (custom implementations + test mocks)
 *
 * - **`Embedder`** — supply a custom embedder (e.g., remote API,
 *   alternate model) by implementing `embed(text)` + `embedBatch(texts)`.
 *   Sprint-017 covers the embedder-spike (alternate engines beyond
 *   Nomic). The default embedder is `LocalEmbedder` (Nomic v1.5).
 * - **`LlmClient`** — implements `generate<T>()` (NOT the Anthropic SDK
 *   `messages.create()` shape). Used by the privacy classifier and the
 *   memory pipeline. Bundle two as `LlmClients = { privacyClient,
 *   memoryClient }`. Defaults wire `LlamaCppClient` or `OllamaClient`
 *   depending on `models.json` config.
 *
 * Both interfaces are re-exported here so consumers can declare custom
 * impls without reaching into internal modules.
 *
 * ## Errors consumers catch
 *
 * - **`AppError`** — base class. All Pristine errors extend it; catch
 *   this for a coarse "Pristine failed" handler.
 * - **`ConfigError`** — bad config (invalid `models.json`, missing model
 *   files, malformed engine settings).
 * - **`EmbedderError`** — embedder-side failures (model load, network
 *   for remote embedders, retries exhausted).
 * - **`IngestQueueError`** — queue-side failures (corruption, contract
 *   violation in a custom `embedTaskHandler`). Catch on `storeAsync`
 *   if the consumer wants to react to ingest-queue trouble explicitly.
 *
 * Domain-specific subclasses (`InvalidArgumentError`,
 * `ConversationNotFoundError`, etc.) live in `src/core/errors.ts` and
 * extend `AppError`; they are NOT re-exported here. Consumers should
 * catch the public classes above; if their flow demands a specific
 * subclass, import direct from `core/errors`.
 *
 * ## Spec + reference implementations
 *
 * Primitive contracts and rationale:
 * **`docs/specs/implementation-spec-005.md`** — §5.1 enumerates the
 * primitives (`store`, `indexer`, `searcher`, `embedder`); §15 describes
 * the user + data flows the SDK composes.
 *
 * Reference tool implementations (`search_memory`, `query_memory`) ship
 * separately as Phase 6 deliverables — when available, they will live
 * under `docs/examples/search-memory-tool/` and
 * `docs/examples/query-memory-tool/` and demonstrate the canonical
 * agent-tool wrappers around `searcher.hybridSearch` and the SQL
 * primitive (sprint-019). Until Phase 6 ships, the recipe above is the
 * canonical pattern.
 */

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export { PristineLocal } from './client.js';
export type { PristineLocalConfig, PristineLiteConfig } from './client.js';

// ---------------------------------------------------------------------------
// Core types (consumer-facing)
// ---------------------------------------------------------------------------

// `Memory` (the pre-spec-005 fact-ledger shape) was previously re-exported
// here. Removed in sprint-018 Story 4. The type itself stays in
// `src/core/types.ts` for now — `SanitizedMemory` derives from it and
// `src/memory/retriever/ranking.ts` still references it; those internal
// consumers import direct from `core/types`. Full removal of the `Memory`
// type belongs to the LLM-removal sprint (per sprint-016 retro), which
// also drops the privacy LLM classifier and `LlmClient` / `LlmClients`
// interfaces that anchor the legacy fact pipeline.
export type {
  ConversationDetail,
  ConversationSearchResult,
  Message,
  MessageRole,
  SecureAndRedactResult,
  RevealResult,
} from './core/types.js';

// ---------------------------------------------------------------------------
// Interfaces (for DI, custom implementations, and test mocks)
// ---------------------------------------------------------------------------

export type { Embedder, LlmClient } from './core/interfaces.js';

export type { LlmClients } from './engine/index.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export { AppError, ConfigError, EmbedderError, IngestQueueError } from './core/errors.js';

// ---------------------------------------------------------------------------
// Database (for provider integrations that need file-backed DBs)
// ---------------------------------------------------------------------------

export { createDatabase } from './core/database.js';

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

// IngestQueue (class), IngestTask (type), and IngestQueueConfig (type) were
// previously re-exported here. Removed in sprint-018 Story 4 — they're
// internal-only plumbing the consumer-facing surface (storeAsync,
// drainEmbedQueue, buildSessionVector) encapsulates. IngestQueueError stays
// exported from the errors block (consumers catch it on storeAsync).

// ---------------------------------------------------------------------------
// Searcher (spec-005 Phase 4 retrieval primitive)
// ---------------------------------------------------------------------------

export type {
  Searcher,
  SearchFilters,
  WindowHit,
  MessageHit,
  SessionHit,
  HybridHit,
  HybridSource,
  Role,
} from './memory/searcher/index.js';
