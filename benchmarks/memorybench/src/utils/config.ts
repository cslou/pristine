import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface Config {
  openaiApiKey: string
  anthropicApiKey: string
  googleApiKey: string
}

export const config: Config = {
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  googleApiKey: process.env.GOOGLE_API_KEY || "",
}

/**
 * Read the Pristine extraction model from ~/.pristine/models.json. Returns
 * null when the file is missing or malformed. Exposed so the orchestrator
 * can inject the value into the provider's config instead of each provider
 * duplicating file-reading logic.
 */
export function readPristineExtractionModel(): string | null {
  try {
    const raw = readFileSync(join(homedir(), ".pristine", "models.json"), "utf8")
    const parsed = JSON.parse(raw) as { memory?: { model?: unknown } }
    const model = parsed.memory?.model
    return typeof model === "string" ? model : null
  } catch {
    return null
  }
}

export function getProviderConfig(
  provider: string,
  dataSourceRunId: string,
  resumeMode = false,
  concurrency?: import("../types/concurrency").ConcurrencyConfig,
  benchmark?: string
): {
  apiKey: string
  baseUrl?: string
  dataSourceRunId: string
  resumeMode: boolean
  concurrency?: import("../types/concurrency").ConcurrencyConfig
  benchmark?: string
  extractionModel: string | null
} {
  const base = (() => {
    switch (provider) {
      case "filesystem":
        return { apiKey: config.openaiApiKey } // Filesystem uses OpenAI for memory extraction
      case "rag":
        return { apiKey: config.openaiApiKey } // RAG provider uses OpenAI for embeddings
      case "pristine":
        return { apiKey: "none" } // Pristine uses local models, no API key needed
      default:
        throw new Error(`Unknown provider: ${provider}`)
    }
  })()
  return {
    ...base,
    dataSourceRunId,
    resumeMode,
    concurrency,
    benchmark,
    extractionModel: provider === "pristine" ? readPristineExtractionModel() : null,
  }
}

export function getJudgeConfig(judge: string): { apiKey: string; model?: string } {
  switch (judge) {
    case "openai":
      return { apiKey: config.openaiApiKey }
    case "anthropic":
      return { apiKey: config.anthropicApiKey }
    case "google":
      return { apiKey: config.googleApiKey }
    case "ollama":
      return { apiKey: "none" }
    default:
      throw new Error(`Unknown judge: ${judge}`)
  }
}
