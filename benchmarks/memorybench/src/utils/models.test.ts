import { describe, test, expect } from "bun:test"
import { resolveModel, getModelConfig, getModelId, getModelProvider } from "./models"

// The ollama:<model> alias must preserve colons in the model id. llama3.2:3b
// and gemma4:e4b both embed a colon after the model family, and a naive
// `split(":")` would truncate at the first colon and yield "llama3.2" /
// "gemma4" — different models with the same memorybench flag would then
// silently collapse onto the wrong runtime model. This suite is the
// regression guard for alias parsing across the three exposed entry points.

describe("ollama:<model> alias parsing", () => {
  test("resolveModel preserves colons in the model id", () => {
    expect(resolveModel("ollama:gemma4:e4b").id).toBe("gemma4:e4b")
    expect(resolveModel("ollama:llama3.2:3b").id).toBe("llama3.2:3b")
    expect(resolveModel("ollama:qwen2.5:7b").id).toBe("qwen2.5:7b")
  })

  test("resolveModel reports ollama as the provider", () => {
    expect(resolveModel("ollama:gemma4:e4b").provider).toBe("ollama")
  })

  test("resolveModel sets a human-readable displayName that includes the full id", () => {
    expect(resolveModel("ollama:gemma4:e4b").displayName).toContain("gemma4:e4b")
  })

  test("getModelConfig behaves identically to resolveModel for ollama aliases", () => {
    const viaResolve = resolveModel("ollama:gemma4:e4b")
    const viaConfig = getModelConfig("ollama:gemma4:e4b")
    expect(viaConfig.id).toBe(viaResolve.id)
    expect(viaConfig.provider).toBe(viaResolve.provider)
  })

  test("getModelId strips the ollama: prefix but preserves inner colons", () => {
    expect(getModelId("ollama:gemma4:e4b")).toBe("gemma4:e4b")
  })

  test("getModelProvider returns 'ollama' for prefixed aliases", () => {
    expect(getModelProvider("ollama:gemma4:e4b")).toBe("ollama")
  })

  test("bare 'ollama' alias resolves to the default ollama model", () => {
    // MODEL_CONFIGS lookup path for the legacy bare alias.
    const cfg = resolveModel("ollama")
    expect(cfg.provider).toBe("ollama")
    expect(typeof cfg.id).toBe("string")
    expect(cfg.id.length).toBeGreaterThan(0)
  })

  test("does NOT alter non-ollama aliases when they contain colons", () => {
    // Sanity guard: only `ollama:` prefix triggers the slice; other aliases
    // with colons (hypothetical future — e.g. `provider:model`) must not
    // be accidentally stripped. Use an alias with a colon so a future
    // regression that strips on ANY colon would actually fail this test.
    const cfg = resolveModel("hypothetical:variant")
    expect(cfg.id).toBe("hypothetical:variant")
  })
})
