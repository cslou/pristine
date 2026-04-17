import type { UnifiedSession } from "./unified"
import type { ProviderPrompts } from "./prompts"
import type { ConcurrencyConfig } from "./concurrency"

export interface ProviderConfig {
  apiKey: string
  baseUrl?: string
  /**
   * Identifies the run that owns any data this provider persists. Passed
   * through from the orchestrator (checkpoint.dataSourceRunId) so providers
   * can scope storage per run. Optional for provider implementations that
   * do not persist per-run data (e.g. filesystem, rag).
   */
  dataSourceRunId?: string
  /**
   * True when the orchestrator is resuming an existing run (checkpoint
   * exists, not --force). Providers can use this to detect situations
   * like a legacy checkpoint whose on-disk data lives at a path the
   * current code no longer produces (migration case).
   */
  resumeMode?: boolean
  /**
   * Effective concurrency for this run (CLI overrides merged with provider
   * defaults). Providers can use this to warn about configurations that are
   * unlikely to help — e.g. Pristine with Ollama serializes LLM calls, so
   * setting concurrency > 1 just adds latency without improving throughput.
   */
  concurrency?: ConcurrencyConfig
  /**
   * Benchmark name for this run (e.g. "locomo"). Used by providers that
   * stamp per-run metadata so later re-runs can detect config drift.
   */
  benchmark?: string
  /**
   * Pre-resolved extraction model identifier (e.g. "gemma4:e4b"). Providers
   * that stamp per-run metadata compare this against the stamp's prior
   * value to detect config drift. Typically read by the orchestrator from
   * ~/.pristine/models.json; passed in so the provider does not need to
   * duplicate file-reading logic and so tests can inject directly.
   */
  extractionModel?: string | null
  [key: string]: unknown
}

export interface IngestOptions {
  containerTag: string
  metadata?: Record<string, unknown>
}

export interface SearchOptions {
  containerTag: string
  limit?: number
  threshold?: number
  temporalMode?: string
  asOf?: string
}

export interface IngestResult {
  documentIds: string[]
  taskIds?: string[]
  /**
   * Number of memory records the provider actually created for this ingest
   * call. Populated by providers that know the count (Pristine); omitted by
   * providers that cannot report it (filesystem, rag). The orchestrator
   * aggregates this across the ingest phase to detect silent no-op runs
   * (e.g., content-hash duplicate detection that skips extraction) which
   * would otherwise look successful but produce zero-memory containers.
   */
  memoryCount?: number
}

export interface IndexingProgress {
  completedIds: string[]
  failedIds: string[]
  total: number
}

export type IndexingProgressCallback = (progress: IndexingProgress) => void

export interface Provider {
  name: string
  prompts?: ProviderPrompts
  concurrency?: ConcurrencyConfig
  initialize(config: ProviderConfig): Promise<void>
  ingest(sessions: UnifiedSession[], options: IngestOptions): Promise<IngestResult>
  awaitIndexing(
    result: IngestResult,
    containerTag: string,
    onProgress?: IndexingProgressCallback
  ): Promise<void>
  search(query: string, options: SearchOptions): Promise<unknown[]>
  clear(containerTag: string): Promise<void>
  /**
   * Purges all persisted data for a specific dataSourceRunId. Called by the
   * orchestrator when --force is passed, so a clean re-run does not reuse
   * prior extraction state. Distinct from shutdown: this wipes persistent
   * data; shutdown releases in-memory resources.
   */
  purgeRunData?(dataSourceRunId: string): Promise<void>
  /**
   * Releases in-memory resources held by the provider (DB connections,
   * cached clients, open file handles). Called by the orchestrator at the
   * end of a run or on SIGINT/SIGTERM. Must be idempotent — may be invoked
   * from both the finally block and the signal handler.
   */
  shutdown?(): Promise<void>
}

export type ProviderName = "filesystem" | "rag" | "pristine"
