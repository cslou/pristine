# Pristine — Sprint 031
**Date:** 2026-05-18 – TBD
**Goal:** Add a Pi-dev reference privacy input extension that composes the Sprint 030 primitives with a pluggable/subagent classifier so raw user-pasted secrets are classified from sanitized packets and redacted before they reach Pi model context or session history.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript ESM SDK, Vitest, SQLite/better-sqlite3 privacy vault, Pi extension examples under `examples/pi-dev/`, Pi extension APIs from `@mariozechner/pi-coding-agent`
- **Current state:** Sprint 030 is planned to add core Detector / Classifier / Redactor primitives: candidate detection, sanitized classifier packets, classifier verdict contracts, and confirmed-span vault redaction. Existing Pi-dev examples cover JSONL memory indexing/search but no privacy input hook. Pi supports an `input` extension event that can transform user text before skill/template expansion and before agent/model context.
- **Implementation spec:** `docs/specs/implementation-spec-004.md` — Sprint 030 updates this spec with the primitive split; this sprint extends the Pi-dev reference section with an input-only privacy composition.

### Sprint-Wide Context

- **Sprint type:** Feature
- **Shared context:** This sprint depends on Sprint 030's primitives being merged before implementation starts. The Pi-dev reference should demonstrate one composition, not force a universal policy: detector and packet builder are SDK primitives, classifier/labeler is a harness adapter, policy is extension-owned, and redaction/vault storage remains local. The v1 Pi reference protects user input only.
- **Non-goals:** No tool-call reveal hook, no tool-result scrub hook, no Claude Code or Codex integration, no background session scanning, no hosted Pristine classifier, no raw candidate values in subagent prompts, no model-provider-specific production routing beyond a reference subagent/adapter, and no replacement of the existing deterministic `secureAndRedact` convenience API.

### Affected Flows

- **Existing flows affected:** Pi-dev example artifact map/install docs, examples/pi-dev unit tests, public Pi-dev docs, privacy primitive API usage, package/public API smoke tests.
- **New flows introduced:** Pi user-input privacy flow: Pi `input` hook receives raw user text → SDK detector finds candidates locally → SDK packet builder creates sanitized classifier request → Pi classifier adapter/subagent returns verdict/type/label → extension policy handles confirmed/uncertain/failure states → confirmed spans are secured locally and redacted text is passed to Pi.

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
  - [ ] `examples/pi-dev/extensions/privacy-input/` exists with `index.ts`, `package.json`, README, and internal `lib/` modules matching existing Pi-dev example conventions.
  - [ ] The extension registers a Pi `input` handler and skips processing for `event.source === "extension"` to avoid recursion.
  - [ ] The extension delegates behavior to a testable runtime object so unit tests can invoke input handling without launching Pi.
  - [ ] The runtime accepts injected detector, packet builder, classifier adapter, redactor, policy, user ID, and notification dependencies for tests and host-managed lifecycles.
  - [ ] No candidates returns `{ action: "continue" }` and does not call classifier or redactor dependencies.
- **Functional verification:**
  - [ ] Add `tests/examples/pi-dev/privacy-input-extension.test.ts`; pass condition: extension registration wires exactly one `input` handler and delegates to the runtime.
  - [ ] Add runtime unit tests for extension-injected messages and no-candidate user messages; pass condition: injected messages continue unchanged and no-candidate input continues without classifier/redactor calls.
  - [ ] Run `npm run test:unit -- tests/examples/pi-dev/privacy-input-extension.test.ts`; pass condition: new scaffold/runtime tests pass.
- **Regression verification:**
  - [ ] Run `npm run test:unit -- tests/examples/pi-dev/install-layout.test.ts tests/examples/pi-dev/search-memory-tool.test.ts`; pass condition: existing Pi-dev extension discovery/install expectations and recall tool wrappers remain green.
  - [ ] Run `npm run lint`; pass condition: new Pi-dev extension code has no lint errors or debug logging.
- **Manual-only verification:** N/A — extension registration and runtime boundaries are covered by unit tests.
- **Planned commits:**
  1. `feat: scaffold pi privacy input extension` — add extension directory, runtime shell, package metadata, README, and focused tests.
- **Technical notes:** Follow the existing `jsonl-index` and `search-memory` example pattern: copied extension directories should be self-contained and should not rely on project-private test fixtures at runtime.

#### Story 2: Compose detector, classifier packets, policy, and confirmed-span redaction in the input runtime
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
  - Resolution: Added a confirmed-secret safe-details leak test requiring candidate IDs, verdicts, types, labels, placeholder IDs, and no raw candidate values.
- **As a** Pi user, **I want** confirmed input secrets redacted before my message reaches the model, **so that** I can paste sensitive values into Pi without storing or sending those raw values in model context.
- **Dependencies:** Story 1; Sprint 030 merged
- **Acceptance criteria:**
  - [ ] The runtime composes Sprint 030 primitives in order: detect candidates → build sanitized classifier request → classify candidates → apply extension policy → secure confirmed spans → return transformed redacted text.
  - [ ] Classifier verdicts with `verdict: "secret"` produce confirmed spans using classifier-provided type and label, then call the confirmed-span redactor with original text plus spans.
  - [ ] `verdict: "not_secret"` candidates are not redacted when no other confirmed candidates overlap the same span.
  - [ ] Successful redaction returns `{ action: "transform", text: redactedText }` and the transformed text contains Pristine `[SENSITIVE:<type>:<id>]` placeholders but not the raw secret.
  - [ ] The runtime records safe details for rendering/logging that include candidate IDs, verdicts, types, labels, and placeholder IDs, but no raw candidate values.
- **Functional verification:**
  - [ ] Add runtime composition tests with fake detector/packet builder/classifier/redactor; pass condition: dependency calls occur in the expected order and receive original text only where local redaction requires it.
  - [ ] Add a secret-input transform test using the real Sprint 030 detector/packet builder/redactor with a fake classifier; pass condition: raw secret is absent from transformed text, placeholder is present, and reveal restores the original value for the same user.
  - [ ] Add a mixed verdict test; pass condition: `secret` verdict spans are redacted and `not_secret` spans remain unchanged.
  - [ ] Add a confirmed-secret safe-details leak test; pass condition: emitted runtime details include expected candidate IDs, verdicts, types, labels, and placeholder IDs, and serialized details do not contain raw candidate values.
- **Regression verification:**
  - [ ] Run `npm run test:integration -- tests/integration/privacy.test.ts`; pass condition: existing core `secureAndRedact` / `reveal` / `scrubOutput` behavior remains green.
  - [ ] Run `npm run test:unit -- tests/client.test.ts tests/privacy/secure-and-redact.test.ts`; pass condition: public privacy client behavior and existing high-level redaction behavior remain green.
- **Manual-only verification:** N/A — runtime composition and vault round-trip are covered by tests.
- **Planned commits:**
  1. `feat: compose pi input privacy redaction` — wire detector/packet/classifier/policy/redactor flow and add runtime/vault round-trip tests.
- **Technical notes:** The extension should transform only the user input text; tool-call reveal and tool-result scrubbing are intentionally deferred to a later sprint.

#### Story 3: Add reference subagent classifier and labeler adapter
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
- **As a** Pi extension author, **I want** a reference classifier/labeler adapter that consumes sanitized packets, **so that** I can see how to use Pi's harness LLM/subagent path without sending raw candidate values to it.
- **Dependencies:** Story 1, Story 2; Sprint 030 merged
- **Acceptance criteria:**
  - [ ] A reference classifier adapter builds a classifier task/prompt from sanitized packet requests and never includes raw candidate strings, arbitrary raw prefixes/suffixes, decoded JWT payload values, URL passwords, query secret values, or seed phrase words.
  - [ ] The adapter expects structured JSON results containing candidate ID, verdict, sensitivity type, optional label, confidence, and rationale, and validates the response before policy uses it.
  - [ ] The reference supports `secret`, `not_secret`, and `uncertain` verdicts and preserves labels for `secret` verdicts when supplied.
  - [ ] The adapter is replaceable: tests and README show how hosts can use a fake/local/manual classifier instead of the reference subagent classifier.
  - [ ] Malformed, missing, duplicate, or unknown candidate IDs in classifier output are reported as classifier failures rather than silently passing through.
- **Functional verification:**
  - [ ] Add prompt-construction leak tests for realistic raw secrets, arbitrary raw prefixes/suffixes, JWT payload values, credential URL passwords, signed URL query secret values, and seed phrase words; pass condition: serialized prompts/tasks contain placeholders and metadata but none of those raw values.
  - [ ] Add response parser tests; pass condition: valid JSON verdicts parse to classifier results and malformed/duplicate/unknown-candidate outputs fail with structured classifier errors.
  - [ ] Add label preservation tests; pass condition: `secret` verdict labels from classifier output are passed to the runtime confirmed-span flow.
- **Regression verification:**
  - [ ] Run `npm run test:unit -- tests/examples/pi-dev/search-session-history.test.ts tests/examples/pi-dev/search-memory.test.ts`; pass condition: existing Pi-dev skill/tool examples remain green.
  - [ ] Run `npm run typecheck`; pass condition: classifier adapter types compile cleanly with strict TypeScript.
- **Manual-only verification:** N/A — reference prompt construction and parser behavior are covered by unit tests; real Pi smoke is planned in Story 5.
- **Planned commits:**
  1. `feat: add pi secret classifier adapter` — add reference prompt/task builder, structured result parser, adapter docs, and leak-focused tests.
- **Technical notes:** If direct subagent spawning is too brittle for the copied extension shape, keep the runtime adapter interface stable and provide a command/subprocess-backed reference implementation plus fake classifier tests. Do not add Anthropic/OpenAI SDK dependencies.

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
  - [ ] The extension policy supports configurable `uncertain` handling with explicit modes `block`, `redact`, and `allow`, and the documented default is `block`.
  - [ ] Classifier timeout, thrown error, malformed response, unknown candidate ID, or duplicate candidate ID causes the input turn to be blocked and the user notified with a safe message that contains no raw candidate values.
  - [ ] `uncertainPolicy: "block"` blocks the turn and notifies the user when any candidate remains uncertain.
  - [ ] `uncertainPolicy: "redact"` redacts uncertain candidates using detector-suggested type/fallback label without sending raw values to the classifier or notification.
  - [ ] `uncertainPolicy: "allow"` passes uncertain candidates through only when explicitly configured, and safe details record that policy decision without raw values.
- **Functional verification:**
  - [ ] Add failure-mode tests for classifier throw, timeout, malformed JSON, unknown candidate ID, and duplicate candidate ID; pass condition: runtime returns `{ action: "handled" }` or the chosen block representation, sends a safe notification, and does not transform raw text into model context.
  - [ ] Add tests for all uncertain policy modes; pass condition: `block`, `redact`, and `allow` produce the documented behavior and safe details contain no raw candidate values.
  - [ ] Add notification leak tests; pass condition: notification text and details do not contain raw candidate values.
- **Regression verification:**
  - [ ] Run `npm run test:unit -- tests/privacy/safety-scan.test.ts tests/vault/vault-redaction.test.ts`; pass condition: core scrub/placeholder behavior remains green.
  - [ ] Run `npm run lint`; pass condition: policy code has no lint errors or debug logging.
- **Manual-only verification:** N/A — failure and policy behavior are covered by unit tests.
- **Planned commits:**
  1. `feat: handle pi privacy classification failures` — add policy modes, failure handling, safe notifications, and leak tests.
- **Technical notes:** Pi `input` supports `continue`, `transform`, and `handled`; if blocking uses `handled`, notify the user clearly that the turn was stopped before reaching the agent.

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
  - [ ] `examples/pi-dev/README.md` artifact map includes the privacy-input extension, copy/install target, dependency installation, and expected behavior.
  - [ ] `examples/pi-dev/extensions/privacy-input/README.md` documents runtime dependencies, classifier adapter configuration, uncertain policy modes, classifier failure behavior, local vault/key responsibilities, and v1 limitations.
  - [ ] Public docs under `docs/pages/pi-dev.mdx` and privacy pages link to the Pi privacy input reference without implying tool-call reveal or tool-result scrub are implemented in v1.
  - [ ] `docs/specs/implementation-spec-004.md` is updated or amended so the Pi-dev reference flow clearly distinguishes Sprint 031's input-only v1 from future tool-call reveal and tool-result scrub hooks.
  - [ ] Documentation states that classifier prompts receive sanitized context and metadata only, never raw candidates.
  - [ ] A reproducible Pi smoke procedure is documented with explicit pass/fail conditions for a fake/test classifier mode and, where practical, a real subagent classifier mode.
- **Functional verification:**
  - [ ] Run `npm run docs:build`; pass condition: updated public docs build successfully.
  - [ ] Run `rg "privacy-input|sanitized|raw candidate|uncertainPolicy|input hook|tool-call reveal" examples/pi-dev docs/pages/pi-dev.mdx docs/pages/privacy`; pass condition: docs mention the privacy-input extension, sanitized classifier prompts, policy modes, input hook behavior, and v1 limitations for tool-call reveal.
  - [ ] Run `rg "input-only|future tool-call|future tool-result|tool_call|tool_result" docs/specs/implementation-spec-004.md`; pass condition: the spec distinguishes Sprint 031's input-only v1 from future tool-call reveal and tool-result scrub work.
  - [ ] Run the documented non-interactive smoke command or test harness for fake/test classifier mode; pass condition: a sample input containing a fake API key is transformed to a Pristine placeholder and the raw key is absent from the model-facing text.
- **Regression verification:**
  - [ ] Run `npm run test:unit -- tests/examples/pi-dev`; pass condition: all Pi-dev example tests, including existing memory examples and new privacy-input tests, pass.
  - [ ] Run `npm run test:smoke`; pass condition: package/public API smoke tests remain green after docs/example changes.
- **Manual-only verification:** If real Pi subagent smoke cannot be automated reliably, run `pi` from a copied reference repo with privacy-input enabled; pass condition: typing a sample fake key produces a safe block/transform result before the agent sees raw text, and document the log or transcript path in story evidence.
- **Planned commits:**
  1. `docs: document pi privacy input reference` — update Pi-dev runbook, extension README, public docs, and smoke evidence.
- **Technical notes:** Be explicit that v1 is user-input protection only. Tool-call reveal and output scrub require later dedicated hooks and verification.

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
