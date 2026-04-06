# Pristine Local — Sprint 004b
**Date:** TBD
**Goal:** Fix critical key persistence bug — add KeyManager interface with filesystem implementation so RSA key pairs survive across process restarts
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, better-sqlite3, node:crypto
- **Current state:** Sprint 004 near-complete (275 tests passing). Privacy pipeline works but RSA key pairs are generated in-memory and lost when the process exits — encrypted PII becomes permanently unrecoverable across sessions.
- **Implementation spec:** `docs/specs/implementation-spec-001.md`
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context
- This sprint fixes a critical bug in the privacy pipeline: key persistence.
- The existing two-layer encryption (AES-256-GCM + RSA-OAEP key wrapping) is the correct architecture — it enables efficient key rotation (re-wrap DEKs without re-encrypting values). We keep it.
- The `KeyManager` interface is deliberately minimal (one method) so the storage backend can be swapped from filesystem to OS Keychain later without changing any consumer code.
- `SqlitePublicKeyStore` becomes redundant — the KeyManager manages both public and private keys.

### Parallelization
Stories are sequential: Story 1 (interface + implementation) → Story 2 (refactor pipeline) → Story 3 (docs).

### Stories
**Constraints:** Max 5 commits per story.

#### Story 1: KeyManager interface + FileSystemKeyManager
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
- **As a** developer, **I want** RSA key pairs persisted to disk and managed via a swappable interface, **so that** encrypted PII survives across process restarts and key management can be upgraded to OS Keychain later.
- **Dependencies:** None
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `KeyManager` interface added to `src/core/interfaces.ts` with `getOrCreateKeyPair(userId): Promise<KeyPairWithStatus>` and `saveKeyPair(userId, keyPair): Promise<void>` (needed for key rotation in 004c)
  - [ ] `KeyPairWithStatus` type added to `src/core/types.ts` — extends existing `KeyPairResult` from `asymmetric-crypto.ts` with `created: boolean` field
  - [ ] `src/privacy/keys/filesystem.ts` exports `FileSystemKeyManager` implementing `KeyManager`
  - [ ] Auto-generates RSA-4096 key pair on first call per userId, persists to `{keysDir}/{userId}-private.pem` + `{userId}-public.pem`
  - [ ] Sets file permissions to `0o600` on private key (Unix; graceful no-op on Windows)
  - [ ] Reads existing keys from disk on subsequent calls (cached in memory)
  - [ ] Validates PEM format on read — rejects corrupt/truncated files with clear error
  - [ ] Atomic file writes (write to temp file, then rename) to prevent corruption on crash
  - [ ] Configurable `keysDir` via constructor (default: `~/.pristine/keys`)
  - [ ] `created` flag is `true` on first generation, `false` on reload
  - [ ] `saveKeyPair(userId, keyPair)` saves/overwrites key pair to disk (for key rotation)
  - [ ] Tests pass: generate + persist, reload from disk, multi-user isolation, created flag, custom keysDir, corrupt file handling, saveKeyPair overwrite
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** Use temp directories (via `os.tmpdir()`) for test key storage — no real `~/.pristine` access in tests. Test file creation, reload, multi-user, permissions.
- **QA:** N/A
- **Planned commits:**
  1. `feat: add KeyManager interface and KeyPairWithStatus type` — src/core/interfaces.ts, src/core/types.ts
  2. `feat: implement FileSystemKeyManager` — src/privacy/keys/filesystem.ts
  3. `test: add FileSystemKeyManager tests` — tests/privacy/keys/filesystem.test.ts
- **Technical notes:**
  - `KeyManager` interface has two methods: `getOrCreateKeyPair(userId)` and `saveKeyPair(userId, keyPair)`. Crypto operations (wrapDek, unwrapDek, computeFingerprint) stay in `asymmetric-crypto.ts` — they're stateless utilities, not key management.
  - `KeyPairWithStatus` extends existing `KeyPairResult` from `asymmetric-crypto.ts` — avoids duplicating `publicKey`/`privateKey` fields
  - Memory cache: `Map<string, KeyPairResult>` keyed by userId. First call reads from disk (or generates), subsequent calls return from cache. `saveKeyPair` invalidates cache for that userId.
  - File layout: `{keysDir}/{userId}-private.pem`, `{keysDir}/{userId}-public.pem`
  - `mkdirSync(keysDir, { recursive: true })` on first write
  - Atomic writes: write to `{file}.tmp`, then `renameSync` to final path — prevents corrupt files on crash
  - PEM validation on read: attempt `createPublicKey(pem)` — if it throws, the file is corrupt
  - Windows: `chmod` is a no-op, document as known limitation
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Refactor privacy pipeline to use KeyManager
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
- **As a** developer, **I want** the privacy pipeline to use KeyManager instead of raw PEM strings, **so that** callers don't handle keys directly and key persistence is automatic.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `SecureAndRedactConfig` replaces `publicKeyPem: string` with `keyManager: KeyManager`
  - [ ] `RevealConfig` replaces `privateKeyPem: string` with `keyManager: KeyManager`
  - [ ] `secureAndRedact()` calls `keyManager.getOrCreateKeyPair(userId)` internally for public key + fingerprint
  - [ ] `reveal()` calls `keyManager.getOrCreateKeyPair(userId)` internally for private key
  - [ ] `SqlitePublicKeyStore` usage removed from privacy pipeline (KeyManager replaces it)
  - [ ] All existing privacy tests updated to use an `InMemoryKeyManager` test helper
  - [ ] End-to-end privacy integration test passes with `InMemoryKeyManager`
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- **Testing approach:** Create `InMemoryKeyManager` test helper (generates keys in memory, no disk I/O) for use in all privacy tests. Verify full secureAndRedact → reveal round-trip works with KeyManager.
- **QA:** N/A
- **Planned commits:**
  1. `refactor: update privacy pipeline configs to use KeyManager` — src/privacy/index.ts
  2. `test: update privacy tests to use InMemoryKeyManager` — tests/integration/privacy.test.ts + any other affected tests
- **Technical notes:**
  - `InMemoryKeyManager` for tests: same interface, stores keys in a Map, no filesystem. Always returns `created: true` on first call.
  - Keep `SqlitePublicKeyStore` class in vault/sqlite/index.ts for now (it's harmless and the table DDL stays). Just stop using it in the privacy pipeline. Can remove in a future cleanup.
  - The `asymmetric-encrypt.ts` function `encryptAndWrapValue()` still takes raw `publicKeyPem` — intentionally unchanged. It's a low-level stateless function called internally by `secureAndRedact()` which gets the key from KeyManager. 004c will change this function when switching to KEK-based wrapping.
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Update README and docs
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
- **As a** developer, **I want** the README to show the new KeyManager-based API, **so that** new developers see the correct usage pattern.
- **Dependencies:** Story 2
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] README privacy code examples updated — no more `generateKeyPair()` or raw PEM strings in usage examples
  - [ ] README SDK integration tool handler example updated
  - [ ] Key management explained: where keys are stored, auto-generation, `created` flag for first-run warnings
  - [ ] `npm run typecheck` and `npm test` pass (no code changes, just docs)
- **Testing approach:** Docs only — verify no stale code patterns remain.
- **QA:** N/A
- **Planned commits:**
  1. `docs: update README for KeyManager-based privacy API` — README.md
- **Technical notes:**
  - New usage pattern: `const keyManager = new FileSystemKeyManager()` then pass to secureAndRedact/reveal
  - Show the `created` flag pattern for first-run user notification
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
- Story 1: KeyManager + FileSystemKeyManager — PR #, status
- Story 2: Refactor privacy pipeline — PR #, status
- Story 3: Update README — PR #, status

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
