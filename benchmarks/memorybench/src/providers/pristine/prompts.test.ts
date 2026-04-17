import { describe, test, expect } from "bun:test"
import { buildPristineAnswerPrompt } from "./prompts"

// The answer-phase prompt builder is the boundary where provider search
// results flow into the LLM prompt. A bad shape there turns into silent
// nonsense or a hard-to-trace crash downstream. The zod schema at this
// boundary converts that into a clear, localized error.

const validResult = {
  text: "User moved apartments in April 2023.",
  score: 0.87,
  validFrom: "2023-04-15T00:00:00Z",
}

describe("buildPristineAnswerPrompt context validation (zod)", () => {
  test("accepts well-formed search results", () => {
    expect(() =>
      buildPristineAnswerPrompt("Where did the user move?", [validResult])
    ).not.toThrow()
  })

  test("returns 'No relevant memories' when context is empty", () => {
    const out = buildPristineAnswerPrompt("q?", [])
    expect(out).toContain("No relevant memories were found.")
  })

  test("throws a clear error when a result is missing required `text`", () => {
    const bad = [{ score: 0.9, validFrom: "2023-01-01" }]
    expect(() => buildPristineAnswerPrompt("q?", bad)).toThrow(
      /malformed search results/
    )
  })

  test("throws a clear error when `score` is a string (wrong type)", () => {
    const bad = [{ text: "ok", score: "high" }]
    expect(() => buildPristineAnswerPrompt("q?", bad)).toThrow(
      /malformed search results/
    )
  })

  test("throws a clear error when context is not an array", () => {
    // Upstream contract: memorybench always passes unknown[], but defensive
    // coding at the boundary must reject non-array inputs gracefully too.
    expect(() =>
      buildPristineAnswerPrompt("q?", "not-an-array" as unknown as unknown[])
    ).toThrow(/malformed search results/)
  })

  test("accepts results with only the required fields (validFrom/validUntil optional)", () => {
    const minimal = [{ text: "bare minimum", score: 0.5 }]
    expect(() => buildPristineAnswerPrompt("q?", minimal)).not.toThrow()
  })
})
