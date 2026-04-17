import { mkdirSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import type {
  Provider,
  ProviderConfig,
  IngestOptions,
  IngestResult,
  SearchOptions,
  IndexingProgressCallback,
} from "../../types/provider"
import type { UnifiedSession, UnifiedMessage } from "../../types/unified"
import type { PristineLocal, Message } from "pristine"
import { logger } from "../../utils/logger"
import { PRISTINE_PROMPTS } from "./prompts"

const PRISTINE_DB_ROOT = join(process.cwd(), "data", "pristine-dbs")

/**
 * Pristine Provider
 *
 * Uses PristineLocal SDK directly (no HTTP server). Each conversation gets
 * its own file-backed SQLite database at data/pristine-dbs/{dataSourceRunId}/{containerTag}.db.
 * The isolated namespace (separate from memorybench's data/runs/) avoids cleanup
 * races with CheckpointManager and keeps ownership unambiguous.
 * Data persists across benchmark phases (ingest -> indexing -> search -> answer).
 */
export class PristineProvider implements Provider {
  name = "pristine"
  prompts = PRISTINE_PROMPTS
  concurrency = {
    default: 1,
    ingest: 1,
  }

  private clients = new Map<string, PristineLocal>()
  private pristineModule: typeof import("pristine") | null = null
  private dataSourceRunId: string | null = null

  async initialize(config: ProviderConfig): Promise<void> {
    const newRunId = config.dataSourceRunId
    if (!newRunId) {
      throw new Error("Pristine provider requires dataSourceRunId in ProviderConfig")
    }

    // Idempotency: if reinitializing with a different run, dispose cached clients first
    if (this.dataSourceRunId && this.dataSourceRunId !== newRunId && this.clients.size > 0) {
      for (const client of this.clients.values()) {
        await client.dispose()
      }
      this.clients.clear()
    }

    this.dataSourceRunId = newRunId
    this.pristineModule = await import("pristine")
    logger.info(`Initialized Pristine provider for dataSourceRunId=${newRunId}`)
  }

  async ingest(sessions: UnifiedSession[], options: IngestOptions): Promise<IngestResult> {
    const client = await this.getOrCreateClient(options.containerTag)
    const documentIds: string[] = []
    let memoryCount = 0

    for (const session of sessions) {
      const messages: Message[] = session.messages.map((m: UnifiedMessage) => ({
        role: m.role as Message["role"],
        content: m.content,
        ...(m.timestamp ? { timestamp: m.timestamp } : {}),
      }))

      // Partial-ingest recovery (Option B). Pristine's pipeline is not
      // transactional: addConversation commits, then extract/embed/store run
      // separately. If extract fails (Ollama timeout, OOM, SIGINT) the
      // conversation persists with zero memories. A naive retry would hit
      // UNIQUE (user_id, content_hash) and silently skip extraction. Detect
      // that state here and delete the orphan row before re-ingesting.
      const existing = await client.findConversationByMessages(options.containerTag, messages)
      if (existing && existing.memoryCount === 0) {
        logger.warn(
          `Detected partial-ingest for session ${session.sessionId} ` +
            `(containerTag=${options.containerTag}, conversationId=${existing.id}). ` +
            `Deleting orphan conversation row and re-ingesting.`
        )
        await client.deleteConversation(existing.id)
      } else if (existing && existing.memoryCount > 0) {
        // Idempotent re-run: a prior ingest for this conversation already
        // produced memories. Skip to avoid re-extracting and to preserve the
        // existing memory graph. Report the existing count so Story 6's
        // aggregate guard does not fire.
        memoryCount += existing.memoryCount
        documentIds.push(session.sessionId)
        continue
      }

      const sessionDate = session.metadata?.date as string | undefined
      const result = await client.orchestrator.ingest(messages, options.containerTag, {
        ...(sessionDate ? { referenceTimestamp: sessionDate } : {}),
      })

      // Warn on silent no-op: the Pristine pipeline can still skip extraction
      // for reasons outside the partial-ingest path (e.g. duplicate detection
      // against a session whose conversation row existed before the recovery
      // window, or a config mismatch). Without this warning the failure would
      // look identical to a successful ingest.
      if (result.memoryIds.length === 0 && messages.length > 0) {
        logger.warn(
          `Pristine ingest produced 0 memories for session ${session.sessionId} ` +
            `(containerTag=${options.containerTag}, ${messages.length} messages). ` +
            `Likely cause: content-hash duplicate detection against a stale DB. ` +
            `Run with --force to reset.`
        )
      }

      memoryCount += result.memoryIds.length
      documentIds.push(session.sessionId)
    }

    return { documentIds, memoryCount }
  }

  async awaitIndexing(
    result: IngestResult,
    _containerTag: string,
    onProgress?: IndexingProgressCallback
  ): Promise<void> {
    // Pristine's orchestrator.ingest() completes synchronously — no async indexing needed
    onProgress?.({
      completedIds: result.documentIds,
      failedIds: [],
      total: result.documentIds.length,
    })
  }

  async search(query: string, options: SearchOptions): Promise<unknown[]> {
    const client = this.clients.get(options.containerTag)
    if (!client) {
      logger.warn(`No Pristine client found for ${options.containerTag}`)
      return []
    }

    const result = await client.search(query, options.containerTag, {
      topK: options.limit || 10,
    })

    return result.memories.map((m) => ({
      text: m.memory.text,
      score: m.score,
      validFrom: m.memory.validFrom,
      validUntil: m.memory.validUntil,
    }))
  }

  async clear(containerTag: string): Promise<void> {
    const client = this.clients.get(containerTag)
    if (client) {
      await client.dispose()
      this.clients.delete(containerTag)
    }

    const dbPath = this.getDbPath(containerTag, false)
    try {
      rmSync(dbPath, { force: true })
      logger.info(`Cleared Pristine data for: ${containerTag}`)
    } catch (e) {
      logger.warn(`Failed to clear Pristine data: ${e}`)
    }
  }

  async shutdown(): Promise<void> {
    // Drain-before-dispose: snapshot the clients and clear the map BEFORE
    // awaiting any dispose(), so a concurrent second invocation (e.g. a
    // SIGINT firing between two awaits in the loop) finds an empty map and
    // is a true no-op. Without this, a racing caller would call dispose()
    // on already-disposed clients, and better-sqlite3 throws on double-close.
    const clients = [...this.clients.values()]
    this.clients.clear()
    for (const client of clients) {
      await client.dispose()
    }
  }

  async purgeRunData(dataSourceRunId: string): Promise<void> {
    // Release in-memory resources first: better-sqlite3 holds file handles
    // that can block rmSync cleanup on some platforms. The cache only ever
    // holds clients for a single active run (initialize clears on run-id
    // change), so a full shutdown is equivalent to disposing this run's.
    await this.shutdown()

    const runDir = join(PRISTINE_DB_ROOT, dataSourceRunId)
    if (existsSync(runDir)) {
      rmSync(runDir, { recursive: true, force: true })
      logger.info(`Purged Pristine DB folder for dataSourceRunId=${dataSourceRunId}`)
    }
  }

  private getDbPath(containerTag: string, ensureDir = true): string {
    if (!this.dataSourceRunId) {
      throw new Error("Pristine provider not initialized. Call initialize() first.")
    }
    const runDir = join(PRISTINE_DB_ROOT, this.dataSourceRunId)
    if (ensureDir && !existsSync(runDir)) {
      mkdirSync(runDir, { recursive: true })
    }
    const safeName = containerTag.replace(/[^a-zA-Z0-9_.-]/g, "_")
    return join(runDir, `${safeName}.db`)
  }

  private async getOrCreateClient(containerTag: string): Promise<PristineLocal> {
    let client = this.clients.get(containerTag)
    if (client) return client

    if (!this.pristineModule) throw new Error("Provider not initialized")

    const dbPath = this.getDbPath(containerTag, true)
    const db = this.pristineModule.createDatabase(dbPath)
    client = await this.pristineModule.PristineLocal.create({ db })
    this.clients.set(containerTag, client)

    return client
  }
}

export default PristineProvider
