# MemoryBench

A pluggable benchmarking framework for evaluating memory and context systems.

## Features

- Interoperable: mix and match any provider with any benchmark
- Bring your own benchmarks: plug in custom datasets and tasks
- Checkpointed runs: resume from any pipeline stage (ingest -> index -> search -> answer -> evaluate)
- Multi-provider comparison: run the same benchmark across providers side-by-side
- Judge-agnostic: swap GPT-4o, Claude, Gemini, etc. without code changes
- Structured reports: export run status, failures, and metrics for analysis

```
+--------------+    +--------------+    +--------------+
|  Benchmarks  |    |  Providers   |    |   Judges     |
|  (LoCoMo,    |    | (filesystem, |    |  (GPT-4o,    |
|  LongMem..)  |    |  rag, ...)   |    |  Claude..)   |
+------+-------+    +------+-------+    +------+-------+
       +-------------------+-------------------+
                           v
              +------------------------+
              |      MemoryBench       |
              +------------+-----------+
                           v
    +--------+---------+--------+----------+--------+
    | Ingest | Indexing | Search |  Answer  |Evaluate|
    +--------+---------+--------+----------+--------+
```

## Quick Start

```bash
# 1. Install benchmark deps AND build the local `pristine` package
#    (the memorybench package depends on `pristine` via a file: link).
npm install
npm run bench -- run -p filesystem -b locomo -j gpt-4o -r run-fs

# Equivalent explicit form (no prebench helper, e.g. when debugging):
cd ../..                     # repo root
npm install && npm run build # builds dist/ that the file: dep resolves to
cd benchmarks/memorybench
npx tsx src/index.ts run -p filesystem -b locomo -j gpt-4o -r run-fs
```

## Setup gotchas

The benchmark does NOT run under Bun even though `package.json` has a `bun test`
script. These constraints are load-bearing; violating them produces failures
that look like bugs but are tooling mismatches.

- **Do not invoke with `bun run` or `bun test` for anything that imports
  `pristine`.** Pristine uses `better-sqlite3`, a native addon that is not
  compatible with Bun's runtime (`oven-sh/bun#4290`). Use `npx tsx` to run
  benchmark commands; use `bun test` only for files that do not import
  Pristine (e.g. the memorybench orchestrator unit tests).
- **The Pristine SDK must be built before the benchmark starts.**
  `memorybench` depends on `pristine` via `file:../../`, which resolves to
  the repo-root `dist/` directory. `npm run build` at the repo root is a
  prerequisite — the `prebench` script (added in Story 8a Commit 2) runs
  this automatically for `npm run bench`.
- **Run from the memorybench directory** (or use the `bench` npm script
  which does the `cd` for you). The relative paths in
  `data/pristine-dbs/{dataSourceRunId}/` and `data/runs/{runId}/` are
  resolved against `process.cwd()`, not the script location. Running from
  the repo root will create these folders at the repo root — not what you
  want.

## Configuration

```bash
# Judges and reference providers (at least one)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
```

## Commands

| Command | Description |
|---------|-------------|
| `run` | Full pipeline: ingest -> index -> search -> answer -> evaluate -> report |
| `compare` | Run benchmark across multiple providers simultaneously |
| `ingest` | Ingest benchmark data into provider |
| `search` | Run search phase only |
| `test` | Test single question |
| `status` | Check run progress |
| `list-questions` | Browse benchmark questions |
| `show-failures` | Debug failed questions |
| `help` | Show help (`help providers`, `help models`, `help benchmarks`) |

## Options

```
-p, --provider         Memory provider (filesystem, rag)
-b, --benchmark        Benchmark (locomo, longmemeval, convomem)
-j, --judge            Judge model (gpt-4o, sonnet-4, gemini-2.5-flash, etc.)
-r, --run-id           Run identifier (auto-generated if omitted)
-m, --answering-model  Model for answer generation (default: gpt-4o)
-l, --limit            Limit number of questions
-q, --question-id      Specific question (for test command)
--force                Clear checkpoint and restart
```

## Examples

All commands below assume CWD is `benchmarks/memorybench` and `npm run build`
has been run at the repo root (the `bench` script handles this automatically).
Use `npx tsx` for any command that exercises the Pristine provider; `bun run`
is only safe for files that do not import Pristine.

```bash
# Full run with filesystem provider
npx tsx src/index.ts run -p filesystem -b locomo -j gpt-4o -r run-fs

# Full run with RAG provider
npx tsx src/index.ts run -p rag -b locomo -j gpt-4o -r run-rag

# Resume existing run
npx tsx src/index.ts run -r my-test

# Limited questions
npx tsx src/index.ts run -p filesystem -b locomo -l 10

# Compare providers
npx tsx src/index.ts compare -p filesystem,rag -b locomo -j gpt-4o -r compare1

# Test single question
npx tsx src/index.ts test -r my-test -q question_42

# Debug
npx tsx src/index.ts status -r my-test
npx tsx src/index.ts show-failures -r my-test
```

## Pipeline

```
1. INGEST    Load benchmark sessions -> Push to provider
2. INDEX     Wait for provider indexing
3. SEARCH    Query provider -> Retrieve context
4. ANSWER    Build prompt -> Generate answer via LLM
5. EVALUATE  Compare to ground truth -> Score via judge
6. REPORT    Aggregate scores -> Output accuracy + latency
```

Each phase checkpoints independently. Failed runs resume from last successful point.

## Checkpointing

Runs persist to `data/runs/{runId}/`:
- `checkpoint.json` - Run state and progress
- `results/` - Search results per question
- `report.json` - Final report

Re-running same ID resumes. Use `--force` to restart.

The Pristine provider stores its own per-run SQLite databases in a separate
namespace: `data/pristine-dbs/{dataSourceRunId}/`. The split exists so that
`--force` can cleanly purge Pristine state without racing the checkpoint
manager's cleanup of `data/runs/`. `dataSourceRunId` matches `runId` on
fresh runs; it only diverges when a checkpoint is copied (used to swap
judges or answering models without re-ingesting).

## Migration from earlier Sprint 008c builds

Pristine provider DBs used to land in the shared `data/runs/default/` folder
because of a regex bug in how containerTags were parsed (Sprint 008c Story 3,
PR #86). Runs with different extraction models silently reused each other's
memories. If you have legacy checkpoints or DB files from that era:

```bash
# Safe to delete — all pre-Story-3 Pristine state lived in this shared folder.
rm -rf data/runs/default/

# Any in-flight runs must be restarted with --force so the provider rebuilds
# the per-run folder under data/pristine-dbs/{dataSourceRunId}/.
npx tsx src/index.ts run -r baseline-v1 --force ...
```

On resume, the Pristine provider will warn if it detects a checkpoint whose
DB path does not exist (a sign of a pre-Story-3 checkpoint) and prompt for
`--force`.

## Recommended Ollama models

For a Pristine + Ollama baseline run you configure two roles:

1. **Pristine's memory + privacy engines** (via `~/.pristine/models.json`) —
   used to extract facts, consolidate memories, classify sensitive fields.
   This role needs a model that handles **strict JSON Schema structured
   output on nested objects** reliably.
2. **Memorybench's judge + answering model** (via the `-j` / `-m` flags) —
   used to answer LOCOMO questions and grade the answers. This role tolerates
   a wider range of models since the prompts are simpler.

Recommended split:

```jsonc
// ~/.pristine/models.json
{
  "privacy": { "engine": "ollama", "model": "llama3.2:latest" },
  "memory":  { "engine": "ollama", "model": "llama3.2:latest" }
}
```

```bash
npm run bench -- run -p pristine -b locomo \
  -j ollama:gemma4:e4b -m ollama:gemma4:e4b \
  -r baseline-v1 --force
```

### Why `llama3.2:latest` for Pristine's memory role

`gemma4:e4b` has weak structured-output compliance on Pristine's extraction
schema. When asked to emit `{facts: [...]}` with nested `validFrom` /
`validUntil` / `temporalConfidence` items, gemma4:e4b collapses to
`{"facts": []}` on inputs longer than ~3 messages — even when the content
obviously contains extractable facts. Loosening the Ollama `format`
parameter to plain `"json"` does let gemma4 produce content, but in a
malformed nested shape that Pristine's parser rejects.

`llama3.2:latest` handles the same extraction schema on the same LOCOMO
sessions without issue (10 facts on an 18-msg session in ~25s on M4 Max).

Reproduce / debug the behavior:

```bash
cd benchmarks/memorybench
npx tsx scripts/debug-extract.mjs
```

The script runs 7 probes of increasing complexity (synthetic control,
LOCOMO-style, real LOCOMO at 3/6/18 messages, plus raw Ollama calls with
the full schema and with `format: "json"`) against whatever is configured
in `~/.pristine/models.json`. Use it to evaluate any Ollama model before
committing to it for a full LOCOMO run.

Using `gemma4:e4b` as the memorybench judge and answering model (the `-j`
/ `-m` flags above) is fine — those roles use simpler prompts and do not
exercise the extraction schema.

## Extending

| Component | Guide |
|-----------|-------|
| Add Provider | [src/providers/README.md](src/providers/README.md) |
| Add Benchmark | [src/benchmarks/README.md](src/benchmarks/README.md) |
| Add Judge | [src/judges/README.md](src/judges/README.md) |
| Project Structure | [src/README.md](src/README.md) |

## License

MIT
