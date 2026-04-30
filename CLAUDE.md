# Pristine Local

Local-first privacy and memory SDK. No API calls, no server, no data leaving the device.

## Key References

- **Implementation spec:** `docs/specs/implementation-spec-005.md`
- **Sprint docs:** `docs/sprints/`
- **Source repo for porting:** `~/projects/memory` (GitHub: `getlou-gh/memory`)

## Architecture

- Each module creates its own SQLite tables on init — no centralized migration phase
- Embedding via `@huggingface/transformers` + Nomic Embed v1.5 (768-dim vectors)
- Storage: single SQLite file per user via `better-sqlite3` + `sqlite-vec`

## Module Structure

- All module contracts live in `src/core/interfaces.ts`
- All shared types live in `src/core/types.ts`
- All error classes live in `src/core/errors.ts`
- Each module directory has a `types.ts` re-exporting relevant types from core
- Modules are grouped by workstream:
  - `src/privacy/` — sanitizer, classifier, vault, and pipeline (`secureAndRedact`, `reveal`, `scrubOutput`)
  - `src/memory/` — extractor, consolidator, store, temporal, retriever, query-analyzer, orchestrator, episodes, graph
  - Shared: `src/core/`, `src/embedder/`
- Implementations live in subdirectories (e.g., `privacy/vault/sqlite/`)

## Coding Conventions

- TypeScript strict mode, ESM only (`"type": "module"`)
- No `any` — use `unknown` + type guards
- No `console.log` in production code
- Pin exact dependency versions (no `^` or `~`)
- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`
- Rebase, don't merge — keep linear history
- Branch naming: `feat/<name>`, `fix/<name>`, `chore/<name>`

## Testing

- Vitest, test files in `tests/` mirroring `src/` structure
- Colocate tests next to the module they test (e.g., `tests/extractor/`)
- Integration tests in `tests/integration/`
- Tests requiring real model inference should be skippable (for CI without models)

## Prohibited Patterns

- No Anthropic SDK imports (`@anthropic-ai/sdk`)
- No OpenAI SDK imports (`openai`)
- No PostgreSQL imports (`pg`, `@supabase/*`)
- No generic `Error` throws — use domain-specific error classes from `src/core/errors.ts`
