// Debug harness: isolate why Pristine + gemma4:e4b extracts zero facts on
// LOCOMO sessions but works on a 3-message synthetic probe. Runs 7 probes of
// increasing complexity and prints facts count, raw response, and timing for
// each. See ../../.claude-2/plans/misty-sauteeing-crystal.md for context.
//
// Usage:  cd benchmarks/memorybench && npx tsx debug-extract.mjs
// Requires: Ollama running locally with gemma4:e4b pulled;
//           ~/.pristine/models.json pointing memory+privacy to gemma4:e4b.
import { readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PristineLocal, createDatabase } from "pristine"

const REF_TIMESTAMP = "2023-05-08T13:56:00.000Z"
const LOCOMO_PATH = join(
  process.cwd(),
  "data/benchmarks/locomo/locomo10.json"
)

// Mirror of EXTRACT_FACTS_SCHEMA for the raw-Ollama probe (P6/P7). Keep in
// sync with src/memory/extractor/schema.ts. If this diverges the probe loses
// its value as a parity check.
const EXTRACT_FACTS_SCHEMA = {
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
// Inputs
// ---------------------------------------------------------------------------

function syntheticControl() {
  return [
    {
      role: "user",
      content: "I moved to Tokyo in April 2023. My favorite ramen shop is Ichiran.",
    },
    { role: "assistant", content: "That's exciting! How are you adjusting to Tokyo?" },
    {
      role: "user",
      content: "Loving it. The public transit is incredible and I walk everywhere.",
    },
  ]
}

function locomoStyleThreeMsg() {
  // LOCOMO tone: casual peer dialog, no explicit "I am X" framings
  return [
    { role: "user", content: "Hey! Long time no see. How's work going?" },
    {
      role: "assistant",
      content: "It's been busy. I got promoted to senior engineer last month actually.",
    },
    { role: "user", content: "Congrats!! That's huge. Are you still at Acme?" },
  ]
}

function loadConv26Session1() {
  const data = JSON.parse(readFileSync(LOCOMO_PATH, "utf8"))
  const item = data.find((x) => x.sample_id === "conv-26")
  if (!item) throw new Error("conv-26 not found in locomo10.json")
  const speakerA = item.conversation.speaker_a
  const messagesRaw = item.conversation.session_1
  return messagesRaw.map((m) => ({
    role: m.speaker === speakerA ? "user" : "assistant",
    content: m.text,
  }))
}

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------

async function runPristineProbe(name, messages) {
  const dbPath = join(tmpdir(), `debug-extract-${Date.now()}-${Math.random()}.db`)
  const db = createDatabase(dbPath)
  const client = await PristineLocal.create({ db })
  const started = Date.now()
  try {
    const result = await client.orchestrator.ingest(messages, `probe-${name}`, {
      referenceTimestamp: REF_TIMESTAMP,
    })
    const durationMs = Date.now() - started
    console.log(`\n=== ${name} ===`)
    console.log(`  messages: ${messages.length}`)
    console.log(`  facts: ${result.facts?.length ?? "n/a"}`)
    console.log(`  memoryIds: ${result.memoryIds?.length ?? "n/a"}`)
    console.log(`  errors: ${JSON.stringify(result.errors)}`)
    console.log(`  duration: ${(durationMs / 1000).toFixed(1)}s`)
    if (result.facts && result.facts.length > 0) {
      console.log(`  first fact:`, JSON.stringify(result.facts[0], null, 2))
    }
  } finally {
    await client.dispose()
    for (const ext of ["", "-wal", "-shm"]) {
      try {
        rmSync(dbPath + ext, { force: true })
      } catch {}
    }
  }
}

/**
 * Build the extraction system prompt exactly like Pristine does. Must stay
 * aligned with src/memory/extractor/prompts.ts.
 */
function buildExtractionSystemPrompt(referenceTimestamp) {
  const sensitive =
    'CRITICAL: If the text contains [SENSITIVE:type:id] placeholders, you MUST preserve them EXACTLY as-is in your extracted facts. Do NOT summarize, paraphrase, or remove these placeholders. They are redacted sensitive values that must pass through unchanged. Example input: "User\'s NRIC is [SENSITIVE:identity_number:abc-123]" -> Output fact: "The user\'s NRIC is [SENSITIVE:identity_number:abc-123]."'
  const categories =
    "Focus on extracting these types of information: (1) personal preferences (likes, dislikes, favorites), (2) important personal details (names, relationships, dates), (3) plans and intentions (upcoming events, goals), (4) activity and service preferences (dining, travel, hobbies), (5) health and wellness information (dietary restrictions, fitness), (6) professional details (job title, career goals, work habits), (7) miscellaneous details (favorite books, movies, brands)."
  const temporal = `TEMPORAL EXTRACTION RULES:
For each fact, detect temporal signals and set validFrom, validUntil, and temporalConfidence accordingly.

REFERENCE_TIME: ${referenceTimestamp}

DATETIME RULES:
- Use ISO 8601 with UTC (Z suffix): 2026-01-15T00:00:00.000Z
- If only a date is mentioned, assume 00:00:00 UTC
- If only a year is mentioned, use January 1st at 00:00:00 UTC
- Ongoing/present-tense facts: set validFrom = REFERENCE_TIME
- Leave both validFrom and validUntil null if no temporal signal is detectable`
  return `Extract factual statements from the conversation. Return each fact as a standalone sentence with no unresolved pronouns. ${sensitive} ${categories}\n\n${temporal}`
}

function buildUserPrompt(messages) {
  return messages.map((m) => `${m.role}: ${m.content}`).join("\n")
}

async function rawOllamaProbe(name, messages, { format }) {
  const body = {
    model: "gemma4:e4b",
    messages: [
      { role: "system", content: buildExtractionSystemPrompt(REF_TIMESTAMP) },
      { role: "user", content: buildUserPrompt(messages) },
    ],
    format,
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
  console.log(`\n=== ${name} (raw Ollama, format=${typeof format === "string" ? format : "schema"}) ===`)
  console.log(`  messages: ${messages.length}`)
  console.log(`  duration: ${(durationMs / 1000).toFixed(1)}s`)
  console.log(`  raw response (first 800 chars):`)
  console.log("    " + raw.slice(0, 800).replace(/\n/g, "\n    "))
  if (raw.length > 800) {
    console.log(`    ... (${raw.length - 800} more chars)`)
  }
  try {
    const parsed = JSON.parse(raw)
    console.log(`  parsed facts count: ${parsed.facts?.length ?? "n/a"}`)
  } catch (e) {
    console.log(`  JSON.parse FAILED: ${e.message}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Starting gemma4:e4b extraction diagnostic at", new Date().toISOString())

  const session1 = loadConv26Session1()
  console.log(`Loaded conv-26 session_1: ${session1.length} messages`)

  await runPristineProbe("P1-synthetic-control-3msg", syntheticControl())
  await runPristineProbe("P2-locomo-style-3msg", locomoStyleThreeMsg())
  await runPristineProbe("P3-locomo-real-3msg", session1.slice(0, 3))
  await runPristineProbe("P4-locomo-real-6msg", session1.slice(0, 6))
  await runPristineProbe("P5-locomo-real-full", session1)

  await rawOllamaProbe("P6-raw-ollama-full-schema", session1, {
    format: EXTRACT_FACTS_SCHEMA,
  })
  await rawOllamaProbe("P7-raw-ollama-json-mode", session1, {
    format: "json",
  })

  console.log("\nDone at", new Date().toISOString())
}

main().catch((e) => {
  console.error("Probe harness crashed:", e)
  process.exit(1)
})
