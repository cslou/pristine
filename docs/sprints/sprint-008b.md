# Pristine Local — Sprint 008b
**Date:** TBD
**Goal:** Add local Ollama judge and answering model to memorybench, run a baseline LOCOMO benchmark for $0, and commit the baseline report
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3, sqlite-vec
- **Current state:** Sprint 008a complete. Memorybench framework ported to `benchmarks/memorybench/`, 202x ingestion bug fixed (272 sessions instead of 55,014), Pristine provider created (direct SDK import, no HTTP). The benchmark compiles and runs with the Pristine provider but currently requires API-based judge models (GPT-4o, ~$50/run). No baseline accuracy numbers exist for Pristine.
- **Implementation spec:** `docs/specs/implementation-spec-003.md` — Phase 9
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context
- This sprint makes memorybench runnable for $0 by adding Ollama as a judge and answering model backend, then runs a baseline LOCOMO benchmark to establish Pristine's accuracy numbers.
- **Judge architecture:** The benchmark's `Judge` interface requires (1) a `judge()` method for scoring answers, and (2) a `getModel(): LanguageModel` for retrieval evaluation via Vercel AI SDK. The Ollama judge calls `localhost:11434/api/chat` with `format: "json"` for structured output. For `getModel()`, we use the `ollama-ai-provider` npm package (Vercel AI SDK compatible) — if incompatible, retrieval evaluation is skipped with a warning.
- **Answering model:** The benchmark's answer phase currently supports OpenAI/Anthropic/Google via Vercel AI SDK. We add `ollama:modelname` format using `ollama-ai-provider` or direct HTTP fetch.
- **Model choice:** Gemma 4 E4B via Ollama (`gemma4:e4b`). Latest generation (April 2026), excellent reasoning quality, 4.5B effective params (9.6 GB download), 128K context. Runs comfortably on M4 Max 64 GB alongside normal workloads (~7 GB VRAM). Note: do NOT set `think=false` when using Ollama's `format` parameter — it silently disables JSON schema enforcement (Ollama issue #15260). Omit the `think` parameter entirely.
- **Cost comparison:** GPT-4o judge = ~$50/run. Ollama local = $0/run. The tradeoff is accuracy (GPT-4o is a better judge) vs cost ($0). The baseline should use local models so anyone can reproduce it.
- **Baseline run:** `--sample 10` takes 10 questions per category (5 categories x 10 = 50 questions). Expected total run time: <2 hours. Even low accuracy is a valid baseline — it establishes where we are.

### Parallelization
Stories are sequential: Story 1 (Ollama judge) -> Story 2 (Ollama answering model) -> Story 3 (validation run + baseline).

### Stories
**Constraints:** Max 5 stories per sprint. Max 5 commits per story. If a story needs 6+ commits during planning, split it.

#### Story 1: Add local Ollama judge backend
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** to use a local Ollama model as the benchmark judge, **so that** I can run the full benchmark for $0.
- **Dependencies:** Sprint 008a (memorybench ported + Pristine provider)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `benchmarks/memorybench/src/judges/ollama.ts` implements the judge interface
  - [ ] Judge calls local Ollama API (`localhost:11434/api/chat`) with the same judge prompts as existing judges
  - [ ] Judge parses JSON response from Ollama with retry (up to 3 attempts on malformed JSON)
  - [ ] Configurable model name (default: `gemma4:e4b`)
  - [ ] CLI accepts `--judge ollama` or `--judge ollama:gemma4:e4b`
  - [ ] `getModel()` returns an `ollama-ai-provider` LanguageModel instance, OR if incompatible, retrieval evaluation is skipped with a warning
  - [ ] Judge registered in `src/judges/index.ts`
- **Testing approach:** Unit test with mocked Ollama HTTP response. Manual test: run a single question with `--judge ollama --limit 1` and verify scoring.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement Ollama judge backend` — src/judges/ollama.ts with JSON retry logic
  2. `chore: register ollama judge and update CLI help` — update src/judges/index.ts, CLI docs
- **Technical notes:**
  - The `Judge` interface has two requirements: (1) `judge()` method for scoring, (2) `getModel(): LanguageModel` for retrieval evaluation via Vercel AI SDK
  - For `getModel()`: install `ollama-ai-provider` (npm package for Vercel AI SDK-compatible LanguageModel). If incompatible or unmaintained, skip retrieval evaluation for Ollama judge (log warning, return null metrics)
  - Ollama's `/api/chat` accepts `{ model, messages, format: "json" }` — use `format` with a JSON schema object for structured output
  - **Gemma 4 caveat:** Do NOT set `think: false` in the Ollama request — it silently breaks the `format` constraint (issue #15260). Omit the `think` parameter entirely. The model will think internally (adds ~2-5s latency) but produces valid schema-conforming JSON. Also strip whitespace from response content before JSON.parse (issue #15416).
  - Parse response JSON for `{ score: 0|1, label, explanation }` with 3 retries on parse failure
  - The judge prompt is the same regardless of backend — only the transport changes
  - **Type updates needed:** Add `"ollama"` to the `JudgeName` union type in `src/types/judge.ts`. The `JudgeConfig` type requires `apiKey: string` — make it optional or provide a dummy value for Ollama. Also update `getJudgeConfig()` in `config.ts` to handle the ollama case (currently only handles openai/anthropic/google).
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Support Ollama as answering model
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** to use a local Ollama model as the answering model, **so that** the full benchmark pipeline runs locally for $0.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Answering model supports `ollama:modelname` format (e.g., `ollama:gemma4:e4b`)
  - [ ] Answer phase uses Ollama when model string starts with `ollama:`
  - [ ] Answers are generated correctly — the answering prompt includes retrieved memories as context
  - [ ] CLI accepts `-m ollama:gemma4:e4b` for the answering model
- **Testing approach:** Manual test: run `--limit 1 -m ollama:gemma4:e4b` and verify answers are generated.
- **QA:** N/A
- **Planned commits:**
  1. `feat: support ollama as answering model` — update answer phase model resolution to handle `ollama:` prefix via `ollama-ai-provider` or direct HTTP
- **Technical notes:**
  - The answering model currently uses Vercel AI SDK (`@ai-sdk/openai`, `@ai-sdk/anthropic`, etc.). For `ollama:modelname` format, add an Ollama branch in `getAnsweringModel()` using `ollama-ai-provider`
  - **Model resolution:** `getModelConfig()` in `models.ts` has a default fallback that returns `provider: "openai"` for unknown model strings. The `ollama:` prefix must be intercepted BEFORE or WITHIN `getModelConfig()` — either add `"ollama"` as a provider type in `ModelConfig` and handle it in the switch, or strip the `ollama:` prefix and dispatch to a separate code path before calling `getModelConfig()`. Do NOT let it fall through to the OpenAI default.
  - The model resolution logic currently has 3 branches (openai, anthropic, google) — add a 4th for ollama
  - If `ollama-ai-provider` was already installed for Story 1, reuse it here
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Validation run — LOCOMO baseline with Pristine + local models
- **Story Checklist:**
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (max 5 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Reviewer: *(sub-agent session ID)*
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** developer, **I want** to run a sampled LOCOMO benchmark and verify the full pipeline works, **so that** I have a baseline accuracy number and can detect regressions.
- **Dependencies:** Stories 1, 2
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Run: `bun run src/index.ts run -p pristine -b locomo -j ollama -m ollama:gemma4:e4b --sample 10`
  - [ ] Ingestion completes for all 10 conversations (272 sessions, not 55K)
  - [ ] Total ingest time < 30 minutes
  - [ ] All sampled questions get scores (no crashes)
  - [ ] `report.json` generated with accuracy breakdown by question type
  - [ ] Baseline report committed to `benchmarks/memorybench/data/baselines/pristine-local-v1.json`
  - [ ] Total run time < 2 hours for the sampled run
  - [ ] Benchmark run instructions documented in `benchmarks/memorybench/README.md`
- **Testing approach:** This IS the test — run the benchmark end-to-end, verify it completes, commit the baseline.
- **QA:**
  - Manual: Inspect `report.json` — verify accuracy numbers are in a reasonable range (>0.2 for any question type, should not be 0 across the board). Inspect latency stats for obvious outliers.
- **Planned commits:**
  1. `docs: add benchmark run instructions to benchmarks/memorybench/README.md`
  2. `feat: commit baseline report for pristine-local-v1` — data/baselines/pristine-local-v1.json
- **Technical notes:**
  - `--sample 10` — verify the actual sampling semantics in the orchestrator source before running. It may mean 10 questions per category (50 total) or 10 total questions. Adjust the AC time bounds accordingly.
  - Time bounds (30 min ingest, 2 hour total) are approximate targets for a machine with GPU. On CPU-only, local models will be slower — treat these as guidelines, not hard pass/fail.
  - If accuracy is very low (<10% overall), that's still a valid baseline — it establishes where we are, not where we need to be
  - The baseline report is the reference point for all future regression checks
  - Document the exact command used to produce the baseline so it's reproducible
  - If the run crashes partway, the checkpoint system should allow resuming with the same run ID
- **Priority:** Must-have
- **Owner:** Coding Agent

### Rules
- Follow repo's `CLAUDE.md` for branching, rebase, and PR conventions
- Follow PR template (`.github/PULL_REQUEST_TEMPLATE.md`) when opening PRs
- Branch off `main` after the previous story is merged. Do NOT stack unmerged branches.
- Open a PR per story with: story reference, summary, files changed, testing done
- Run tests + linter locally before pushing
- If `main` has changed since branching: rebase onto latest `main`, re-test, force-push
- If blocked, document the blocker and move to next story
- Do not modify files outside the project directory
- Do not install new dependencies without noting them in completion report
- **Review loop** Open PRs, get Greptile review clean, merge, then move to the next story. Stop once the sprint is completed for Lou to have a final review.

### Definition of Done
- All must-have stories pass acceptance criteria
- Ollama judge produces valid scores for $0
- Full benchmark pipeline runs locally: Pristine provider + Ollama judge + Ollama answering model
- Baseline report committed with sampled LOCOMO results
- Benchmark run instructions documented and reproducible
- Tests + linter pass (locally and CI)
- One or more commits per story (logical chunks), one PR per story
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`) per repo CLAUDE.md
- All PRs open and Greptile-clean

---

## Completion
*(Filled by coding agent when sprint is done)*

### Summary

### Results
- :white_check_mark: Story 1: Ollama judge backend — PR #, status
- :white_check_mark: Story 2: Ollama answering model — PR #, status
- :white_check_mark: Story 3: Validation run + baseline — PR #, status

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
- :red_circle: **Critical** —
- :yellow_circle: **Good to have** —
- :white_circle: **Ignore** —

### Documentation Updates
- **Backlog:**
- **README / Repo Docs:**
- **Memory:**
- **Playbook Learnings:**
