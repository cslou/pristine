# Pristine — Sprint 031
**Date:** 2026-05-18 – TBD
**Goal:** Add a Pi-dev reference privacy input extension that composes Sprint 030's `detect`, `classify`, and `redact` primitives with a pluggable/subagent classifier callback so raw user-pasted secrets are classified from sanitized inputs and redacted before they reach Pi model context or session history.
**Status:** 🟠 In Progress

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript ESM SDK, Vitest, SQLite/better-sqlite3 privacy vault, Pi extension examples under `examples/pi-dev/`, Pi extension APIs from `@mariozechner/pi-coding-agent`
- **Current state:** Sprint 030 is planned to add core `detect`, `classify`, and `redact` primitives: raw-value-free candidate detection with `sourceSpan`/`hint` metadata, sanitized classifier callback inputs with candidate markers, normalized classifier decisions with `sourceSpan`s, and vault-backed redaction returning `sensitiveRef`/`redactedSpan` metadata for confirmed secrets. Existing Pi-dev examples cover JSONL memory indexing/search but no privacy input hook. Pi supports an `input` extension event that can transform user text before skill/template expansion and before agent/model context.
- **Implementation spec:** `docs/specs/implementation-spec-004.md` — Sprint 030 updates this spec with the primitive split; this sprint extends the Pi-dev reference section with an input-only privacy composition. Until Story 5 amends the spec, this sprint doc's input-only flow supersedes the current §8 full input/tool_call/tool_result plan for Sprint 031 implementation; tool-call reveal and tool-result scrub remain future work.

### Sprint-Wide Context

- **Sprint type:** Feature
- **Shared context:** This sprint depends on Sprint 030's primitives being merged before implementation starts. The Pi-dev reference should demonstrate one composition, not force a universal policy: `detect` and `classify` are SDK primitives, the classifier/labeler callback is a harness adapter that receives sanitized marker/hint data only, policy is extension-owned, and `redact` keeps raw-value slicing, vault storage, placeholder replacement, and alias persistence local. The v1 Pi reference protects user input only.
- **Non-goals:** No tool-call reveal hook, no tool-result scrub hook, no Claude Code or Codex integration, no background session scanning, no hosted Pristine classifier, no raw candidate values in subagent prompts, no model-provider-specific production routing beyond a reference subagent/adapter, no `secureAndRedact` public-flow dependency, and no composed replacement convenience wrapper for `detect` → `classify` → `redact`.

### Affected Flows

- **Existing flows affected:** Pi-dev example artifact map/install docs, examples/pi-dev unit tests, public Pi-dev docs, privacy primitive API usage, package/public API smoke tests.
- **New flows introduced:** Pi user-input privacy flow: Pi `input` hook receives raw user text → SDK `detect` finds raw-value-free candidates with `sourceSpan`/`hint` metadata locally → SDK `classify` creates sanitized classifier input with `[CANDIDATE:<id>]` markers and calls the Pi classifier adapter/subagent callback → extension policy handles confirmed/uncertain/failure states using normalized decisions with `sourceSpan`s → SDK `redact` secures confirmed secrets locally, persists labels as aliases, and passes redacted text plus `sensitiveRef`/`redactedSpan` metadata to Pi.

### Verification Strategy

This sprint follows verifiability-first engineering: every story must define how its new or changed behavior will be proven correct and which existing behavior it could regress.

Verification has two categories:

- **Functional verification:** new verification created for behavior introduced or changed by this sprint.
- **Regression verification:** existing verification for behavior that predates this sprint.

Each implementation story must include:

- Functional verification for the new or changed behavior it delivers.
- Targeted regression verification for existing behavior most likely to be affected by that story.

The Final Verification Story runs all sprint functional verification plus the full available regression verification suite. After the sprint completes, the sprint's functional verification becomes part of the regression suite for future sprints.

### Stories
**Constraints:** Target 5-8 stories per sprint. Each story should be small enough to review, verify, and merge independently. Split stories that combine unrelated outcomes or cannot be verified with a clear functional/regression verification plan.

#### Story 1: Add Pi privacy-input extension scaffold and runtime boundaries
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: None.
  - Resolution: N/A.
- **As a** Pi harness adopter, **I want** a repo-local privacy-input extension scaffold with explicit runtime boundaries, **so that** I can install and test input privacy protection without confusing it with memory indexing/search examples.
- **Dependencies:** Sprint 030 merged; no intra-sprint dependency
- **Acceptance criteria:**
  - [x] `examples/pi-dev/extensions/privacy-input/` exists with `index.ts`, `package.json`, README, and internal `lib/` modules matching existing Pi-dev example conventions.
  - [x] The extension registers a Pi `input` handler and skips processing for `event.source === "extension"` to avoid recursion.
  - [x] The extension delegates behavior to a testable runtime object so unit tests can invoke input handling without launching Pi.
  - [x] The runtime accepts injected `detect`, `classify`/classifier callback adapter, `redact`, policy, user ID, and notification dependencies for tests and host-managed lifecycles.
  - [x] No candidates returns `{ action: "continue" }` and does not call `classify` or `redact` dependencies.
- **Functional verification:**
  - [x] Add `tests/examples/pi-dev/privacy-input-extension.test.ts`; pass condition: extension registration wires exactly one `input` handler and delegates to the runtime.
  - [x] Add runtime unit tests for extension-injected messages and no-candidate user messages; pass condition: injected messages continue unchanged and no-candidate input continues without classifier/redactor calls.
  - [x] Run `pnpm run test:unit -- tests/examples/pi-dev/privacy-input-extension.test.ts`; pass condition: new scaffold/runtime tests pass.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/examples/pi-dev/install-layout.test.ts tests/examples/pi-dev/search-memory-tool.test.ts`; pass condition: existing Pi-dev extension discovery/install expectations and recall tool wrappers remain green.
  - [x] Run `pnpm run lint`; pass condition: new Pi-dev extension code has no lint errors or debug logging.
- **Manual-only verification:** N/A — extension registration and runtime boundaries are covered by unit tests.
- **Planned commits:**
  1. `feat: scaffold pi privacy input extension` — add extension directory, runtime shell, package metadata, README, and focused tests.
- **Technical notes:** Follow the existing `jsonl-index` and `search-memory` example pattern: copied extension directories should be self-contained and should not rely on project-private test fixtures at runtime.
- **Implementation notes:**
  - Added `examples/pi-dev/extensions/privacy-input/index.ts`, `package.json`, README, and `lib/runtime.ts`.
  - `registerPrivacyInputExtension` registers one `input` handler plus shutdown cleanup; extension-origin messages continue before runtime construction.
  - `PrivacyInputRuntime` accepts injected detector/classifier/redactor/policy/user/notification dependencies; no-candidate input exits before classifier/redactor calls, and non-empty candidate input fails closed until Story 2 redaction composition is implemented.
  - `pnpm run test:unit -- tests/examples/pi-dev/privacy-input-extension.test.ts` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-s31-story1-unit2-XXXX.log.3jp6p71udX`.
  - `pnpm run test:unit -- tests/examples/pi-dev/install-layout.test.ts tests/examples/pi-dev/search-memory-tool.test.ts` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-s31-story1-reg2-XXXX.log.hIr3Etanea`.
  - `pnpm run lint` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-s31-story1-lint2-XXXX.log.RqfTDfqcbN`.
  - Review-fix coverage: initialization failure with and without context object continues safely; non-empty candidates return `handled` with a raw-value-free notification until redaction composition exists; detected-candidate fail-closed behavior does not depend on user ID resolution.
  - `pnpm run test:unit -- tests/examples/pi-dev/privacy-input-extension.test.ts` passed after review fixes; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-s31-story1-fix2-unit-XXXX.log.ZwQppTEba1`.
  - `pnpm run lint` passed after review fixes; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-s31-story1-fix2-lint-XXXX.log.1NvjSTwrom`.
  - `pnpm run typecheck` passed after review fixes; log: `/tmp/s31-story1-fix2-typecheck.log`.
  - Second review-fix pass: `pnpm run test:unit -- tests/examples/pi-dev/privacy-input-extension.test.ts` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-s31-story1-fix3-unit-XXXX.log.fJnj0Puf9a`.
  - Second review-fix pass: `pnpm run lint` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-s31-story1-fix3-lint-XXXX.log.29S81VIZtn`.
  - Second review-fix pass: `pnpm run typecheck` passed; log: `/tmp/s31-story1-fix3-typecheck.log`.

#### Story 2: Compose `detect`, `classify`, policy, and `redact` in the input runtime
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: P1 from sprint-doc-reviewer: safe-details/logging acceptance criteria had no explicit verification proving expected metadata is recorded without raw candidate values.
  - Resolution: Added a confirmed-secret safe-details leak test requiring candidate IDs, verdicts, types, labels, `sensitiveRef`s/placeholders, `redactedSpan`s, and no raw candidate values.
- **As a** Pi user, **I want** confirmed input secrets redacted before my message reaches the model, **so that** I can paste sensitive values into Pi without storing or sending those raw values in model context.
- **Dependencies:** Story 1; Sprint 030 merged
- **Acceptance criteria:**
  - [x] The runtime composes Sprint 030 primitives in order: `detect(text)` → `classify(text, candidates, classifierCallback)` with sanitized marker/hint callback input → apply extension policy → `redact(text, confirmed, userId)` → return transformed redacted text.
  - [x] Classifier verdicts with `verdict: "secret"` produce confirmed secrets using classifier-provided `sourceSpan`, type, and label, then call `redact` with original text plus confirmed `{ sourceSpan, type, label }` inputs.
  - [x] `verdict: "not_secret"` candidates are not redacted when no other confirmed candidate overlaps the same `sourceSpan`.
  - [x] Successful redaction returns `{ action: "transform", text: redactedText }` and the transformed text contains Pristine `[SENSITIVE:<type>:<id>]` placeholders but not the raw secret.
  - [x] The runtime records safe details for rendering/logging that include candidate IDs, verdicts, types, labels, `sensitiveRef`s, placeholders, and `redactedSpan`s, but no raw candidate values.
- **Functional verification:**
  - [x] Add runtime composition tests with fake `detect`/`classify`/`redact` dependencies and a fake classifier adapter; pass condition: dependency calls occur in the expected order and receive original text only where local detection/redaction requires it, while the classifier callback receives only sanitized marker/hint data.
  - [x] Add a secret-input transform test using the real Sprint 030 `detect`, `classify`, and `redact` primitives with a fake classifier callback; pass condition: raw secret is absent from transformed text, placeholder is present, `sourceSpan`/`redactedSpan` metadata is correct, and reveal restores the original value for the same user.
  - [x] Add a mixed verdict test; pass condition: `secret` verdict `sourceSpan`s are redacted and `not_secret` candidate source text remains unchanged.
  - [x] Add a confirmed-secret safe-details leak test; pass condition: emitted runtime details include expected candidate IDs, verdicts, types, labels, `sensitiveRef`s, placeholders, and `redactedSpan`s, and serialized details do not contain raw candidate values.
- **Regression verification:**
  - [x] Run `pnpm run test:integration -- tests/integration/privacy.test.ts`; pass condition: existing core `reveal`, `scrubOutput`, vault lifecycle, and sensitive CRUD behavior remains green.
  - [x] Run `pnpm run test:unit -- tests/client.test.ts tests/privacy/safety-scan.test.ts tests/vault/sqlite-vault-store.test.ts`; pass condition: public privacy client behavior, scrub behavior, and sensitive CRUD behavior remain green.
- **Manual-only verification:** N/A — runtime composition and vault round-trip are covered by tests.
- **Planned commits:**
  1. `feat: compose pi input privacy redaction` — wire `detect`/`classify`/classifier callback/policy/`redact` flow with `sourceSpan`/`hint`/`sensitiveRef` metadata and add runtime/vault round-trip tests.
- **Technical notes:** The extension should transform only the user input text; tool-call reveal and tool-result scrubbing are intentionally deferred to a later sprint.
- **Implementation notes:**
  - `PrivacyInputRuntime` now accepts injected `detect`, `classify`, `classifierCallback`, and `redact` dependencies and composes them in the primitive order for user input.
  - Confirmed `secret` decisions are converted to `{ candidateId, sourceSpan, type, label }` redaction inputs; `not_secret` decisions continue without redaction.
  - Runtime transform results include raw-value-free details with candidate IDs, verdict/type/label metadata, `sensitiveRef`s, placeholders, and `redactedSpan`s.
  - Functional tests include fake dependency call-order/shape coverage, `uncertainPolicy` block/redact/allow coverage, malformed-secret fail-closed coverage, redaction setup failure blocking, and a real `detect` → `classify` → `Pristine.redact` → `reveal` round trip.
  - `pnpm run test:unit -- tests/examples/pi-dev/privacy-input-extension.test.ts` passed.
  - `pnpm run typecheck` passed.
  - `pnpm run test:integration -- tests/integration/privacy.test.ts` passed.
  - `pnpm run test:unit -- tests/client.test.ts tests/privacy/safety-scan.test.ts tests/vault/sqlite-vault-store.test.ts` passed.
  - `pnpm run lint` passed.
  - Review-fix reruns passed: `pnpm run test:unit -- tests/examples/pi-dev/privacy-input-extension.test.ts`, `pnpm run typecheck`, and `pnpm run lint`.

#### Story 3: Add reference subagent classifier callback and labeler adapter
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: P2 from sprint-doc-reviewer: prompt leak tests did not enumerate all risky fields named in the leak-prevention AC.
  - Resolution: Expanded prompt leak verification to require raw prefixes/suffixes, decoded JWT payload values, URL passwords, query secret values, and seed phrase words.
- **As a** Pi extension author, **I want** a reference classifier/labeler adapter that consumes Sprint 030 `classify` sanitized callback inputs with markers and hints, **so that** I can see how to use Pi's harness LLM/subagent path without sending raw candidate values to it.
- **Dependencies:** Story 1, Story 2; Sprint 030 merged
- **Acceptance criteria:**
  - [x] A reference classifier adapter builds a classifier task/prompt from sanitized `classify` callback requests containing `sanitizedContext`, `[CANDIDATE:<id>]` markers, non-value-derived candidate IDs, safe `sourceSpan` metadata, and safe `hint` metadata, and never includes raw candidate strings, arbitrary raw prefixes/suffixes, decoded JWT payload values, URL passwords, query secret values, or seed phrase words.
  - [x] The adapter returns structured classifier decisions containing candidate ID, verdict, sensitivity type, optional label, confidence, and rationale, and validates/parses the response before `classify` normalizes the decisions with `sourceSpan`s for policy use.
  - [x] The reference supports `secret`, `not_secret`, and `uncertain` verdicts and preserves labels for `secret` verdicts when supplied.
  - [x] Classifier-provided labels are validated/normalized for Sprint 030 `redact` alias storage via the PR #240 sensitive alias path; invalid or unsafe labels are rejected with structured classifier errors or replaced by a documented safe fallback before policy/redaction uses them.
  - [x] The adapter is replaceable: tests and README show how hosts can use a fake/local/manual classifier instead of the reference subagent classifier.
  - [x] Malformed, missing, duplicate, or unknown candidate IDs in classifier output are reported as classifier failures rather than silently passing through.
- **Functional verification:**
  - [x] Add prompt-construction leak tests for realistic raw secrets, arbitrary raw prefixes/suffixes, JWT payload values, credential URL passwords, signed URL query secret values, and seed phrase words; pass condition: serialized prompts/tasks contain `[CANDIDATE:<id>]` markers, non-value-derived candidate IDs, safe `sourceSpan` metadata, and safe `hint` metadata but none of those raw values.
  - [x] Add response parser tests; pass condition: valid JSON verdicts parse to classifier results and malformed/duplicate/unknown-candidate outputs fail with structured classifier errors before `classify` can normalize them.
  - [x] Add label preservation and validation tests; pass condition: `secret` verdict labels from classifier output are passed through `classify` decisions to the runtime `redact` alias flow, invalid/unsafe labels produce the documented structured failure or fallback behavior, and serialized aliases/details do not contain raw secret values.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/examples/pi-dev/search-session-history.test.ts tests/examples/pi-dev/search-memory.test.ts`; pass condition: existing Pi-dev skill/tool examples remain green.
  - [x] Run `pnpm run typecheck`; pass condition: classifier adapter types compile cleanly with strict TypeScript.
- **Manual-only verification:** N/A — reference prompt construction and parser behavior are covered by unit tests; real Pi smoke is planned in Story 5.
- **Planned commits:**
  1. `feat: add pi secret classifier adapter` — add reference prompt/task builder for `classify` callbacks with marker/hint inputs, structured result parser, adapter docs, and leak-focused tests.
- **Technical notes:** If direct subagent spawning is too brittle for the copied extension shape, keep the runtime adapter interface stable and provide a command/subprocess-backed reference implementation plus fake classifier tests. Do not add Anthropic/OpenAI SDK dependencies.
- **Implementation notes:**
  - Added `lib/classifier-adapter.ts` with a sanitized task builder, response parser, safe-label validator, structured `PrivacyInputClassifierError`, and replaceable transport-backed callback factory.
  - `tests/examples/pi-dev/privacy-input-classifier-adapter.test.ts` covers prompt leak prevention for raw secrets/prefixes/JWT payload values/URL passwords/query secrets/seed words, parser rejection paths, label normalization/rejection, and fake transport replacement.
  - `examples/pi-dev/extensions/privacy-input/README.md` documents the replaceable fake/local/manual classifier callback option and sanitized marker/hint task shape.
  - `pnpm run test:unit -- tests/examples/pi-dev/privacy-input-classifier-adapter.test.ts` passed.
  - `pnpm run test:unit -- tests/examples/pi-dev/search-session-history.test.ts tests/examples/pi-dev/search-memory.test.ts` passed.
  - `pnpm run typecheck` passed.
  - `pnpm run lint` passed.
  - Review-fix additions sanitize unknown hint/location metadata before prompt serialization, reject non-string labels, verify non-vacuous raw-value leak sentinels in unsafe request metadata, and cover adapter label flow through runtime redaction details.
  - Review-fix reruns passed: `pnpm run test:unit -- tests/examples/pi-dev/privacy-input-classifier-adapter.test.ts`, `pnpm run typecheck`, and `pnpm run lint`.

#### Story 4: Implement policy and failure handling for uncertain or failed classification
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: None.
  - Resolution: N/A.
- **As a** privacy-conscious Pi user, **I want** classifier uncertainty and failures handled before the turn proceeds, **so that** a classifier outage or ambiguous result does not silently leak likely secrets to model context.
- **Dependencies:** Story 2, Story 3
- **Acceptance criteria:**
  - [x] The extension policy supports configurable `uncertain` handling with explicit modes `block`, `redact`, and `allow`, and the documented default is `block`.
  - [x] Classifier timeout, thrown error, malformed response, unknown candidate ID, or duplicate candidate ID causes the input turn to return `{ action: "handled" }` and sends exactly one safe notification that contains no raw candidate values.
  - [x] `uncertainPolicy: "block"` blocks the turn and notifies the user when any candidate remains uncertain.
  - [x] `uncertainPolicy: "redact"` redacts uncertain candidates using detector `hint.suggestedType` or a fallback type/label without sending raw values to the classifier or notification.
  - [x] `uncertainPolicy: "allow"` passes uncertain candidates through only when explicitly configured, safe details record that policy decision without raw values, and docs/config warnings state this unsafe opt-in mode is excluded from the sprint's default no-raw-secret model/session-history guarantee.
- **Functional verification:**
  - [x] Add failure-mode tests for classifier throw, timeout, malformed JSON, unknown candidate ID, and duplicate candidate ID; pass condition: runtime returns exactly `{ action: "handled" }`, sends exactly one safe notification, and does not transform raw text into model context.
  - [x] Add tests for all uncertain policy modes; pass condition: `block`, `redact`, and `allow` produce the documented behavior, safe details contain no raw candidate values, and `allow` assertions/docs mark the raw-pass-through risk as explicit opt-in.
  - [x] Add notification leak tests; pass condition: notification text and details do not contain raw candidate values.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/privacy/safety-scan.test.ts tests/vault/vault-redaction.test.ts`; pass condition: core scrub/placeholder behavior remains green.
  - [x] Run `pnpm run lint`; pass condition: policy code has no lint errors or debug logging.
- **Manual-only verification:** N/A — failure and policy behavior are covered by unit tests.
- **Planned commits:**
  1. `feat: handle pi privacy classification failures` — add policy modes, failure handling, safe notifications, and leak tests.
- **Technical notes:** Pi `input` supports `continue`, `transform`, and `handled`; if blocking uses `handled`, notify the user clearly that the turn was stopped before reaching the agent.
- **Implementation notes:**
  - Runtime classification is wrapped in safe failure handling with optional `classifierTimeoutMs`; classifier throw, timeout, malformed parser errors, unknown IDs, and duplicate IDs return `{ action: "handled" }` with exactly one raw-value-free notification.
  - `uncertainPolicy` now has tested `block`, `redact`, and `allow` behavior. Default `block` is fail-closed; `allow` is explicit opt-in, returns safe details only, and is documented in the extension README as excluded from the default no-raw-secret guarantee.
  - `pnpm run test:unit -- tests/examples/pi-dev/privacy-input-extension.test.ts` passed.
  - `pnpm run typecheck` passed.
  - `pnpm run test:unit -- tests/privacy/safety-scan.test.ts tests/vault/vault-redaction.test.ts` passed.
  - `pnpm run lint` passed.

#### Story 5: Document Pi privacy input installation, limits, and smoke verification
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template
  - [x] Acceptance criteria are specific and testable
  - [x] Functional verification items are concrete and have pass/fail conditions
  - [x] Regression verification items are concrete and have pass/fail conditions
  - [x] Story is small enough to review and merge independently
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed or explicitly recorded
  - [x] Ready for Lou
- **Planning review:**
  - Findings: P2 from sprint-doc-reviewer: spec flow alignment for input-only v1 was implicit even though the referenced spec still describes full Pi input/tool_call/tool_result flow.
  - Resolution: Added Story 5 acceptance and verification to update/check `implementation-spec-004.md` so Sprint 031 is explicitly input-only and later hooks remain future work.
- **As a** Pi adopter, **I want** installation docs and a reproducible smoke check for privacy input protection, **so that** I can copy the reference into a repo and verify raw user-input secrets are redacted before model context.
- **Dependencies:** Story 1, Story 2, Story 3, Story 4
- **Acceptance criteria:**
  - [x] `examples/pi-dev/README.md` artifact map includes the privacy-input extension, copy/install target, dependency installation, and expected behavior.
  - [x] `examples/pi-dev/extensions/privacy-input/README.md` documents runtime dependencies, classifier adapter configuration, marker/hint classifier inputs, uncertain policy modes, classifier failure behavior, local vault/key responsibilities, and v1 limitations.
  - [x] Public docs under `docs/pages/pi-dev.mdx` and privacy pages link to the Pi privacy input reference without implying tool-call reveal or tool-result scrub are implemented in v1.
  - [x] `docs/specs/implementation-spec-004.md` is updated or amended so the Pi-dev reference flow clearly distinguishes Sprint 031's input-only v1 from future tool-call reveal and tool-result scrub hooks.
  - [x] Documentation states that classifier prompts receive sanitized context, `[CANDIDATE:<id>]` markers, non-value-derived candidate IDs, safe `sourceSpan` metadata, and safe `hint` metadata only, never raw candidates.
  - [x] A reproducible Pi smoke procedure is documented with explicit pass/fail conditions for a fake/test classifier mode and, where practical, a real subagent classifier mode.
  - [x] Smoke evidence includes a model-facing/session-history artifact or transcript proving the placeholder is present and the raw input secret is absent after the input hook runs.
- **Functional verification:**
  - [x] Run `pnpm run docs:build`; pass condition: updated public docs build successfully.
  - [x] Run individual `rg` checks for `privacy-input`, `sanitized`, `raw candidate`, `uncertainPolicy`, `input hook`, `tool-call reveal`, `marker`, `hint`, `sourceSpan`, and `sensitiveRef` in `examples/pi-dev docs/pages/pi-dev.mdx docs/pages/privacy`; pass condition: docs mention the privacy-input extension, sanitized classifier prompts, marker/hint inputs, policy modes, input hook behavior, v1 limitations for tool-call reveal, and Sprint 030 refined metadata names.
  - [x] Run `rg "input-only|future tool-call|future tool-result|tool_call|tool_result" docs/specs/implementation-spec-004.md`; pass condition: the spec distinguishes Sprint 031's input-only v1 from future tool-call reveal and tool-result scrub work.
  - [x] Run the documented non-interactive smoke command or test harness for fake/test classifier mode; pass condition: a sample input containing a fake API key is transformed to a Pristine placeholder and the raw key is absent from the model-facing text and recorded session-history/transcript artifact.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/examples/pi-dev`; pass condition: all Pi-dev example tests, including existing memory examples and new privacy-input tests, pass.
  - [x] Run `pnpm run test:smoke`; pass condition: package/public API smoke tests remain green after docs/example changes.
  - [x] Run `pnpm run verify:public-api-types` and individual `rg` checks for `detect(`, `classify(`, `redact(`, `sourceSpan`, `redactedSpan`, `sensitiveRef`, and `classifierCallback` in `examples/pi-dev docs/pages/pi-dev.mdx docs/pages/privacy`; pass condition: public type smoke and docs/examples use Sprint 030 primitive names and refined schema names.
  - [x] Run `rg "secureAndRedact" examples/pi-dev/extensions/privacy-input docs/pages/pi-dev.mdx docs/pages/privacy`; pass condition: no Pi privacy-input docs or public privacy docs reintroduce `secureAndRedact` as a callable public flow; any remaining mentions are limited to migration/non-use language.
- **Manual-only verification:** If real Pi subagent smoke cannot be automated reliably, run `pi` from a copied reference repo with privacy-input enabled; pass condition: typing a sample fake key produces a safe block/transform result before the agent sees raw text, and document the log or transcript path in story evidence.
- **Planned commits:**
  1. `docs: document pi privacy input reference` — update Pi-dev runbook, extension README, public docs, and smoke evidence.
- **Technical notes:** Be explicit that v1 is user-input protection only. Tool-call reveal and output scrub require later dedicated hooks and verification.
- **Implementation notes:**
  - Updated `examples/pi-dev/README.md`, `examples/pi-dev/extensions/privacy-input/README.md`, `docs/pages/pi-dev.mdx`, `docs/pages/privacy.mdx`, and `docs/specs/implementation-spec-004.md` with input-only privacy reference docs, policy limits, and smoke procedures.
  - Updated Pi-dev install-layout test to include copied `privacy-input` extension imports.
  - `pnpm run docs:build` passed.
  - `pnpm run test:unit -- tests/examples/pi-dev` passed.
  - `pnpm run test:smoke` passed.
  - `pnpm run verify:public-api-types` passed.
  - Documentation `rg` checks passed for privacy-input terms, input-only/future hook spec language, primitive schema names, and no `secureAndRedact` reintroduction in Pi privacy-input/public privacy docs.
  - Fake classifier smoke passed via `pnpm run test:unit -- tests/examples/pi-dev/privacy-input-extension.test.ts -t "uses real primitives to transform and reveal a confirmed secret"`.
  - Fake/test smoke transcript evidence is recorded in `examples/pi-dev/extensions/privacy-input/smoke-transcript.md`; manual real Pi smoke remains deferred to Lou after sprint handoff, per latest user instruction.

#### Final Story: Sprint Verification & Completion
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Uses the story sections above and the existing regression suite as the verification source of truth
  - [x] Defines where final verification evidence will be recorded
  - [x] Includes full regression verification, not only areas believed to be touched
  - [x] Ready for Lou
- **As a** maintainer, **I want** all sprint functional verification and all available regression verification run, **so that** the sprint can be integrated with evidence that new behavior works and existing behavior did not regress.
- **Dependencies:** All implementation stories
- **Acceptance criteria:**
  - [ ] Every story’s acceptance criteria are evaluated against implementation evidence.
  - [ ] Every story’s functional verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [ ] Every story’s targeted regression verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [ ] The full available regression verification suite is run, including existing unit, integration, e2e, smoke, simulator/browser/device, static, and manual-only checks where applicable.
  - [ ] Failed, ambiguous, manual-only, or unrun verification items are documented.
  - [ ] The sprint’s new functional verification is identified as future regression verification.
  - [ ] Verification delta is reported by canonical type, showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals, with rows for every canonical verification type including zero-count rows and rationale for any `Unknown` values.
  - [ ] The sprint doc status is updated to `🟢 Complete` only if completion criteria are met.
  - [ ] A `## Final Review` section is appended to the sprint doc with the final completion message quoted for auditability.
- **Functional verification:**
  - [ ] Run all functional verification items from every story and record pass/fail evidence.
- **Regression verification:**
  - [ ] Run all targeted regression verification items from every story and record pass/fail evidence.
  - [ ] Run the full available regression verification suite and record pass/fail evidence.
- **Manual-only verification:** Real Pi subagent smoke from Story 5 if not automated; otherwise `N/A — no manual-only verification required`.
- **Planned commits:**
  1. `test: complete sprint 031 verification` — record final verification evidence and sprint completion state.
- **Technical notes:** Use the story sections plus the existing regression suite as the source of truth. Do not duplicate all AC/verification items here; run them, reference the evidence, compute the verification delta table, and record final results in `## Final Review`. Use `workflow-prompts/handle-sprint-completion.md` for the final completion message shape. `## Final Review` is the durable audit copy of that message; emit the same summary to the user and append it to the sprint doc.

### Rules
- Use the sprint-branch workflow from AGENTS.md: `sprint-NNN` branches from target, story branches fork from `sprint-NNN`, and story PRs target `sprint-NNN`.
- Work through stories sequentially. The Final Verification Story is always last.
- Each story PR follows the normal review/fix/merge gates from AGENTS.md.
- After the Final Verification Story merges, open the sprint-integration PR (`sprint-NNN → target`). It uses the same gates, then pauses for the user's explicit merge command.
- Record new dependencies in `## Final Review`, or record `None` when no dependencies were added.

### Definition of Done
- All implementation stories pass acceptance criteria.
- Functional verification evidence is recorded for every implementation story.
- Targeted regression verification evidence is recorded for every implementation story.
- Final Verification Story has run all sprint functional verification and the full available regression verification suite.
- Failed, ambiguous, manual-only, or unrun verification items are documented in `## Final Review`.
- `## Final Review` includes a verification delta table showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals by canonical verification type.
- Sprint doc status is `🟢 Complete` only when completion criteria are met.
- Sprint doc includes `## Final Review` with the final completion message and a New Dependencies field containing dependencies or `None`.
- Sprint-integration PR is reviewed, passes the required gates, and is merged only after the explicit user merge command.
- If the sprint introduces new flows, they are folded into the implementation spec before sprint integration.
