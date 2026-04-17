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
