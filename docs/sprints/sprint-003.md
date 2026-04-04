# Pristine Local — Sprint 003
**Date:** TBD
**Goal:** Build the complete privacy pipeline end-to-end: sanitizer, classifier (deterministic + LLM + combined), vault with SQLite storage, wired into secureAndRedact/reveal
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, node-llama-cpp, @huggingface/transformers, better-sqlite3, sqlite-vec
- **Current state:** Sprint 001 (foundation) + Sprint 002 (shared infrastructure) complete. All interfaces defined, LLM engines (llamacpp + ollama) working, local embedder producing 768-dim vectors, SQLite connection factory operational.
- **Implementation spec:** `docs/specs/implementation-spec-001.md` — Phase 2: Privacy Pipeline
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context
- This sprint builds the first complete end-to-end pipeline. At the end, `secureAndRedact()` takes raw text and returns redacted text with encrypted PII stored in SQLite.
- The sanitizer is pure logic ported directly from the source repo — no adaptation needed except import paths.
- The LLM classifier adapts from Anthropic SDK `messages.create()` to `LlmClient.generate<T>()`. The tool schema changes from Anthropic tool format to plain JSON Schema.
- The deterministic classifier is **new code** (not in source repo) — replaces Presidio with regex-based patterns. No Docker dependency.
- The vault crypto utilities are ported from source — same zk-v2 encryption scheme (AES-256-GCM + RSA-OAEP-256). Only the storage backend changes from PostgreSQL to SQLite.
- Source files for reference: `~/projects/memory/src/sanitizer/`, `~/projects/memory/src/classifier/`, `~/projects/memory/src/vault/`

### Parallelization
Story 1 (sanitizer) must come first — classifier and vault tests import `assertNoLlmReentry` from sanitizer. Stories 2 (classifier) and 3 (vault) are independent of each other and can run in parallel. Story 4 (integration) depends on all prior stories.

### Stories
**Constraints:** Max 5 stories per sprint. Max 5 commits per story. If a story needs 6+ commits during planning, split it.

#### Story 1: Port sanitizer module
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
- **As a** developer, **I want** the sanitizer module working with resolve(), sanitizeText(), and LLM reentry guards, **so that** classifiers and downstream modules can safely handle sensitive placeholders.
- **Dependencies:** Sprint 001 (types defined)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/sanitizer/index.ts` exports: `PLACEHOLDER_REGEX`, `resolve()`, `sanitizeText()`, `assertNoLlmReentry()`, `collectPlaceholders()`, `clearResolvedStringRegistry()`
  - [ ] `src/sanitizer/types.ts` exports: `SensitiveField`, `SanitizedMemory`, `SensitivePlaceholderMatch`, `ResolveInput`, `ApprovalRequestPayload`, `ApprovalDecision`, `ApprovalDecisionPayload`
  - [ ] Error classes exported: `ResolveApprovalTimeoutError`, `ResolveApprovalError`
  - [ ] All 22 sanitizer unit tests pass (ported from source `tests/pipeline/sanitizer.test.ts`, dropping the 2 API endpoint tests from the `P3-4 search endpoint sanitization` describe block)
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Port sanitizer tests directly from source. Drop the 2 tests in the `P3-4 search endpoint sanitization` describe block (import from `../../src/api/index.js` — server-specific). Remaining 22 tests are pure logic, no adaptation needed beyond import paths.
- **QA:** N/A
- **Planned commits:**
  1. `feat: port sanitizer types` — src/sanitizer/types.ts
  2. `feat: port sanitizer implementation` — src/sanitizer/index.ts with all exports
  3. `test: port sanitizer tests` — tests/sanitizer/sanitizer.test.ts (18 tests)
- **Technical notes:**
  - Source: `~/projects/memory/src/sanitizer/index.ts` (391 lines), `types.ts` (40 lines)
  - Source tests: `~/projects/memory/tests/pipeline/sanitizer.test.ts` (336 lines)
  - Port is nearly direct copy — only import paths change (e.g., `'../../src/sanitizer/index.js'` -> `'../../src/sanitizer/index.js'` or similar)
  - The `NO_REENTRY_METADATA` symbol and `resolvedStringRegistry` are module-private — they work as-is
  - Drop `createTestJwtKit` / JWT-related imports from test file — those are from dropped API tests
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Build classifier module (deterministic + LLM + combined)
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
- **As a** developer, **I want** PII classification via both rule-based patterns and local LLM, **so that** the privacy pipeline catches both structural PII (credit cards, emails) and contextual PII (health conditions, salary mentions).
- **Dependencies:** Story 1 (sanitizer — assertNoLlmReentry), Sprint 002 (LlmClient)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `src/classifier/llm/prompts.ts` contains `buildClassificationPrompt()`
  - [ ] `src/classifier/llm/schema.ts` contains classify_sensitivity JSON Schema (plain object, not Anthropic tool format)
  - [ ] `src/classifier/llm/index.ts` exports `LlmClassifier` + `createLlmClassifier()` using `LlmClient.generate<T>()` — ported parsing/validation from source, adapted from `messages.create`
  - [ ] `src/classifier/deterministic/index.ts` exports `DeterministicClassifier` — regex patterns for: credit cards, emails, phone numbers, SSN, common ID formats. Returns `DetectedEntity[]` with `source: 'deterministic'`
  - [ ] `src/classifier/combined/index.ts` exports `CombinedClassifier` — runs deterministic + LLM in parallel, merges with `mergeReports()` and `extractCleanSpans()` ported from source `src/classifier/index.ts`
  - [ ] `LlmClassificationError` thrown on LLM failure (fail-closed behavior — classification blocked, ingestion cannot proceed)
  - [ ] Confidence threshold filtering (default 0.7)
  - [ ] Entity span calculation: find text span in source, fail-closed to full text if not found
  - [ ] All classifier tests pass (~462 lines ported + adapted from `tests/pipeline/classifier.test.ts` and `tests/pipeline/llm-classifier.test.ts`)
  - [ ] New tests for deterministic classifier: detects credit card, email, phone, SSN patterns
  - [ ] Multilingual PII detection tests: LLM classifier detects PII in Mandarin, Hindi, Japanese, Spanish text (the primary quality advantage over Presidio)
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Port classifier tests from source, adapting mocked `messages.create` to mocked `generate<T>()`. The LLM classifier tests mock the LlmClient. Add new tests for deterministic classifier regex patterns. Combined classifier tests verify parallel execution and merge logic. Multilingual tests use mocked LlmClient with realistic non-English PII findings.
- **QA:** N/A
- **Planned commits:**
  1. `feat: port classification prompt and schema` — src/classifier/llm/prompts.ts, src/classifier/llm/schema.ts
  2. `feat: implement LLM classifier with generate<T>()` — src/classifier/llm/index.ts, LlmClassificationError, confidence filtering, span calculation
  3. `feat: implement deterministic classifier` — src/classifier/deterministic/index.ts with regex patterns
  4. `feat: implement combined classifier with merge logic` — src/classifier/combined/index.ts, extractCleanSpans(), mergeReports()
  5. `test: port and add classifier tests` — tests/classifier/ with LLM, deterministic, combined, and reentry guard tests
- **Technical notes:**
  - Key adaptation: source LLM classifier calls `this.client.messages.create({ tools, tool_choice, ... })` and finds `tool_use` in response content. New version calls `this.client.generate<T>({ schema, ... })` and gets `T` directly — no tool_use parsing needed. The `parseFindings()` logic simplifies significantly.
  - Source: `~/projects/memory/src/classifier/llm/index.ts` (224 lines), `~/projects/memory/src/classifier/index.ts` (117 lines)
  - Source tests: `~/projects/memory/tests/pipeline/llm-classifier.test.ts` (462 lines — main classifier tests), `classifier.test.ts` (22 lines — reentry guard test)
  - Deterministic classifier is new — no source equivalent. Replaces Presidio. Start with common patterns: Luhn-valid credit cards, RFC 5322 emails, E.164 phone numbers, US SSN format.
  - `SensitivitySource` type in `src/core/types.ts` (defined in Sprint 001) needs to be updated to include `'deterministic'` in addition to `'llm'`. Modify the core type directly — this is the single source of truth.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Build vault module with SQLite storage
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
- **As a** developer, **I want** encrypted PII stored locally in SQLite, **so that** sensitive values can be securely vaulted and revealed without any external service.
- **Dependencies:** Sprint 001 (SQLite connection factory, VaultStore interface)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Vault crypto utilities ported: `src/vault/asymmetric-crypto.ts` (RSA key ops), `src/vault/asymmetric-encrypt.ts` (AES-256-GCM envelope), `src/vault/base64url.ts` (encoding)
  - [ ] `src/vault/redaction.ts` ported — redaction/reveal placeholder-to-vault flow
  - [ ] `vault_entries` and `user_public_keys` SQLite tables created on module init (uses connection factory from Sprint 001)
  - [ ] `src/vault/sqlite/index.ts` exports `SqliteVaultStore` implementing `VaultStore` interface
  - [ ] `SqlitePublicKeyStore` for user public key management
  - [ ] `addEntries()` stores encrypted envelopes in SQLite
  - [ ] `getEntriesByPlaceholderIds()` retrieves entries by placeholder ID
  - [ ] `deleteEntriesByMemoryId()` removes entries
  - [ ] Vault crypto tests pass: `asymmetric-crypto.test.ts` (194 lines), `asymmetric-encrypt.test.ts` (182 lines), `vault-redaction.test.ts` (275 lines)
  - [ ] SQLite CRUD tests: add entries, retrieve by placeholder ID, delete by memory ID
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Port vault crypto tests directly from source (pure Node.js crypto, no adaptation needed). Write new SQLite-specific tests for VaultStore CRUD operations using in-memory database.
- **QA:** N/A
- **Planned commits:**
  1. `feat: port vault crypto utilities` — src/vault/asymmetric-crypto.ts, asymmetric-encrypt.ts, base64url.ts
  2. `feat: port vault redaction logic` — src/vault/redaction.ts
  3. `feat: implement SqliteVaultStore with table creation` — src/vault/sqlite/index.ts, table DDL, CRUD operations
  4. `test: port vault crypto tests and add SQLite store tests` — tests/vault/
- **Technical notes:**
  - Source: `~/projects/memory/src/vault/` (769 lines across 6 files)
  - Source tests: `~/projects/memory/tests/vault/` (651 lines across 3 files)
  - Crypto utilities are pure Node.js `crypto` module — port directly, no changes needed
  - SQLite adaptation: source `index.ts` uses `pool.query()` (pg). Replace with `db.prepare().run()` / `.get()` / `.all()` (better-sqlite3)
  - Table creation should happen in a `initTables(db: Database)` function called on first use
  - `encrypted_value`, `iv`, `auth_tag` stored as BLOB in SQLite (Buffer type maps directly)
  - Source vault's `getEntriesByPlaceholderIds` JOINs against a `memories` table that won't exist until Sprint 004. Simplify the query to not JOIN on `memories` — look up vault entries by placeholder ID directly from `vault_entries` table only. The JOIN can be added when the memories table exists.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: Wire privacy pipeline end-to-end
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
- **As a** developer, **I want** `secureAndRedact()` and `reveal()` working end-to-end, **so that** I can classify, redact, store, and recover PII locally.
- **Dependencies:** Stories 1-3
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `secureAndRedact(messages, config)` function: takes raw messages, runs combined classifier, redacts detected PII with `[SENSITIVE:type:id]` placeholders, encrypts original values in vault, returns redacted messages + placeholder IDs
  - [ ] `reveal(redactedText, placeholderIds, privateKey)` function: retrieves encrypted values from vault, decrypts with private key, replaces placeholders with original values
  - [ ] `scrubOutput(text)` function: removes any remaining `[SENSITIVE:...]` placeholders from text (safety net)
  - [ ] End-to-end test: input text with PII (name, email, phone) -> secureAndRedact -> verify redacted text has placeholders -> reveal -> verify original PII recovered
  - [ ] End-to-end test: input text with no PII -> secureAndRedact -> verify text unchanged, empty vault entries
  - [ ] All privacy pipeline tests pass
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- **Testing approach:** End-to-end integration tests using in-memory SQLite and mocked LlmClient. Verify the full flow: classify -> redact -> vault store -> reveal -> verify original values.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement secureAndRedact, reveal, and scrubOutput` — src/privacy/index.ts (or wherever the public API lives) wiring sanitizer + classifier + vault
  2. `test: add end-to-end privacy pipeline tests` — tests/integration/privacy.test.ts
- **Technical notes:**
  - `secureAndRedact` flow: (1) run combined classifier on text, (2) for each detected entity, generate placeholder ID, replace text span with `[SENSITIVE:type:id]`, (3) encrypt original value with user's public key, (4) store in vault, (5) return redacted text + placeholder map
  - `reveal` flow: (1) collect placeholders from text, (2) fetch encrypted values from vault by placeholder IDs, (3) decrypt with private key, (4) replace placeholders with decrypted values, (5) mark result as no-LLM-reentry
  - For end-to-end tests, generate a test RSA key pair in the test setup
  - The mocked LlmClient for e2e tests should return realistic classifier findings (known PII in test strings)
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
- Do not modify files outside the project directory
- Do not install new dependencies without noting them in completion report
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
- Story 1: Port sanitizer — PR #, status
- Story 2: Build classifier — PR #, status
- Story 3: Build vault — PR #, status
- Story 4: Wire privacy pipeline — PR #, status

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
