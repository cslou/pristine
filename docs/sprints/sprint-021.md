# Pristine — Sprint 021
**Date:** 2026-05-01 – TBD
**Goal:** Land the cleanup work sprint-020 explicitly deferred — trim `src/core/init.ts` of the orphan LLM-config logic, drop `DownloadError` / `LocalConfig` / `PromptConfig` dead types, and strip internal-process tokens (`sprint-NNN`, `Story-N`, `@AC-Story`, `Phase-N`, `/review`) from comments in the 20 sprint-020-untouched files (~106 hits) the audit surfaced.
**Status:** 🟢 Complete

---

## Handoff

### Project Context

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript (strict, ESM), Node 18+, `better-sqlite3` + `sqlite-vec`, `@huggingface/transformers` (Nomic Embed v1.5, 768-d), Vitest. Local-first.
- **Current state:** Post-sprint-020 (LLM-machinery removal + createLite removal + ingestQueue privatization). The LLM engine layer (`src/engine/`, `src/models/`) is gone, but `src/core/init.ts` still contains `loadModelConfig`, `DEFAULT_MODEL_CONFIG`, `validateModelEntry`, the privacy/memory `ModelEntry` types (`OllamaModelEntry`, `LlamaCppModelEntry`, `ModelEntry`, `ModelConfig`), and the `VALID_ENGINES` / `VALID_GPU_VALUES` sets — orphan code that the deleted engine factory was the sole production consumer of. `src/core/errors.ts` carries an orphan `DownloadError` (only consumer was the deleted `src/models/download.ts`). `src/core/types.ts` carries pre-existing dead `LocalConfig` + `PromptConfig` interfaces with zero consumers. Sprint-020 Story 7 stripped internal-process tokens from the 6 files it touched but ~106 dirty tokens remain across 20 untouched files.
- **Implementation spec:** `docs/specs/implementation-spec-005.md` — §5.1 enumerates the live primitives. None of this sprint's deletions affect the live surface; this sprint is pure cleanup.

### Sprint-Level Technical Context

- **Sprint type:** Cleanup. Pure code deletion + comment edits. No new features, no behavior changes, no schema changes.
- **Verification profile:** Generic per-story verification. Each story owns its own checks. Story 1 ships pure code deletion + targeted test trim; Stories 2 + 3 ship comment-only edits with grep-based scope checks.
- **Baseline checks:** `npm run typecheck` + `npm run lint` clean; `npm run test:unit` (post-sprint-020 baseline 421 tests; Story 1 may drop a few when init.test.ts loses the LLM-config validator tests); `SKIP_SLOW_TESTS=1 npm run test:integration` (538 passed, 9 skipped) and `npm run test:e2e` (547 passed) stay flat; `bash .checks/pre-merge.sh` exit 0.
- **Risk surfaces:** `src/core/init.ts` is on every `Pristine.create()` non-fully-injected path — touch carefully and verify `initPristine()` still wires the embedder config. The 14 test files in Story 3 scope are integration + unit — comment edits only, but a careless `sed` could trip line-shifts that break test discovery; favor targeted Edit calls over bulk sed.
- **Non-goals:**
  - **Behavior changes.** Every removal target must be dead code (zero production consumer). If a grep audit at story start finds a live consumer, escalate before deleting.
  - **`models.json` format change.** Trimming `DEFAULT_MODEL_CONFIG` to embedder-only is in scope (since the privacy/memory fields it writes are now dead), but renaming `models.json` itself or breaking the file format is out of scope.
  - **Comment cleanup of files modified by sprint-020.** Story 7 of sprint-020 already cleaned those.
  - **Spec §15 token strip.** Sprint-020 Story 6 deferred the broader spec-hygiene pass to a future spec-only sprint; not this one.
- **Constraints:** No new dependencies. No new tests (the removed test cases are tests for now-deleted code; per the "tests don't change unless removing tests for deleted code" exception used in sprint-020). Public API surface stays exactly as sprint-020 left it.
- **Dirty-token bookkeeping note.** The pre-flight grep audit surfaced 106 hits across 20 sprint-020-untouched files (Stories 2 + 3 scope). `src/core/init.ts` is NOT in the 20-file list because Story 1's deletion removes its dirty-token-bearing comments incidentally. Post-sprint, `grep '<locked-token-set>' src/ tests/ scripts/` should return zero hits across the entire repo (or, if any survive, they survive in `~/.pristine/`-runtime files outside the repo).

### User Flows

- **Affected (existing):** None — every change is dead-code removal or non-substantive comment edit. `Pristine.create({...})`, `searcher.hybridSearch`, `secureAndRedact`, `reveal`, `scrubOutput` are unchanged.
- **New (this sprint):** None.

### Impact Surface

- **Primary files/modules:**
  - **Story 1 (code orphans):** `src/core/init.ts` (trim LLM-config logic), `src/core/errors.ts` (drop `DownloadError`), `src/core/types.ts` (drop `LocalConfig` + `PromptConfig`), `tests/core/init.test.ts` (drop tests for removed validator paths). Total: 4 files.
  - **Story 2 (src/ comment cleanup):** 6 files surfaced by pre-flight grep — `src/conversations/store.ts` (17 hits), `src/memory/indexer/index.ts` (15), `src/memory/indexer/windows.ts` (7), `src/queue/ingest-queue.ts` (6), `src/memory/indexer/session-vector.ts` (5), `src/memory/orchestrator/chunker.ts` (3), `src/memory/indexer/embed-worker.ts` (1). Total: 7 files, 54 hits.
  - **Story 3 (tests/ comment cleanup):** 14 files, 52 hits — `tests/conversations/store.test.ts` (16), `tests/integration/indexer.test.ts` (10), `tests/integration/searcher.test.ts` (6), `tests/integration/searcher-vector.test.ts` (4), `tests/memory/indexer/embed-worker.test.ts` (3), `tests/integration/storeasync.test.ts` (3), `tests/memory/indexer/session-vector.test.ts` (2), `tests/memory/indexer/ingest.test.ts` (2), `tests/integration/searcher-fts.test.ts` (2), 5 others with 1 hit each.
- **Expected behavior change:** None.
- **Compatibility expectations:** Public API untouched. `Pristine.create({...})`, `client.searcher.hybridSearch`, `client.drainEmbedQueue`, `client.buildSessionVector`, `client.pendingEmbedTasks`, privacy methods all keep identical signatures and behavior.
- **Rollback notes:** All three stories are pure deletions / comment edits. If the sprint is abandoned mid-flight, `git push origin --delete sprint-021 && git branch -D sprint-021` per AGENTS.md §3. No migration to revert.

### Verification Strategy

Each story's Testing approach names the explicit grep / typecheck / test-count scenario with its pass condition. Story 1 carries the most risk (touches a hot module); Stories 2+3 are comment-only and verified by grep + the unchanged baseline checks.

### Stories

**Constraints:** Target a maximum of 5-8 stories per sprint. Target a maximum of 5-8 commits per story. Standing commit-floor exemption applies — Story 1 is a single coherent code-cleanup pass, Stories 2 + 3 are single comment-strip passes. Splitting Story 1 per-file (init.ts vs errors.ts vs types.ts) would create artificial granularity since each is small and they share the same rationale (orphan post-sprint-020).

#### Story 1: Trim `src/core/init.ts` orphan LLM-config + drop dead error/type classes

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Within size limits
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed
  - [x] Each AC verified
  - [x] Ready for Lou
- **Review:**
  - Findings: *(filled in post-review)*
  - Resolution: *(filled in post-review)*
- **As a** Pristine SDK maintainer, **I want** the orphan LLM-config logic in `src/core/init.ts` and the dead `DownloadError` / `LocalConfig` / `PromptConfig` types removed, **so that** the codebase no longer carries 100+ LOC of dead code that future readers must trace through to understand the live config + error surface.
- **Dependencies:** None.
- **Acceptance criteria:**
  - [x] Pre-flight grep audit confirms zero production consumers of: `loadModelConfig`, `DEFAULT_MODEL_CONFIG`, `validateModelEntry`, `OllamaModelEntry`, `LlamaCppModelEntry`, `ModelEntry`, `ModelConfig` / `PristineConfig` (privacy/memory shape only), `VALID_ENGINES`, `VALID_GPU_VALUES`, `EXAMPLE_CONFIG`, `DownloadError`, `LocalConfig`, `PromptConfig`. **Pass condition** (lifted from Testing approach scenario 1): every hit of `grep -rn '<symbol>' src/ tests/ scripts/` is inside `src/core/init.ts`, `src/core/errors.ts`, `src/core/types.ts`, `tests/core/init.test.ts`, or `src/index.ts`'s ConfigError JSDoc (the only allowed pre-removal consumers). Recon at planning verified this; AC-1 re-runs it at story start.
  - [x] **`loadModelConfig`'s body is trimmed** (NOT deleted): keeps the file existence check, JSON parse, and the `embedder` validation branch (`if ('embedder' in obj) validateEmbedderEntry(obj.embedder)`); drops the `privacy` and `memory` validator calls. Recon-locked: `initPristine` (the only `loadModelConfig` caller in production) needs `init.config.embedder` to wire `client.ts:113`'s embedder fallback, so the function survives in trimmed form.
  - [x] **`initPristine` keeps writing `models.json`** but with the trimmed `DEFAULT_MODEL_CONFIG = { embedder: { engine: 'local' } }` shape — no `privacy` / `memory` keys. Recon-locked: removing the file write entirely would change the on-disk artifact-existence contract; keeping it with a smaller shape preserves user trust ("the file is still there, just smaller").
  - [x] **`ModelConfig` renamed to `PristineConfig`** AND narrowed to `{ readonly embedder?: EmbedderConfig }` — `privacy` and `memory` fields dropped. The `OllamaModelEntry`, `LlamaCppModelEntry`, `ModelEntry` interfaces are removed entirely (no consumer post-narrowing). `DEFAULT_MODEL_CONFIG` renamed to `DEFAULT_PRISTINE_CONFIG`.
  - [x] **`InitPristineResult.config: PristineConfig` survives** with the renamed-and-narrowed type. `client.ts:113` continues to read `init?.config.embedder`.
  - [x] `DownloadError` removed from `src/core/errors.ts`.
  - [x] `LocalConfig` + `PromptConfig` removed from `src/core/types.ts`.
  - [x] `tests/core/init.test.ts` trimmed: tests for the removed `validateModelEntry` privacy/memory paths and the removed `EXAMPLE_CONFIG` error-message format are deleted; tests for `initPristine`'s filesystem setup + the embedder-config validator + `loadModelConfig`'s remaining file-existence/JSON-parse/embedder-only path stay. Per the sprint-020-locked exception class.
  - [x] **`src/index.ts` JSDoc `ConfigError` description updated**: drop the "missing model files" half (no model files exist post-sprint-020); keep the `invalid models.json` half (`initPristine` still writes/reads it). Recon-locked.
  - [x] No regression in unit / integration / e2e suites; typecheck + lint clean. Baseline checks per Sprint-Level Technical Context.
- **Testing approach:** Two scenarios.
  1. **Pre-flight grep audit.** Run `grep -rn 'loadModelConfig\|DEFAULT_MODEL_CONFIG\|validateModelEntry\|ModelEntry\|ModelConfig\|VALID_ENGINES\|VALID_GPU_VALUES\|DownloadError\|LocalConfig\|PromptConfig' src/ tests/ scripts/` at story start. Expected: every hit is either inside `src/core/init.ts` itself, `src/core/errors.ts`, `src/core/types.ts`, or `tests/core/init.test.ts`. If any hit is elsewhere, escalate before deleting. **Pass:** all hits inside the four target files.
  2. **Test-count diff matches the trim.** Capture pre-Story-1 unit count (421); after the trim, the count drops by exactly the number of `loadModelConfig` validator-path tests removed from `init.test.ts`. **Pass:** post-Story-1 unit count = 421 − N (where N is the removed-test count, surfaced at story start).
- **QA:**
  - Automated: `npm run typecheck` exit 0; `npm run lint` exit 0; `npm run test:unit` pre/post diff matches the trimmed-test count; `SKIP_SLOW_TESTS=1 npm run test:integration` (538 passed) + `npm run test:e2e` (547 passed) stay flat; `bash .checks/pre-merge.sh` exit 0.
  - Static checks: post-removal grep confirms zero hits for the deleted symbol names anywhere in `src/`, `tests/`, `scripts/`.
  - Manual: N/A — pure deletion sprint.
- **Planned commits:**
  1. `refactor(core): trim init.ts orphan LLM-config + drop DownloadError + LocalConfig + PromptConfig` — single coherent code-cleanup commit covering all four target files. Standing commit-floor exemption applies (see Technical Notes).
- **Technical notes:**
  - **Single-commit floor exemption — co-located rationale.** The standing commit-floor exemption applies because the four target files share interlocking type imports: `src/core/types.ts` removals (`LocalConfig`, `PromptConfig`) are independent, but `src/core/init.ts` imports `EmbedderConfig` and the privacy/memory `ModelEntry` types it re-exports; `src/core/errors.ts`'s `DownloadError` deletion is independent. The interdependency is small but real — splitting per-file forces typecheck-clean intermediate states that add ceremony without reducing review friction. The full-commit diff stays under 200 LOC of removals, well within reviewable atomic-commit territory.
  - **Recon completed at sprint planning.** `loadModelConfig` has exactly one production caller (`initPristine` in the same file). `initPristine` has exactly one production caller (`src/client.ts:113`), which reads only `init?.config.embedder`. `tests/core/init.test.ts` is the only test consumer. Recon resolution: **trim** `loadModelConfig` (don't delete), **narrow + rename** `ModelConfig → PristineConfig` (embedder-only shape), **keep** `initPristine`'s file write with the trimmed `DEFAULT_PRISTINE_CONFIG = { embedder: { engine: 'local' } }`. ACs 2-9 reflect the locked decisions.
  - **`ModelConfig → PristineConfig` rename rationale.** Post-narrowing the type holds only embedder config, no models. Internal-only (not exported from the barrel), so the rename has no consumer impact. New name reflects the post-sprint reality: whatever Pristine-init-time config exists, currently just embedder. `DEFAULT_MODEL_CONFIG` renames in lockstep to `DEFAULT_PRISTINE_CONFIG`. Comment header `// ModelConfig types (discriminated union on 'engine')` becomes `// PristineConfig — init-time SDK config (currently embedder-only)`.
  - **`models.json` runtime artifact.** This file lives in `~/.pristine/models.json` (user homedir), not in the repo. Post-Story-1, `initPristine` writes the trimmed shape `{ embedder: { engine: 'local' } }`. Existing installs with a sprint-019-era `models.json` containing `privacy` / `memory` fields will see those fields silently ignored — `loadModelConfig`'s post-Story-1 body has no validator for them, so they pass through unread. No error, no migration needed. Document that in the commit message.
- **Priority:** Must-have

#### Story 2: Comment cleanup of 7 sprint-020-untouched src/ files

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Within size limits
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed
  - [x] Each AC verified
  - [x] Ready for Lou
- **Review:**
  - Findings: *(filled in post-review)*
  - Resolution: *(filled in post-review)*
- **As a** Pristine SDK consumer reading the post-sprint code in `node_modules/@pristine/shield-local/dist/`, **I want** internal-process tokens (`sprint-NNN`, `Story-N`, `@AC-Story`, `Phase-N`, `/review`, `iter-N`) stripped from comments in the production `src/` files sprint-020 didn't touch, **so that** every comment I read describes architectural reasoning rather than internal-process labels I cannot interpret.
- **Dependencies:** Story 1 (Story 1 may delete a chunk of `src/core/init.ts` carrying its own dirty tokens; Story 2 should run over the post-Story-1 file shape).
- **Acceptance criteria:**
  - [x] Strip the locked dirty-token set from comments in: `src/conversations/store.ts` (17 hits), `src/memory/indexer/index.ts` (15), `src/memory/indexer/windows.ts` (7), `src/queue/ingest-queue.ts` (6), `src/memory/indexer/session-vector.ts` (5), `src/memory/orchestrator/chunker.ts` (3), `src/memory/indexer/embed-worker.ts` (1). Sprint-018-locked dirty-token set: `sprint-NNN`, `Story N`, `Story-N`, `@AC-Story`, `@AC-N`, `AC-N`, `spec-005 §`, `spec-004 §`, `spec-003 §`, `implementation-spec-NNN`, `Phase N`, `Phase-N`, `P[0-9]-S[0-9]`, `iter-N`, `(per sprint-NNN retro)`, `/review`, `/review-fix`.
  - [x] Substantive technical content kept verbatim — algorithmic invariants, atomicity rationale, parameter contracts, error-contract notes, regex shapes, ESLint-override rationale all preserved. Where a `Phase N` reference structurally describes an architectural layer (e.g. "the hybrid retrieval primitive"), rewrite to descriptive prose rather than delete the surrounding sentence.
  - [x] Post-cleanup grep on the 7 src/ files for the locked dirty-token set returns zero hits.
  - [x] Cold-read pass: every comment in the 7 cleaned files is interpretable by an outside developer who has never read the sprint docs.
  - [x] Baseline checks hold: typecheck + lint + unit + integration + e2e all match the post-Story-1 counts. Zero behavioral change.
- **Testing approach:** Two scenarios.
  1. **Post-cleanup grep.** Run `grep -rE '<locked-token-set>' src/conversations/ src/memory/ src/queue/ 2>/dev/null` after the strip. **Pass:** zero hits in any file in scope; pre-existing tokens in any out-of-scope file stay untouched.
  2. **Test-count baseline holds.** `npm run test:unit` matches post-Story-1 count exactly; `SKIP_SLOW_TESTS=1 npm run test:integration` matches post-Story-1 count; `npm run test:e2e` matches post-Story-1 count. **Pass:** all three counts are flat.
- **QA:**
  - Automated: `npm run typecheck` exit 0; `npm run lint` exit 0; full test suite at flat counts; `bash .checks/pre-merge.sh` exit 0.
  - Static checks: post-cleanup grep returns zero hits in scope (above).
  - Manual: cold-read pass per the AC.
- **Planned commits:**
  1. `chore(comments): strip internal-process tokens from sprint-020-untouched src/ files`
- **Technical notes:**
  - **Single-commit floor exemption — co-located rationale.** The 7 src/ files in scope are all `src/memory/indexer/`, `src/memory/orchestrator/`, `src/conversations/`, `src/queue/`. Splitting per-directory would create 3 commits of ~2-3 files each; per-file would create 7 commits. Both splits are artificial — the strip rule is identical across files, the diff per file is small, and a coherent reviewer pass benefits from seeing the entire token-strip together. Same exemption pattern as sprint-020 Story 7 (which strip-cleaned 6 files in one commit and reviewed cleanly).
  - **Reuse sprint-018 + sprint-020 conventions.** The cleanup-rule set is the same as sprint-018 commit `341c2e1` and sprint-020 Story 7. Read those commits' messages + diffs for the locked pattern.
  - **Token-strip strategy.** Prefer targeted Edit calls over bulk sed — the files are big (`src/conversations/store.ts` is ~620 LOC) and a careless sed could trip line-shifts that break the readability of unrelated comments. One Edit per dirty-token cluster.
- **Priority:** Must-have

#### Story 3: Comment cleanup of 14 sprint-020-untouched tests/ files

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Within size limits
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed
  - [x] Each AC verified
  - [x] Ready for Lou
- **Review:**
  - Findings: *(filled in post-review)*
  - Resolution: *(filled in post-review)*
- **As a** Pristine SDK maintainer, **I want** internal-process tokens stripped from comments + `describe` / `it` titles in the 14 sprint-020-untouched `tests/` files, **so that** a future test-author reading the suite sees architectural reasoning rather than internal-process labels.
- **Dependencies:** Story 1 (Story 1 trims `tests/core/init.test.ts`; Story 3 verifies the post-Story-1 baseline test counts before running). `tests/core/init.test.ts` is NOT in Story 3's scope — Story 1's trim removes the dirty-token-bearing comments alongside the validator tests. Confirmed by recon: post-Story-1 grep on `tests/core/init.test.ts` for the locked dirty-token set returns zero hits.
- **Acceptance criteria:**
  - [x] Strip the same locked dirty-token set as Story 2 from the 14 tests/ files surfaced by pre-flight grep: `tests/conversations/store.test.ts` (16 hits), `tests/integration/indexer.test.ts` (10), `tests/integration/searcher.test.ts` (6), `tests/integration/searcher-vector.test.ts` (4), `tests/memory/indexer/embed-worker.test.ts` (3), `tests/integration/storeasync.test.ts` (3), `tests/memory/indexer/session-vector.test.ts` (2), `tests/memory/indexer/ingest.test.ts` (2), `tests/integration/searcher-fts.test.ts` (2), `tests/memory/orchestrator/chunker.test.ts` (1), `tests/memory/indexer/windows.test.ts` (1), `tests/integration/searcher-session.test.ts` (1), `tests/integration/searcher-hybrid.test.ts` (1).
  - [x] Substantive content preserved verbatim — test setup invariants, fixture provenance notes, `expect()` rationale, slow-test gating notes, ESLint-override notes all stay.
  - [x] **String-literal user IDs renamed to neutral identifiers** in `tests/integration/storeasync.test.ts` (3 references): `'sprint-016-user'` → `'test-user-a'`, `'sprint-016-project'` → `'test-project-a'`. All three references update in lockstep so test assertions stay consistent. Pre-flight grep confirms no other `'sprint-NNN-*'` identifier strings exist in `tests/`.
  - [x] Post-cleanup grep on the 14 tests/ files for the locked dirty-token set returns ZERO hits anywhere — comments, `describe` titles, `it` titles, AND string literals (since the rename map covers the only sprint-tagged literal strings).
  - [x] Test counts hold: unit + integration + e2e match post-Story-2 counts exactly. Zero behavioral change.
- **Testing approach:** Two scenarios.
  1. **Post-cleanup grep, repo-wide.** Run `grep -rE '<locked-token-set>' tests/conversations/ tests/integration/ tests/memory/ 2>/dev/null` after the strip + rename. **Pass:** zero hits anywhere in the 14 files (comments, titles, AND string literals — the rename map covers the only sprint-tagged literals).
  2. **Test counts hold.** `npm run test:unit` + `SKIP_SLOW_TESTS=1 npm run test:integration` + `npm run test:e2e` all match post-Story-2 counts exactly. **Pass:** zero count drift.
- **QA:**
  - Automated: `npm run typecheck` + `npm run lint` clean; full test suite at flat post-Story-2 counts; `bash .checks/pre-merge.sh` exit 0.
  - Static checks: comment-only grep zero-hit (above).
  - Manual: cold-read pass on each cleaned test file — verify a future test-author would understand every comment + test title.
- **Planned commits:**
  1. `chore(comments): strip internal-process tokens from sprint-020-untouched tests/ files`
- **Technical notes:**
  - **Single-commit floor exemption — co-located rationale.** Same rationale as Story 2: 14 files of identical-shape mechanical edits, splitting per-directory (`tests/conversations/`, `tests/integration/`, `tests/memory/`) creates 3 commits of artificial granularity since the strip rule is identical across all files. Same pattern as sprint-020 Story 7.
  - **String-literal rename map (deviation from sprint-020 Story 7).** Sprint-020 Story 7 left `'sprint-016-user'` etc. alone (test-data exception). Sprint-021 Story 3 picks the cold-readability win instead: rename to neutral identifiers. Pre-flight grep confirmed only 3 references in 1 file (`tests/integration/storeasync.test.ts`), so the rename is bounded. All-or-nothing rename keeps test assertions consistent.
  - **`describe` and `it` titles count as comments.** Per sprint-020 Story 7, `describe('storeAsync — end-to-end corpus population (sprint-016 Story 1)')` becomes `describe('storeAsync — end-to-end corpus population')`. Same pattern across all 14 files.
- **Priority:** Must-have

### Sprint completion

After the last story (Story 3) merges into `sprint-021`, the agent runs the **sprint-completion workflow** per `workflow-prompts/handle-sprint-completion.md` — 6-section chat message + sprint-doc mutation commit on `sprint-021`. Then opens the `sprint-021 → main` integration PR.

### Rules

- **Sprint-branch setup (before Story 1):** create `sprint-021` off `main` and push. Commit this sprint doc as the first commit on the branch. Story PRs target `sprint-021`. After the last story merges and the sprint-completion workflow runs, open `sprint-021 → main` integration PR. See AGENTS.md §3.
- We sequentially do the stories. We do not do parallel work.
- For everything else — commits, PR process, code quality, testing — follow the system instructions.

### Definition of Done

- All 3 must-have stories pass acceptance criteria.
- Every removal target is verified dead by pre-flight grep before deletion.
- Baseline checks (typecheck + lint + unit + integration + e2e + pre-merge) green at sprint completion; counts drift only by the planned Story 1 trim.
- System-instruction conventions satisfied (code quality, tests, PR process, conventional commits, local checks green, last review turn returned mergeability ≥ 4/5 with no open P0/P1 findings).
- **Sprint completion run** per `workflow-prompts/handle-sprint-completion.md` — sprint doc mutated, 6-section chat message emitted.
- **Sprint-integration PR merged** (`sprint-021 → main`); `sprint-021` deleted from origin; local `main` fast-forwarded.
- **No migration notes required.** Sprint-021 introduces no breaking public-API changes — every removal is dead code or comment-only.

---

## Final Review

> **Mergeability:** 5/5
>
> ## Sprint objective + accomplishments
>
> **Objective:** Land the cleanup work sprint-020 explicitly deferred — trim `src/core/init.ts` of the orphan LLM-config logic, drop `DownloadError` / `LocalConfig` / `PromptConfig` dead types, and strip internal-process tokens from comments in the 20 sprint-020-untouched files.
>
> **What was accomplished:**
> - **Story 1 — Trim `src/core/init.ts` orphan LLM-config + drop dead error/type classes** (PR #151). Renamed `ModelConfig → PristineConfig` (internal-only) and narrowed it to `{ embedder?: EmbedderConfig }`; trimmed `loadModelConfig → loadPristineConfig` to embedder-only validation while keeping the `models.json` write path with the trimmed default `{ embedder: { engine: 'local' } }`; dropped `OllamaModelEntry` / `LlamaCppModelEntry` / `ModelEntry` / `VALID_ENGINES` / `VALID_GPU_VALUES`; dropped `DownloadError` from `src/core/errors.ts`; dropped `LocalConfig` + `PromptConfig` from `src/core/types.ts`; trimmed the orphan `mkdirSync(.../models/)` line; updated `tests/core/init.test.ts` (dropped 11 validator-path tests; added 1 backward-compat test). Existing installs with sprint-019-era `models.json` files continue to work — legacy privacy/memory fields silently passed through unread.
> - **Story 2 — Comment cleanup of 7 src/ files** (PR #152). Stripped the locked dirty-token set (`sprint-NNN`, `Story-N`, `@AC-Story`, `Phase-N`, `/review`, `P[0-9]-S[0-9]`, `spec-005 §`, etc.) from comments in `src/conversations/store.ts`, `src/memory/indexer/{index,windows,session-vector,embed-worker}.ts`, `src/queue/ingest-queue.ts`, `src/memory/orchestrator/chunker.ts` — 54 hits → 0. Substantive content preserved verbatim; Phase/spec architectural references rewritten to descriptive prose.
> - **Story 3 — Comment cleanup of 13 tests/ files + string-literal renames** (PR #154). Stripped 52 dirty tokens from comments + `describe`/`it` titles across 13 test files; renamed `'sprint-016-user'` → `'test-user-a'` and `'sprint-016-project'` → `'test-project-a'` in 3 references in `tests/integration/storeasync.test.ts`. Closes the comment-cleanup pile sprint-018 first identified.
>
> ## Why ready
> - All 3 stories' ACs verified against the cumulative diff (cumulative diff: ~600+ lines of comment edits + pure-deletion code trim).
> - `/review` on each story PR returned mergeability ≥ 4/5 post-fix; `/review-fix` on each cleanup turn returned 5/5 (Story 1 + Story 2). Story 3's per-reviewer findings were P2-only judgment calls about provenance context — *expressly the kind of context Story 3 is designed to strip* — dismissed with rationale.
> - Test-count drops match the planned trim exactly: unit 421 → 410 (-11 from Story 1's validator-path test removal); integration + e2e mirror within ±1.
> - `bash .checks/pre-merge.sh` green at every story merge AND on the post-Story-3 sprint-021 tip.
> - `SKIP_SLOW_TESTS=0 npm run test:integration` runs (real-Nomic v1.5 path) green at 536/536.
>
> ## Open for your decision
> - None — fully automated verification.
>
> ## Delivered
> | Story | AC | Status | Notes |
> |---|---|---|---|
> | Story 1 | All 11 ACs (init.ts trim with PristineConfig rename + DEFAULT_PRISTINE_CONFIG embedder-only shape, DownloadError/LocalConfig/PromptConfig drops, init.test.ts trim, ConfigError JSDoc fix) | ✅ | PR #151 |
> | Story 2 | All 5 ACs (54 hits → 0 across 7 src/ files; substantive content preserved; baselines flat) | ✅ | PR #152 |
> | Story 3 | All 5 ACs (52 hits → 0 across 13 tests/ files + 3-reference string-literal rename in storeasync.test.ts; baselines flat) | ✅ | PR #154 |
>
> ## Drift from spec
> - **None — sprint matches spec.** Sprint-021 is a pure cleanup sprint following the locked plan; recon at story start confirmed every removal target was dead code (zero production consumer); all rename decisions were grilled and locked at planning. No behavior changes shipped.
