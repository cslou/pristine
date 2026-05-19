# Pristine — Sprint 030
**Date:** 2026-05-18 – TBD
**Goal:** Replace the opinionated `secureAndRedact` flow with short, composable privacy primitives — `detect`, `classify`, and `redact` — so harnesses decide classification policy while Pristine owns safe local detection, sanitized classifier inputs, and vault-backed redaction.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript ESM SDK, Vitest, SQLite/better-sqlite3 privacy vault, local-first privacy APIs, Pi reference examples under `examples/pi-dev/`
- **Current state:** Pristine has an opinionated deterministic privacy pipeline where `secureAndRedact` classifies with built-in/custom regex rules, redacts matching entities, and stores originals in the encrypted local vault. PR #240 added sensitive vault CRUD primitives (`listSensitive`, `getSensitive`, `updateSensitive`, `deleteSensitive`, `resolveSensitive`) and visible metadata aliases. Custom regexes are extensible, but detection, classification policy, and redaction are currently coupled in the high-level `secureAndRedact` flow. Pi-dev examples currently cover memory indexing/search but do not include a privacy input hook.
- **Implementation spec:** `docs/specs/implementation-spec-004.md` — existing secret-redaction spec; this sprint updates it with the Detector / Classifier / Redactor primitive flow because the spec currently reflects the earlier deterministic-only harness plan.

### Sprint-Wide Context

- **Sprint type:** Feature
- **Shared context:** This sprint creates the core SDK building blocks for a future Pi privacy hook. The desired architecture is Detector / Classifier / Redactor with short public primitive names: `detect` finds suspicious spans and metadata, `classify` builds sanitized classifier inputs and validates caller-provided classifier decisions, and `redact` stores/redacts confirmed spans locally. The SDK should expose reusable contracts and local primitives but should not implement a hosted or provider-specific LLM classifier. `secureAndRedact` is removed from the preferred public flow because it composes an opinionated deterministic classifier differently from the new user/harness-owned `classify` primitive. `docs/specs/implementation-spec-004.md` must be updated before sprint integration so the durable flow spec matches the new primitive split.
- **Non-goals:** No Pi input hook implementation, no subagent classifier implementation, no hosted Pristine service, no third-party secret verification, no large provider-specific catalog beyond the broad v1 candidate classes, no raw candidate values in detector output or sanitized classifier packets, and no composed replacement convenience wrapper for `detect` → `classify` → `redact`.

### Affected Flows

- **Existing flows affected:** Privacy module exports, `secureAndRedact` public API removal/migration surface, implementation-spec-004's current deterministic `secureAndRedact` and Pi secret-redaction flows, `reveal`, `scrubOutput`, sensitive vault CRUD/alias APIs, vault redaction/storage, public API type fixture, privacy tests.
- **New flows introduced:** SDK primitive flow for harness-mediated privacy decisions: `detect(text)` → `classify(text, candidates, classifier)` → harness policy selects confirmed decisions → `redact(text, confirmed, userId)` stores originals in the local vault, applies safe aliases, and returns redacted text.

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

#### Story 1: Define `detect`, `classify`, and `redact` contracts and module boundaries
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
  - Findings: P2 from sprint-doc-reviewer: `secureAndRedact` migration permitted multiple public API end states.
  - Resolution: Set the canonical migration policy: remove `secureAndRedact` from root public exports and public docs; legacy internal helpers may remain only if not documented as a user-facing primitive.
- **As a** SDK integrator, **I want** explicit `detect`, `classify`, and `redact` contracts, **so that** I can compose local candidate detection, harness-owned classification policy, and local vault redaction without relying on a monolithic privacy pipeline.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] New shared privacy types live in the privacy/core type surface with names that distinguish `detect` candidate output, `classify` decisions, and `redact` confirmed inputs/results.
  - [ ] `detect` candidate types contain stable candidate IDs, span offsets, detector kind/rule metadata, and derived shape/context signals, but no raw matched value field.
  - [ ] `classify` request/response types represent sanitized classifier inputs, `secret` / `not_secret` / `uncertain` verdicts, sensitivity type, optional label, confidence, and rationale without requiring the SDK to implement an LLM provider.
  - [ ] `redact` input/result types carry candidate IDs, span offsets, sensitivity type, optional labels, returned sensitive refs/placeholders, and alias metadata needed by callers.
  - [ ] Root public exports include the new canonical primitive functions/types and remove `secureAndRedact` from the documented/root public API surface, with any legacy internal helper kept only if it is not exported or documented as user-facing, and the public API type fixture importing the new surface successfully.
- **Functional verification:**
  - [ ] Add or update a type-focused smoke fixture in `tests/smoke/public-api-types-fixture.mts`; pass condition: `pnpm run verify:public-api-types` succeeds with `detect`, `classify`, `redact`, and their exported primitive types.
  - [ ] Add type/shape unit tests or compile-time fixtures proving detector candidates and sanitized classifier inputs do not expose a `rawValue`/`text` field for the matched secret; pass condition: tests or typecheck fail if such a public field is required.
  - [ ] Add a public-surface assertion; pass condition: root exports/docs/type fixtures no longer expose or instruct new consumers to call `secureAndRedact` and instead import/use `detect`, `classify`, and `redact`.
- **Regression verification:**
  - [ ] Run `pnpm run typecheck`; pass condition: existing strict TypeScript compilation remains green after new public types are introduced.
  - [ ] Run `pnpm run test:unit -- tests/privacy/safety-scan.test.ts tests/vault/vault-redaction.test.ts tests/vault/sqlite-vault-store.test.ts`; pass condition: existing scrub, placeholder, and sensitive CRUD behavior still passes.
- **Manual-only verification:** N/A — type fixtures and focused tests cover this story.
- **Planned commits:**
  1. `feat: define privacy primitive contracts` — add `detect`/`classify`/`redact` contracts, type exports, and public-surface migration tests without runtime behavior changes.
- **Technical notes:** Keep all module contracts in `src/core/interfaces.ts` and shared types in `src/core/types.ts` where they are general SDK contracts; privacy-specific helper exports can re-export from `src/privacy/` as needed. Do not add Anthropic/OpenAI SDK dependencies. Because the package is pre-1.0, `secureAndRedact` should be removed from root public exports and public docs; legacy internal code may remain only as an implementation detail if tests prove it is not user-facing.

#### Story 2: Implement `detect` candidate primitive
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
  - Findings: P2 from sprint-doc-reviewer: AC-3 required rich detector metadata, but functional verification did not explicitly assert value length, location metadata, prefix-family metadata, detector confidence reason, or context-specific signal fields.
  - Resolution: Expanded detector fixture verification to assert value length, location metadata, allowed prefix-family metadata, suggested type, detector confidence reason signals, key/header/parameter context signals, and positive/negative signal fields where applicable.
- **As a** harness developer, **I want** a broad local `detect` primitive that returns suspicious candidates with metadata, **so that** my harness can cast a wide net before asking its own classifier to decide policy.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [ ] A new `detect(text, options?)` public primitive detects secret candidates in a text string without performing final secret classification or vault redaction.
  - [ ] The detector covers broad v1 candidate classes: private key blocks, sensitive key/value assignments, auth headers, known provider prefixes, JWT/PASETO-like structured tokens, credential-bearing URLs, cookies/session tokens, signed URLs/query secrets, cloud credential blocks, recovery/seed phrases, and opaque generated-looking values.
  - [ ] `detect` output includes span offsets, candidate kind, rule ID, value length, line/column or equivalent location metadata, allowed provider prefix-family metadata where applicable, suggested sensitivity type where the rule has one, and explicit `positiveSignals` / `negativeSignals` arrays with at least key/header/parameter context, detector confidence reason, example/placeholder signal, and hash/public-id signal when those facts are present.
  - [ ] `detect` output does not include the raw matched value; raw values remain recoverable only by local code that already has the original text and span offsets.
  - [ ] Overlapping detector matches are normalized so higher-signal or longer candidates are not duplicated before `classify` receives them.
- **Functional verification:**
  - [ ] Add detector unit tests with at least one fixture for each broad v1 candidate class; pass condition: every fixture returns an expected candidate kind/rule ID, span, value length, location metadata, allowed prefix-family metadata where applicable, suggested type where applicable, and asserted `positiveSignals` such as `known_provider_prefix`, `sensitive_key_name`, `auth_header_context`, `query_secret_param`, `credential_url_context`, `detector_confidence_high`, or equivalent rule-specific confidence/context signals.
  - [ ] Add noisy non-secret fixtures for hashes, commit SHAs, UUIDs, package versions, example placeholders, and public IDs; pass condition: either no candidate is emitted or emitted candidates include asserted `negativeSignals` such as `looks_like_commit_sha`, `looks_like_uuid`, `looks_like_package_version`, `looks_like_placeholder`, or `looks_like_public_id`.
  - [ ] Add an overlap/deduplication test; pass condition: nested matches such as an auth header containing a provider token produce the intended normalized candidate set without duplicate raw spans.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/classifier/deterministic-classifier.test.ts tests/privacy/safety-scan.test.ts`; pass condition: existing custom-pattern detection and scrub behavior still passes while the new `detect` primitive remains candidate-only.
  - [ ] Run `pnpm run lint`; pass condition: detector regex implementation satisfies lint and contains no debug logging.
- **Manual-only verification:** N/A — detector fixtures cover this story.
- **Planned commits:**
  1. `feat: add detect privacy primitive` — add `detect`, candidate rules, overlap normalization, and focused fixtures.
- **Technical notes:** Treat regexes as candidate detectors, not truth classifiers. `detect` may accept extensible detector rules/options, but extension must preserve the no-raw-value output contract. Keep rule metadata explicit enough for classifier prompts and test assertions.

#### Story 3: Implement `classify` with sanitized classifier inputs
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
  - Findings: P2 from sprint-doc-reviewer: the previous packet-shape AC needed explicit field assertions; planning later changed this story from a packet-builder primitive to the short `classify` primitive.
  - Resolution: `classify` now owns sanitized input construction and user classifier callback validation; verification asserts required fields and no raw candidate leakage in the callback request.
- **As a** harness classifier author, **I want** a `classify` primitive that safely calls my classifier with redacted context and rich metadata, **so that** I can decide whether candidates are secrets without seeing full raw candidate values in classifier input.
- **Dependencies:** Story 1, Story 2
- **Acceptance criteria:**
  - [ ] A new `classify(text, candidates, classifier, options?)` public primitive builds sanitized classifier input internally, invokes a caller-provided classifier callback, and returns normalized candidate decisions.
  - [ ] The classifier callback receives `requestId`, `sourceSurface`, `sanitizedContext`, and `candidates[]`; each candidate entry includes `candidateId`, `kind`, `ruleId`, `span`, `location`, `valueLength`, `features`, `allowedPrefixFamily`, `providerGuess`, `nearbyName`, `suggestedType`, `positiveSignals`, and `negativeSignals` fields where applicable.
  - [ ] `classify` replaces all candidate spans in included context with `[CANDIDATE:<id>]` placeholders, including candidates other than the callback request's primary candidate when per-candidate requests are used.
  - [ ] The classifier callback input does not include raw candidate strings, arbitrary raw prefixes/suffixes, decoded JWT payload values, connection-string passwords, query secret values, or seed phrase words.
  - [ ] `classify` validates callback output for known candidate IDs, allowed verdicts (`secret`, `not_secret`, `uncertain`), valid sensitivity type/label fields, confidence shape, and duplicate/missing candidate decisions.
- **Functional verification:**
  - [ ] Add `classify` callback-input tests using multi-candidate user messages; pass condition: all raw candidate strings are absent from serialized callback input and each candidate placeholder appears in sanitized context.
  - [ ] Add a callback request shape fixture/test; pass condition: classifier requests include `requestId`, `sourceSurface`, `sanitizedContext`, `candidates[]`, and candidate `candidateId`, `kind`, `ruleId`, `span`, `location`, `valueLength`, `features`, `allowedPrefixFamily`, `providerGuess`, `nearbyName`, `suggestedType`, `positiveSignals`, and `negativeSignals` fields where applicable, without raw candidate leakage.
  - [ ] Add tests for allowed provider prefix-family metadata; pass condition: allowed labels such as `sk-proj`, `ghp_`, and `AKIA` are represented as metadata for classifier signal while arbitrary unknown candidate prefixes are not exposed and no prefix-family metadata is treated as a non-secret verdict.
  - [ ] Add JWT/URL/seed phrase sanitization tests; pass condition: classifier callback input does not contain decoded payload values, URL passwords, query secret values, or seed words.
  - [ ] Add classifier output validation tests; pass condition: duplicate, unknown, missing, malformed, or invalid verdict/type/label outputs fail loudly with domain-specific errors or structured failures before `redact` can run.
- **Regression verification:**
  - [ ] Run `pnpm run test:unit -- tests/vault/vault-redaction.test.ts tests/privacy/safety-scan.test.ts`; pass condition: existing placeholder and scrubbing behavior is unchanged.
  - [ ] Run `pnpm run typecheck`; pass condition: `classify` request/decision types compile cleanly with strict TypeScript.
- **Manual-only verification:** N/A — leak-focused serialization and callback validation tests cover this story.
- **Planned commits:**
  1. `feat: add classify privacy primitive` — add `classify`, sanitized callback request construction, callback output validation, leak-focused tests, and request JSON fixtures.
- **Technical notes:** This story owns the privacy boundary for classifier prompts: no full raw candidates. Prefer stable, explicit metadata over partial raw value previews. The SDK provides the callback contract and validation, not a bundled LLM classifier implementation.

#### Story 4: Implement `redact` vault-backed primitive
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
  - Findings: P2 from sprint-doc-reviewer: label preservation was conditional on “where supported,” so the observable label persistence surface was not fully falsifiable. PR #240 later added sensitive metadata aliases.
  - Resolution: Required `redact` to persist classifier-provided labels as visible sensitive aliases via the PR #240 `updateSensitive`/vault metadata path and to expose the resulting alias/sensitive ref in its result.
- **As a** harness integrator, **I want** a `redact` primitive for exact classifier-confirmed spans, **so that** the raw secret is stored only locally in the vault and the text entering model context contains Pristine placeholders.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [ ] A new `redact(text, confirmed, userId, options?)` public primitive accepts original text, user/vault/key configuration, and confirmed spans with start/end/type/optional label, then returns redacted text and sensitive refs/placeholders while storing originals in the encrypted vault.
  - [ ] `redact` slices raw values locally from the original text using span offsets and does not require confirmed span inputs to carry raw values.
  - [ ] `redact` validates span bounds, rejects or reports overlapping/invalid confirmed spans with domain-specific errors or structured failure results, and preserves deterministic behavior for valid non-overlapping spans.
  - [ ] Optional classifier-provided labels are persisted as visible metadata aliases for the resulting sensitive refs using the PR #240 sensitive CRUD/vault metadata path, with safe fallback aliases or no alias for unlabeled spans.
  - [ ] `reveal` can restore values redacted by `redact`, and `resolveSensitive` can resolve each returned sensitive ref for the same user.
- **Functional verification:**
  - [ ] Add integration tests for `redact`; pass condition: confirmed spans are replaced with `[SENSITIVE:<type>:<id>]`, originals are absent from redacted text, sensitive refs/placeholder IDs are returned, and vault entries exist.
  - [ ] Add a reveal/resolve round-trip test; pass condition: `reveal` restores text redacted by `redact`, and `resolveSensitive` returns the original value for each returned sensitive ref for the same user.
  - [ ] Add validation tests for invalid, out-of-bounds, and overlapping spans; pass condition: invalid input fails loudly without writing partial vault entries.
  - [ ] Add label/alias tests; pass condition: supplied labels are persisted as visible aliases returned by `getSensitive`/`listSensitive`, unlabeled spans use the documented fallback/no-alias behavior, and aliases never contain raw secret values.
- **Regression verification:**
  - [ ] Run `pnpm run test:integration -- tests/integration/privacy.test.ts tests/integration/kek-lifecycle.test.ts`; pass condition: existing reveal/scrub/vault lifecycle and PR #240 sensitive CRUD behavior remain green.
  - [ ] Run `pnpm run test:unit -- tests/vault/vault-redaction.test.ts tests/vault/sqlite-vault-store.test.ts`; pass condition: existing redaction and vault store behavior is unchanged.
- **Manual-only verification:** N/A — integration and unit tests cover this story.
- **Planned commits:**
  1. `feat: add redact privacy primitive` — add `redact`, validation, vault storage integration, alias persistence, and round-trip tests.
- **Technical notes:** Reuse existing vault encryption/key/KekManager paths and PR #240 sensitive CRUD metadata aliases. Classifier labels are visible metadata, not secrets; validate or document that callers must not put raw secret values in aliases.

#### Story 5: Publish primitive API docs, spec update, and `secureAndRedact` migration
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
  - Findings: P2 from sprint-doc-reviewer: docs verification did not directly prove no hosted/LLM classifier implementation claims, and spec-flow migration needed one canonical `secureAndRedact` policy.
  - Resolution: Added explicit hosted/LLM classifier non-goal verification and standardized `secureAndRedact` policy as public API removal/migration to `detect` → `classify` → `redact`.
- **As a** privacy API adopter, **I want** docs and examples that explain `detect` → `classify` → `redact` and the `secureAndRedact` migration, **so that** I can compose privacy policy explicitly instead of relying on an opinionated SDK wrapper.
- **Dependencies:** Story 1, Story 2, Story 3, Story 4
- **Acceptance criteria:**
  - [ ] Public API docs describe short primitive names `detect`, `classify`, and `redact`, and clearly state that the SDK does not send raw candidates to any LLM or implement a hosted classifier.
  - [ ] `docs/specs/implementation-spec-004.md` is updated with a dedicated section or addendum for the new `detect` → `classify` → `redact` primitive flow and explicitly marks the old composed `secureAndRedact` flow as removed from the root public API, with any legacy internal implementation treated as non-user-facing.
  - [ ] Privacy guide docs show a concise composition example: `detect(text)` → `classify(text, candidates, classifier)` → harness policy → `redact(text, confirmed, userId)`.
  - [ ] Docs explain that deterministic regex-only behavior can be implemented as a user/example classifier composition, not as a privileged `secureAndRedact` SDK wrapper.
  - [ ] Docs warn that classifier policy, including `uncertain` handling, belongs to the harness/tool/extension/skill using the primitives.
  - [ ] Docs describe PR #240 sensitive CRUD primitives and state classifier labels are visible aliases stored via `updateSensitive`, never raw secrets.
  - [ ] Public API type fixture and package build include the new exports and no longer encourage `secureAndRedact` for new consumers.
- **Functional verification:**
  - [ ] Run `pnpm run docs:build`; pass condition: updated API/privacy docs build successfully.
  - [ ] Run `rg "detect|classify|redact" docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec mention all three short primitive names.
  - [ ] Run `rg "confirmed span|confirmed spans|sensitive refs|sensitiveRef" docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec describe the confirmed-span `redact` primitive and returned sensitive refs.
  - [ ] Run `rg "sanitized|raw candidates|raw candidate" docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec explain sanitized classifier input and that raw candidates are not sent to classifiers.
  - [ ] Run `rg "uncertain|policy" docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec state uncertain handling belongs to harness policy.
  - [ ] Run `rg "secureAndRedact|migration|primitive-first" docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec explain the `secureAndRedact` public API removal/migration and primitive-first replacement.
  - [ ] Run `rg "hosted classifier|hosted Pristine|LLM classifier|does not implement" docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec state the SDK does not provide a hosted classifier or bundled LLM classifier implementation.
  - [ ] Run `rg "listSensitive|getSensitive|updateSensitive|deleteSensitive|resolveSensitive|alias" docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec mention sensitive CRUD and alias label handling.
  - [ ] Run `pnpm run verify:public-api-types`; pass condition: external consumers can import new primitive types and existing supported types.
- **Regression verification:**
  - [ ] Run `pnpm run test:smoke`; pass condition: package build and public API smoke tests remain green.
  - [ ] Run `pnpm run test:unit -- tests/client.test.ts tests/privacy/safety-scan.test.ts tests/vault/sqlite-vault-store.test.ts`; pass condition: public client privacy APIs, scrub behavior, and sensitive CRUD behavior remain green after `secureAndRedact` migration.
- **Manual-only verification:** N/A — docs build, grep checks, smoke tests, and focused unit tests cover this story.
- **Planned commits:**
  1. `docs: document primitive-first privacy api` — update API/privacy docs, implementation spec, public type fixtures, and examples for `detect` → `classify` → `redact` plus `secureAndRedact` migration.
- **Technical notes:** Use public docs wording consistent with recent Vocs positioning: local SDK building blocks, no hosted service, no raw candidates to LLM by default. Keep Pi hook and subagent implementation documentation for a later sprint. The spec update can be an addendum rather than a full rewrite of the older deterministic-only plan. Because classifier labels are visible aliases, docs must warn not to put plaintext secrets in labels/aliases.

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
- **Manual-only verification:** N/A — no manual-only verification is planned for implementation stories; if a later story discovers an unavoidable manual check, record it here and in `## Final Review`.
- **Planned commits:**
  1. `test: complete sprint 030 verification` — record final verification evidence and sprint completion state.
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
- If the sprint introduces new flows, they are folded into `docs/specs/implementation-spec-004.md` before sprint integration.
