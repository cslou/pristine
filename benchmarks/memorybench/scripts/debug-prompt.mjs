// Bisect: which chunk of Pristine's extractor system prompt breaks gemma4:e4b?
// Schema variation probes showed every schema works with a shortened prompt,
// but the full production prompt (per src/memory/extractor/prompts.ts) yields
// {facts: []}. Run 4 variants against the SAME schema + input to isolate.
//
// Usage:  cd benchmarks/memorybench && npx tsx scripts/debug-prompt.mjs
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REF_TIMESTAMP = "2023-05-08T13:56:00.000Z"
const LOCOMO_PATH = join(
  process.cwd(),
  "data/benchmarks/locomo/locomo10.json"
)

const SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          metadata: { type: "object" },
          validFrom: { type: "string" },
          validUntil: { type: "string" },
          temporalConfidence: {
            type: "string",
            enum: ["explicit", "inferred", "implied", "none"],
          },
        },
        required: ["text"],
      },
    },
  },
  required: ["facts"],
}

// ---------------------------------------------------------------------------
// Prompt chunks (verbatim from src/memory/extractor/prompts.ts)
// ---------------------------------------------------------------------------
const SENSITIVE_PLACEHOLDER_RULES =
  'CRITICAL: If the text contains [SENSITIVE:type:id] placeholders, you MUST preserve them EXACTLY as-is in your extracted facts. ' +
  'Do NOT summarize, paraphrase, or remove these placeholders. They are redacted sensitive values that must pass through unchanged. ' +
  'Example input: "User\'s NRIC is [SENSITIVE:identity_number:abc-123]" -> Output fact: "The user\'s NRIC is [SENSITIVE:identity_number:abc-123]."'

const CATEGORY_GUIDANCE =
  "Focus on extracting these types of information: " +
  "(1) personal preferences (likes, dislikes, favorites), " +
  "(2) important personal details (names, relationships, dates), " +
  "(3) plans and intentions (upcoming events, goals), " +
  "(4) activity and service preferences (dining, travel, hobbies), " +
  "(5) health and wellness information (dietary restrictions, fitness), " +
  "(6) professional details (job title, career goals, work habits), " +
  "(7) miscellaneous details (favorite books, movies, brands)."

const TEMPORAL_RULES_FULL = `TEMPORAL EXTRACTION RULES:
For each fact, detect temporal signals and set validFrom, validUntil, and temporalConfidence accordingly.

REFERENCE_TIME: ${REF_TIMESTAMP}

DATETIME RULES:
- Use ISO 8601 with UTC (Z suffix): 2026-01-15T00:00:00.000Z
- If only a date is mentioned, assume 00:00:00 UTC
- If only a year is mentioned, use January 1st at 00:00:00 UTC
- Ongoing/present-tense facts: set validFrom = REFERENCE_TIME
- Leave both validFrom and validUntil null if no temporal signal is detectable

TEMPORAL SIGNAL TYPES:
1. Absolute dates: "started in January 2026", "born on April 5, 1990"
   -> Set validFrom to the stated date. temporalConfidence = "explicit"
2. Relative dates: "last month", "two weeks ago", "recently"
   -> Resolve relative to REFERENCE_TIME. temporalConfidence = "inferred"
3. State changes: "just got promoted", "moved to London", "switched to tea"
   -> Set validFrom ~ REFERENCE_TIME. temporalConfidence = "implied"
4. Duration: "for three years", "since college"
   -> Calculate validFrom = REFERENCE_TIME minus duration. temporalConfidence = "inferred"
5. Implicit past: "used to", "no longer", "before the merger"
   -> Set validUntil ~ REFERENCE_TIME (fact is no longer true). temporalConfidence = "implied"

CONFIDENCE LEVELS:
- "explicit": date/time stated directly in the text
- "inferred": resolved from a relative expression + REFERENCE_TIME
- "implied": deduced from language patterns (less precise)
- "none": no temporal signal detected (omit validFrom/validUntil)

If temporal extraction is ambiguous or contradictory, set temporalConfidence = "none" and omit dates. Do not guess.`

const TEMPORAL_RULES_SHORT = `TEMPORAL EXTRACTION RULES:
For each fact, detect temporal signals and set validFrom, validUntil, and temporalConfidence accordingly.

REFERENCE_TIME: ${REF_TIMESTAMP}`

function loadConv26Session1() {
  const data = JSON.parse(readFileSync(LOCOMO_PATH, "utf8"))
  const item = data.find((x) => x.sample_id === "conv-26")
  const speakerA = item.conversation.speaker_a
  return item.conversation.session_1.map((m) => ({
    role: m.speaker === speakerA ? "user" : "assistant",
    content: m.text,
  }))
}

async function probe(name, systemPrompt) {
  const userPrompt = loadConv26Session1()
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n")
  const body = {
    model: "gemma4:e4b",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    format: SCHEMA,
    stream: false,
    options: { num_predict: 4096, temperature: 0 },
  }
  const started = Date.now()
  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  const durationMs = Date.now() - started
  const raw = json.message?.content ?? "<<no message.content>>"
  let factsCount = "?"
  try {
    const parsed = JSON.parse(raw)
    factsCount = Array.isArray(parsed?.facts) ? parsed.facts.length : "n/a"
  } catch {
    factsCount = "NOT JSON"
  }
  console.log(
    `\n=== ${name} (${(durationMs / 1000).toFixed(1)}s, systemPrompt=${systemPrompt.length} chars) ===`
  )
  console.log(`  facts count: ${factsCount}`)
  console.log(`  raw (first 300 chars): ${raw.slice(0, 300).replace(/\n/g, " | ")}`)
}

async function main() {
  console.log("Prompt bisect — started at", new Date().toISOString())

  // P1: Full production prompt — should reproduce 0 facts.
  const intro = "Extract factual statements from the conversation. Return each fact as a standalone sentence with no unresolved pronouns. "
  await probe(
    "P1-full-production",
    `${intro}${SENSITIVE_PLACEHOLDER_RULES} ${CATEGORY_GUIDANCE}\n\n${TEMPORAL_RULES_FULL}`
  )

  // P2: Full production MINUS SENSITIVE_PLACEHOLDER_RULES.
  await probe(
    "P2-no-sensitive-rules",
    `${intro}${CATEGORY_GUIDANCE}\n\n${TEMPORAL_RULES_FULL}`
  )

  // P3: Full production MINUS the long TEMPORAL sub-sections.
  await probe(
    "P3-short-temporal",
    `${intro}${SENSITIVE_PLACEHOLDER_RULES} ${CATEGORY_GUIDANCE}\n\n${TEMPORAL_RULES_SHORT}`
  )

  // P4: Full production MINUS CATEGORY_GUIDANCE.
  await probe(
    "P4-no-category-guidance",
    `${intro}${SENSITIVE_PLACEHOLDER_RULES}\n\n${TEMPORAL_RULES_FULL}`
  )

  // P5: Only intro + short temporal (baseline minimal).
  await probe("P5-minimal", `${intro}${CATEGORY_GUIDANCE}\n\n${TEMPORAL_RULES_SHORT}`)

  console.log("\nDone at", new Date().toISOString())
}

main().catch((e) => {
  console.error("Bisect crashed:", e)
  process.exit(1)
})
