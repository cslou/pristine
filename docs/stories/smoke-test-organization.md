# Pristine — Story: Organize smoke tests as a first-class regression suite

**Date:** 2026-05-07
**Type:** Test / Cleanup
**Status:** 🟡 Planning
**Target branch:** main
**Working branch:** test/organize-smoke-suite
**Related issue/spec/sprint/PR:** `docs/stories/regression-command-contract.md`

---

## Handoff

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript strict ESM, Node/npm, Vitest, `better-sqlite3`, `sqlite-vec`, `@huggingface/transformers`.
- **Current state:** Smoke-like coverage is scattered. `tests/e2e/phase1-smoke.test.ts` verifies public API boot/import/store behavior. `tests/e2e/privacy-pipeline.test.ts` verifies deterministic privacy end-to-end behavior. `scripts/smoke-indexer.ts` is a manual real-Nomic smoke for the public `storeAsync` → embed-worker → searcher path. Some integration tests include inline smoke cases. No `test:smoke` script or `tests/smoke/` suite exists.
- **Problem/current behavior:** Agents cannot quickly distinguish critical fast smoke checks from broader e2e/integration coverage. The future regression contract can report `E2E / smoke`, but the repo does not yet expose a clean smoke command or directory convention.
- **Expected behavior/outcome:** Smoke tests are organized as a small, fast, deterministic suite with a dedicated npm command, while slower real-model smoke remains explicit/full-tier. The resulting structure makes the regression tier map easy to understand.

## Story

**As a** maintainer, **I want** smoke tests organized as a first-class deterministic suite, **so that** pre-merge verification can prove the critical product paths without mixing fast smoke with broader or real-model checks.

- **Scope:** Add a `tests/smoke/` suite and `npm run test:smoke`; move or wrap existing smoke-like tests without weakening assertions; decide whether the real-model indexer smoke stays as a full-tier script or gets a deterministic Vitest counterpart.
- **Non-goals:** Do not rewrite product code, remove existing behavior coverage, add new external services, add paid/prod-adjacent checks, or fold all smoke tests into one large file.

## Story Checklist

(MUST BE CHECKED OFF BEFORE STARTING WORK)

- [ ] Uses this standalone story template
- [ ] Scope fits one independently reviewable PR and does not require a full sprint
- [ ] Acceptance criteria are specific and testable
- [ ] Functional verification items are concrete and have pass/fail conditions
- [ ] Regression verification items are concrete and have pass/fail conditions
- [ ] Affected flows are declared, or explicitly marked as none
- [ ] Non-goals are declared
- [ ] Ready for implementation

## Affected Flows

- **Existing flows affected:** Test discovery/configuration; e2e/smoke verification commands; regression tier command mapping if `docs/stories/regression-command-contract.md` has already landed.
- **New flows introduced:** Dedicated deterministic smoke command: `npm run test:smoke`.

## Acceptance Criteria

- [ ] A `tests/smoke/` directory exists with smoke tests named `*.smoke.test.ts`. **Pass condition:** the files are discoverable by the new smoke Vitest config and are excluded from unit/integration/e2e configs unless intentionally included by tier command.
- [ ] `npm run test:smoke` exists and runs the deterministic smoke suite. **Pass condition:** the command exits `0` and reports the smoke files/cases.
- [ ] The public API smoke currently in `tests/e2e/phase1-smoke.test.ts` is moved to `tests/smoke/public-api.smoke.test.ts` or otherwise made part of `test:smoke` without weakening assertions. **Pass condition:** create/import/store/scrub/public-barrel assertions still run and pass.
- [ ] The privacy pipeline smoke is classified explicitly as either deterministic smoke or broader e2e. **Pass condition:** if moved to smoke, `npm run test:smoke` runs it; if left in e2e, README/package guidance explains why.
- [ ] `scripts/smoke-indexer.ts` is classified explicitly as full-tier real-model smoke or replaced/augmented by a deterministic Vitest smoke. **Pass condition:** no current indexer smoke coverage silently disappears; real-Nomic behavior remains available through an explicit full-tier command or script.
- [ ] Package/test config names make the tier split obvious. **Pass condition:** `package.json` and Vitest configs document or encode `unit`, `smoke`, `integration`, and `e2e` boundaries.
- [ ] No smoke test requires paid APIs, production/staging services, or manual TUI interaction.

## Implementation Plan

- **Touched modules/files:** `package.json`, new `vitest.smoke.config.ts`, existing Vitest configs if needed, `tests/e2e/phase1-smoke.test.ts`, `tests/e2e/privacy-pipeline.test.ts` if moved, optional new `tests/smoke/indexer.smoke.test.ts`, optional README Development section, optional `.checks/regression.sh` if the regression-contract story has already landed.
- **Approach:** Add a smoke Vitest config with `include: ['tests/smoke/**/*.smoke.test.ts']`. Move the public API smoke first because it is already fast/offline. Evaluate privacy pipeline runtime; keep it in e2e if it is too broad/slow for smoke, otherwise move it with the same assertions. Keep `scripts/smoke-indexer.ts` as explicit full-tier real-Nomic smoke unless a deterministic stubbed Vitest smoke can cover the critical indexer path without model cost.
- **Risks/rollback:** Medium-low risk / normal git revert. Main risks are accidental double-running, accidentally excluding moved tests from all suites, or weakening smoke assertions during file moves. Mitigate with explicit `npm run test:smoke`, `npm run test:e2e`, and `npm run test:unit` verification.
- **New dependencies:** None.
- **Planned commits:**
  1. `test: add smoke test suite command` — add `vitest.smoke.config.ts`, `test:smoke`, and move public API smoke.
  2. `test: classify remaining smoke coverage` — move or document privacy/indexer smoke placement and update regression/docs references.

## Verification Plan

This story follows verifiability-first engineering: define how the new or changed behavior will be proven correct and which existing behavior it could regress before implementation starts.

- **Functional verification:**
  - [ ] `npm run test:smoke` exits `0`. **Pass condition:** Vitest reports the expected smoke files/cases and no failures.
  - [ ] `npx vitest run --passWithNoTests --config vitest.smoke.config.ts` exits `0`. **Pass condition:** direct config invocation matches the package script.
  - [ ] Vitest discovery boundaries are recorded for `unit`, `smoke`, `integration`, and `e2e` configs. **Pass condition:** command output or reporter evidence shows `*.smoke.test.ts` files are included by the smoke config and excluded from other configs unless the story intentionally documents overlap.
  - [ ] If an indexer Vitest smoke is added, it proves `storeAsync` → drain worker/indexer/searcher behavior with a deterministic embedder. **Pass condition:** assertions cover populated rows and/or search hits without real model loading.
  - [ ] If `scripts/smoke-indexer.ts` remains full-tier only, `npx tsx scripts/smoke-indexer.ts` is documented as full-tier real-model smoke. **Pass condition:** the script remains runnable and is not hidden inside quick/standard/deep by default.
- **Regression verification:**
  - [ ] `npm run test:unit` exits `0`. **Pass condition:** moving smoke files does not affect unit discovery unexpectedly.
  - [ ] `SKIP_SLOW_TESTS=1 npm run test:integration` exits `0`. **Pass condition:** deterministic integration coverage remains intact.
  - [ ] `npm run test:e2e` exits `0`. **Pass condition:** e2e coverage either still includes remaining e2e files or intentionally excludes moved smoke files with replacement coverage in `test:smoke`.
  - [ ] If `.checks/regression.sh` already exists, `.checks/regression.sh --tier=deep` exits `0` and includes `npm run test:smoke`. **Pass condition:** deep-tier report lists smoke coverage under `E2E / smoke`.
- **Manual-only verification:** N/A — test organization should be fully automated. Pi TUI/repo-local install smoke remains separate manual/reference verification unless a later story automates it safely.

## Completion Evidence

(Fill this in before marking the story `🟢 Complete`.)

- **PR:** TBD
- **Commits:** TBD
- **Acceptance criteria evidence:** TBD
- **Functional verification evidence:** TBD
- **Regression verification evidence:** TBD
- **Manual-only verification evidence:** N/A
- **Failed, ambiguous, or unrun verification:** TBD
- **Review evidence:** TBD
- **New dependencies:** None expected

## Rules

- Use this template for work small enough to complete, verify, review, and merge as one PR.
- If the work needs multiple independently mergeable stories, shared sprint-wide context, or final sprint verification, create a sprint with `templates/sprint.md` instead.
- Follow the git, PR, review, and merge gates from `AGENTS.md`.
- PRs for standalone stories target the repo default branch unless the story is part of an active sprint branch.
- Each acceptance criterion and verification item must include a concrete pass/fail condition.
- Prefer automated verification. Use manual-only verification only when automation is not practical, and record reproducible steps.
- Mark `Status` as `🟢 Complete` only after acceptance criteria and verification evidence are recorded.

## Definition of Done

- Acceptance criteria are met.
- Functional verification evidence proves the new or changed behavior works.
- Targeted regression verification evidence proves relevant existing behavior still works.
- Failed, ambiguous, manual-only, or unrun verification items are documented.
- Completion Evidence is filled in.
- New dependencies are recorded, or `None` is recorded.
- No secrets, debug artifacts, or unrelated changes are included.
