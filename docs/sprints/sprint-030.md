# Pristine — Sprint 030
**Date:** 2026-05-18 – TBD
**Goal:** Replace the opinionated `secureAndRedact` flow with short, composable privacy primitives — `detect`, `classify`, and `redact` — so harnesses decide classification policy while Pristine owns safe local detection, sanitized classifier inputs, and vault-backed redaction.
**Status:** 🟢 Complete

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript ESM SDK, Vitest, SQLite/better-sqlite3 privacy vault, local-first privacy APIs, Pi reference examples under `examples/pi-dev/`
- **Current state:** Pristine has an opinionated deterministic privacy pipeline where `secureAndRedact` classifies with built-in/custom regex rules, redacts matching entities, and stores originals in the encrypted local vault. PR #240 added sensitive vault CRUD primitives (`listSensitive`, `getSensitive`, `updateSensitive`, `deleteSensitive`, `resolveSensitive`) and visible metadata aliases. Custom regexes are extensible, but detection, classification policy, and redaction are currently coupled in the high-level `secureAndRedact` flow. Pi-dev examples currently cover memory indexing/search but do not include a privacy input hook.
- **Implementation spec:** `docs/specs/implementation-spec-004.md` — existing secret-redaction spec; this sprint updates it with the Detector / Classifier / Redactor primitive flow because the spec currently reflects the earlier deterministic-only harness plan.

### Sprint-Wide Context

- **Sprint type:** Feature
- **Shared context:** This sprint creates the core SDK building blocks for a future Pi privacy hook. The desired architecture is Detector / Classifier / Redactor with short public primitive names: `detect` finds suspicious `sourceSpan`s and safe hint metadata, `classify` builds raw-value-free classifier requests, invokes a caller-provided classifier callback, and validates/normalizes decisions, and `redact` stores/redacts confirmed `sourceSpan`s locally while returning sensitive refs/placeholders. The SDK should expose reusable contracts and local primitives but should not implement a hosted or provider-specific LLM classifier. `secureAndRedact` is removed from the preferred public flow because it composes an opinionated deterministic classifier differently from the new user/harness-owned classifier callback used by `classify`. `docs/specs/implementation-spec-004.md` must be updated before sprint integration so the durable flow spec matches the new primitive split.
- **Non-goals:** No Pi input hook implementation, no subagent classifier implementation, no SDK-owned LLM classifier, no hosted Pristine service, no third-party secret verification, no large provider-specific catalog beyond the broad v1 candidate classes, no raw candidate values in detector output or sanitized classifier requests, and no composed replacement convenience wrapper for `detect` → `classify` → `redact`.

### Affected Flows

- **Existing flows affected:** Privacy module exports, `secureAndRedact` public API removal/migration surface, implementation-spec-004's current deterministic `secureAndRedact`, §8 Claude Code/harness secret-redaction, custom-pattern/classifier, compatible harness reveal/tool-call, and Pi secret-redaction flows, `reveal`, `scrubOutput`, sensitive vault CRUD/alias APIs, vault redaction/storage, public API type fixture, privacy tests. Pi hook, tool-call reveal, and tool-result scrub implementations remain non-goals for this sprint.
- **New flows introduced:** SDK primitive flow for harness-mediated privacy decisions: `detect(text)` returns raw-value-free candidates with `sourceSpan`s and `hint` metadata → `classify(text, candidates, classifierCallback)` sends sanitized context and marker metadata to the harness classifier callback and returns normalized decisions with `sourceSpan`s → harness policy selects confirmed decisions → `redact(text, confirmed, userId)` slices originals locally, stores them in the local vault, applies safe aliases, and returns redacted text plus `sensitiveRef`, `sourceSpan`, and `redactedSpan` metadata.

### Primitive Surface Targets

- `detect(text, options?) -> DetectResult`: returns `{ sourceSurface?, candidates }`, where each candidate has a non-value-derived `candidateId`, `sourceSpan`, `kind`, `ruleId`, `valueLength`, optional `location`, and optional safe `hint` metadata. It never returns raw matched values.
- `classify(text, candidates, classifierCallback, options?) -> Promise<ClassifyResult>`: builds a sanitized `ClassifierRequest` with `sanitizedContext`, `[CANDIDATE:<id>]` markers, non-value-derived candidate IDs, safe `sourceSpan` metadata, and safe `hint` metadata, invokes the caller-provided callback, then validates and normalizes callback decisions back to `{ candidateId, verdict, sourceSpan, type?, label?, confidence?, rationale? }`. It does not implement or bundle an LLM classifier.
- `redact(text, confirmed, userId, options) -> Promise<RedactResult>`: accepts confirmed secrets with `{ candidateId?, sourceSpan, type, label? }` plus caller-provided vault/key managers, slices raw values locally from the original text, stores them in the local vault, persists safe labels as visible aliases where supplied, and returns `{ text, redactions }` with `sensitiveRef`, placeholder, `sourceSpan`, and `redactedSpan` metadata.

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
  - [x] New shared privacy types live in the privacy/core type surface with names that distinguish `detect` candidate output, `classify` callback requests/decisions, and `redact` confirmed inputs/results.
  - [x] Shared span types define UTF-16 half-open `[start, end)` offsets and use `sourceSpan` for positions in the original text; redaction result types additionally expose `redactedSpan` for placeholder positions in returned text.
  - [x] `detect` candidate types contain stable non-value-derived candidate IDs, detector kind/rule metadata, `sourceSpan`, value length, optional location, and safe `hint` metadata (`suggestedType`, `provider`, `prefixFamily`, `nearbyName`, signals, and features), but no raw matched value field.
  - [x] `classify` request/response types represent raw-value-free sanitized classifier inputs, candidate `marker`s, harness callback decisions, `secret` / `not_secret` / `uncertain` verdicts, sensitivity type, optional label, confidence, and rationale without requiring the SDK to implement an LLM provider.
  - [x] `redact` input/result types carry candidate IDs, `sourceSpan`s, sensitivity type, optional labels, returned `sensitiveRef`s/placeholders, `redactedSpan`s, and alias metadata needed by callers.
  - [x] Root public type exports include the new canonical primitive function contracts/types, root `Pristine` no longer exposes `secureAndRedact`, public docs no longer instruct new consumers to call it, and runtime primitive value exports are deferred to their implementation stories to avoid public throw-only stubs.
- **Functional verification:**
  - [x] Add or update a type-focused smoke fixture in `tests/smoke/public-api-types-fixture.mts`; pass condition: `pnpm run verify:public-api-types` succeeds with `DetectPrimitive`, `ClassifyPrimitive`, `RedactPrimitive`, and their exported primitive types.
  - [x] Add type/shape unit tests or compile-time fixtures proving detector candidates and sanitized classifier requests do not expose a `rawValue`/`text` field for the matched secret and use `hint`, `sourceSpan`, `redactedSpan`, and `sensitiveRef` naming; pass condition: tests or typecheck fail if raw-value fields are required or refined names are missing.
  - [x] Add a public-surface assertion; pass condition: root exports/docs/type fixtures no longer expose or instruct new consumers to call `secureAndRedact` and instead import/use primitive-first contracts.
- **Regression verification:**
  - [x] Run `pnpm run typecheck`; pass condition: existing strict TypeScript compilation remains green after new public types are introduced.
  - [x] Run `pnpm run test:unit -- tests/privacy/safety-scan.test.ts tests/vault/vault-redaction.test.ts tests/vault/sqlite-vault-store.test.ts`; pass condition: existing scrub, placeholder, and sensitive CRUD behavior still passes.
- **Manual-only verification:** N/A — type fixtures and focused tests cover this story.
- **Implementation evidence:**
  - `src/core/types.ts`, `src/core/interfaces.ts`, and `src/privacy/types.ts` define/re-export the primitive contract surface: `DetectCandidate`/`DetectResult`/`DetectPrimitive`, `ClassifierRequest`/`ClassifierCallbackDecision`/`ClassifyResult`/`ClassifyPrimitive`, `RedactConfirmedSecret`/`RedactResult`/`RedactPrimitive`, `SourceSpan`, `TextSpan`, `sourceSpan`, `redactedSpan`, and `sensitiveRef`.
  - `src/index.ts` exports the primitive contract types without publishing throw-only runtime stubs. `tests/smoke/public-api-types-fixture.mts` imports the new type surface and uses `@ts-expect-error` to assert `SecureAndRedactResult` is no longer root-exported for new consumers and `secureAndRedact` is no longer a public `Pristine` client method.
  - `tests/privacy/primitive-contracts.test.ts` passed and asserts candidate/classifier request shapes use safe required `hint` metadata, do not expose `rawValue`/`text` fields for matched secrets, and require `type` on `secret` classifier decisions before downstream redaction.
  - Review fix: runtime primitive value exports were deferred to implementation stories to avoid public throw-only stubs; Story 1 exports stable primitive function contract types instead.
  - Review fix: root `Pristine` no longer exposes `secureAndRedact`; public docs/README now describe the primitive-first `detect` → `classify` → `redact` flow while legacy internals remain available for existing privacy regression tests.
  - `pnpm run build` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-build-reviewfix-XXXX.log.Ovi5i86hi5`.
  - `pnpm run verify:public-api-types` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-public-api-types-reviewfix-XXXX.log.2fG2dn49pc`.
  - `pnpm run test:smoke` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-smoke-reviewfix-XXXX.log.PSPhomYxTf`.
  - `pnpm run docs:build` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-docs-build-reviewfix-XXXX.log.KI6ea1U6Xi`.
  - `! rg -n "secureAndRedact|SecureAndRedactResult" README.md docs/pages` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-public-docs-rg-p2fix-XXXX.log.OSY1wwiKEw`.
  - `pnpm run typecheck` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-typecheck-reviewfix-XXXX.log.UcAs14dxKm`.
  - `pnpm run test:unit -- tests/client.test.ts tests/privacy/primitive-contracts.test.ts tests/privacy/safety-scan.test.ts tests/vault/vault-redaction.test.ts tests/vault/sqlite-vault-store.test.ts` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-target-unit-reviewfix-XXXX.log.tTHnzv2pdW`.
  - `pnpm run test:unit` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-unit-reviewfix-XXXX.log.QBiW5LaG1L`.
  - `pnpm run lint` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-lint-reviewfix-XXXX.log.xBNV3lDGCf`.
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
  - [x] A new `detect(text, options?)` public primitive detects secret candidates in a text string without performing final secret classification or vault redaction, and is configurable by callers through rule enable/disable, custom detector rules, sensitivity presets, and source-surface metadata.
  - [x] The detector covers broad v1 candidate classes: private key blocks, sensitive key/value assignments, auth headers, known provider prefixes, JWT/PASETO-like structured tokens, credential-bearing URLs, cookies/session tokens, signed URLs/query secrets, cloud credential blocks, recovery/seed phrases, and opaque generated-looking values.
  - [x] `detect` output includes `sourceSpan` offsets, candidate kind, rule ID, value length, line/column or equivalent location metadata, and safe `hint` metadata with `prefixFamily` where applicable, `provider` where guessed, `suggestedType` where the rule has one, and `positiveSignals` / `negativeSignals` arrays with at least key/header/parameter context, detector confidence reason, example/placeholder signal, and hash/public-id signal when those facts are present.
  - [x] `detect` output does not include the raw matched value, raw prefixes/suffixes, or value-derived candidate IDs; raw values remain recoverable only by local code that already has the original text and `sourceSpan` offsets.
  - [x] Overlapping detector matches are normalized so higher-signal or longer candidates are not duplicated before `classify` receives them.
- **Functional verification:**
  - [x] Add detector unit tests with at least one fixture for each broad v1 candidate class; pass condition: every fixture returns an expected candidate kind/rule ID, `sourceSpan`, value length, location metadata, `hint.prefixFamily` where applicable, `hint.provider`/`hint.suggestedType` where applicable, and asserted `hint.positiveSignals` such as `known_provider_prefix`, `sensitive_key_name`, `auth_header_context`, `query_secret_param`, `credential_url_context`, `detector_confidence_high`, or equivalent rule-specific confidence/context signals.
  - [x] Add detector configuration tests; pass condition: rule enable/disable changes emitted candidates, a custom detector rule emits the documented safe candidate shape without raw values, `broad`/`balanced`/`strict` sensitivity presets produce the documented candidate-count or signal differences, and `sourceSurface` metadata is propagated to the detect result or downstream classifier request.
  - [x] Add noisy non-secret fixtures for hashes, commit SHAs, UUIDs, package versions, example placeholders, and public IDs; pass condition: either no candidate is emitted or emitted candidates include asserted `negativeSignals` such as `looks_like_commit_sha`, `looks_like_uuid`, `looks_like_package_version`, `looks_like_placeholder`, or `looks_like_public_id`.
  - [x] Add an overlap/deduplication test; pass condition: nested matches such as an auth header containing a provider token produce the intended normalized candidate set without duplicate `sourceSpan`s.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/classifier/deterministic-classifier.test.ts tests/privacy/safety-scan.test.ts`; pass condition: existing custom-pattern detection and scrub behavior still passes while the new `detect` primitive remains candidate-only.
  - [x] Run `pnpm run lint`; pass condition: detector regex implementation satisfies lint and contains no debug logging.
- **Manual-only verification:** N/A — detector fixtures cover this story.
- **Implementation evidence:**
  - `src/privacy/detector/` implements the candidate-only `detect` primitive with modular rule helpers, built-in rules, custom detector rule support, overlap normalization, and stable non-value-derived candidate IDs.
  - `tests/privacy/detect.test.ts` covers all broad v1 candidate classes, source spans, value lengths, location metadata, safe hints, provider/prefix metadata, positive/negative signals, configuration behavior, custom rules, source-surface propagation, broad/balanced/strict presets, noisy fixtures, and auth-header/provider overlap normalization.
  - `src/index.ts`, smoke tests, and public API type fixture export/import the root `detect` value while keeping `classify` and `redact` as deferred contract types.
  - `pnpm run test:unit -- tests/privacy/detect.test.ts tests/classifier/deterministic-classifier.test.ts tests/privacy/safety-scan.test.ts` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-detect-reviewfix2-test-XXXX.log.gfz4LyKeEv`.
  - `pnpm run build` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-build-detect-XXXX.log.mxTD0oLE2w`.
  - `pnpm run verify:public-api-types` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-api-detect-XXXX.log.3D6gU3JmNU`.
  - `pnpm run test:smoke` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-smoke-detect-XXXX.log.Rr5hhLWx6Q`.
  - `pnpm run typecheck` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-typecheck-detect-reviewfix2-XXXX.log.wZsfNtY0jl`.
  - `pnpm run lint` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-lint-detect-reviewfix2-XXXX.log.6YjVG3zrQI`.
  - `pnpm run test:unit` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-unit-detect-XXXX.log.otQsgt5rUK`.
- **Planned commits:**
  1. `feat: add detect privacy primitive` — add `detect`, candidate rules, overlap normalization, and focused fixtures.
- **Technical notes:** Treat regexes as candidate detectors, not truth classifiers. `detect` should accept extensible detector rules/options, but extension must preserve the no-raw-value output contract and avoid value-derived IDs. Keep `hint` metadata explicit enough for classifier prompts and test assertions without exposing raw candidate substrings.

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
  - [x] A new `classify(text, candidates, classifierCallback, options?)` public primitive builds sanitized classifier input internally, invokes a caller-provided classifier callback, and returns normalized candidate decisions with original `sourceSpan`s for downstream policy/redaction.
  - [x] The classifier callback receives `requestId`, `sourceSurface`, `sanitizedContext`, and `candidates[]`; each candidate entry includes `candidateId`, `marker`, `kind`, `ruleId`, safe `sourceSpan` metadata, and safe `hint` metadata (`valueLength`, `location`, `features`, `prefixFamily`, `provider`, `nearbyName`, `suggestedType`, `positiveSignals`, `negativeSignals`) where applicable.
  - [x] `classify` replaces all candidate `sourceSpan`s in included context with `[CANDIDATE:<id>]` markers, including candidates other than the callback request's primary candidate when per-candidate requests are used.
  - [x] The classifier callback input does not include raw candidate strings, arbitrary raw prefixes/suffixes, decoded JWT payload values, connection-string passwords, query secret values, or seed phrase words; any `sourceSpan` metadata is numeric offset metadata only.
  - [x] `classify` validates callback output for known candidate IDs, allowed verdicts (`secret`, `not_secret`, `uncertain`), valid sensitivity type/label fields, confidence shape (`0..1`), and duplicate/missing candidate decisions.
- **Functional verification:**
  - [x] Add `classify` callback-input tests using multi-candidate user messages; pass condition: all raw candidate strings are absent from serialized callback input and each candidate marker appears in sanitized context.
  - [x] Add a callback request shape fixture/test; pass condition: classifier requests include `requestId`, `sourceSurface`, `sanitizedContext`, `candidates[]`, and candidate `candidateId`, `marker`, `kind`, `ruleId`, `sourceSpan`, and `hint` fields (`valueLength`, `location`, `features`, `prefixFamily`, `provider`, `nearbyName`, `suggestedType`, `positiveSignals`, `negativeSignals`) where applicable, without raw candidate leakage.
  - [x] Add tests for safe provider prefix-family metadata; pass condition: allowed labels such as `sk-proj`, `ghp_`, and `AKIA` are represented as `hint.prefixFamily` metadata for classifier signal while arbitrary unknown candidate prefixes are not exposed and no prefix-family metadata is treated as a non-secret verdict.
  - [x] Add JWT/URL/seed phrase sanitization tests; pass condition: classifier callback input does not contain decoded payload values, URL passwords, query secret values, or seed words.
  - [x] Add classifier output validation tests; pass condition: duplicate, unknown, missing, malformed, or invalid verdict/type/label/confidence outputs fail loudly with domain-specific errors or structured failures before `redact` can run, and valid outputs normalize back to decisions containing original `sourceSpan`s.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/vault/vault-redaction.test.ts tests/privacy/safety-scan.test.ts`; pass condition: existing placeholder and scrubbing behavior is unchanged.
  - [x] Run `pnpm run typecheck`; pass condition: `classify` request/decision types compile cleanly with strict TypeScript.
- **Verification evidence:**
  - `pnpm run test:unit -- tests/privacy/classify.test.ts tests/privacy/primitive-contracts.test.ts tests/vault/vault-redaction.test.ts tests/privacy/safety-scan.test.ts` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story3-reviewfix2-targeted-XXXX.log.cbrBbhvxRG`.
  - `pnpm run typecheck` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story3-reviewfix2-typecheck-XXXX.log.aqxdiXg1SI`.
  - `pnpm run lint` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story3-reviewfix2-lint-XXXX.log.IyJI5X29Vw`.
  - `pnpm run build` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story3-reviewfix2-build-XXXX.log.mXTsxpr59o`.
  - `pnpm run verify:public-api-types` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story3-reviewfix2-public-api-XXXX.log.B74ID7qc9x`.
  - `pnpm run test:smoke` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story3-reviewfix2-smoke-XXXX.log.Mk2V9CG4Kh`.
- **Manual-only verification:** N/A — leak-focused serialization and callback validation tests cover this story.
- **Planned commits:**
  1. `feat: add classify privacy primitive` — add `classify`, sanitized callback request construction, callback output validation, leak-focused tests, and request JSON fixtures.
- **Technical notes:** This story owns the privacy boundary for classifier prompts: no full raw candidates. Prefer stable, explicit `hint` metadata and `[CANDIDATE:<id>]` markers over partial raw value previews. The SDK provides request construction, callback contract, and validation; the harness owns any LLM/subagent/manual classifier implementation.

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
  - [x] A new `redact(text, confirmed, userId, options)` public primitive accepts original text, user/vault/key configuration, and confirmed secrets with `sourceSpan`/type/optional label, then returns redacted text and `sensitiveRef`s/placeholders while storing originals in the encrypted vault.
  - [x] `redact` slices raw values locally from the original text using `sourceSpan` offsets and does not require confirmed secret inputs to carry raw values.
  - [x] `redact` validates `sourceSpan` bounds, rejects or reports overlapping/invalid confirmed secrets with domain-specific errors or structured failure results, and preserves deterministic behavior for valid non-overlapping spans.
  - [x] Optional classifier-provided labels are persisted as visible metadata aliases for the resulting `sensitiveRef`s using the PR #240 sensitive CRUD/vault metadata path, with safe fallback aliases or no alias for unlabeled spans.
  - [x] `redact` result redaction metadata includes `candidateId` where available, `sensitiveRef`, placeholder, type, label, original `sourceSpan`, and `redactedSpan` in the returned text.
  - [x] `reveal` can restore values redacted by `redact`, and `resolveSensitive` can resolve each returned `sensitiveRef` for the same user.
- **Functional verification:**
  - [x] Add integration tests for `redact`; pass condition: confirmed `sourceSpan`s are replaced with `[SENSITIVE:<type>:<id>]`, originals are absent from redacted text, `sensitiveRef`s/placeholder IDs are returned, `sourceSpan` and `redactedSpan` are correct, and vault entries exist.
  - [x] Add a reveal/resolve round-trip test; pass condition: `reveal` restores text redacted by `redact`, and `resolveSensitive` returns the original value for each returned `sensitiveRef` for the same user.
  - [x] Add validation tests for invalid, out-of-bounds, and overlapping `sourceSpan`s; pass condition: invalid input fails loudly without writing partial vault entries.
  - [x] Add label/alias tests; pass condition: supplied labels are persisted as visible aliases returned by `getSensitive`/`listSensitive`, unlabeled spans use the documented fallback/no-alias behavior, and aliases never contain raw secret values.
- **Regression verification:**
  - [x] Run `pnpm run test:integration -- tests/integration/privacy.test.ts tests/integration/kek-lifecycle.test.ts`; pass condition: existing reveal/scrub/vault lifecycle and PR #240 sensitive CRUD behavior remain green.
  - [x] Run `pnpm run test:unit -- tests/vault/vault-redaction.test.ts tests/vault/sqlite-vault-store.test.ts`; pass condition: existing redaction and vault store behavior is unchanged.
- **Verification evidence:**
  - `pnpm run test:integration -- tests/integration/redact.test.ts tests/integration/privacy.test.ts tests/integration/kek-lifecycle.test.ts` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story4-reviewfix-targeted-XXXX.log.Yucv8P4qVl`.
  - `pnpm run test:unit -- tests/vault/vault-redaction.test.ts tests/vault/sqlite-vault-store.test.ts tests/privacy/primitive-contracts.test.ts` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story4-reviewfix-unit-XXXX.log.4kvxYv5xc2`.
  - `pnpm run typecheck` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story4-reviewfix-typecheck-XXXX.log.fRoRHmtqQw`.
  - `pnpm run lint` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story4-reviewfix-lint-XXXX.log.nA3lSteHml`.
  - `pnpm run build` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story4-reviewfix-build-XXXX.log.JSN3Jps7hi`.
  - `pnpm run verify:public-api-types` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story4-reviewfix-public-api-XXXX.log.Nqjave1zSo`.
  - `pnpm run test:smoke` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story4-reviewfix-smoke-XXXX.log.mh4s8NkQqI`.
- **Manual-only verification:** N/A — integration and unit tests cover this story.
- **Planned commits:**
  1. `feat: add redact privacy primitive` — add `redact`, validation, vault storage integration, alias persistence, and round-trip tests.
- **Technical notes:** Reuse existing vault encryption/key/KekManager paths and PR #240 sensitive CRUD metadata aliases. Classifier labels are visible metadata, not secrets; validate or document that callers must not put raw secret values in aliases. Keep source and redacted spans distinct because placeholder insertion changes offsets.

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
  - [x] Public API docs describe short primitive names `detect`, `classify`, and `redact`, and clearly state that the SDK does not send raw candidates to any LLM or implement a hosted/bundled classifier.
  - [x] Primitive-flow migration is documented in tracked public docs; local ignored `docs/specs/implementation-spec-004.md` was also updated with a dedicated `detect` → `classify` → `redact` addendum per repo policy that internal specs are not committed to the public repository.
  - [x] Privacy guide docs show a concise composition example: `detect(text)` → `classify(text, candidates, classifierCallback)` → harness policy maps secret decisions to confirmed `{ sourceSpan, type, label }` inputs → `redact(text, confirmed, userId)`.
  - [x] Docs explain that deterministic regex-only behavior can be implemented as a user/example classifier callback composition, not as a privileged `secureAndRedact` SDK wrapper.
  - [x] Docs warn that classifier policy, including `uncertain` handling, belongs to the harness/tool/extension/skill using the primitives.
  - [x] Docs describe PR #240 sensitive CRUD primitives and state classifier labels are visible aliases stored via `updateSensitive`, never raw secrets.
  - [x] Public API type fixture and package build include the new exports and no longer encourage `secureAndRedact` for new consumers.
- **Functional verification:**
  - [x] Run `pnpm run docs:build`; pass condition: updated API/privacy docs build successfully.
  - [x] Run individual `rg` checks for `detect`, `classify`, and `redact` in `docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec mention each short primitive name.
  - [x] Run individual `rg` checks for `sourceSpan`, `redactedSpan`, `sensitiveRef`, and `sensitive refs` in `docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec describe confirmed-secret `sourceSpan` inputs, `redact` output spans, and returned sensitive refs.
  - [x] Run individual `rg` checks for `sanitized`, `raw candidate`, `classifierCallback`, `hint`, and `marker` in `docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec explain sanitized classifier callback input, candidate markers/hints, and that raw candidates are not sent to classifiers.
  - [x] Run individual `rg` checks for `uncertain` and `policy` in `docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec state uncertain handling belongs to harness policy.
  - [x] Run individual `rg` checks for `secureAndRedact`, `migration`, and `primitive-first` in `docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec explain the `secureAndRedact` public API removal/migration and primitive-first replacement.
  - [x] Run individual `rg` checks for `hosted classifier`, `LLM classifier`, and `does not implement` in `docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec state the SDK does not provide a hosted classifier or bundled LLM classifier implementation.
  - [x] Run individual `rg` checks for `listSensitive`, `getSensitive`, `updateSensitive`, `deleteSensitive`, `resolveSensitive`, and `alias` in `docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec mention every sensitive CRUD primitive and alias label handling.
  - [x] Run `pnpm run verify:public-api-types`; pass condition: external consumers can import new primitive types and existing supported types.
- **Regression verification:**
  - [x] Run `pnpm run test:smoke`; pass condition: package build and public API smoke tests remain green.
  - [x] Run `pnpm run test:unit -- tests/client.test.ts tests/privacy/safety-scan.test.ts tests/vault/sqlite-vault-store.test.ts`; pass condition: public client privacy APIs, scrub behavior, and sensitive CRUD behavior remain green after `secureAndRedact` migration.
- **Verification evidence:**
  - `pnpm run docs:build` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story5-reviewfix-docs-build-XXXX.log.og2KImL0HH`.
  - `pnpm run verify:public-api-types` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story5-public-api-XXXX.log.kRWxFp8t5s`.
  - `pnpm run test:smoke` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story5-smoke-XXXX.log.boQFlYxeaA`.
  - `pnpm run test:unit -- tests/client.test.ts tests/privacy/safety-scan.test.ts tests/vault/sqlite-vault-store.test.ts` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story5-unit-XXXX.log.KdYDsLSIrn`.
  - `pnpm run typecheck` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story5-typecheck-XXXX.log.uELVTHYRwg`.
  - `pnpm run lint` passed; log: `/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-story5-lint-XXXX.log.te1uNP1CA8`.
  - `rg` checks for `detect`, `classify`, `redact`, `sourceSpan`, `redactedSpan`, `sensitiveRef`, `sensitive refs`, `sanitized`, `raw candidate`, `classifierCallback`, `hint`, `marker`, `uncertain`, `policy`, `secureAndRedact`, `migration`, `primitive-first`, `hosted classifier`, `LLM classifier`, `does not implement`, `listSensitive`, `getSensitive`, `updateSensitive`, `deleteSensitive`, `resolveSensitive`, and `alias` passed against `docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`.
- **Manual-only verification:** N/A — docs build, grep checks, smoke tests, and focused unit tests cover this story.
- **Planned commits:**
  1. `docs: document primitive-first privacy api` — update API/privacy docs, implementation spec, public type fixtures, and examples for `detect` → `classify` → `redact`, refined schema names (`hint`, `sourceSpan`, `redactedSpan`, `sensitiveRef`), and `secureAndRedact` migration.
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
  - [x] Every story’s acceptance criteria are evaluated against implementation evidence.
  - [x] Every story’s functional verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [x] Every story’s targeted regression verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [x] The full available regression verification suite is run, including existing unit, integration, e2e, smoke, simulator/browser/device, static, and manual-only checks where applicable.
  - [x] Failed, ambiguous, manual-only, or unrun verification items are documented.
  - [x] The sprint’s new functional verification is identified as future regression verification.
  - [x] Verification delta is reported by canonical type, showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals, with rows for every canonical verification type including zero-count rows and rationale for any `Unknown` values.
  - [x] The sprint doc status is updated to `🟢 Complete` only if completion criteria are met.
  - [x] A `## Final Review` section is appended to the sprint doc with the final completion message quoted for auditability.
- **Functional verification:**
  - [x] Run all functional verification items from every story and record pass/fail evidence.
- **Regression verification:**
  - [x] Run all targeted regression verification items from every story and record pass/fail evidence.
  - [x] Run the full available regression verification suite and record pass/fail evidence.
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

## Final Review

**Mergeability:** 4/5 from Final Verification Story `/review`; P2 signature cleanup applied in follow-up commit.

## Sprint objective + accomplishments

**Objective:** Replace the opinionated `secureAndRedact` flow with short, composable privacy primitives — `detect`, `classify`, and `redact` — so harnesses decide classification policy while Pristine owns safe local detection, sanitized classifier inputs, and vault-backed redaction.

**What was accomplished:**
- **Story 1 — Define privacy primitive contracts** — Added public contracts for `detect`, `classify`, and `redact`, including raw-value-free detector/classifier shapes and vault redaction result metadata. Public client/root guidance no longer presents `secureAndRedact` as the preferred flow; evidence is recorded in Story 1 and PR #253.
- **Story 2 — Implement `detect`** — Added root `detect` plus built-in broad candidate detection, custom rules, overlap normalization, source metadata, and hint sanitization. Leak-focused detector tests and public API smoke/type fixtures prove candidates do not expose raw values; evidence is recorded in Story 2 and PR #254.
- **Story 3 — Implement `classify`** — Added root `classify`, sanitized marker context, allowlisted hint/source-surface metadata, context windows, callback validation, and normalized decisions. Multi-candidate, JWT/URL/query/seed, raw prefix/suffix, and callback validation tests prove the classifier boundary; evidence is recorded in Story 3 and PR #255.
- **Story 4 — Implement `redact`** — Added root `redact`, exact-span slicing, encrypted vault persistence, safe label aliases, placeholder metadata, and reveal/resolve round-trips. Integration tests prove vault storage, invalid-span rejection without partial writes, custom type preservation, and raw-label suppression; evidence is recorded in Story 4 and PR #256.
- **Story 5 — Document primitive-first privacy API** — Updated README and public privacy/API docs for the primitive-first flow, classifier policy ownership, no hosted/bundled LLM classifier, sensitive-ref CRUD, and `secureAndRedact` migration. The ignored local implementation spec was updated as internal context but is intentionally not committed; tracked docs carry the public migration evidence in Story 5 and PR #257.

## Verification delta

| Verification type | Before sprint | Added this sprint | Removed | Pending / not yet run | After sprint | Notes |
|---|---:|---:|---:|---:|---:|---|
| Unit | 32 | +3 | 0 | 0 | 35 | Added `tests/privacy/detect.test.ts`, `tests/privacy/classify.test.ts`, and `tests/privacy/primitive-contracts.test.ts`; existing unit suite passed in `pnpm run test`. |
| Integration / contract | 3 | +1 | 0 | 0 | 4 | Added `tests/integration/redact.test.ts`; existing privacy and KEK lifecycle integration tests passed in `pnpm run test`. |
| E2E / smoke | 4 | +0 | 0 | 0 | 4 | Existing smoke/e2e suites remained green; smoke public API fixtures were updated for primitive exports. |
| Simulator / device | 0 | +0 | 0 | 0 | 0 | No simulator/device surface in this SDK sprint. |
| AI / model evals | 0 | +0 | 0 | 0 | 0 | No hosted or bundled LLM classifier/eval surface was added. |
| Static / local checks | 4 | +0 | 0 | 0 | 4 | `typecheck`, `lint`, `docs:build`, and public API type verification all passed. |
| Performance / load | 0 | +0 | 0 | 0 | 0 | No performance/load suite exists for this repo. |
| Security / dependency | 0 | +0 | 0 | 0 | 0 | No dependency changes; security-sensitive behavior covered by privacy leak tests and review checks. |
| Accessibility / visual | 0 | +0 | 0 | 0 | 0 | No UI surface. |
| Manual-only | 0 | +0 | 0 | 0 | 0 | No manual-only verification required. |
| Other verification | 0 | +1 | 0 | 0 | 1 | Story 5 added explicit docs `rg` verification across privacy/API/spec terms. |
| **Total** | **43** | **+5** | **0** | **0** | **48** | Counting basis: test files by suite plus static/local check surfaces and docs term-check surface. |

Counting basis: test files for Unit, Integration / contract, and E2E / smoke; recurring command surfaces for Static / local checks; explicit documentation term-check group for Other verification. Regression summary: 0 existing regression verifications pending/not yet run; full `pnpm run test`, `docs:build`, `typecheck`, and `lint` passed for final verification.

## Why ready

- All implementation story ACs are checked with evidence in the story sections and merged story PRs #253–#257.
- Functional verification for new `detect`, `classify`, `redact`, and docs behavior is automated and recorded in each story.
- Full regression verification passed: `pnpm run test` (`/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-sprint030-final-test-XXXX.log.MIlsMfzMkU`), `pnpm run docs:build` (`/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-sprint030-final-docs-XXXX.log.6SSjVzHC6G`), `pnpm run typecheck` (`/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-sprint030-final-typecheck-XXXX.log.LfvodU4Mzw`), and `pnpm run lint` (`/var/folders/d9/c72wvkps2px78k5rcxwg8rdr0000gn/T/pristine-sprint030-final-lint-XXXX.log.pZUJjncwuZ`).
- Final Verification Story review/mergeability gate will be recorded after PR review completes.

## Open for your decision

None — fully automated verification.

## Delivered

| Story | Item | Status | Evidence |
|---|---|---|---|
| Story 1 — Contracts | Primitive contracts and public-surface migration | ✅ | PR #253, `tests/privacy/primitive-contracts.test.ts`, public API fixtures. |
| Story 2 — Detect | Raw-value-free candidate detection | ✅ | PR #254, `tests/privacy/detect.test.ts`, public API smoke/type fixtures. |
| Story 3 — Classify | Sanitized classifier callback boundary | ✅ | PR #255, `tests/privacy/classify.test.ts`. |
| Story 4 — Redact | Vault-backed exact-span redaction | ✅ | PR #256, `tests/integration/redact.test.ts`. |
| Story 5 — Docs | Primitive-first docs and migration guidance | ✅ | PR #257, docs build, public API verification, and docs `rg` checks. |
| Final Verification | Full regression suite | ✅ | `pnpm run test`, `docs:build`, `typecheck`, and `lint` logs listed above. |

## Drift from spec

- The durable public flow is now primitive-first `detect` → `classify` → `redact`; `secureAndRedact` remains legacy/internal compatibility behavior rather than the preferred public API.
- `docs/specs/implementation-spec-004.md` is ignored by repository policy, so the implementation-spec addendum was updated locally while tracked public docs carry the committed migration guidance.

## New Dependencies

None
