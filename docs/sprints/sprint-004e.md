# Pristine Local — Sprint 004e
**Date:** TBD
**Goal:** Security hardening — fix path traversal in key management and enforce clean separation of responsibilities between classification and redaction
**Status:** :white_circle: Backlog

---

## Handoff

### Project Context
- **Repo:** getlou-gh/pristine (local: ~/projects/pristine)
- **Tech stack:** TypeScript, Vitest, ESLint, better-sqlite3, node:crypto
- **Current state:** Sprint 004d complete. `initPristine()`, `models.json`, `createLlmClients()`, SSH-style permission validation, and full documentation all in place. 371 tests passing (including 14 e2e with real Ollama).
- **Implementation spec:** `docs/specs/implementation-spec-001.md`
- **Source:** Issue #31 — security findings from external agent review
- **Coding Session ID:** *(filled when coding session starts)*

### Sprint-Level Technical Context

**Problem A: Path traversal in FileSystemKeyManager**

Sprint 004d added SSH-style permission validation (directory 0o700, file 0o600). However, `publicKeyPath()` and `privateKeyPath()` in `src/privacy/keys/filesystem.ts` build filesystem paths using `userId` directly with no path traversal prevention:

```typescript
join(this.keysDir, `${userId}-private.pem`)
```

`join()` resolves `..` segments. A `userId` like `../../etc/evil` escapes `keysDir` and writes arbitrary files. Even in a local SDK, this is a filesystem integrity bug — `userId` may come from caller-controlled input.

**Problem B: Redaction layer makes classification decisions**

`shouldRedactEntity()` in `src/privacy/vault/redaction.ts` (lines 170-205) applies heuristics that can suppress entities the classifiers flagged as sensitive. This violates separation of responsibilities:

- **Classifiers** (deterministic + LLM) decide what is PII
- **Redaction layer** should only replace text with placeholders for entities it's given

Currently the redaction layer second-guesses the classifiers: it drops `physical_address` entities without house numbers, filters temporal-looking text, and applies DOB context checks. These are classification decisions sitting in the wrong module.

The fix is to **delete `shouldRedactEntity` and all its helpers/regex patterns**. `redactText()` becomes a simple loop that redacts every entity. Over-redaction is the correct fail-closed behavior for a privacy SDK. Classifier improvements (better false positive filtering) belong in the classifier modules and are tracked separately in the backlog.

### Prerequisites
- Sprint 004d merged (done)

### Parallelization
Stories 1 and 2 are independent — they touch different files and can run in parallel. Story 3 (documentation) depends on both.

### Stories
**Constraints:** Max 5 commits per story.

#### Story 1: Path traversal prevention in FileSystemKeyManager
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
- **As a** developer, **I want** `userId` validated before use in filesystem paths, **so that** path traversal attacks cannot write or read files outside the keys directory.
- **Dependencies:** None
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `userId` containing `/` is rejected with `KeyManagerError`
  - [ ] `userId` containing `\` is rejected with `KeyManagerError`
  - [ ] `userId` containing `..` is rejected with `KeyManagerError`
  - [ ] Error message clearly states the invalid character/pattern
  - [ ] Validation runs in both `getOrCreateKeyPair` and `saveKeyPair` (before any filesystem operation)
  - [ ] Normal `userId` values work: `user-1`, `user_abc`, `user.name`, `user@domain`
  - [ ] Tests: traversal with `../`, absolute path `/etc/evil`, backslash `..\\`, and valid userIds
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` pass
- **Testing approach:** Unit tests in `tests/privacy/keys/filesystem.test.ts` with malicious and valid `userId` values.
- **QA:** N/A
- **Planned commits:**
  1. `fix: add userId path traversal validation to FileSystemKeyManager`
  2. `test: add path traversal prevention tests`
- **Technical notes:**
  - Add a `validateUserId(userId: string)` helper at module level
  - Reject if `userId` includes `/`, `\`, or `..` — these are the traversal vectors. This intentionally also rejects unusual-but-non-malicious values like `user..name` (acceptable trade-off)
  - Call in `getOrCreateKeyPair` and `saveKeyPair` before any path construction
  - Throw `KeyManagerError` (existing domain error class)
- **Priority:** Must-have (High severity from Issue #31)
- **Owner:** Coding Agent

#### Story 2: Remove classification heuristics from redaction layer
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
- **As a** developer, **I want** the redaction layer to only perform redaction — not classification decisions, **so that** each module has a single responsibility and can be optimized independently.
- **Dependencies:** None
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] `shouldRedactEntity()` function deleted from `redaction.ts`
  - [ ] All helper functions used only by `shouldRedactEntity` deleted: `isLikelyNonSensitiveTemporalText`, `isLikelyFullAddress`, `isPhoneLike`
  - [ ] All regex patterns used only by the deleted helpers deleted: `TEMPORAL_TYPE_RE`, `DOB_TYPE_RE`, `DOB_CONTEXT_RE`, `DATE_VALUE_RE`, `TEMPORAL_WORD_RE`, `TRAVEL_SCHEDULING_RE`, `STREET_TOKEN_RE`, `HOUSE_NUMBER_RE`, `ZIPISH_RE`, `ADDRESS_CONTEXT_RE`, `EMAIL_RE`, `PHONE_RE`, `LONG_DIGIT_RE`, `CARDISH_RE`, `GOVT_ID_RE`, `ISO_DATE_ONLY_RE`
  - [ ] `DIGITS_RE` and `digitsOnly()` RETAINED — used by `buildPlaceholderLabel` (not a `shouldRedactEntity` dependency)
  - [ ] `redactText()` redacts every entity it receives — no filtering, no `shouldRedactEntity` call
  - [ ] `normalizeType()` retained (used by placeholder construction, not classification)
  - [ ] Deterministic classifier logic unchanged
  - [ ] LLM classifier logic unchanged
  - [ ] Combined classifier merge logic unchanged
  - [ ] Existing tests updated: remove or adjust tests that assert on `shouldRedactEntity` filtering behavior
  - [ ] E2e tests still pass (privacy pipeline may redact more aggressively — this is correct fail-closed behavior)
  - [ ] `npm run typecheck`, `npm test`, `npm run lint` pass
- **Testing approach:** Verify `redactText` redacts all entities. Update existing redaction tests that relied on filtering. Run e2e tests with real Ollama to confirm pipeline still works.
- **QA:** N/A
- **Planned commits:**
  1. `refactor: remove shouldRedactEntity and classification heuristics from redaction layer`
  2. `test: update redaction tests for simplified redactText`
- **Technical notes:**
  - `redactText()` loop simplifies: remove the `shouldRedactEntity` check at line 222, keep the overlap skip at line 218
  - Check which regex patterns are used by `normalizeType()` — only delete patterns not needed by remaining code
  - After this change, the redaction layer is ~90-100 lines (down from ~250) — `normalizeType`, `buildPlaceholder`, `buildPlaceholderLabel` (with `digitsOnly`, `lastFourLabel`, `detectCardNetwork`), and the replacement loop
  - **Tests that will break** in `tests/vault/vault-redaction.test.ts` (these assert entities are NOT redacted, which will no longer be true):
    - "does not redact travel date/time phrases misclassified as other"
    - "does not redact relative weekday travel phrases misclassified as other"
    - "does not redact long travel scheduling phrase misclassified as other"
    - "does not redact one-digit day dates misclassified as other"
    - "does not redact city-only value misclassified as physical_address"
    - These should be inverted (assert redaction happens) or deleted
    - "still redacts date values when context indicates DOB" and "still redacts full physical addresses" will still pass but the "still" wording is misleading — rename or keep as-is
  - The classifiers may over-detect (e.g., LLM flags "next Tuesday" as sensitive). This is the correct fail-closed behavior — over-redact is safer than under-redact. Classifier false-positive improvements are tracked in the backlog separately.
- **Priority:** Must-have (Medium severity from Issue #31, architecture concern)
- **Owner:** Coding Agent

#### Story 3: Document privacy pipeline architecture and module responsibilities
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
- **As a** developer, **I want** clear documentation of the privacy pipeline's module boundaries and each module's single responsibility, **so that** contributors can optimize classifiers, redaction, or vault independently without breaking the pipeline contract.
- **Dependencies:** Stories 1-2
- **Coding Agent:** claude
- **Acceptance criteria:**
  - [ ] README privacy section updated with a module responsibility diagram showing the pipeline: deterministic classifier -> LLM classifier -> combined classifier (merge + dedup) -> redaction (placeholder replacement only) -> vault (encrypt + store)
  - [ ] Each module's single responsibility documented:
    - Deterministic classifier: regex-based PII detection (credit cards, emails, SSN, phone). High confidence, no LLM needed.
    - LLM classifier: contextual PII detection (health, financial, relationships). Lower confidence, catches what regex misses.
    - Combined classifier: runs both in parallel, merges reports, deduplicates overlapping spans.
    - Redaction: replaces detected entities with `[SENSITIVE:type:id]` placeholders. Does NOT filter or second-guess classification decisions.
    - Vault: encrypts original PII values (AES-256-GCM + KEK wrapping) and stores in SQLite.
  - [ ] Extension guide updated: "Adding a new classifier" section explaining how to add a third classifier source (e.g., a rules engine) that plugs into the combined classifier's merge
  - [ ] Document the design principle: classifiers decide what is PII, redaction layer only executes. Over-redaction (fail-closed) is preferred over under-redaction.
  - [ ] `npm run lint` passes
- **Testing approach:** Manual review — verify documented module boundaries match actual code structure.
- **QA:** N/A
- **Planned commits:**
  1. `docs: add privacy pipeline architecture and module responsibility guide to README`
- **Technical notes:**
  - The diagram should show data flow: `text -> [deterministic + LLM in parallel] -> combined merge -> redactText() -> vault encrypt -> redacted text + placeholder IDs`
  - Emphasize that `redactText()` is now a pure function: entities in, placeholders out, no side decisions
  - Note that false positive filtering (if needed in future) belongs in the classifier layer, not the redaction layer
  - Reference Issue #31 as the motivation for this architecture clarification
- **Priority:** Must-have
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
- Story 1: Path traversal prevention — PR #, status
- Story 2: Redaction layer cleanup — PR #, status
- Story 3: Privacy pipeline architecture docs — PR #, status

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
