# Pristine Local — Sprint 004c
**Date:** TBD
**Goal:** Add Key Encryption Key (KEK) intermediary layer for O(1) key rotation — RSA key change re-wraps one KEK instead of N DEKs
**Status:** :yellow_circle: Planning

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, better-sqlite3, node:crypto
- **Current state:** Sprint 004b complete. KeyManager persists RSA key pairs to `~/.pristine/keys/`. Privacy pipeline uses KeyManager. Two-layer encryption working: each PII value has its own random DEK wrapped directly by the user's RSA public key.
- **Implementation spec:** `docs/specs/implementation-spec-001.md`
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context

**Current architecture (per-value RSA wrapping):**
```
RSA public key  →  wraps DEK₁  →  encrypts PII value 1
RSA public key  →  wraps DEK₂  →  encrypts PII value 2
RSA public key  →  wraps DEKₙ  →  encrypts PII value N

Key rotation: N RSA unwrap + re-wrap operations
```

**Target architecture (KEK intermediary):**
```
RSA public key  →  wraps KEK (once per user)  →  stored in user_keys table

KEK  →  wraps DEK₁  →  encrypts PII value 1
KEK  →  wraps DEK₂  →  encrypts PII value 2
KEK  →  wraps DEKₙ  →  encrypts PII value N

Key rotation: 1 RSA operation (re-wrap KEK) regardless of N
```

**What changes:**
- DEK wrapping switches from RSA-OAEP to AES-256-KW (AES Key Wrap, RFC 3394) using the KEK
- KEK is a random 256-bit key, wrapped once by RSA and stored per user
- On encryption: retrieve KEK → unwrap with RSA → wrap DEK with KEK → store
- On decryption: retrieve KEK → unwrap with RSA → unwrap DEK with KEK → decrypt
- Key rotation: unwrap KEK with old RSA → re-wrap KEK with new RSA → update one row
- The `ZkV2EncryptedValue` schema evolves: `wrappedDek` is now wrapped by KEK, new `keyWrapping` value

### Prerequisites
- **Sprint 004b must be fully merged** before starting this sprint. Verify `KeyManager` interface exists in `src/core/interfaces.ts` with both `getOrCreateKeyPair` and `saveKeyPair` methods.
- Story 1 includes a prerequisite commit to widen the `keyWrapping` type in `ZkV2EncryptedValue` and `ZkV2EncryptedValueMetadata` from the literal `'rsa-oaep-256'` to a union `'rsa-oaep-256' | 'aes-256-kw+rsa-oaep-256'`, and update `parseZkV2EncryptionMetadata` to accept the new value.

### Parallelization
Stories are sequential: Story 1 (KEK generation + storage) → Story 2 (migrate wrapping) → Story 3 (key rotation API) → Story 4 (migrate existing entries).

### Stories
**Constraints:** Max 5 commits per story.

#### Story 1: KEK generation, storage, and retrieval
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
- **As a** developer, **I want** a per-user KEK generated, RSA-wrapped, and stored in the database, **so that** DEK wrapping can use the fast symmetric KEK instead of slow RSA.
- **Dependencies:** Sprint 004b (KeyManager)
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] Widen `keyWrapping` type in `ZkV2EncryptedValue` and `ZkV2EncryptedValueMetadata` from `'rsa-oaep-256'` to `'rsa-oaep-256' | 'aes-256-kw+rsa-oaep-256'` (prerequisite for all other work)
  - [ ] Update `parseZkV2EncryptionMetadata` to accept new `keyWrapping` value
  - [ ] `user_keks` SQLite table: `user_id TEXT PRIMARY KEY`, `wrapped_kek BLOB NOT NULL`, `key_id TEXT NOT NULL` (RSA fingerprint), `algorithm TEXT NOT NULL DEFAULT 'rsa-oaep-256'`, `created_at TEXT`
  - [ ] `KekManager` class takes `db` and `keyManager` in constructor (explicit dependencies)
  - [ ] `generateKek()` creates random 256-bit key
  - [ ] `wrapKek(kek, publicKeyPem)` wraps KEK with RSA-OAEP (reuses existing `wrapDek`)
  - [ ] `unwrapKek(wrappedKek, privateKeyPem)` unwraps KEK with RSA private key
  - [ ] `kekManager.getOrCreate(userId)` — retrieves from DB or generates + stores new one
  - [ ] KEK cached in memory per userId after first retrieval
  - [ ] `kekManager.clearCache(userId?)` for explicit cleanup (clears one user or all)
  - [ ] Tests: generate + store, retrieve, cache hit, cache clear, multi-user isolation
  - [ ] `npm run typecheck` and `npm test` pass
- **Testing approach:** In-memory SQLite. Test KEK generation, RSA wrapping/unwrapping round-trip, database storage and retrieval, memory caching, cache clearing.
- **QA:** N/A
- **Planned commits:**
  1. `feat: widen keyWrapping type union and update metadata parser` — src/core/types.ts, src/privacy/vault/sqlite/index.ts
  2. `feat: add user_keks table and KekManager with caching` — DDL, KekManager class, generateKek, wrapKek, unwrapKek, getOrCreate, clearCache
  3. `test: add KekManager tests` — tests/privacy/kek/
- **Technical notes:**
  - KEK = 32 bytes random (AES-256), wrapped by RSA-OAEP-256 → 512-byte blob in DB
  - `wrapKek` reuses existing `wrapDek` from `asymmetric-crypto.ts` — same RSA operation, different semantic name
  - `KekManager` class (not a standalone function) — holds `db`, `keyManager`, and cache as instance state. Parallels the `KeyManager` pattern.
  - Cache: `Map<string, Buffer>` keyed by userId, holds unwrapped KEK in memory. Documented security property: plaintext KEK in process memory (same threat model as RSA private key in memory).
  - `algorithm` column on `user_keks` for future-proofing (e.g., post-quantum key wrapping)
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 2: Migrate DEK wrapping from RSA to KEK
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
- **As a** developer, **I want** DEKs wrapped by the user's KEK instead of RSA directly, **so that** key rotation only needs to re-wrap the KEK.
- **Dependencies:** Story 1
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `wrapDekWithKek(dek, kek)` — AES-256-KW (RFC 3394) wrapping of DEK with KEK. Uses `crypto.createCipheriv('aes256-wrap')` with fixed IV `0xA6A6A6A6A6A6A6A6`. Output: 40 bytes (32-byte DEK + 8-byte integrity check).
  - [ ] `unwrapDekWithKek(wrappedDek, kek)` — AES-256-KW unwrap, returns 32-byte DEK
  - [ ] `encryptAndWrapValue()` updated: takes `kek: Buffer` instead of `publicKeyPem`, wraps DEK with KEK via AES-KW. Sets `keyWrapping: 'aes-256-kw+rsa-oaep-256'` on envelope.
  - [ ] `reveal()` refactored: replace inline `privateDecrypt` with `unwrapDek()` from `asymmetric-crypto.ts`, then branch on `envelope.keyWrapping`: old path (`'rsa-oaep-256'`) uses RSA directly, new path (`'aes-256-kw+rsa-oaep-256'`) unwraps DEK with KEK
  - [ ] `secureAndRedact()` updated: gets KEK via `kekManager.getOrCreate(userId)` → passes KEK to `encryptAndWrapValue()`
  - [ ] Backward compatible: existing entries with `keyWrapping: 'rsa-oaep-256'` still decrypt via RSA direct path
  - [ ] Round-trip test: encrypt with KEK → store → retrieve → decrypt → verify original value
  - [ ] Backward compat test: old RSA-wrapped entry still decrypts after code change
  - [ ] Mixed vault test: some old entries + some new entries, all decrypt correctly
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- **Testing approach:** Test new KEK-based encryption round-trip. Test backward compatibility with old RSA-wrapped entries. Test mixed vault (some old, some new entries).
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement AES-256-KW key wrapping for DEK with KEK` — wrapDekWithKek, unwrapDekWithKek
  2. `refactor: update encryptAndWrapValue to use KEK and refactor reveal() inline crypto` — privacy pipeline changes, replace inline privateDecrypt with unwrapDek utility
  3. `test: add KEK-based encryption tests and backward compatibility` — tests/privacy/
- **Technical notes:**
  - **AES-256-KW (RFC 3394)** chosen over AES-GCM: purpose-built for key wrapping, no nonce management (uses fixed IV), deterministic output, no auth tag storage needed. 32-byte DEK → 40-byte wrapped output. Industry standard (AWS KMS, GCP KMS).
  - Backward compat: check `envelope.keyWrapping` field — `'rsa-oaep-256'` = old path (unwrap DEK with RSA), `'aes-256-kw+rsa-oaep-256'` = new path (unwrap KEK with RSA via KekManager, then unwrap DEK with KEK via AES-KW)
  - `reveal()` currently has inline `privateDecrypt` duplicating `unwrapDek()` logic — refactor to use `unwrapDek()` first, then add the new KEK branching
  - Performance: KEK unwrap (RSA) happens once per `reveal()` call (cached), then each DEK unwrap is AES-KW (~microseconds vs ~1ms for RSA)
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 3: Key rotation API
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
- **As a** developer, **I want** a key rotation function that re-wraps the KEK with a new RSA key, **so that** users can change their encryption key without re-encrypting any PII.
- **Dependencies:** Story 2
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `rotateKey(userId, keyManager, kekManager)` function exported from privacy module — generates new RSA key pair internally
  - [ ] Gets old key pair via `keyManager.getOrCreateKeyPair(userId)`
  - [ ] Unwraps KEK with old RSA private key via `kekManager`
  - [ ] Generates new RSA key pair via `generateKeyPair()`
  - [ ] Re-wraps KEK with new RSA public key
  - [ ] Updates `user_keks` table with new wrapped KEK + new key_id (via `kekManager`)
  - [ ] Saves new key pair via `keyManager.saveKeyPair(userId, newKeyPair)`
  - [ ] Clears KEK memory cache for the user via `kekManager.clearCache(userId)`
  - [ ] All existing vault entries remain decryptable with new key (KEK unchanged, only its RSA wrapping changed)
  - [ ] Test: rotate key → verify all previously encrypted values still decrypt correctly
  - [ ] Test: rotate key → encrypt new value → decrypt with new key
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- **Testing approach:** End-to-end: encrypt several values → rotate key → verify old values decrypt → encrypt new value → verify new value decrypts. All with in-memory SQLite + InMemoryKeyManager.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement rotateKey for O(1) key rotation` — src/privacy/rotation.ts
  2. `test: add key rotation tests` — tests/privacy/rotation.test.ts
- **Technical notes:**
  - This is O(1) regardless of vault size — only the KEK row in `user_keks` is updated
  - Old wrapped DEKs stay as-is (they're wrapped by KEK, not RSA)
  - The `keyId` field in vault entries becomes stale after rotation (points to old RSA fingerprint). This is informational — decryption uses the KEK, not the RSA key directly. Add a code comment on `keyId` documenting this: "fingerprint at encryption time, may differ from current RSA key after rotation"
  - `rotateKey` generates the new key pair internally (not passed by caller) — uses `generateKeyPair()` then `keyManager.saveKeyPair()` to persist
  - Clear KEK cache after rotation to force re-read of newly wrapped KEK
- **Priority:** Must-have
- **Owner:** Coding Agent

#### Story 4: Migrate existing RSA-wrapped entries to KEK scheme
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
- **As a** developer, **I want** existing RSA-wrapped vault entries migrated to the KEK scheme, **so that** all entries benefit from O(1) key rotation.
- **Dependencies:** Story 2
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `migrateToKek(userId, keyManager, kekManager, db)` function: finds all entries with `keyWrapping: 'rsa-oaep-256'`, unwraps DEK with RSA, re-wraps with KEK, updates entry
  - [ ] Migration is idempotent — running twice is safe (skips entries already on `'aes-256-kw+rsa-oaep-256'`)
  - [ ] Migration runs in a `db.transaction()` (all-or-nothing)
  - [ ] Test: create old-format entries → migrate → verify decryptable via KEK path
  - [ ] Test: run migration twice → verify no errors, no double-wrapping
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- **Testing approach:** Create entries in old format (RSA-wrapped DEK), run migration, verify they decrypt via the new KEK path. Run migration again to verify idempotency.
- **QA:** N/A
- **Planned commits:**
  1. `feat: implement migrateToKek for existing vault entries` — src/privacy/migration.ts
  2. `test: add migration tests` — tests/privacy/migration.test.ts
- **Technical notes:**
  - This is a one-time migration per user, not a recurring operation
  - Can be triggered automatically on first `reveal()` call that encounters an old-format entry, or manually via CLI
  - Migration per entry: unwrap DEK with RSA → re-wrap with KEK via AES-KW → update `wrappedDek` + `keyWrapping` in DB
  - **Crash safety**: SQLite `db.transaction()` provides atomicity — if process crashes mid-migration, WAL rollback undoes all changes. No partial migration state possible. No retry logic needed.
  - For local-first use, vault sizes are small (hundreds, not millions). Full-table migration in one transaction is fine.
- **Priority:** Nice-to-have (backward compat in Story 2 means old entries still work without migration)
- **Owner:** Coding Agent

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
- Story 1: KEK generation + storage — PR #, status
- Story 2: Migrate DEK wrapping to KEK — PR #, status
- Story 3: Key rotation API — PR #, status
- Story 4: Migrate existing entries — PR #, status

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
