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

export function getProviderConfig(
  provider: string,
  dataSourceRunId: string
): { apiKey: string; baseUrl?: string; dataSourceRunId: string } {
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
  return { ...base, dataSourceRunId }
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
