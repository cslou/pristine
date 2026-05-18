# Pristine — Sprint 030
**Date:** 2026-05-18 – TBD
**Goal:** Add reusable privacy primitives for secret-candidate detection, sanitized classifier packets, and confirmed-span vault redaction so harnesses can compose LLM-mediated secret decisions without changing the existing `secureAndRedact` convenience flow.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript ESM SDK, Vitest, SQLite/better-sqlite3 privacy vault, local-first privacy APIs, Pi reference examples under `examples/pi-dev/`
- **Current state:** Pristine has a deterministic privacy pipeline where `secureAndRedact` classifies with built-in/custom regex rules, redacts matching entities, stores originals in the encrypted local vault, and supports `reveal`/`scrubOutput`. Custom regexes are extensible, but detection, classification, and redaction are currently coupled in the high-level flow. Pi-dev examples currently cover memory indexing/search but do not include a privacy input hook.
- **Implementation spec:** `docs/specs/implementation-spec-004.md` — existing secret-redaction spec; this sprint updates it with the Detector / Classifier / Redactor primitive flow because the spec currently reflects the earlier deterministic-only harness plan.

### Sprint-Wide Context

- **Sprint type:** Feature
- **Shared context:** This sprint creates the core SDK building blocks for a future Pi privacy hook. The desired architecture is Detector / Classifier / Redactor: detectors find suspicious spans and metadata, harness classifiers decide `secret` / `not_secret` / `uncertain` from sanitized packets, and redactors store/redact confirmed spans locally. The SDK should expose reusable contracts and local primitives but should not implement a hosted or provider-specific LLM classifier. Existing `secureAndRedact` remains available and unchanged as a deterministic convenience API. `docs/specs/implementation-spec-004.md` must be updated before sprint integration so the durable flow spec matches the new primitive split.
- **Non-goals:** No Pi input hook implementation, no subagent classifier implementation, no hosted Pristine service, no third-party secret verification, no large provider-specific catalog beyond the broad v1 candidate classes, no breaking changes to existing privacy APIs, and no raw candidate values in detector output or sanitized classifier packets.

### Affected Flows

- **Existing flows affected:** Privacy module exports, deterministic `secureAndRedact` regression surface, `reveal`, `scrubOutput`, vault redaction/storage, public API type fixture, privacy tests.
- **New flows introduced:** SDK flow for harness-mediated privacy decisions: detect secret candidates locally → build sanitized classifier packets → receive harness-owned classifier verdicts/policy → secure confirmed spans into the local vault and return redacted text.

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

#### Story 1: Define privacy primitive contracts and module boundaries
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
- **As a** SDK integrator, **I want** explicit Detector / Classifier / Redactor contracts, **so that** I can compose local candidate detection, harness-owned LLM classification, and local vault redaction without relying on a monolithic privacy pipeline.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] New shared privacy candidate/classification/redaction types live in the privacy/core type surface with names that distinguish detector output from classifier verdicts and confirmed redaction spans.
  - [ ] Detector candidate types contain stable candidate IDs, span offsets, detector kind/rule metadata, and derived shape/context signals, but no raw matched value field.
  - [ ] Classifier request/response types represent sanitized packets, `secret` / `not_secret` / `uncertain` verdicts, sensitivity type, optional label, confidence, and rationale without requiring the SDK to implement an LLM provider.
  - [ ] Confirmed-span redaction input types carry candidate IDs, span offsets, sensitivity type, and optional labels needed by the redactor.
  - [ ] Root public exports include the new canonical types needed by consumers, and the public API type fixture imports them successfully.
- **Functional verification:**
  - [ ] Add or update a type-focused smoke fixture in `tests/smoke/public-api-types-fixture.mts`; pass condition: `npm run verify:public-api-types` succeeds with the new exported primitive types.
  - [ ] Add type/shape unit tests or compile-time fixtures proving detector candidates and sanitized packets do not expose a `rawValue`/`text` field for the matched secret; pass condition: tests or typecheck fail if such a public field is required.
- **Regression verification:**
  - [ ] Run `npm run typecheck`; pass condition: existing strict TypeScript compilation remains green after new public types are introduced.
  - [ ] Run `npm run test:unit -- tests/privacy/secure-and-redact.test.ts tests/privacy/safety-scan.test.ts tests/vault/vault-redaction.test.ts`; pass condition: existing deterministic privacy behavior still passes.
- **Manual-only verification:** N/A — type fixtures and focused tests cover this story.
- **Planned commits:**
  1. `feat: define privacy primitive contracts` — add candidate/classifier/redactor types and public exports without runtime behavior changes.
- **Technical notes:** Keep all module contracts in `src/core/interfaces.ts` and shared types in `src/core/types.ts` where they are general SDK contracts; privacy-specific helper exports can re-export from `src/privacy/` as needed. Do not add Anthropic/OpenAI SDK dependencies.

#### Story 2: Implement broad secret candidate detector
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
  - Findings: P2 from sprint-doc-reviewer: AC-3 required rich detector metadata, but functional verification did not explicitly assert value length, location metadata, prefix-family metadata, or positive signal fields.
  - Resolution: Expanded detector fixture verification to assert value length, location metadata, allowed prefix-family metadata, and positive/negative signal fields where applicable.
- **As a** harness developer, **I want** a broad local detector that returns suspicious secret candidates with metadata, **so that** my harness can cast a wide net before asking its own classifier to decide policy.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [ ] A new detector module exposes a function or class for detecting secret candidates in a text string without performing final secret classification or vault redaction.
  - [ ] The detector covers broad v1 candidate classes: private key blocks, sensitive key/value assignments, auth headers, known provider prefixes, JWT/PASETO-like structured tokens, credential-bearing URLs, cookies/session tokens, signed URLs/query secrets, cloud credential blocks, recovery/seed phrases, and opaque generated-looking values.
  - [ ] Detector output includes span offsets, candidate kind, rule ID, value length, line/column or equivalent location metadata, allowed provider prefix-family metadata where applicable, and explicit `positiveSignals` / `negativeSignals` arrays with at least key/header/parameter context, detector confidence reason, example/placeholder signal, and hash/public-id signal when those facts are present.
  - [ ] Detector output does not include the raw matched value; raw values remain recoverable only by local code that already has the original text and span offsets.
  - [ ] Overlapping detector matches are normalized so higher-signal or longer candidates are not duplicated in classifier packets.
- **Functional verification:**
  - [ ] Add detector unit tests with at least one fixture for each broad v1 candidate class; pass condition: every fixture returns an expected candidate kind/rule ID, span, value length, location metadata, allowed prefix-family metadata where applicable, and positive signal fields for the secret-looking value.
  - [ ] Add noisy non-secret fixtures for hashes, commit SHAs, UUIDs, package versions, example placeholders, and public IDs; pass condition: either no candidate is emitted or emitted candidates include asserted `negativeSignals` such as `looks_like_commit_sha`, `looks_like_uuid`, `looks_like_package_version`, `looks_like_placeholder`, or `looks_like_public_id`.
  - [ ] Add an overlap/deduplication test; pass condition: nested matches such as an auth header containing a provider token produce the intended normalized candidate set without duplicate raw spans.
- **Regression verification:**
  - [ ] Run `npm run test:unit -- tests/classifier/deterministic-classifier.test.ts tests/privacy/safety-scan.test.ts`; pass condition: existing deterministic classifier/custom regex and scrub behavior still passes.
  - [ ] Run `npm run lint`; pass condition: detector regex implementation satisfies lint and contains no debug logging.
- **Manual-only verification:** N/A — detector fixtures cover this story.
- **Planned commits:**
  1. `feat: detect secret candidates` — add detector module, candidate rules, overlap normalization, and focused fixtures.
- **Technical notes:** Treat regexes as candidate detectors, not truth classifiers. Avoid unsafe user-configured regex execution in this detector story; custom pattern integration can remain with existing deterministic classifier unless a small adapter is needed. Keep rule metadata explicit enough for classifier prompts and test assertions.

#### Story 3: Build sanitized classifier packet generation
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
  - Findings: P2 from sprint-doc-reviewer: AC-5 defined a stable JSON request shape, but verification did not explicitly assert required public fields.
  - Resolution: Added a packet-shape fixture/test requiring serialized `requestId`, `sourceSurface`, `sanitizedContext`, `candidates[]`, candidate `location`, `features`, and no raw candidate leakage.
- **As a** harness classifier author, **I want** sanitized candidate packets with full redacted context and rich metadata, **so that** an LLM or local policy can decide whether a candidate is a secret without seeing the full raw candidate.
- **Dependencies:** Story 1, Story 2
- **Acceptance criteria:**
  - [ ] A packet builder accepts original text plus detector candidates and returns classifier request packets where all candidate spans in included context are replaced with `[CANDIDATE:<id>]` placeholders.
  - [ ] Packet metadata includes candidate kind/rule ID, value length, character-class features, allowed provider prefix-family metadata, nearby key/header/parameter names, source surface, positive signals, and negative signals where available.
  - [ ] Packet generation supports full sanitized context for a user message while ensuring every detected candidate span is redacted, including candidates other than the packet's primary candidate.
  - [ ] Packet generation does not include raw candidate strings, arbitrary raw prefixes/suffixes, decoded JWT payload values, connection-string passwords, or seed phrase words.
  - [ ] Packet generation exposes a stable JSON request shape with `requestId`, `sourceSurface`, `sanitizedContext`, and `candidates[]`; each candidate entry includes `candidateId`, `kind`, `ruleId`, `span`, `location`, `valueLength`, `features`, `allowedPrefixFamily`, `providerGuess`, `nearbyName`, `positiveSignals`, and `negativeSignals` fields where applicable.
- **Functional verification:**
  - [ ] Add packet builder unit tests using multi-candidate user messages; pass condition: all raw candidate strings are absent from serialized packets and each candidate placeholder appears in the sanitized context.
  - [ ] Add a packet-shape fixture/test; pass condition: serialized classifier requests include `requestId`, `sourceSurface`, `sanitizedContext`, `candidates[]`, and candidate `candidateId`, `kind`, `ruleId`, `span`, `location`, `features`, `positiveSignals`, and `negativeSignals` fields without raw candidate leakage.
  - [ ] Add tests for allowed provider prefix-family metadata; pass condition: allowed labels such as `sk-proj`, `ghp_`, and `AKIA` are represented as metadata for classifier signal while arbitrary unknown candidate prefixes are not exposed and no prefix-family metadata is treated as a non-secret verdict.
  - [ ] Add JWT/URL/seed phrase sanitization tests; pass condition: serialized packets do not contain decoded payload values, URL passwords, query secret values, or seed words.
- **Regression verification:**
  - [ ] Run `npm run test:unit -- tests/vault/vault-redaction.test.ts tests/privacy/safety-scan.test.ts`; pass condition: existing placeholder and scrubbing behavior is unchanged.
  - [ ] Run `npm run typecheck`; pass condition: packet types compile cleanly with strict TypeScript.
- **Manual-only verification:** N/A — leak-focused serialization tests cover this story.
- **Planned commits:**
  1. `feat: build sanitized secret candidate packets` — add packet builder, leak-focused tests, and classifier request JSON fixtures.
- **Technical notes:** This story owns the privacy boundary for classifier prompts: no full raw candidates. Prefer stable, explicit metadata over partial raw value previews.

#### Story 4: Add confirmed-span redaction and vault storage primitive
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
  - Findings: P2 from sprint-doc-reviewer: label preservation was conditional on “where supported,” so the observable label persistence surface was not fully falsifiable.
  - Resolution: Required the confirmed-span redactor result to expose safe placeholder metadata including `id`, `type`, `label`, `start`, and `end`, with label tests asserting that surface.
- **As a** harness integrator, **I want** to secure exact classifier-confirmed spans, **so that** the raw secret is stored only locally in the vault and the text entering model context contains Pristine placeholders.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [ ] A new core privacy function accepts original text, user/vault/key configuration, and confirmed spans with start/end/type/optional label, then returns redacted text and placeholder IDs while storing originals in the encrypted vault.
  - [ ] The redactor slices raw values locally from the original text using span offsets and does not require confirmed span inputs to carry raw values.
  - [ ] The redactor validates span bounds, rejects or reports overlapping/invalid confirmed spans with domain-specific errors or structured failure results, and preserves deterministic behavior for valid non-overlapping spans.
  - [ ] Optional classifier-provided labels are preserved in the confirmed-span redactor result's safe placeholder metadata (`id`, `type`, `label`, `start`, `end`), with safe fallback labels for unlabeled spans.
  - [ ] `reveal` can restore values redacted by the confirmed-span primitive for the same user.
- **Functional verification:**
  - [ ] Add integration tests for `secureConfirmedSpans` or the chosen public name; pass condition: confirmed spans are replaced with `[SENSITIVE:<type>:<id>]`, originals are absent from redacted text, placeholder IDs are returned, and vault entries exist.
  - [ ] Add a reveal round-trip test; pass condition: `reveal` restores text redacted by confirmed spans for the same user.
  - [ ] Add validation tests for invalid, out-of-bounds, and overlapping spans; pass condition: invalid input fails loudly without writing partial vault entries.
  - [ ] Add label tests; pass condition: supplied labels are preserved in the confirmed-span redactor result's safe placeholder metadata and unlabeled spans use existing safe fallback labels.
- **Regression verification:**
  - [ ] Run `npm run test:integration -- tests/integration/privacy.test.ts tests/integration/kek-lifecycle.test.ts`; pass condition: existing secure/redact/reveal/vault lifecycle remains green.
  - [ ] Run `npm run test:unit -- tests/vault/vault-redaction.test.ts tests/vault/sqlite-vault-store.test.ts`; pass condition: existing redaction and vault store behavior is unchanged.
- **Manual-only verification:** N/A — integration and unit tests cover this story.
- **Planned commits:**
  1. `feat: secure confirmed secret spans` — add redactor primitive, validation, vault storage integration, and round-trip tests.
- **Technical notes:** Reuse existing vault encryption/key/KekManager paths. If preserving custom labels requires a small internal redaction helper, keep the change narrowly scoped and avoid altering existing `redactText` behavior unless tests prove compatibility.

#### Story 5: Publish primitive API docs, spec update, and preserve existing convenience flow
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
- **As a** privacy API adopter, **I want** docs and examples that explain the new primitive composition while preserving `secureAndRedact`, **so that** I can choose either deterministic automatic redaction or a harness-mediated classifier flow.
- **Dependencies:** Story 1, Story 2, Story 3, Story 4
- **Acceptance criteria:**
  - [ ] Public API docs describe Detector / Classifier / Redactor primitives and clearly state that the SDK does not send raw candidates to any LLM or implement a hosted classifier.
  - [ ] `docs/specs/implementation-spec-004.md` is updated with a dedicated section or addendum for the new Detector / Classifier / Redactor primitive flow and explicitly distinguishes it from the existing deterministic `secureAndRedact` convenience flow.
  - [ ] Privacy guide docs show a concise composition example: detect candidates → build sanitized packets → apply harness classifier verdicts/policy → secure confirmed spans.
  - [ ] Docs explicitly state `secureAndRedact` remains available as a deterministic convenience API and is unchanged by the primitive split.
  - [ ] Docs warn that classifier policy, including `uncertain` handling, belongs to the harness/tool/extension/skill using the primitives.
  - [ ] Public API type fixture and package build include the new exports without removing existing exports.
- **Functional verification:**
  - [ ] Run `npm run docs:build`; pass condition: updated API/privacy docs build successfully.
  - [ ] Run `rg "Detector|Classifier|Redactor" docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec mention all three primitive roles.
  - [ ] Run `rg "secureConfirmed|confirmed span|confirmed spans" docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec describe the confirmed-span redaction primitive.
  - [ ] Run `rg "sanitized|raw candidates|raw candidate" docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec explain sanitized packets and that raw candidates are not sent to classifiers.
  - [ ] Run `rg "uncertain|policy" docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec state uncertain handling belongs to harness policy.
  - [ ] Run `rg "secureAndRedact|deterministic convenience" docs/pages/privacy docs/pages/api.mdx docs/specs/implementation-spec-004.md`; pass condition: docs/spec state `secureAndRedact` remains the deterministic convenience API.
  - [ ] Run `npm run verify:public-api-types`; pass condition: external consumers can import new primitive types and existing types.
- **Regression verification:**
  - [ ] Run `npm run test:smoke`; pass condition: package build and public API smoke tests remain green.
  - [ ] Run `npm run test:unit -- tests/client.test.ts tests/privacy/secure-and-redact.test.ts`; pass condition: public client privacy APIs and existing high-level redaction behavior remain green.
- **Manual-only verification:** N/A — docs build, grep checks, smoke tests, and focused unit tests cover this story.
- **Planned commits:**
  1. `docs: document privacy primitives` — update API/privacy docs, implementation spec, public type fixtures, and examples for the primitive composition.
- **Technical notes:** Use public docs wording consistent with recent Vocs positioning: local SDK building blocks, no hosted service, no raw candidates to LLM by default. Keep Pi hook and subagent implementation documentation for a later sprint. The spec update can be an addendum rather than a full rewrite of the older deterministic-only plan.

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
