# Pristine — Story: Harden provider-prefix classification policy

**Date:** 2026-05-20
**Type:** Fix
**Status:** 🟡 Planning
**Target branch:** sprint-30-and-31
**Working branch:** fix/provider-prefix-classification-policy
**Related issue/spec/sprint/PR:** `docs/sprints/sprint-031.md`, PR #269

---

## Handoff

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript, ESM, Vitest, privacy classifier primitives
- **Current state:** `detect` identifies known provider-prefix candidates such as OpenAI `sk-proj-...`, and `classify` accepts callback decisions from sanitized context. Manual smoke planning found that fake/test/example wording can make a model classifier too permissive for provider-looking secrets.
- **Problem/current behavior:** A classifier callback can mark a strong known-provider prefix candidate as `not_secret` solely because surrounding sanitized text says fake, test, example, or API-key. Prompt wording alone is not a sufficient safety guardrail.
- **Expected behavior/outcome:** Strong known-provider prefix candidates cannot pass through as `not_secret` based solely on fake/test/example wording; SDK classification enforces a conservative code-level override to `uncertain` or `secret`.

## Story

**As a** privacy SDK maintainer, **I want** provider-prefix candidates handled conservatively in code, **so that** provider-looking secrets are not accidentally allowed into model context because of casual fake/test/example wording.

- **Scope:** Add code-level classification normalization for strong provider-prefix candidates and regression tests for fake/test/example OpenAI-style token wording.
- **Non-goals:** No broad safe diagnostic reason-code system, no vault metadata semantics changes, no detector rule expansion beyond what is needed for known provider-prefix handling, no prompt-only solution. Minimal raw-free classifier rationale/metadata for this override is in scope only if needed to explain the conservative decision.

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

- **Existing flows affected:** `detect` → `classify` privacy primitive flow, Pi privacy-input policy decisions that depend on `classify`, fake/test/example manual smoke prompts with provider-looking tokens.
- **New flows introduced:** None — existing classification flow becomes more conservative for strong provider-prefix candidates.

## Acceptance Criteria

- [ ] `classify` post-processing detects strong provider-prefix candidates using raw-value-free detector metadata. Strong provider-prefix means candidates already identified by detector metadata as known provider prefixes, such as `kind: "known_provider_prefix"` or known-provider signals/prefix-family metadata; generic API-key wording alone must not trigger the override. Pass condition: tests show the override works from sanitized candidate metadata without inspecting/logging raw candidate values.
- [ ] If a classifier callback returns `not_secret` for a strong provider-prefix candidate, the final `ClassifyDecision` is normalized to `uncertain` with a safe rationale/metadata, or to `secret` if implementation chooses a stricter policy. Pass condition: tests assert final verdict is never `not_secret` for strong provider-prefix fixtures.
- [ ] Regression coverage exists for these exact synthetic fixtures: `My fake API key is sk-proj-abcdefghijklmnopqrstuvwxyz123456`, `My fake API-key is sk-proj-abcdefghijklmnopqrstuvwxyz123456`, `My test API key is sk-proj-abcdefghijklmnopqrstuvwxyz123456`, and `My example OpenAI token is sk-proj-abcdefghijklmnopqrstuvwxyz123456`. Pass condition: each produces `secret` or `uncertain`, never `not_secret`.
- [ ] Synthetic test fixtures may contain provider-looking fake values, but emitted diagnostics/details must not echo candidate-derived prefixes/suffixes or raw values. Pass condition: serialized decisions/details for provider-prefix override do not contain the fake `sk-proj-...` value.
- [ ] Existing non-provider-prefix `not_secret` decisions still pass through when safe. Pass condition: a non-provider candidate callback returning `not_secret` remains `not_secret` in regression tests.

## Implementation Plan

- **Touched modules/files:** `src/privacy/classifier/index.ts`, `tests/privacy/classify.test.ts`, possibly `docs/pages/privacy*.mdx` or `examples/pi-dev/extensions/privacy-input/README.md` if behavior needs public explanation.
- **Approach:** Add a small helper in the classifier module that identifies strong provider-prefix metadata and normalizes unsafe `not_secret` decisions to `uncertain` with raw-free rationale. Enforce this after callback validation so all classifier transports benefit. Keep implementation metadata-driven and avoid raw value inspection beyond existing sanitized request construction. This story may add minimal raw-free rationale for the override, but it does not introduce the broader diagnostics system from Story 003.
- **Risks/rollback:** Medium risk because it changes classifier outcomes for provider-looking fixtures. Roll back with normal git revert. The expected tradeoff is acceptable false positives for provider-looking fake/test strings in privacy-input contexts.
- **New dependencies:** None
- **Planned commits:**
  1. `fix: guard provider prefix classifier decisions` — classification override helper and provider-prefix regression tests.

## Verification Plan

This story follows verifiability-first engineering: define how the new or changed behavior will be proven correct and which existing behavior it could regress before implementation starts.

- **Functional verification:**
  - [ ] Run `pnpm run test:unit -- tests/privacy/classify.test.ts -t "provider-prefix"`; pass condition: fake/test/example `sk-proj-...` cases are `secret` or `uncertain`, never `not_secret`.
  - [ ] Run a targeted no-raw-leak assertion in `tests/privacy/classify.test.ts`; pass condition: serialized override decisions/details do not include the raw fake token.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/privacy/classify.test.ts`; pass condition: all classifier primitive tests pass, including existing non-provider `not_secret` behavior.
  - [ ] Run `pnpm run test:unit -- tests/examples/pi-dev/privacy-input-extension.test.ts tests/examples/pi-dev/privacy-input-classifier-adapter.test.ts`; pass condition: Pi privacy-input behavior remains green with the stricter provider-prefix policy.
  - [ ] Run `pnpm run lint && pnpm run typecheck`; pass condition: lint and TypeScript checks pass without errors.
- **Manual-only verification:** N/A — automated classifier and Pi runtime tests cover the provider-prefix policy. Real Pi smoke can be rerun during final integration verification if this change affects manual smoke behavior.

## Completion Evidence

(Fill this in before marking the story `🟢 Complete`.)

- **PR:** Pending
- **Commits:** Pending
- **Acceptance criteria evidence:** Pending
- **Functional verification evidence:** Pending
- **Regression verification evidence:** Pending
- **Manual-only verification evidence:** N/A
- **Failed, ambiguous, or unrun verification:** Pending
- **Review evidence:** Pending `/review`
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
