import type { ProviderPrompts } from "../../types/prompts"

interface PristineResult {
  text: string
  score: number
  validFrom?: string
  validUntil?: string
}

function buildPristineContext(context: unknown[]): string {
  const results = context as PristineResult[]

  if (results.length === 0) {
    return "No relevant memories were found."
  }

  return results
    .map((result, i) => {
      const validity = [
        result.validFrom ? `from: ${result.validFrom}` : null,
        result.validUntil ? `to: ${result.validUntil}` : null,
      ]
        .filter(Boolean)
        .join(", ")
      const header = `=== Memory ${i + 1} (score: ${result.score.toFixed(2)}${validity ? `, ${validity}` : ""}) ===`
      return `${header}\n${result.text}`
    })
    .join("\n\n")
}

export function buildPristineAnswerPrompt(
  question: string,
  context: unknown[],
  questionDate?: string
): string {
  const retrievedContext = buildPristineContext(context)

  return `You are a question-answering system. Based on the retrieved memories below, answer the question.

Question: ${question}
Question Date: ${questionDate || "Not specified"}

Retrieved Memories:
${retrievedContext}

Instructions:
- Base your answer ONLY on the provided memories
- Each memory has a relevance score and optional temporal validity dates
- For time-based questions, use the validity dates and question date to reason about what was true when
- If the memories contain enough information, provide a clear, concise answer
- If the memories do not contain enough information, respond with "I don't know"

Answer:`
}

export const PRISTINE_PROMPTS: ProviderPrompts = {
  answerPrompt: buildPristineAnswerPrompt,
}

export default PRISTINE_PROMPTS
