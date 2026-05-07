# Pristine — Story: Migrate local checks to the regression command contract

**Date:** 2026-05-07
**Type:** Tooling
**Status:** 🟡 Planning
**Target branch:** main
**Working branch:** chore/regression-command-contract
**Related issue/spec/sprint/PR:** `~/projects/harness-config/docs/verifications/regression-command-contract.md`

---

## Handoff

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript strict ESM, Node/npm, Vitest, ESLint, `better-sqlite3`, `sqlite-vec`, `@huggingface/transformers`.
- **Current state:** Local check wrappers exist in `.checks/pre-commit.sh`, `.checks/pre-push.sh`, and `.checks/pre-merge.sh`. They duplicate command lists instead of delegating to one canonical regression command. Current wrappers run lint/typecheck for pre-commit, lint/typecheck/unit for pre-push, and lint/typecheck/unit for pre-merge. Package scripts expose unit, integration, e2e, build, and all-test commands.
- **Problem/current behavior:** The repo does not yet implement the harness regression command contract: `.checks/regression.sh --tier=quick|standard|deep|full|routine`. Agents must infer tiers from separate wrapper scripts and comments, and pre-merge currently has the same coverage as pre-push.
- **Expected behavior/outcome:** The repo exposes `.checks/regression.sh` as the canonical local verification entrypoint with clear tier behavior, text reporting, and wrapper delegation. Existing hook coverage is preserved or strengthened, with no paid/prod-adjacent checks running implicitly.

## Story

**As a** maintainer, **I want** one canonical regression verification command with tiered local checks, **so that** agents can run quick, standard, deep, full, and routine verification consistently without duplicating command lists.

- **Scope:** Add `.checks/regression.sh`, map existing wrappers to contract tiers, and document the tier commands.
- **Non-goals:** Do not reorganize test files, add new tests, add paid/prod-adjacent checks, add JSON output unless it is trivial, or implement routine maintenance checks beyond reporting that none are configured.

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

- **Existing flows affected:** Local verification commands; git hook wrappers; agent pre-commit, pre-push, and pre-merge workflows; README Development verification guidance if updated.
- **New flows introduced:** Direct regression contract command: `.checks/regression.sh --tier=quick|standard|deep|full|routine`.

## Acceptance Criteria

- [ ] `.checks/regression.sh` exists, is executable, accepts `--tier=quick|standard|deep|full|routine`, exits `2` for invalid usage/tier, and prints a readable contract-style report with status, tier, duration, command evidence, skipped/not-configured items, and next action.
- [ ] `quick` runs `npm run lint` and `npm run typecheck`. **Pass condition:** `.checks/regression.sh --tier=quick` exits `0` when those commands pass and exits non-zero if either command fails.
- [ ] `standard` includes quick coverage and runs `npm run test:unit`. **Pass condition:** `.checks/regression.sh --tier=standard` exits `0` after lint, typecheck, and unit tests pass.
- [ ] `deep` includes standard coverage and adds `npm run build`, `SKIP_SLOW_TESTS=1 npm run test:integration`, and `npm run test:e2e`. **Pass condition:** `.checks/regression.sh --tier=deep` exits `0` after all deterministic local pre-merge checks pass.
- [ ] `full` includes deep coverage and runs real-model integration coverage without `SKIP_SLOW_TESTS=1`, plus the existing real-model smoke script if retained (`npx tsx scripts/smoke-indexer.ts`). **Pass condition:** `.checks/regression.sh --tier=full` documents any first-run model-download/local-model cost and exits `0` only when full checks pass.
- [ ] `routine` is implemented as intentionally empty for now. **Pass condition:** `.checks/regression.sh --tier=routine` reports `Routine checks: none configured` and exits `0` without claiming hidden coverage.
- [ ] `.checks/pre-commit.sh`, `.checks/pre-push.sh`, and `.checks/pre-merge.sh` become thin wrappers: pre-commit → quick, pre-push → standard, pre-merge → deep.
- [ ] No paid, production, staging, destructive, or manual-only checks run from quick/standard/deep by default.

## Implementation Plan

- **Touched modules/files:** `.checks/regression.sh`, `.checks/pre-commit.sh`, `.checks/pre-push.sh`, `.checks/pre-merge.sh`, optionally `README.md` Development commands.
- **Approach:** Implement a Bash script with strict mode, tier parsing, small helper functions for timing and command execution, and a text report matching the harness contract closely enough for agents. Keep command definitions centralized in `regression.sh`; wrappers only delegate. Use `SKIP_SLOW_TESTS=1` in `deep` to keep real Nomic/Hugging Face model checks out of the default pre-merge gate.
- **Risks/rollback:** Low risk / normal git revert. Main risk is accidentally weakening existing hook coverage; prevent by mapping quick and standard exactly to current pre-commit/pre-push behavior and strengthening pre-merge to deep.
- **New dependencies:** None.
- **Planned commits:**
  1. `chore: add regression verification entrypoint` — add `.checks/regression.sh` with tier command mapping and text report.
  2. `chore: delegate local check wrappers to regression tiers` — update wrapper scripts and README guidance if needed.

## Verification Plan

This story follows verifiability-first engineering: define how the new or changed behavior will be proven correct and which existing behavior it could regress before implementation starts.

- **Functional verification:**
  - [ ] `bash -n .checks/regression.sh .checks/pre-commit.sh .checks/pre-push.sh .checks/pre-merge.sh` exits `0`. **Pass condition:** all scripts parse successfully.
  - [ ] `.checks/regression.sh --tier=quick` exits `0` and report shows lint + typecheck ran.
  - [ ] `.checks/regression.sh --tier=standard` exits `0` and report shows lint + typecheck + unit tests ran.
  - [ ] `.checks/regression.sh --tier=deep` exits `0` and report shows lint + typecheck + unit + build + `SKIP_SLOW_TESTS=1` integration + e2e ran.
  - [ ] `.checks/regression.sh --tier=full` exits `0` and report shows deep coverage plus full real-model integration/smoke coverage ran, including documented first-run local model-download cost where applicable.
  - [ ] `.checks/regression.sh --tier=routine` exits `0` and report explicitly says no routine checks are configured.
  - [ ] `.checks/regression.sh --tier=not-a-tier` exits `2`. **Pass condition:** invalid usage is visibly rejected.
- **Regression verification:**
  - [ ] `.checks/pre-commit.sh` exits `0` and delegates to quick. **Pass condition:** wrapper output/evidence shows lint + typecheck still run.
  - [ ] `.checks/pre-push.sh` exits `0` and delegates to standard. **Pass condition:** wrapper output/evidence shows lint + typecheck + unit tests still run.
  - [ ] `.checks/pre-merge.sh` exits `0` and delegates to deep. **Pass condition:** wrapper output/evidence shows pre-merge coverage is not weaker than before and includes deterministic integration/e2e/build.
  - [ ] `npm run test:unit` exits `0`. **Pass condition:** existing unit coverage still passes after wrapper changes.
- **Manual-only verification:** N/A — all behavior should be automated via shell commands.

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
