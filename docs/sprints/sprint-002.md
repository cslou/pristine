# Pristine Local — Sprint 002
**Date:** TBD
**Goal:** Stand up the shared LLM inference engines (llamacpp + ollama) and local embedding, so all downstream modules can call generate<T>() and embed()
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3
- **Current state:** Sprint 001 complete — project scaffolded, all types/interfaces/errors defined, directory structure created, SQLite connection factory working.
- **Implementation spec:** `docs/specs/implementation-spec-001.md` — Phase 1: Shared Infrastructure
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context
- This sprint builds the two foundational inference layers that all later modules depend on: LLM (for extraction, consolidation, classification) and embedding (for vector search).
- `node-llama-cpp` v3 is used for in-process GGUF inference with grammar-constrained generation. Metal acceleration is automatic on Apple Silicon.
- `@huggingface/transformers` wraps ONNX Runtime for embedding inference. It handles tokenization and model download automatically.
- Both LLM engines implement the same `LlmClient.generate<T>()` interface from `src/core/interfaces.ts`. The rest of the pipeline doesn't know which engine is behind it.
- Models are stored in `~/.pristine/models/`. Download is resumable (HTTP Range headers).
- Tests requiring actual model inference should be marked with a `@slow` tag or similar — they download multi-GB models and take seconds per call. Fast unit tests should mock the engine.

### Parallelization
Story 1 (llamacpp) and Story 2 (ollama) are independent — both implement the same interface, can be built in parallel. Story 3 (model management) depends on Stories 1 and 2 (engine factory instantiates both clients for auto-detect). Story 4 (embedder) is independent of Stories 1-3. Story 5 (integration tests) depends on all prior stories.

### Stories
**Constraints:** Max 5 stories per sprint. Max 5 commits per story. If a story needs 6+ commits during planning, split it.

#### Story 1: LlamaCpp engine — in-process LLM inference
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** an in-process LLM engine that enforces JSON Schema output via grammar constraints, **so that** extraction, consolidation, and classification always return valid structured data.
- **Dependencies:** Sprint 001 (interfaces defined)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `node-llama-cpp` added as dependency (pinned version)
  - [ ] `src/engine/llamacpp/index.ts` exports `LlamaCppClient` implementing `LlmClient` interface
  - [ ] `generate<T>()` uses `createGrammarForJsonSchema(schema)` to constrain output to valid JSON matching the schema
  - [ ] Model loading is singleton — load GGUF once, reuse across calls
  - [ ] Metal acceleration auto-detected on Apple Silicon
  - [ ] Unit tests with a small test schema verify: valid JSON returned, schema constraints enforced, error handling for missing model file
  - [ ] `npm run typecheck` passes
- **Testing approach:** Unit tests mock the model loading but verify schema grammar creation and response parsing. Integration test (marked slow) loads a real small model and verifies structured output.
- **QA:** N/A
- **Planned commits:**
  1. `feat: add node-llama-cpp dependency and engine types` — package.json update, src/engine/types.ts with engine-specific config types
  2. `feat: implement LlamaCppClient with grammar-constrained generation` — src/engine/llamacpp/index.ts, model loading singleton, generate<T>() implementation
  3. `test: add llamacpp engine unit tests` — tests/engine/llamacpp.test.ts
- **Technical notes:**
  - node-llama-cpp v3 API: `getLlama()` -> `loadModel(path)` -> `createContext()` -> `createChatSession()`. Use `createGrammarForJsonSchema()` for schema enforcement.
  - Model singleton: store loaded model at module level, reuse across `generate()` calls. Dispose on process exit.
  - Error handling: throw `DownloadError` if model file not found, generic error for inference failures.
  - Default model: Qwen2.5 7B Instruct Q4_K_M (~4.5 GB). Path resolved from `LocalConfig.modelsDir` + model filename.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Ollama engine — HTTP-based LLM inference
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreeed + reason)*
- **As a** developer, **I want** an Ollama-backed LLM engine, **so that** users with Ollama already installed can use Pristine with zero model download.
- **Dependencies:** Sprint 001 (interfaces defined)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/engine/ollama/index.ts` exports `OllamaClient` implementing `LlmClient` interface
  - [ ] `generate<T>()` maps to Ollama's `/api/chat` endpoint with `format: schema` for structured output
  - [ ] HTTP client targets `localhost:11434` by default, configurable via `OLLAMA_HOST` env var
  - [ ] Parses Ollama's response format back into type `T`
  - [ ] Unit tests verify: correct HTTP request shape, response parsing, error handling for unreachable Ollama
  - [ ] `npm run typecheck` passes
- **Testing approach:** Unit tests mock the HTTP calls (no real Ollama needed). Integration test (marked slow) calls a real Ollama instance if available.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement OllamaClient with structured output` — src/engine/ollama/index.ts, HTTP client, response parsing
  2. `test: add ollama engine unit tests` — tests/engine/ollama.test.ts with mocked HTTP
- **Technical notes:**
  - Ollama chat API: `POST /api/chat` with `{ model, messages, format: schema, stream: false }`
  - Use native `fetch` (Node 18+) — no axios dependency needed
  - Response shape: `{ message: { role, content } }` where `content` is the JSON string matching the schema
  - Parse `content` as JSON and cast to `T`
  - Retry policy: 3 attempts with exponential backoff (500ms base) for 429/500 errors
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Model management — registry, download, and engine auto-detect
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** automatic model downloading and engine selection, **so that** `PristineLocal.create()` just works without manual setup.
- **Dependencies:** Stories 1 and 2 (engine factory needs both LlamaCppClient and OllamaClient for auto-detect)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/models/registry.ts` maps model names to download URLs + SHA-256 checksums
  - [ ] `src/models/download.ts` implements resumable HTTP download with progress callback, checksum verification, and `DownloadError` on failure
  - [ ] Default models registered: Qwen2.5 7B Instruct Q4_K_M (LLM), Nomic Embed v1.5 (embedding — managed by @huggingface/transformers)
  - [ ] Engine auto-detect: check if Ollama is reachable at configured host, use Ollama if available, fall back to llamacpp otherwise
  - [ ] `LocalConfig` is read and applied: `llmEngine`, `llmModel`, `embedModel`, `dataDir`, `modelsDir`
  - [ ] Tests: registry lookup, download with mocked HTTP (resume, checksum pass/fail), auto-detect logic
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Unit tests mock HTTP for download (test resume via Range headers, checksum verification). Mock Ollama health check for auto-detect tests.
- **QA:** N/A
- **Planned commits:**
  1. `feat: add model registry with default model entries` — src/models/registry.ts
  2. `feat: add resumable model download manager` — src/models/download.ts with progress, resume, checksum
  3. `feat: add engine auto-detect and config resolution` — src/engine/index.ts with factory function that reads LocalConfig and returns the right LlmClient
  4. `test: add model management and auto-detect tests` — tests/models/, tests/engine/auto-detect.test.ts
- **Technical notes:**
  - Download manager uses `fetch` with `Range` header for resume. Store partial downloads with `.partial` suffix, rename on completion.
  - Checksum: SHA-256 hash of downloaded file, compare against registry. Delete and re-download on mismatch.
  - Auto-detect: `GET http://localhost:11434/api/tags` with 2s timeout. If reachable and model exists in Ollama, use it. Otherwise llamacpp.
  - `~/.pristine/models/` is created on first use if it doesn't exist.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: Local embedder with Nomic Embed v1.5
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** a local embedding engine producing 768-dim vectors, **so that** memory search and entity resolution can work without external API calls.
- **Dependencies:** Sprint 001 (Embedder interface defined)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `@huggingface/transformers` added as dependency (pinned version)
  - [ ] `src/embedder/local/index.ts` exports `LocalEmbedder` implementing `Embedder` interface
  - [ ] `embed(text)` returns a 768-dimensional `number[]`
  - [ ] `embedBatch(texts)` handles batching efficiently, returns `number[][]` in correct order
  - [ ] Model downloaded automatically on first use via @huggingface/transformers (Nomic Embed v1.5)
  - [ ] Unit tests verify: correct output dimension (768), batch ordering preserved, empty input handling
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Unit tests mock the transformers pipeline to verify dimension and ordering. Integration test (marked slow) loads the real model and verifies cosine similarity ranking on a small curated set.
- **QA:** N/A
- **Planned commits:**
  1. `feat: add huggingface transformers dependency` — package.json update
  2. `feat: implement LocalEmbedder with Nomic Embed v1.5` — src/embedder/local/index.ts with embed() and embedBatch()
  3. `test: add local embedder unit tests` — tests/embedder/local.test.ts
- **Technical notes:**
  - `@huggingface/transformers` API: `pipeline('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5')` then `pipe(text, { pooling: 'mean', normalize: true })`
  - Model is ~300 MB, downloaded to `~/.cache/huggingface/` on first use (managed by the library, not our download manager)
  - Nomic Embed outputs 768-dim by default. Verify this in tests.
  - For batch: process sequentially through the pipeline (transformers.js doesn't natively batch for feature-extraction). Consider chunking for very large batches.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 5: Integration tests and embedder throughput benchmark
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** verified end-to-end inference with real models, **so that** I know the engines actually produce valid structured output before building modules on top.
- **Dependencies:** Stories 1-4
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Integration test: LlamaCppClient.generate<T>() with extract_facts schema produces valid JSON with `facts` array (requires real model, marked slow)
  - [ ] Integration test: OllamaClient.generate<T>() with same schema produces valid JSON (requires Ollama running, marked slow + skippable)
  - [ ] Integration test: LocalEmbedder.embed() produces 768-dim vector with real model (marked slow)
  - [ ] Benchmark: embedder throughput measured on M-series Mac (target: >500 embeddings/sec for short texts), results documented
  - [ ] All fast tests still pass (`npm test` excluding slow tests)
  - [ ] `npm run typecheck` and `npm run lint` pass
- **Testing approach:** Integration tests use real models. Mark with `describe.skipIf(!hasModel)` pattern so CI can skip when models aren't available. Benchmark runs as a separate script.
- **QA:** N/A
- **Planned commits:**
  1. `test: add engine integration tests with real models` — tests/integration/engine.test.ts
  2. `test: add embedder integration test and throughput benchmark` — tests/integration/embedder.test.ts, benchmarks/embedder-throughput.ts
- **Technical notes:**
  - Integration tests should detect model availability: check `~/.pristine/models/` for GGUF, check Ollama health endpoint
  - Skip gracefully when models aren't present (CI environments)
  - Benchmark: embed 1000 short texts (5-20 words each), measure total time, report embeddings/sec
  - Extract_facts schema from spec Section 10 source file reference (see `src/extractor/index.ts` lines 22-63 in source repo)
- **Priority:** Must-have
- **Owner:** Coding Agent

### Rules
- Follow repo's `CLAUDE.md` for branching, rebase, and PR conventions
- Follow PR template (`.github/PULL_REQUEST_TEMPLATE.md`) when opening PRs
- Branch off `main` after the previous story is merged. For parallelizable stories, branch off `main` simultaneously. Do NOT stack unmerged branches.
- Open a PR per story with: story reference, summary, files changed, testing done
- Run tests + linter locally before pushing
- If `main` has changed since branching: rebase onto latest `main`, re-test, force-push
- If blocked, document the blocker and move to next story
- **Do not merge PRs.** Open PRs, get Greptile review clean, then move to the next story. Lou merges all PRs at the end of the sprint.

### Definition of Done
- All must-have stories pass acceptance criteria
- Code compiles / app runs without errors
- Tests + linter pass (locally and CI)
- One or more commits per story (logical chunks), one PR per story
- Commit messages: conventional commits (`feat:`, `chore:`, `test:`, `docs:`) per repo CLAUDE.md
- All PRs open and Greptile-clean

---

## Completion
*(Filled by coding agent when sprint is done)*

### Summary

### Results
- Story 1: LlamaCpp engine — PR #, status
- Story 2: Ollama engine — PR #, status
- Story 3: Model management — PR #, status
- Story 4: Local embedder — PR #, status
- Story 5: Integration tests + benchmark — PR #, status

### New Dependencies

### Blockers / Issues

### Carry-Over

### Notes for Next Sprint

---

## Retro
*(Filled by main agent during sprint review)*

- **What went well:**
- **What didn't:**

### Refactoring Opportunities

### Documentation Updates
