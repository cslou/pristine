// Diagnostic that calls Pristine's own LocalExtractor + OllamaClient
// (imported from dist/) instead of a parallel HTTP fetch. If this
// returns facts where the baseline pipeline returns 0, the issue is
// somewhere in the orchestrator / consolidator / store; if this also
// returns 0, the issue is in the extractor path itself.
//
// Usage: cd benchmarks/memorybench && npx tsx scripts/debug-pristine-extractor.mjs
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createExtractor } from "../../../src/memory/extractor/index.js"
import { OllamaClient } from "../../../src/engine/ollama/index.js"

const LOCOMO_PATH = join(process.cwd(), "data/benchmarks/locomo/locomo10.json")
const REF_BY_SESSION = {
  session_5: "2023-07-03T13:36:00.000Z",
  session_7: "2023-07-10T13:45:00.000Z",
  session_8: "2023-07-19T18:30:00.000Z",
  session_12: "2023-08-17T13:50:00.000Z",
  session_14: "2023-08-25T13:33:00.000Z",
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

async function probe(sessionId) {
  const messages = loadSession(sessionId)
  const refTs = REF_BY_SESSION[sessionId]
  const client = new OllamaClient({
    model: "gemma4:e4b",
    host: "http://localhost:11434",
  })
  const extractor = createExtractor(client)
  const started = Date.now()
  try {
    const result = await extractor.extract(messages, refTs)
    const dt = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`\n=== ${sessionId} (${messages.length} msgs, ${dt}s) ===`)
    console.log(`extractor.facts.length = ${result.facts.length}`)
    if (result.facts.length > 0) {
      console.log("first 2 facts:")
      for (const f of result.facts.slice(0, 2)) {
        console.log(" - " + JSON.stringify(f))
      }
    } else {
      console.log("EMPTY result — extractor returned no facts")
    }
  } catch (err) {
    console.log(`\n=== ${sessionId} (${messages.length} msgs) ===`)
    console.log(`ERROR: ${err.message}`)
  }
}

async function main() {
  console.log("Probing Pristine's LocalExtractor + OllamaClient directly")
  console.log("started", new Date().toISOString())
  for (const id of ["session_5", "session_7", "session_8", "session_12", "session_14"]) {
    await probe(id)
  }
  console.log("\ndone", new Date().toISOString())
}

main().catch((e) => {
  console.error("crashed:", e)
  process.exit(1)
})
