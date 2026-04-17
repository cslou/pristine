// Ad-hoc diagnostic: replay the exact failing sessions from the baseline
// run against Ollama with Pristine's CURRENT extractor prompt (imported
// from the built dist/) and capture raw message.content. Tells us
// whether gemma4 returned empty, malformed, or the pipeline rejected
// valid content.
//
// Usage: cd benchmarks/memorybench && npx tsx scripts/debug-failing-sessions.mjs
//
// Note: imports `buildExtractionPrompt` from `pristine` so this script
// always tests the exact prompt Pristine sends. Re-run `npm run build`
// at the repo root after changing the extractor prompt to refresh the
// dist/ copy this script resolves.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildExtractionPrompt } from "pristine"

const LOCOMO_PATH = join(process.cwd(), "data/benchmarks/locomo/locomo10.json")
const REF_BY_SESSION = {
  session_5: "2023-07-03T13:36:00.000Z",
  session_12: "2023-08-17T13:50:00.000Z",
  session_14: "2023-08-25T13:33:00.000Z",
}

// Mirror of EXTRACT_FACTS_SCHEMA (src/memory/extractor/schema.ts).
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

function loadSession(sessionId) {
  const data = JSON.parse(readFileSync(LOCOMO_PATH, "utf8"))
  const item = data.find((x) => x.sample_id === "conv-26")
  const speakerA = item.conversation.speaker_a
  return item.conversation[sessionId].map((m) => ({
    role: m.speaker === speakerA ? "user" : "assistant",
    content: m.text,
  }))
}

// Mirror of Pristine's buildUserPrompt — same Transcript:/--- wrapper so
// the model sees the exact text it sees during production extraction.
function buildUserPrompt(messages) {
  const lines = messages.map((m) => `${m.role}: ${m.content}`)
  return `Transcript:\n---\n${lines.join("\n")}\n---\nExtract facts from the transcript above.`
}

async function probe(sessionId) {
  const messages = loadSession(sessionId)
  const refTs = REF_BY_SESSION[sessionId]
  const body = {
    model: "gemma4:e4b",
    messages: [
      { role: "system", content: buildExtractionPrompt(refTs) },
      { role: "user", content: buildUserPrompt(messages) },
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
  const raw = json.message?.content ?? "<no message.content>"
  console.log(`\n=== ${sessionId} (${messages.length} msgs, ${(durationMs / 1000).toFixed(1)}s) ===`)
  console.log(`raw response (first 1500 chars):`)
  console.log("  " + raw.slice(0, 1500).replace(/\n/g, "\n  "))
  if (raw.length > 1500) {
    console.log(`  ... (${raw.length - 1500} more chars)`)
  }
  try {
    const parsed = JSON.parse(raw)
    console.log(`parsed facts count: ${parsed.facts?.length ?? "n/a"}`)
    if (parsed.facts && parsed.facts.length > 0) {
      console.log(`first 2 facts:`)
      for (const f of parsed.facts.slice(0, 2)) {
        console.log("  - " + JSON.stringify(f))
      }
    }
  } catch (e) {
    console.log(`NOT valid JSON: ${e.message}`)
  }
}

async function main() {
  console.log("Replaying failing sessions with Pristine's current exported prompt")
  console.log("started", new Date().toISOString())
  await probe("session_5")
  await probe("session_12")
  await probe("session_14")
  console.log("\ndone", new Date().toISOString())
}

main().catch((e) => {
  console.error("crashed:", e)
  process.exit(1)
})
