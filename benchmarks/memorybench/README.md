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
bun install
bun run src/index.ts run -p filesystem -b locomo -j gpt-4o -r run-fs
```

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

```bash
# Full run with filesystem provider
bun run src/index.ts run -p filesystem -b locomo -j gpt-4o -r run-fs

# Full run with RAG provider
bun run src/index.ts run -p rag -b locomo -j gpt-4o -r run-rag

# Resume existing run
bun run src/index.ts run -r my-test

# Limited questions
bun run src/index.ts run -p filesystem -b locomo -l 10

# Compare providers
bun run src/index.ts compare -p filesystem,rag -b locomo -j gpt-4o -r compare1

# Test single question
bun run src/index.ts test -r my-test -q question_42

# Debug
bun run src/index.ts status -r my-test
bun run src/index.ts show-failures -r my-test
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

## Extending

| Component | Guide |
|-----------|-------|
| Add Provider | [src/providers/README.md](src/providers/README.md) |
| Add Benchmark | [src/benchmarks/README.md](src/benchmarks/README.md) |
| Add Judge | [src/judges/README.md](src/judges/README.md) |
| Project Structure | [src/README.md](src/README.md) |

## License

MIT
