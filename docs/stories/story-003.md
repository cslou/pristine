# Pristine — Story: Harden privacy-input classifier diagnostics

**Date:** 2026-05-20
**Type:** Fix
**Status:** 🟢 Complete
**Target branch:** sprint-30-and-31
**Working branch:** fix/privacy-input-classifier-diagnostics
**Related issue/spec/sprint/PR:** `docs/sprints/sprint-031.md`, PR #269

---

## Handoff

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript, ESM, Vitest, Pi reference extensions, local SQLite privacy vault
- **Current state:** The Pi privacy-input path works end-to-end with `detect` → `classify` → `redact` → vault storage, and Story 6 added a Pi model classifier transport. Manual setup exposed that classification failures currently collapse into one generic safe notification.
- **Problem/current behavior:** Privacy-input classification remains fail-closed but is hard to diagnose safely when model selection, auth, timeout, parser, or candidate validation fails.
- **Expected behavior/outcome:** Classifier/model/parser failures expose canonical safe reason codes in testable details while preserving fail-closed behavior and never including raw candidate values or secret substrings.

## Story

**As a** Pi privacy-input operator, **I want** safe classifier failure reason codes, **so that** manual smoke failures are actionable without leaking secrets.

- **Scope:** Add raw-secret-free structured reason codes for privacy-input classifier/model/parser failures and surface them through safe runtime details/notifications where appropriate.
- **Non-goals:** No provider-prefix policy changes, no vault metadata semantics changes, no hosted service, no provider SDK beyond the existing Pi model-layer dependency, no raw candidate logging, no tool-call reveal or tool-result scrub implementation.

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

- **Existing flows affected:** Pi `privacy-input` classifier adapter parsing, Pi model classifier transport failures, runtime classifier failure handling, safe notification/details behavior, manual Pi smoke troubleshooting.
- **New flows introduced:** Safe structured privacy-input classifier failure reason reporting.

## Acceptance Criteria

- [x] A canonical privacy-input failure reason type exists with these exact codes: `model_unavailable`, `auth_unavailable`, `timeout`, `aborted`, `malformed_json`, `empty_response`, `truncated_response`, `missing_decision`, `unknown_candidate_id`, `duplicate_candidate_id`, `invalid_response`, and `transport_error`. Pass condition: TypeScript tests compile against the reason-code union and no ad hoc reason strings are needed for the listed failure categories.
- [x] The classifier adapter and Pi model transport map failures to the canonical reason codes without including raw candidate values, raw prefixes/suffixes, decoded payloads, URL passwords, query secret values, seed words, vault refs, or plaintext. Pass condition: tests assert each listed failure category produces the expected reason code and serialized error/details do not contain risky fixture values.
- [x] Runtime classifier failures return `{ action: "handled", details: { classifierFailure: { reasonCode } } }` or an equivalently typed raw-free diagnostic detail carrying the canonical reason code; `redact` is not called for classifier failure cases. Pass condition: runtime tests cover each failure category, assert the expected reason code is present in safe details, and assert `redact` is not called.
- [x] User-facing notifications remain raw-value-free and include stable safe diagnostic wording tied to the canonical reason code. Pass condition: tests assert notification strings contain either the expected reason code or the mapped safe reason label and do not contain fake secret fixture values or candidate-derived substrings.

## Implementation Plan

- **Touched modules/files:** `examples/pi-dev/extensions/privacy-input/lib/classifier-adapter.ts`, `examples/pi-dev/extensions/privacy-input/lib/pi-model-classifier-transport.ts`, `examples/pi-dev/extensions/privacy-input/lib/runtime.ts`, `tests/examples/pi-dev/privacy-input-classifier-adapter.test.ts`, `tests/examples/pi-dev/privacy-input-pi-model-transport.test.ts`, `tests/examples/pi-dev/privacy-input-extension.test.ts`, docs under `examples/pi-dev/extensions/privacy-input/README.md` if public behavior changes.
- **Approach:** Define a small reason-code type and structured classifier error shape near the adapter boundary. Preserve existing fail-closed control flow, but attach safe reason metadata that tests and optional notifications can inspect. Keep all error messages and details independent of raw candidate text.
- **Risks/rollback:** Medium-low risk. Roll back with normal git revert. Main risk is accidentally exposing provider/model error text that contains sensitive context; mitigate by mapping provider errors to safe codes and avoiding raw error message propagation in user-visible details.
- **New dependencies:** None
- **Planned commits:**
  1. `fix: add safe privacy classifier failure reasons` — reason-code type, adapter/transport mappings, runtime details, and tests.

## Verification Plan

This story follows verifiability-first engineering: define how the new or changed behavior will be proven correct and which existing behavior it could regress before implementation starts.

- **Functional verification:**
  - [x] Run targeted tests for safe classifier failure reasons; pass condition: model unavailable, auth unavailable, timeout, abort, malformed JSON, empty response, truncated response, missing decision, unknown candidate, duplicate candidate, invalid response, and transport error each produce the expected raw-value-free reason code.
  - [x] Run targeted runtime failure tests; pass condition: every classifier failure returns `handled` with the expected canonical reason code in raw-free safe details, `redact` is not called, and notification/details contain no raw fake secret values.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/examples/pi-dev/privacy-input-classifier-adapter.test.ts tests/examples/pi-dev/privacy-input-extension.test.ts tests/examples/pi-dev/privacy-input-pi-model-transport.test.ts`; pass condition: Pi privacy-input unit tests pass.
  - [x] Run `pnpm run build`; pass condition: package builds successfully after type/API changes.
  - [x] Run `pnpm run lint && pnpm run typecheck`; pass condition: lint and TypeScript checks pass without errors.
- **Manual-only verification:** N/A — automated adapter/transport/runtime tests cover safe failure diagnostics. Real Pi smoke can be rerun during final integration verification if behavior changes beyond diagnostics.

## Completion Evidence

(Fill this in before marking the story `🟢 Complete`.)

- **PR:** #271 (`fix: add safe privacy classifier failure reasons` targeting `sprint-30-and-31`)
- **Commits:** `082e997 fix: add safe privacy classifier failure reasons`
- **Acceptance criteria evidence:** Added canonical reason-code union and `PrivacyInputClassifierError` in `examples/pi-dev/extensions/privacy-input/lib/classifier-diagnostics.ts`; mapped adapter parser failures and Pi model transport failures to safe reason codes; runtime classifier failures now return raw-free `details.classifierFailure.reasonCode` and include safe notification wording.
- **Functional verification evidence:** PASS — `pnpm run test:unit -- tests/examples/pi-dev/privacy-input-classifier-adapter.test.ts tests/examples/pi-dev/privacy-input-extension.test.ts tests/examples/pi-dev/privacy-input-pi-model-transport.test.ts` covers all canonical reason codes, raw-free serialized errors/details/notifications, runtime fail-closed details, and no `redact` call on classifier failure.
- **Regression verification evidence:** PASS — `pnpm run build`; PASS — `pnpm run lint`; PASS — `pnpm run typecheck`; PASS — push hook standard tier (`pnpm run lint`, `pnpm run typecheck`, `pnpm run test:unit`) with 38 unit files / 420 tests passing. Review-requested cancellation regression is covered by `privacy-input-pi-model-transport.test.ts` asserting pre-aborted setup does not call `registry.find` or `completeSimple`; review-requested timeout regression is covered by `privacy-input-extension.test.ts` asserting fail-closed `handled`, safe `timeout` reason details/notification, and no `redact` call.
- **Manual-only verification evidence:** N/A
- **Failed, ambiguous, or unrun verification:** None
- **Review evidence:** `/review` for PR #271 returned 0 P0, 2 P1 git-history verification concerns, and 8 P2 findings; PR metadata/story evidence was updated to address the P1 verification concerns before `/review-fix`.
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
