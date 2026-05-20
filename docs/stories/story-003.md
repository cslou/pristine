# Pristine — Story: Harden privacy-input classifier diagnostics and provider-prefix policy

**Date:** 2026-05-20
**Type:** Fix
**Status:** 🟡 Planning
**Target branch:** sprint-30-and-31
**Working branch:** fix/privacy-input-classifier-hardening
**Related issue/spec/sprint/PR:** `docs/sprints/sprint-031.md`, PR #269

---

## Handoff

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript, ESM, Vitest, Pi reference extensions, local SQLite privacy vault
- **Current state:** The Pi privacy-input path works end-to-end with `detect` → `classify` → `redact` → vault storage, and Story 6 added a Pi model classifier transport. Manual setup exposed that classification failures currently collapse into a generic safe notification, and model/provider-prefix wording can make strong provider-prefix fake/test fixtures too permissive.
- **Problem/current behavior:** Privacy-input classification remains fail-closed but is hard to diagnose safely, and strong known-provider prefix candidates such as `sk-proj-...` may be allowed as `not_secret` when surrounding text says fake/test/example.
- **Expected behavior/outcome:** Classification failures expose safe structured reason codes without raw values, strong provider-prefix candidates cannot pass through solely due to fake/test/example wording, and vault metadata semantics clearly preserve canonical machine `sensitiveType` separately from visible aliases/labels.

## Story

**As a** Pi privacy-input operator, **I want** safe classifier diagnostics and conservative provider-prefix handling, **so that** manual smoke failures are debuggable without leaking secrets and known provider-looking secrets are not accidentally allowed into model context.

- **Scope:** Add raw-secret-free classifier failure reason codes/details, enforce code-level provider-prefix conservative overrides, and clarify/test canonical `sensitiveType` versus visible `alias` metadata.
- **Non-goals:** No hosted service, no provider SDK beyond existing Pi model-layer dependency, no raw candidate logging, no tool-call reveal or tool-result scrub implementation, no broad privacy architecture rewrite.

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

- **Existing flows affected:** Privacy primitive `classify` callback validation; Pi `privacy-input` classifier adapter/transport/runtime failure handling; manual Pi smoke diagnostics; vault metadata docs/tests for sensitive type and alias display.
- **New flows introduced:** Safe structured privacy-input failure reason reporting for classifier/model/parser failures.

## Acceptance Criteria

- [ ] Privacy-input classifier/model/parser failures surface safe structured reason codes or details for model unavailable/auth failure, timeout/abort, malformed JSON, empty response, truncated response, missing candidate decisions, unknown candidate IDs, and duplicate candidate IDs. Pass condition: tests assert the reason code/detail is present and does not include raw candidate values, raw prefixes/suffixes, decoded payloads, URL passwords, query secret values, seed words, or vault plaintext.
- [ ] Fail-closed behavior is preserved for every classifier failure reason. Pass condition: runtime tests for each failure category return `{ action: "handled" }` or an equivalent blocking action and do not call `redact` unless policy explicitly redacts confirmed/uncertain safe decisions.
- [ ] Strong known-provider prefix candidates are not allowed as `not_secret` solely because surrounding sanitized context says fake, test, example, or uses `API-key`. Pass condition: regression tests for `My fake API key is sk-proj-...`, `My fake API-key is sk-proj-...`, `My test API key is sk-proj-...`, and `My example OpenAI token is sk-proj-...` produce `secret` or at minimum `uncertain`, never `not_secret`.
- [ ] Provider-prefix hardening is enforced in code, not only prompt wording. Pass condition: a classifier callback that returns `not_secret` for a strong provider-prefix candidate is normalized/overridden to `uncertain` or `secret` by SDK/runtime policy, with raw-value-free details.
- [ ] Vault metadata semantics are clear and tested: canonical machine type remains `sensitiveType`/redaction `type` such as `api_key`, classifier-provided richer label like `OpenAI API key` is visible metadata/alias, and display guidance prefers `alias ?? label` without replacing canonical type. Pass condition: docs/tests assert canonical type is not overwritten by free-text labels.

## Implementation Plan

- **Touched modules/files:** `src/privacy/classifier/index.ts`, `tests/privacy/classify.test.ts`, `examples/pi-dev/extensions/privacy-input/lib/classifier-adapter.ts`, `examples/pi-dev/extensions/privacy-input/lib/pi-model-classifier-transport.ts`, `examples/pi-dev/extensions/privacy-input/lib/runtime.ts`, `tests/examples/pi-dev/privacy-input-*.test.ts`, `src/privacy/redactor/index.ts` and/or vault tests/docs if metadata clarification needs coverage, `examples/pi-dev/extensions/privacy-input/README.md`, `docs/pages/privacy*.mdx` as needed.
- **Approach:** Add typed/safe error reason metadata close to classifier adapter/transport boundaries; keep user notifications generic enough for safety but make details testable. Add provider-prefix conservative post-processing in the SDK `classify` path so model prompt behavior is not the only guardrail. Clarify alias/type semantics in tests/docs without changing vault storage format unless a bug is found.
- **Risks/rollback:** Medium risk because classifier normalization affects privacy policy outcomes. Rollback with normal git revert. Main risk is over-redacting some fake/test provider-looking strings; this is acceptable for privacy-input safety and should be documented.
- **New dependencies:** None
- **Planned commits:**
  1. `fix: harden privacy classifier diagnostics` — safe structured failure reasons and fail-closed tests.
  2. `fix: guard provider prefix classifier decisions` — provider-prefix override logic and fake/test wording regressions.
  3. `docs: clarify sensitive type and alias semantics` — docs/tests for canonical type versus visible alias semantics.

## Verification Plan

This story follows verifiability-first engineering: define how the new or changed behavior will be proven correct and which existing behavior it could regress before implementation starts.

- **Functional verification:**
  - [ ] Run targeted tests for safe classifier failure reasons; pass condition: model unavailable/auth failure, timeout/abort, malformed JSON, empty response, truncated response, missing decision, unknown candidate, and duplicate candidate each produce an expected raw-value-free reason and fail closed.
  - [ ] Run targeted provider-prefix tests for fake/test/example wording around `sk-proj-...`; pass condition: each case returns `secret` or `uncertain`, never `not_secret`, even when a callback attempts `not_secret`.
  - [ ] Run targeted metadata tests/docs checks for `sensitiveType`, redaction `type`, `label`, and `alias`; pass condition: canonical machine type remains `api_key` while richer classifier/display text is represented as label/alias metadata.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/privacy/classify.test.ts tests/examples/pi-dev/privacy-input-classifier-adapter.test.ts tests/examples/pi-dev/privacy-input-extension.test.ts tests/examples/pi-dev/privacy-input-pi-model-transport.test.ts`; pass condition: privacy classifier and Pi privacy-input unit tests pass.
  - [ ] Run `pnpm run test:unit -- tests/integration/redact.test.ts tests/integration/privacy.test.ts`; pass condition: vault/redaction metadata behavior remains green.
  - [ ] Run `pnpm run build`; pass condition: package builds successfully after type/API changes.
  - [ ] Run `pnpm run lint && pnpm run typecheck`; pass condition: lint and TypeScript checks pass without errors.
- **Manual-only verification:** Optional real Pi smoke if automated coverage changes the manual smoke behavior; pass condition: fake API key is blocked or transformed before model context, classifier request is sanitized, and session history does not contain the raw fake key. If not rerun, document why automated coverage is sufficient.

## Completion Evidence

(Fill this in before marking the story `🟢 Complete`.)

- **PR:** Pending
- **Commits:** Pending
- **Acceptance criteria evidence:** Pending
- **Functional verification evidence:** Pending
- **Regression verification evidence:** Pending
- **Manual-only verification evidence:** Pending / N/A after implementation decision
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
