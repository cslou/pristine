# Pristine — Story: Clarify vault sensitive type and alias semantics

**Date:** 2026-05-20
**Type:** Docs / Test
**Status:** 🟢 Complete
**Target branch:** sprint-30-and-31
**Working branch:** docs/vault-type-alias-semantics
**Related issue/spec/sprint/PR:** `docs/sprints/sprint-031.md`, PR #269

---

## Handoff

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript, ESM, Vitest, SQLite privacy vault, Vocs docs
- **Current state:** Redaction stores canonical sensitive types such as `api_key` in vault metadata, and aliases are visible metadata. Manual hardening review identified that richer classifier labels like `OpenAI API key` must not replace canonical machine type semantics.
- **Problem/current behavior:** The intended distinction between canonical machine `sensitiveType`/redaction `type` and visible display metadata (`label`/`alias`) is present in code but should be explicitly documented and covered by focused tests before open source release.
- **Expected behavior/outcome:** Docs and tests clearly state and prove that canonical `sensitiveType` remains machine-readable (for example `api_key`), classifier-provided richer labels remain safe redaction `label` metadata, caller-managed display aliases remain vault `alias` metadata, and display guidance prefers `alias ?? label` without overwriting canonical type.
- **Branch context:** This standalone story is part of pre-integration hardening for the active combined `sprint-30-and-31` branch and PR #269, so its PR targets `sprint-30-and-31` rather than the repo default branch.

## Story

**As a** privacy SDK consumer, **I want** vault type and alias semantics to be explicit, **so that** applications do not store free-text display labels as canonical sensitive types.

- **Scope:** Add/adjust docs and focused tests that clarify and verify canonical `sensitiveType` versus visible `label`/`alias` behavior; make only minimal implementation fixes if those tests expose a mismatch.
- **Non-goals:** No classifier diagnostics work, no provider-prefix policy work, no vault schema migration unless tests reveal an existing bug, no UI implementation beyond documented display guidance.

## Story Checklist

(MUST BE CHECKED OFF BEFORE STARTING WORK)

- [x] Uses this standalone story template
- [x] Scope fits one independently reviewable PR and does not require a full sprint
- [x] Acceptance criteria are specific and testable
- [x] Functional verification items are concrete and have pass/fail conditions
- [x] Regression verification items are concrete and have pass/fail conditions
- [x] Affected flows are declared, or explicitly marked as none
- [x] Non-goals are declared
- [x] Ready for implementation

## Affected Flows

If this story affects product, agent, developer, maintainer, CLI, API, or operational flows, list them. If it does not affect runtime/workflow behavior, declare that explicitly.

- **Existing flows affected:** `redact` vault metadata writes, `listSensitive`/`getSensitive` metadata reads, `updateSensitive` alias updates, docs for privacy metadata display.
- **New flows introduced:** None — this story documents and tests existing intended metadata semantics.

## Acceptance Criteria

- [x] Tests prove a redaction with canonical type `api_key` and classifier/display label `OpenAI API key` returns redaction `type: "api_key"`, preserves the classifier text as redaction `label: "OpenAI API key"`, and stores/lists/gets vault `sensitiveType: "api_key"`. Pass condition: assertions fail if canonical type is replaced by `OpenAI API key` or if the safe label is lost from the redaction result.
- [x] Tests prove updating `alias` changes visible metadata without changing canonical `sensitiveType`. Pass condition: after `updateSensitive(..., { alias: "OpenAI API key" })`, `getSensitive`/`listSensitive` return `alias: "OpenAI API key"` and `sensitiveType: "api_key"`.
- [x] Public docs state that `sensitiveType` is the canonical machine type, classifier labels are visible metadata, aliases must never contain plaintext secrets, and display should prefer `alias ?? label` while preserving canonical type. Pass condition: separate `rg` checks find each exact concept: `canonical machine type`, `classifier labels`, `aliases must never contain plaintext secrets`, `alias ?? label`, and `sensitiveType` in `docs/pages examples/pi-dev`.
- [x] No code path introduced by this story stores raw plaintext secrets in alias/display metadata. Pass condition: existing safe-label/alias tests remain green and new tests use fake fixtures only.

## Implementation Plan

- **Touched modules/files:** `tests/integration/redact.test.ts`, `tests/integration/privacy.test.ts`, `tests/privacy/primitive-contracts.test.ts`, `docs/pages/privacy.mdx`, `docs/pages/privacy/secure-redact-reveal.mdx`, `docs/pages/api.mdx`, `examples/pi-dev/extensions/privacy-input/README.md` as needed.
- **Approach:** Prefer docs and focused tests over schema/code changes. If implementation already behaves correctly, add regression tests and docs only. If a mismatch is found, make the minimal code fix that preserves canonical type and alias separation. Keep this story on `sprint-30-and-31` because it is pre-integration hardening before PR #269 lands in `main`.
- **Risks/rollback:** Low risk / normal git revert. Main risk is wording drift; keep docs tied to asserted tests.
- **New dependencies:** None
- **Planned commits:**
  1. `docs: clarify vault type and alias semantics` — docs plus focused tests for canonical sensitive type and visible alias behavior.

## Verification Plan

This story follows verifiability-first engineering: define how the new or changed behavior will be proven correct and which existing behavior it could regress before implementation starts.

- **Functional verification:**
  - [x] Run targeted metadata tests; pass condition: canonical `sensitiveType` remains `api_key` while `alias` carries `OpenAI API key` display metadata.
  - [x] Run separate docs checks for `canonical machine type`, `classifier labels`, `aliases must never contain plaintext secrets`, `alias ?? label`, and `sensitiveType` in `docs/pages examples/pi-dev`; pass condition: each concept is present in updated public docs/examples.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/privacy/primitive-contracts.test.ts`; pass condition: primitive contract tests pass after metadata clarification.
  - [x] Run `pnpm run test:integration -- tests/integration/redact.test.ts tests/integration/privacy.test.ts`; pass condition: vault/redaction metadata integration tests pass.
  - [x] Run `pnpm run docs:build`; pass condition: public docs build successfully after metadata docs changes.
  - [x] Run `pnpm run lint && pnpm run typecheck`; pass condition: lint and TypeScript checks pass without errors.
- **Manual-only verification:** N/A — metadata semantics are covered by automated tests and docs build.

## Completion Evidence

(Fill this in before marking the story `🟢 Complete`.)

- **PR:** #273 (`docs: clarify vault type and alias semantics` targeting `sprint-30-and-31`)
- **Commits:** `9a9f379 docs: clarify vault type and alias semantics`
- **Acceptance criteria evidence:** Added focused integration coverage for `api_key` redaction type, `OpenAI API key` redaction label, vault `sensitiveType: "api_key"`, and caller-managed `alias` updates. Updated docs/API/example wording to distinguish canonical machine type from visible label/alias display metadata. Removed automatic redaction-label-to-vault-alias persistence and narrowed `RedactVaultStore` to the `addEntries` capability used by `redact`.
- **Functional verification evidence:** PASS — `pnpm run test:integration -- tests/integration/redact.test.ts tests/integration/privacy.test.ts`; PASS — `rg -F "canonical machine type" docs/pages examples/pi-dev`; PASS — `rg -F "classifier labels" docs/pages examples/pi-dev`; PASS — `rg -F "aliases must never contain plaintext secrets" docs/pages examples/pi-dev`; PASS — `rg -F "alias ?? label" docs/pages examples/pi-dev`; PASS — `rg -F "sensitiveType" docs/pages examples/pi-dev`.
- **Regression verification evidence:** PASS — `pnpm run test:unit -- tests/privacy/primitive-contracts.test.ts`; PASS — `pnpm run test:integration -- tests/integration/redact.test.ts tests/integration/privacy.test.ts`; PASS — `pnpm run docs:build`; PASS — `pnpm run lint`; PASS — `pnpm run typecheck`; PASS — push hook standard tier (`pnpm run lint`, `pnpm run typecheck`, `pnpm run test:unit`) with 38 unit files / 425 tests passing.
- **Manual-only verification evidence:** N/A
- **Failed, ambiguous, or unrun verification:** None
- **Review evidence:** `/review` for PR #273 initially returned 0 P0, 3 P1, and 1 P2; PR/body/story evidence and the `RedactVaultStore` interface were updated before `/review-fix`.
- **New dependencies:** None

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
