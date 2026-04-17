// Targeted probe: is gemma4:e4b's "empty facts" output caused by our
// JSON Schema shape (specifically llama.cpp GBNF grammar generation quirks)
// rather than a model capability limit?
//
// Approach: hit Ollama directly with the same system+user prompt but vary
// only the `format` parameter. If a simpler schema works where the full
// one fails, the fix is on our side (schema adjustment), not the model.
//
// Usage:  cd benchmarks/memorybench && npx tsx scripts/debug-schema.mjs
// Requires: Ollama running, gemma4:e4b pulled.
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REF_TIMESTAMP = "2023-05-08T13:56:00.000Z"
const LOCOMO_PATH = join(
  process.cwd(),
  "data/benchmarks/locomo/locomo10.json"
)

function loadConv26Session1() {
  const data = JSON.parse(readFileSync(LOCOMO_PATH, "utf8"))
  const item = data.find((x) => x.sample_id === "conv-26")
  const speakerA = item.conversation.speaker_a
  return item.conversation.session_1.map((m) => ({
    role: m.speaker === speakerA ? "user" : "assistant",
    content: m.text,
  }))
}

function buildSystemPrompt() {
  return `Extract factual statements from the conversation. Return each fact as a standalone sentence with no unresolved pronouns. Focus on extracting these types of information: (1) personal preferences (likes, dislikes, favorites), (2) important personal details (names, relationships, dates), (3) plans and intentions (upcoming events, goals), (4) activity and service preferences (dining, travel, hobbies), (5) health and wellness information (dietary restrictions, fitness), (6) professional details (job title, career goals, work habits), (7) miscellaneous details (favorite books, movies, brands).

TEMPORAL EXTRACTION RULES:
For each fact, detect temporal signals and set validFrom, validUntil, and temporalConfidence accordingly.

REFERENCE_TIME: ${REF_TIMESTAMP}`
}

function buildUserPrompt(messages) {
  return messages.map((m) => `${m.role}: ${m.content}`).join("\n")
}

async function probe(name, { format, systemPromptOverride, numPredict }) {
  const body = {
    model: "gemma4:e4b",
    messages: [
      { role: "system", content: systemPromptOverride ?? buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(loadConv26Session1()) },
    ],
    stream: false,
    options: { num_predict: numPredict ?? 4096, temperature: 0 },
  }
  if (format !== undefined) {
    body.format = format
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

  console.log(`\n=== ${name} (${(durationMs / 1000).toFixed(1)}s) ===`)
  console.log(`  raw response (first 1200 chars):`)
  console.log("    " + raw.slice(0, 1200).replace(/\n/g, "\n    "))
  if (raw.length > 1200) {
    console.log(`    ... (${raw.length - 1200} more chars)`)
  }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.facts)) {
      console.log(`  facts count: ${parsed.facts.length}`)
      if (parsed.facts[0]) console.log(`  first fact:`, JSON.stringify(parsed.facts[0]).slice(0, 200))
    } else {
      console.log(`  top-level keys: ${Object.keys(parsed ?? {}).join(", ")}`)
    }
  } catch (e) {
    console.log(`  NOT valid JSON (${e.message})`)
  }
}

// ---------------------------------------------------------------------------
// Schema variants
// ---------------------------------------------------------------------------

const SCHEMA_CURRENT = {
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

// SA — Minimum viable: facts as array of strings only. Pure capability probe.
const SCHEMA_MIN_STRINGS = {
  type: "object",
  properties: {
    facts: { type: "array", items: { type: "string" } },
  },
  required: ["facts"],
}

// SB — Current schema + additionalProperties: false everywhere. Known fix
// for llama.cpp GBNF over-permissive grammar states.
const SCHEMA_CURRENT_STRICT = {
  type: "object",
  additionalProperties: false,
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          metadata: { type: "object", additionalProperties: false },
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

// SC — Current schema minus the unbounded `metadata: {type: object}` field.
// The unbounded object type is a known GBNF trap — sampler has to allow any
// key/value pair, which creates a permissive grammar state.
const SCHEMA_NO_METADATA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
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

// SD — Current schema but ALL properties required. Removes optional-branch
// choice points in the grammar, giving the sampler a single valid path
// through each fact object.
const SCHEMA_ALL_REQUIRED = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          validFrom: { type: "string" },
          validUntil: { type: "string" },
          temporalConfidence: {
            type: "string",
            enum: ["explicit", "inferred", "implied", "none"],
          },
        },
        required: ["text", "validFrom", "validUntil", "temporalConfidence"],
      },
    },
  },
  required: ["facts"],
}

// ---------------------------------------------------------------------------
// Probe sequence
// ---------------------------------------------------------------------------

async function main() {
  console.log("Probe: does schema shape rescue gemma4:e4b? — started at", new Date().toISOString())

  // Baseline: our current schema (known to fail)
  await probe("SA-current-schema", { format: SCHEMA_CURRENT })

  // Minimum viable — is gemma4 capable of structured output AT ALL?
  await probe("SB-min-strings", { format: SCHEMA_MIN_STRINGS })

  // Current schema + additionalProperties: false
  await probe("SC-current-plus-strict", { format: SCHEMA_CURRENT_STRICT })

  // Current schema minus the unbounded metadata field
  await probe("SD-no-metadata", { format: SCHEMA_NO_METADATA })

  // Current schema but all properties required
  await probe("SE-all-required", { format: SCHEMA_ALL_REQUIRED })

  // Sanity: no format constraint + strict system prompt demanding JSON
  await probe("SF-no-format-prompted-json", {
    format: undefined,
    systemPromptOverride:
      buildSystemPrompt() +
      "\n\nYou MUST respond with valid JSON matching this exact shape and nothing else: {\"facts\": [{\"text\": \"...\", \"validFrom\": \"...\", \"validUntil\": \"...\", \"temporalConfidence\": \"explicit|inferred|implied|none\"}]}. No markdown fences, no explanation, only raw JSON.",
  })

  console.log("\nDone at", new Date().toISOString())
}

main().catch((e) => {
  console.error("Probe crashed:", e)
  process.exit(1)
})
