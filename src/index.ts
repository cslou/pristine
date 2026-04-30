/**
 * # Pristine — local-first privacy and memory SDK
 *
 * Pristine is a local-first SDK for storing conversations + retrieving
 * relevant context (windows, messages, sessions) for LLM agents. No API
 * calls, no server, no data leaving the device. The corpus lives in a
 * single SQLite file (`better-sqlite3` + `sqlite-vec`); embeddings are
 * computed in-process via Nomic Embed v1.5 (768-d).
 *
 * ## Primary entry points
 *
 * - **`Pristine.create({...})`** — full client. Includes the embedder, LLM
 *   clients (privacy + memory pipelines), indexer, and searcher. Use when
 *   the consumer wants ingestion + retrieval.
 * - **`Pristine.createLite({...})`** — lightweight client. DB,
 *   `ConversationStore`, and `IngestQueue` only. No embedder, no LLM
 *   clients, no indexer. Supports `searchConversations()` and
 *   `getConversation()` for read-only flows. `storeAsync()`,
 *   `drainEmbedQueue()`, and `buildSessionVector()` all throw
 *   `InvalidArgumentError` on lite clients (no embedder wired); use
 *   `Pristine.create({...})` if any of those are needed.
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
 * - `buildSessionVector(conversationId)` is a separate explicit call;
 *   `storeAsync` does NOT auto-build session vectors. Skip if the
 *   session leg of `hybridSearch` is not needed.
 * - `searcher.hybridSearch(query, filters, k)` returns `HybridHit[]`
 *   spanning `kind: 'window' | 'message' | 'session'` via RRF fusion.
 *
 * ## Dependency injection (custom implementations + test mocks)
 *
 * - **`Embedder`** — supply a custom embedder (e.g., remote API,
 *   alternate model) by implementing `embed(text)` + `embedBatch(texts)`.
 *   The default embedder is `LocalEmbedder` (Nomic v1.5).
 *
 * This interface is re-exported here so consumers can declare custom
 * impls without reaching into internal modules.
 *
 * ## Errors consumers catch
 *
 * - **`AppError`** — base class. All Pristine errors extend it; catch
 *   this for a coarse "Pristine failed" handler.
 * - **`EmbedderError`** — embedder-side failures (model load, network
 *   for remote embedders, retries exhausted).
 * - **`IngestQueueError`** — queue-side failures (corruption, contract
 *   violation in a custom `embedTaskHandler`). Catch on `storeAsync`
 *   if the consumer wants to react to ingest-queue trouble explicitly.
 * - **`InvalidArgumentError`** — caller passed something the SDK won't
 *   accept (missing/empty conversationId on `buildSessionVector`,
 *   `storeAsync`/`drainEmbedQueue`/`buildSessionVector` called on a
 *   lite client, conversationId references a row that doesn't exist).
 *   The two passthrough methods (`drainEmbedQueue`,
 *   `buildSessionVector`) narrow the indexer's broader error set to
 *   this single class so callers have one type to catch.
 * - **`ConfigError`** — bad config (invalid `models.json`, missing model
 *   files, malformed engine settings); typically surfaces during
 *   `Pristine.create({...})`.
 *
 * Other domain-specific subclasses (e.g. `ConversationNotFoundError`)
 * live in `src/core/errors.ts` and extend `AppError`; they are NOT
 * re-exported here. Consumers should catch the public classes above;
 * if their flow demands a specific subclass not exported from the
 * barrel, import direct from `core/errors`.
 *
 * ## Reference implementations
 *
 * Reference tool implementations (`search_memory`, `query_memory`)
 * ship separately as examples — when available they will live under
 * `docs/examples/search-memory-tool/` and
 * `docs/examples/query-memory-tool/` and demonstrate the canonical
 * agent-tool wrappers around `searcher.hybridSearch`. Until those
 * examples ship, the lifecycle recipe above is the canonical pattern.
 */

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export { PristineLocal } from './client.js';
export type { PristineLocalConfig, PristineLiteConfig } from './client.js';

// ---------------------------------------------------------------------------
// Core types (consumer-facing)
// ---------------------------------------------------------------------------

// `Memory` (the legacy fact-ledger row shape) is no longer re-exported
// here. The type itself stays in `src/core/types.ts` for now — internal
// consumers (`src/memory/retriever/ranking.ts`, `SanitizedMemory`) still
// reference it and import direct from `core/types`. Full removal is the
// next cleanup pass.
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

export type { Embedder } from './core/interfaces.js';

export type { DeterministicClassifierConfig } from './privacy/classifier/deterministic/index.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export {
  AppError,
  ConfigError,
  EmbedderError,
  IngestQueueError,
  InvalidArgumentError,
} from './core/errors.js';

// ---------------------------------------------------------------------------
// Database (for provider integrations that need file-backed DBs)
// ---------------------------------------------------------------------------

export { createDatabase } from './core/database.js';

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

// IngestQueue (class), IngestTask (type), and IngestQueueConfig (type)
// are deliberately not re-exported — they're internal-only plumbing the
// consumer-facing surface (storeAsync, drainEmbedQueue,
// buildSessionVector) encapsulates. IngestQueueError stays exported
// from the errors block (consumers catch it on storeAsync).

// ---------------------------------------------------------------------------
// Searcher — the hybrid retrieval primitive
// ---------------------------------------------------------------------------
//
// Consumer recipe: see the top-of-file JSDoc "Lifecycle" section. Per-method
// JSDoc on the Searcher interface methods (vectorSearch, ftsSearch,
// hybridSearch, sessionVectorSearch) lives in src/memory/searcher/index.ts.

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
