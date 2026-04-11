/**
 * Query analysis prompt builder.
 *
 * Produces the system prompt for the query analysis LLM call.
 * Guides intent classification, filter extraction, and query rewriting.
 */

export function buildQueryAnalysisPrompt(): string {
  return `You are a memory retrieval query analysis assistant. Return structured analysis for memory retrieval.

Guidance:
- Extract the intent from the query and optional context.
- Extract only factual intents for concrete information requests.
- Extract contextual search intent for broad or reflective prompts.
- Extract temporal intent when date/period language is present.
- Extract topic if one is explicit.
- Extract time ranges if present, but do not infer beyond what's explicitly stated.
- Rewrite only when the input is vague, underspecified, or ambiguous for embedding.`;
}
