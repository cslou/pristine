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

const RUNS_DIR = join(process.cwd(), "data", "runs")

/**
 * Pristine Provider
 *
 * Uses PristineLocal SDK directly (no HTTP server). Each conversation gets
 * its own file-backed SQLite database at data/runs/{runId}/{containerTag}.db.
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

  async initialize(_config: ProviderConfig): Promise<void> {
    this.pristineModule = await import("pristine")
    logger.info("Initialized Pristine provider (direct SDK import, no HTTP)")
  }

  async ingest(sessions: UnifiedSession[], options: IngestOptions): Promise<IngestResult> {
    const client = await this.getOrCreateClient(options.containerTag)
    const documentIds: string[] = []

    for (const session of sessions) {
      const messages: Message[] = session.messages.map((m: UnifiedMessage) => ({
        role: m.role as Message["role"],
        content: m.content,
        ...(m.timestamp ? { timestamp: m.timestamp } : {}),
      }))

      await client.store(messages, options.containerTag)
      documentIds.push(session.sessionId)
    }

    return { documentIds }
  }

  async awaitIndexing(
    result: IngestResult,
    _containerTag: string,
    onProgress?: IndexingProgressCallback
  ): Promise<void> {
    // Pristine's store() is synchronous from the caller's perspective — no async indexing
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

  private parseContainerTag(containerTag: string): { runId: string } {
    // containerTag format: "conv-{conversationId}-{runId}"
    // conversationId is numeric (LOCOMO sampleId), runId may contain hyphens
    const match = containerTag.match(/^conv-(\d+)-(.+)$/)
    return { runId: match ? match[2] : "default" }
  }

  private getDbPath(containerTag: string, ensureDir = true): string {
    const { runId } = this.parseContainerTag(containerTag)
    const runDir = join(RUNS_DIR, runId)
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
