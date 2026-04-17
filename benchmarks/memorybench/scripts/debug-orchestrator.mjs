// End-to-end orchestrator probe. Ingests session_5/7/8/12 via the full
// Pristine pipeline (orchestrator.ingest()) and logs per-step errors
// and the resulting memoryIds array. Tells us where in the pipeline
// the "0 memories" failure lives — extract, consolidate, store, or
// elsewhere.
//
// Usage: cd benchmarks/memorybench && npx tsx scripts/debug-orchestrator.mjs
import { readFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { PristineLocal } from "../../../src/index.js"

const LOCOMO_PATH = join(process.cwd(), "data/benchmarks/locomo/locomo10.json")
const DB_DIR = join(process.cwd(), "data/pristine-dbs/debug-orchestrator")
const REF_BY_SESSION = {
  session_1: "2023-05-01T10:00:00.000Z",
  session_5: "2023-07-03T13:36:00.000Z",
  session_7: "2023-07-10T13:45:00.000Z",
  session_8: "2023-07-19T18:30:00.000Z",
  session_12: "2023-08-17T13:50:00.000Z",
}

if (existsSync(DB_DIR)) {
  rmSync(DB_DIR, { recursive: true, force: true })
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

async function main() {
  console.log("Creating PristineLocal...")
  const client = await PristineLocal.create({
    dbPath: join(DB_DIR, "probe.db"),
    engine: {
      default: "ollama",
      ollama: { model: "gemma4:e4b", host: "http://localhost:11434" },
    },
  })

  const containerTag = "debug-probe"
  const sessionOrder = ["session_1", "session_5", "session_7", "session_8", "session_12"]

  for (const sessionId of sessionOrder) {
    const messages = loadSession(sessionId)
    const refTs = REF_BY_SESSION[sessionId]
    const started = Date.now()
    const result = await client.orchestrator.ingest(messages, containerTag, {
      referenceTimestamp: refTs,
    })
    const dt = ((Date.now() - started) / 1000).toFixed(1)
    const nonEmpty = result.memoryIds.filter((id) => id.length > 0).length
    console.log(`\n=== ${sessionId} (${messages.length} msgs, ${dt}s) ===`)
    console.log(`facts.length = ${result.facts.length}`)
    console.log(`decisions.length = ${result.decisions.length}`)
    console.log(`memoryIds.length = ${result.memoryIds.length}, non-empty = ${nonEmpty}`)
    if (result.errors.length > 0) {
      console.log(`pipeline errors (${result.errors.length}):`)
      for (const e of result.errors) {
        console.log(`  - step=${e.step}: ${e.error}`)
      }
    }
    if (result.decisions.length > 0) {
      const counts = result.decisions.reduce((acc, d) => {
        const key = d?.action || "(undefined)"
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
      console.log(`decision counts:`, counts)
    }
  }

  await client.close?.()
  console.log("\ndone", new Date().toISOString())
}

main().catch((e) => {
  console.error("crashed:", e)
  process.exit(1)
})
