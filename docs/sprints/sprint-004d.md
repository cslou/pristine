# Pristine Local — Sprint 004d
**Date:** TBD
**Goal:** Local storage defaults and configuration — `initPristine()` bootstraps `~/.pristine/` with default database, model config, and key directories; permission hardening; full documentation
**Status:** :white_circle: Backlog

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, better-sqlite3, node:crypto, node-llama-cpp
- **Current state:** Sprint 004c complete. Three-layer encryption (RSA -> KEK -> DEK) working with O(1) key rotation. Privacy and memory pipelines functional.
- **Implementation spec:** `docs/specs/implementation-spec-001.md`
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context

**Problems:**

**A. No default database path.** The SQLite database stores wrapped KEKs (`user_keks` table) and wrapped DEKs + encrypted PII (`vault_entries` table). But `createDatabase()` requires the caller to pass a path — there is no default. RSA keys already default to `~/.pristine/keys/` via `FileSystemKeyManager`. The database should follow the same pattern: `~/.pristine/data/pristine.db`.

**B. Key directory permissions not validated.** `FileSystemKeyManager` sets `0o600` on private key files but does not set `0o700` on the `~/.pristine/keys/` directory, and does not validate permissions on load. SSH refuses to use keys with wrong permissions — we should too.

**C. No persistent model configuration.** Pristine has two LLM backends with different model resolution:

- **Ollama** — stateless client. Users run `ollama pull <model>`, Pristine sends HTTP requests with a model name. Ollama manages its own storage (`~/.ollama/models/`). No file path needed.
- **llama.cpp** — file-based. Pristine loads a GGUF file directly into process memory via `node-llama-cpp`. Requires an absolute path to a `.gguf` file on disk.

Current behavior: `createLlmClient()` auto-detects by pinging Ollama on `localhost:11434`. If reachable, uses Ollama. If not, falls back to llama.cpp and hopes a GGUF file exists in `~/.pristine/models/`. This is fragile and silent — the user never explicitly chooses.

**D. No unified initialization.** Directory creation is scattered across modules (`FileSystemKeyManager` creates `keys/`, `createDatabase` creates `data/`). There is no single entry point that bootstraps the full `~/.pristine/` tree.

**E. `LocalConfig` has fields that `models.json` replaces.** `LocalConfig` currently has `llmEngine`, `llmModel`, and `modelsDir` — all superseded by `models.json`. These should be removed.

**Target architecture — everything under `~/.pristine/`:**

```
~/.pristine/
  models.json                    — auto-created with Ollama defaults on first run
  keys/                          (0o700 directory)
    {userId}-private.pem         (0o600) — RSA-4096 private key
    {userId}-public.pem          (0o644) — RSA-4096 public key
  data/
    pristine.db                  — SQLite (WAL mode)
      user_keks table            — wrapped KEK per user (512-byte RSA-wrapped blob)
      vault_entries table        — wrapped DEK + encrypted PII per value
  models/
    *.gguf                       — llama.cpp model files (optional, for future CLI download)
```

Nothing leaves this directory. One `cp -r ~/.pristine/ backup/` captures everything needed to restore. Plaintext KEK and DEK never touch disk — they only exist in process memory.

**`models.json` is the source of truth for model configuration.** It is auto-created on first run with Ollama defaults. The user edits it to change engines or models. A future CLI command (`npx pristine-local setup`) will automate this.

```jsonc
// Default (auto-created) — both pipelines use Ollama
{
  "privacy": { "engine": "ollama", "model": "llama3.2:latest" },
  "memory": { "engine": "ollama", "model": "llama3.2:latest" }
}

// User edits for llama.cpp
{
  "privacy": { "engine": "llamacpp", "path": "/Users/lou/models/qwen2.5-7b.gguf" },
  "memory": { "engine": "llamacpp", "path": "/Users/lou/models/qwen2.5-7b.gguf" }
}

// Future: different models per pipeline
{
  "privacy": { "engine": "ollama", "model": "llama3.2:1b" },
  "memory": { "engine": "ollama", "model": "llama3.2:latest" }
}
```

Ollama engine fields: `engine`, `model`, `host` (optional, defaults to `OLLAMA_HOST` env var or `localhost:11434`).
Llamacpp engine fields: `engine`, `path` (absolute path to GGUF), `gpu` (optional, defaults to `auto`).

**How model configuration works:**

| Who | How they configure |
|-----|-------------------|
| End user (has Ollama) | `models.json` auto-created with Ollama defaults — just works |
| End user (has GGUF) | Edits `models.json`: set `engine: "llamacpp"`, `path: "/absolute/path.gguf"` |
| SDK developer | Constructs `OllamaClient` or `LlamaCppClient` directly in code, ignores `models.json` |
| Future CLI | `npx pristine-local setup` writes `models.json` for the user (see `docs/backlog.md`) |

**Key design decisions:**

1. **`initPristine()`** — single function that bootstraps the full `~/.pristine/` tree: creates directories, writes default `models.json` if missing, creates default database. Individual modules can still create their own subdirectories when used standalone (SDK users), but the standard path goes through `initPristine()`.

2. **`createLlmClients()`** — returns `{ privacyClient, memoryClient }`. Reads the `privacy` and `memory` sections from `models.json`. If both point to the same engine + model, returns the same instance. Callers don't need to know about `models.json` sections.

3. **`LocalConfig` trimmed** — removes `llmEngine`, `llmModel`, `modelsDir` (replaced by `models.json`). Keeps `dataDir`, `embedModel`, `prompts`. SDK users who need full control construct clients directly (`new OllamaClient(...)`) — no config bag needed.

4. **No auto-detect** — `detectEngine()` and `DEFAULT_MODELS_DIR` deleted. `models.json` is the source of truth. If Ollama isn't running, the error comes from `OllamaClient` itself ("connection refused") — clear and actionable.

### Prerequisites
- Sprint 004c merged (done)

### Parallelization
Story 1 (initPristine + config) -> Story 2 (factory rewrite) -> Story 3 (error messages). Story 4 (permissions) depends on Story 1 (both touch directory creation for `keys/` and `data/`). Story 5 (documentation) depends on all others.

### Stories
**Constraints:** Max 5 commits per story.

#### Story 1: `initPristine()` and model config schema
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
- **As a** developer, **I want** `initPristine()` to bootstrap the full `~/.pristine/` directory tree including a default `models.json`, **so that** the SDK works out of the box with zero user configuration.
- **Dependencies:** None
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `ModelConfig` type defined with `privacy` and `memory` fields, each supporting both engine variants (llamacpp with `path`/`gpu`, ollama with `model`/`host`)
  - [ ] `loadModelConfig(configDir?)` reads and parses `models.json` from `~/.pristine/` (or custom dir)
  - [ ] `initPristine(baseDir?)` creates the full directory tree: `~/.pristine/` (0o700), `keys/` (0o700), `data/` (0o700), `models/`, default `models.json`, default database at `data/pristine.db`
  - [ ] If `models.json` doesn't exist, `initPristine` creates it with Ollama defaults (`llama3.2:latest` for both pipelines)
  - [ ] If `models.json` already exists, `initPristine` leaves it untouched
  - [ ] `loadModelConfig` throws domain-specific error with clear message if file exists but is malformed
  - [ ] Schema validation: rejects unknown engines, missing required fields, non-existent file paths for llamacpp
  - [ ] `createDefaultDatabase(dataDir?)` exported from `src/core/database.ts` — creates database at `~/.pristine/data/pristine.db` (or custom dir), reuses existing `createDatabase` internally
  - [ ] Existing `createDatabase(path)` unchanged — `createDefaultDatabase` is additive
  - [ ] Tests: initPristine creates full tree, default models.json content, idempotent on second run, loadModelConfig with valid/invalid/missing configs, createDefaultDatabase with default and custom paths
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` pass
- **Testing approach:** Unit tests with temp directories. Verify directory creation, permissions, default config content, idempotency, validation errors for bad configs, database creation.
- **QA:** N/A
- **Planned commits:**
  1. `feat: add ModelConfig type and loadModelConfig loader`
  2. `feat: add createDefaultDatabase with ~/.pristine/data/ default`
  3. `feat: add initPristine to bootstrap ~/.pristine/ directory tree`
  4. `test: add init, config, and default database tests`
- **Technical notes:**
  - `initPristine` lives in a new `src/core/init.ts` module — single responsibility, called once at startup
  - Use `readFileSync`/`writeFileSync` — config is loaded once at startup, no need for async (except `createDefaultDatabase` which delegates to sync `createDatabase`)
  - Validate llamacpp `path` exists on disk at load time — fail early with a helpful message
  - Ollama `host` defaults to `OLLAMA_HOST` env var (Ollama's own convention), then `localhost:11434`
  - Default `models.json` content: `{ "privacy": { "engine": "ollama", "model": "llama3.2:latest" }, "memory": { "engine": "ollama", "model": "llama3.2:latest" } }`
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Rewrite engine factory with `createLlmClients()`
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
- **As a** developer, **I want** `createLlmClients()` to read `models.json` and return per-pipeline clients, **so that** model configuration is explicit and the caller doesn't deal with config internals.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `createLlmClients(configDir?)` returns `{ privacyClient: LlmClient, memoryClient: LlmClient }`
  - [ ] Reads `privacy` and `memory` sections from `models.json` via `loadModelConfig`
  - [ ] If both sections specify the same engine + model, returns the same `LlmClient` instance (no duplicate)
  - [ ] If sections differ, returns two separate instances
  - [ ] Delete `detectEngine()` function
  - [ ] Delete `DEFAULT_MODELS_DIR` constant
  - [ ] Delete old `createLlmClient()` function (replaced by `createLlmClients`)
  - [ ] Delete `tests/engine/auto-detect.test.ts` (tests the removed `detectEngine`/`createLlmClient`)
  - [ ] Update or remove all internal callers of old `createLlmClient` (grep for imports)
  - [ ] Remove `llmEngine`, `llmModel`, `modelsDir` from `LocalConfig` in `src/core/types.ts`
  - [ ] Re-export `LocalConfig` from `src/engine/types.ts` and `src/models/types.ts` still works after trimming
  - [ ] Direct `new OllamaClient()` / `new LlamaCppClient()` construction still works for SDK users
  - [ ] Tests: returns same instance when configs match, returns different instances when configs differ, reads from models.json, SDK direct construction unaffected
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` pass
- **Testing approach:** Unit tests with temp config files. Verify instance reuse, pipeline selection, LocalConfig trimming doesn't break existing code.
- **QA:** N/A
- **Planned commits:**
  1. `refactor: replace createLlmClient with createLlmClients reading models.json` — src/engine/index.ts
  2. `refactor: trim LocalConfig — remove llmEngine, llmModel, modelsDir` — src/core/types.ts
  3. `test: add createLlmClients integration tests`
- **Technical notes:**
  - `ModelConfig.privacy` / `ModelConfig.memory` maps to engine-specific config: `engine` -> client class, `path` -> `LlamaCppConfig.modelPath`, `model` -> `OllamaConfig.model`, `host` -> `OllamaConfig.host`
  - `OLLAMA_HOST` is Ollama's own convention (other tools respect it too) — keep as host fallback within `OllamaClient`, not a Pristine-specific concern
  - Direct client construction (`new OllamaClient(...)`) bypasses `models.json` entirely — this is the SDK escape hatch
  - Instance dedup: compare `engine`, `model`/`path`, and `host` fields explicitly to decide whether to share (not `JSON.stringify` — field order is unreliable)
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Improve error messages with config guidance
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
- **As a** user, **I want** error messages that guide me to fix configuration issues, **so that** I can resolve problems without reading source code.
- **Dependencies:** Story 2
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Error messages include example `models.json` snippet when config file is malformed
  - [ ] Error message when GGUF file not found includes the path that was tried and a suggestion to update `~/.pristine/models.json`
  - [ ] Error message when `models.json` has unknown engine includes list of valid engines (`ollama`, `llamacpp`)
  - [ ] Error message when Ollama is not reachable includes: "Start Ollama with `ollama serve`, or switch to llamacpp in `~/.pristine/models.json`"
  - [ ] Tests: verify error messages contain expected guidance strings
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` pass
- **Testing approach:** Unit tests asserting error message content contains guidance strings and example snippets.
- **QA:** N/A
- **Planned commits:**
  1. `fix: improve error messages with models.json config guidance`
- **Technical notes:**
  - Error messages should be actionable: include the exact file path, what's wrong, and how to fix it
  - Include a copy-pasteable `models.json` example in malformed-config errors
  - Ollama connection errors should mention both `ollama serve` and the config file alternative
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: Key directory permission hardening
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
- **As a** developer, **I want** sensitive directory and file permissions validated on load, **so that** misconfigured permissions are caught early (like SSH does).
- **Dependencies:** Story 1 (for `initPristine` which creates directories)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `mkdirSync` in `FileSystemKeyManager.writeToDisk` sets `0o700` on keys directory
  - [ ] On key load (`getOrCreateKeyPair`), validate `keys/` directory permissions: reject if group or others have access (`mode & 0o077 !== 0`)
  - [ ] On key load, validate private key file permissions: reject if group or others have any access (`mode & 0o077 !== 0`)
  - [ ] `createDefaultDatabase` validates `data/` directory permissions: reject if group or others have access (`mode & 0o077 !== 0`) — this directory contains wrapped KEK and encrypted PII
  - [ ] Permission checks skipped on Windows (`process.platform === 'win32'`)
  - [ ] Error messages include the current permissions and the exact `chmod` command to fix (e.g., `"Permissions 0755 for ~/.pristine/keys/ are too open. Run: chmod 700 ~/.pristine/keys/"`)
  - [ ] Tests: correct permissions accepted, wrong directory permissions rejected, wrong file permissions rejected, data directory permissions validated, Windows skip
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` pass
- **Testing approach:** Unit tests creating temp directories with specific permissions. Verify acceptance of correct perms, rejection of wrong perms with descriptive error messages. Mock `process.platform` for Windows test.
- **QA:** N/A
- **Planned commits:**
  1. `feat: add SSH-style permission validation to FileSystemKeyManager` — src/privacy/keys/filesystem.ts
  2. `test: add permission validation tests` — tests/privacy/keys/filesystem.test.ts
- **Technical notes:**
  - Follow OpenSSH's `sshkey_perm_ok` pattern: check `(stat.mode & 0o077) !== 0`
  - Check both the directory and the private key file — public key file can be world-readable (0o644)
  - Use `statSync` since this is on the key-load path (already synchronous I/O)
  - GPG also validates enclosing directory permissions — same approach
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 5: Full storage layout and configuration documentation
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
- **As a** user, **I want** comprehensive documentation of where Pristine stores everything and how to configure it, **so that** I understand the security model, can back up my data, and can configure models without reading source code.
- **Dependencies:** Stories 1-4
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] README has a "Storage Layout" section with the full `~/.pristine/` directory tree diagram
  - [ ] Each key type documented: RSA (PEM files), wrapped KEK (SQLite `user_keks`), wrapped DEK (SQLite `vault_entries`), plaintext KEK/DEK (process memory only, never on disk)
  - [ ] Three-layer encryption diagram with storage locations annotated
  - [ ] Backup section: single `cp -r ~/.pristine/` captures everything, what to back up, restore instructions
  - [ ] Model configuration section: `models.json` format for both engines, default config, how to switch engines, per-pipeline config
  - [ ] `initPristine()` documented: what it creates, when to call it, idempotency
  - [ ] Security notes: file permissions (0o600/0o700), what SSH-style validation catches, Windows behavior
  - [ ] `npm run lint` passes (markdown lint if applicable)
- **Testing approach:** Manual review — verify all file paths and directory structures mentioned in docs match the actual codebase.
- **QA:** N/A
- **Planned commits:**
  1. `docs: add storage layout, key locations, and backup guide to README`
  2. `docs: add model configuration and initPristine sections to README`
- **Technical notes:**
  - Consolidate the existing Encryption and Key Management sections with the new storage layout
  - Remove any outdated references (e.g., old auto-detect behavior, `DEFAULT_MODELS_DIR`, old `createLlmClient` usage)
  - Update usage examples to use `initPristine()` + `createLlmClients()`
  - Include common GGUF locations for users switching to llamacpp: `~/.lmstudio/models/`, `~/llama.cpp/models/`
- **Priority:** Must-have
- **Owner:** Coding Agent

### Open Questions
- **Embedding config:** The embedding model (Nomic) auto-downloads via `@huggingface/transformers`. Does it need config in `models.json`, or is it fine as-is?

### Rules
- Follow repo's `CLAUDE.md` for branching, rebase, and PR conventions
- Follow PR template (`.github/PULL_REQUEST_TEMPLATE.md`) when opening PRs
- Branch off `main` after the previous story is merged.
- Open a PR per story with: story reference, summary, files changed, testing done
- Run tests + linter locally before pushing
- **Do not merge PRs.** Open PRs, get Greptile review clean, then move to the next story. Lou merges all PRs at the end of the sprint.

### Definition of Done
- All must-have stories pass acceptance criteria
- Code compiles / app runs without errors
- Tests + linter pass (locally and CI)
- One or more commits per story (logical chunks), one PR per story
- Commit messages: conventional commits per repo CLAUDE.md
- All PRs open and Greptile-clean

---

## Completion
*(Filled by coding agent when sprint is done)*

### Summary

### Results
- Story 1: initPristine + config schema — PR #, status
- Story 2: Factory rewrite (createLlmClients) — PR #, status
- Story 3: Error message guidance — PR #, status
- Story 4: Key directory permission hardening — PR #, status
- Story 5: Full storage layout documentation — PR #, status

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
