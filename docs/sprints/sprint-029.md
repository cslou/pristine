# Pristine — Sprint 029
**Date:** 2026-05-14 – TBD
**Goal:** Reorganize the public Vocs docs so agent/harness adopters can understand Pristine, complete an SDK memory quickstart, and reach Pi memory/privacy integration prompts without relying on the current flat sidebar.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript ESM SDK, Vocs docs, Vitest, SQLite/sqlite-vec, local embedding support
- **Current state:** Public docs exist in `docs/pages/` with a flat sidebar (`Intro`, `Quickstart`, `Concepts`, `API`, `Privacy`, `Pi-dev`, `Configuration`, `Examples`). The docs build works, but the information architecture does not clearly separate Memory, Privacy, Integrations, and agent-copyable setup paths.
- **Implementation spec:** None — no implementation spec for this sprint

### Sprint-Wide Context

- **Sprint type:** Docs
- **Shared context:** Primary docs audience is agent/harness adopters. The new structure should keep existing public URLs working where practical while adding clearer nested sections. The main quickstart should start with the base SDK memory flow, then route Pi users quickly to copy-paste agent prompts for memory and privacy setup. Examples should be organized by harness first, then by capability.
- **Non-goals:** No new runtime behavior, no new SDK APIs, no new harness integration implementation, no compatibility URL migration that intentionally breaks current public docs routes, and no claim that Claude Code or Codex integrations are fully supported unless current repository evidence supports that claim.

### Affected Flows

- **Existing flows affected:** Public docs navigation, docs homepage onboarding, SDK quickstart reading flow, Pi integration docs reading flow, Vocs docs build.
- **New flows introduced:** None — no product, SDK API, CLI, runtime, or operational flow is introduced; this sprint reorganizes and adds public documentation reading paths only.

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

#### Story 1: Establish docs information architecture and sidebar groups
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
  - Findings: P1 from sprint-doc-reviewer: unsupported Claude Code/Codex production-ready label claims needed an explicit verification path.
  - Resolution: Added manual inspection of integration labels in `vocs.config.ts` with a pass condition that unsupported entries are omitted or labeled future/custom, not production-ready.
- **As a** harness adopter, **I want** the docs sidebar grouped by Start, Memory, Privacy, Integrations, Agent setup, and Reference, **so that** I can find the adoption path without scanning a flat miscellaneous page list.
- **Dependencies:** None
- **Acceptance criteria:**
  - [x] `vocs.config.ts` sidebar contains top-level groups for Start, Memory, Privacy, Integrations, Agent setup, and Reference.
  - [x] Existing public docs routes `/`, `/quickstart`, `/concepts`, `/api`, `/privacy`, `/pi-dev`, `/configuration`, and `/examples` remain present as pages or intentionally linked compatibility pages.
  - [x] New nested page paths needed by later stories are represented in the sidebar without dead links.
  - [x] Navigation labels do not claim unsupported Claude Code or Codex integrations as production-ready.
- **Functional verification:**
  - [x] Run `npm run docs:build`; pass condition: Vocs builds successfully with the grouped sidebar and no route-generation failure.
  - [x] Manually inspect `vocs.config.ts`; pass condition: each top-level group and all current compatibility routes are present exactly once in the intended navigation model.
  - [x] Manually inspect integration labels in `vocs.config.ts`; pass condition: unsupported Claude Code, Codex, or custom-harness entries are either omitted or labeled as future/custom patterns, not production-ready integrations.
- **Regression verification:**
  - [x] Run `npm run docs:build`; pass condition: existing pages still compile after sidebar changes.
  - [x] Run `test -f docs/pages/quickstart.mdx && test -f docs/pages/api.mdx && test -f docs/pages/privacy.mdx && test -f docs/pages/pi-dev.mdx`; pass condition: existing public route source files still exist.
- **Manual-only verification:** Inspect `vocs.config.ts` sidebar and integration labels; pass condition: top-level groups/routes are present and unsupported integrations are omitted or labeled future/custom, not production-ready.
- **Implementation evidence:**
  - `npm run docs:build` passed; log: `/tmp/pristine-story1-docs-build.log`.
  - Manual sidebar inspection passed: Start, Memory, Privacy, Integrations, Agent setup, and Reference groups are present; existing compatibility routes remain linked exactly once; unsupported Claude Code/Codex labels are omitted from `vocs.config.ts`.
  - Compatibility source check passed: `test -f docs/pages/quickstart.mdx && test -f docs/pages/api.mdx && test -f docs/pages/privacy.mdx && test -f docs/pages/pi-dev.mdx`.
- **Planned commits:**
  1. `docs: group vocs navigation` — update sidebar structure and add placeholder page shells only where required to prevent dead links.
- **Technical notes:** Preserve current URLs first; add nested pages for clarity rather than moving existing pages unless a compatibility page remains.

#### Story 2: Rewrite Start and Quickstart for SDK-first then Pi prompt onboarding
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
  - Findings: P2 from sprint-doc-reviewer: key-term grep did not prove Pi memory/privacy prompts include expected outcomes and detailed-page links.
  - Resolution: Added targeted `quickstart.mdx` verification for distinct memory/privacy prompt blocks, expected outcomes, and detailed-page links.
- **As a** harness adopter, **I want** the homepage and quickstart to explain what Pristine gives me and then get me to SDK memory plus Pi setup prompts quickly, **so that** I can decide whether Pristine fits my agent workflow and delegate setup to my coding agent.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [x] `docs/pages/index.mdx` positions Pristine as local-first memory and privacy for agent harnesses, and links to SDK quickstart, Pi quickstart/prompt, Memory, and Privacy sections.
  - [x] `docs/pages/quickstart.mdx` keeps a base SDK flow for install → create `Pristine` → store → recall → inspect source pointer → forget.
  - [x] `docs/pages/quickstart.mdx` includes a clearly labeled Pi quickstart section that explains users need harness integration for agent memory behavior.
  - [x] The Pi quickstart section includes copy-paste prompts for memory setup and privacy setup, with expected outcomes and links to detailed example/reference pages.
- **Functional verification:**
  - [x] Run `npm run docs:build`; pass condition: updated homepage and quickstart render in the Vocs build.
  - [x] Run `rg "copy|prompt|Pi|Pristine|store|recall|forget|source pointer" docs/pages/index.mdx docs/pages/quickstart.mdx`; pass condition: output shows the homepage/quickstart include the required concepts and prompt language.
  - [x] Run `rg "Memory setup prompt|Privacy setup prompt|Expected outcome|examples/pi-dev/README.md|/pi-dev|/examples" docs/pages/quickstart.mdx`; pass condition: the quickstart contains distinct memory/privacy prompt blocks, expected outcomes, and detailed-page links.
- **Regression verification:**
  - [x] Run `npm run test:smoke`; pass condition: public API examples remain aligned with the built package and exported `Pristine` client.
  - [x] Run `! rg "PristineLocal" docs/pages/index.mdx docs/pages/quickstart.mdx`; pass condition: no stale `PristineLocal` reference is present.
- **Manual-only verification:** N/A — docs build, grep checks, and smoke tests cover this story.
- **Implementation evidence:**
  - `npm run docs:build` passed; log: `/tmp/pristine-story2-docs-build.log`.
  - Required homepage/quickstart concept grep passed; log: `/tmp/pristine-story2-keyterms.log`.
  - Required Pi prompt/detail grep passed; log: `/tmp/pristine-story2-promptterms.log`.
  - `npm run test:smoke` passed; log: `/tmp/pristine-story2-smoke.log`.
  - Stale-name check passed: `! rg "PristineLocal" docs/pages/index.mdx docs/pages/quickstart.mdx`.
- **Planned commits:**
  1. `docs: rewrite start and quickstart onboarding` — update homepage and quickstart content with SDK-first flow and Pi prompt sections.
- **Technical notes:** Prompt text should instruct a coding agent to read repository-local Pristine/Pi example docs rather than pretending the SDK alone wires a harness.

#### Story 3: Build the Memory docs pillar
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
  - Findings: P2/P1 from sprint-doc-reviewer: broad grep did not prove page-by-page Memory content, and `/concepts` compatibility/no-conflict handling was not verified.
  - Resolution: Added specific target files for Memory overview/how-it-works/guide checks plus a `/concepts` alignment check.
- **As a** harness integrator, **I want** Memory docs that explain source-owned memory, how memory works, and the store/recall/forget lifecycle, **so that** I can wire Pristine into an agent without confusing recall snippets with authoritative source records.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [x] `docs/pages/memory.mdx` exists and explains local source-pointer memory, project scoping, and what data remains owned by the host harness/application.
  - [x] `docs/pages/memory/how-it-works.mdx` exists with a conceptual lifecycle diagram or step list covering host event → chunk/index → local SQLite/vector store → recall → source inspection.
  - [x] `docs/pages/memory/store-recall-forget.mdx` exists with a Memory guide for store/recall/forget and links to API/reference details.
  - [x] Existing `/concepts` content is either updated as a compatibility/overview page or linked into the new Memory pillar without contradictory duplicate explanations.
- **Functional verification:**
  - [x] Run `npm run docs:build`; pass condition: Memory pages build successfully.
  - [x] Run `rg "source-pointer memory|project scoping|host harness|source of truth" docs/pages/memory.mdx`; pass condition: Memory overview contains the required source-ownership concepts.
  - [x] Run `rg "host event|chunk|local SQLite|vector|recall|source inspection" docs/pages/memory/how-it-works.mdx`; pass condition: Memory how-it-works contains the required lifecycle steps.
  - [x] Run `rg "store|recall|forget|projectId|API|Reference" docs/pages/memory/store-recall-forget.mdx`; pass condition: Memory guide contains the required operation and reference-link language.
  - [x] Run `rg "Memory|source pointer|source of truth|docs/pages/memory|/memory" docs/pages/concepts.mdx`; pass condition: `/concepts` is visibly aligned with or routes readers to the Memory pillar and does not contain a conflicting source-ownership explanation.
- **Regression verification:**
  - [x] Run `npm run test:unit -- tests/client/source-memory-store.test.ts tests/client/source-memory-recall-forget.test.ts`; pass condition: documented memory operations still match existing client behavior.
  - [x] Run `! rg "PristineLocal" docs/pages`; pass condition: no stale public client name appears in docs pages.
- **Manual-only verification:** N/A — docs build, grep checks, and focused unit tests cover this story.
- **Implementation evidence:**
  - `npm run docs:build` passed; log: `/tmp/pristine-story3-docs-build.log`.
  - Memory overview grep passed; log: `/tmp/pristine-story3-memory-overview.log`.
  - Memory how-it-works grep passed; log: `/tmp/pristine-story3-memory-how.log`.
  - Memory guide grep passed; log: `/tmp/pristine-story3-memory-guide.log`.
  - Concepts compatibility grep passed; log: `/tmp/pristine-story3-concepts.log`.
  - Focused memory unit tests passed; log: `/tmp/pristine-story3-memory-unit.log`.
  - Stale-name check passed: `! rg "PristineLocal" docs/pages`.
- **Planned commits:**
  1. `docs: add memory docs pillar` — create/update Memory overview, how-it-works, and guide pages.
- **Technical notes:** Keep implementation internals concise; link to Reference for exact signatures and configuration.

#### Story 4: Build the Privacy docs pillar
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
  - Findings: P2 from sprint-doc-reviewer: broad grep did not prove page-by-page Privacy content, and hosted-API wording needed explicit forbidden-pattern verification.
  - Resolution: Added specific target files for Privacy overview/how-it-works/guide checks plus forbidden hosted-service phrasing regression check.
- **As a** privacy-conscious harness integrator, **I want** Privacy docs that explain redaction, reveal, scrub output, and the local threat model, **so that** I know where Pristine reduces risk and where my application still owns policy.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [ ] `docs/pages/privacy.mdx` states no Pristine-hosted API is required and clearly separates privacy vault behavior from source-index memory behavior.
  - [ ] `docs/pages/privacy/how-it-works.mdx` exists with a conceptual lifecycle diagram or step list covering raw text → classify/redact → agent/model boundary → scrub output → optional local reveal.
  - [ ] `docs/pages/privacy/secure-redact-reveal.mdx` documents secureAndRedact, reveal, and scrubOutput usage with links to API/reference details.
  - [ ] Threat model notes remain explicit about local database sensitivity, key backups, model downloads, and caller-owned network wrappers.
- **Functional verification:**
  - [ ] Run `npm run docs:build`; pass condition: Privacy pages build successfully.
  - [ ] Run `rg "no Pristine-hosted API|required|privacy vault|source-index memory|database sensitivity|key backups|model downloads|network wrappers" docs/pages/privacy.mdx`; pass condition: Privacy overview contains required local-first and threat-model language.
  - [ ] Run `rg "raw text|classify|redact|agent/model boundary|scrub output|local reveal" docs/pages/privacy/how-it-works.mdx`; pass condition: Privacy how-it-works contains the required lifecycle steps.
  - [ ] Run `rg "secureAndRedact|reveal|scrubOutput|API|Reference" docs/pages/privacy/secure-redact-reveal.mdx`; pass condition: Privacy guide contains the required API and reference-link language.
- **Regression verification:**
  - [ ] Run `npm run test:e2e -- tests/e2e/privacy-pipeline.test.ts`; pass condition: documented privacy flow still matches deterministic e2e behavior.
  - [ ] Run `! rg "requires a Pristine server|requires a Pristine API key|send(s)? .* to Pristine|Pristine cloud" docs/pages`; pass condition: no public docs page uses forbidden phrasing that implies a hosted Pristine service is required.
- **Manual-only verification:** N/A — docs build, grep checks, and focused e2e tests cover this story.
- **Planned commits:**
  1. `docs: add privacy docs pillar` — create/update Privacy overview, how-it-works, guide, and threat-model content.
- **Technical notes:** Do not overpromise privacy: distinguish SDK guarantees from filesystem, backup, logging, remote embedder, and wrapper-service responsibilities.

#### Story 5: Reorganize integrations and examples by harness
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
  - Findings: P1 from sprint-doc-reviewer: unsupported/future harness labeling and per-harness prerequisites/setup/outcome/verification coverage were not proven per page.
  - Resolution: Narrowed Pi grep to integration/example pages and added manual per-page harness checklist plus unsupported-page labeling check. Lou later requested a Claude Code section marked Coming soon; Story 5 AC and verification were updated accordingly.
- **As a** harness adopter, **I want** examples organized by harness first and capability second, **so that** I can start from my environment and see what memory/privacy integration paths are supported.
- **Dependencies:** Story 1, Story 2
- **Acceptance criteria:**
  - [ ] The Integrations section includes a Pi page that points to `examples/pi-dev/README.md` and explains memory components, privacy prompt setup, expected outcomes, and source inspection flow.
  - [ ] `docs/pages/examples.mdx` becomes a harness-oriented examples index or compatibility page that routes to Pi memory/privacy examples and any honest future-placeholder pages.
  - [ ] The Integrations or Examples section includes a Claude Code section/page explicitly marked `Coming soon`.
  - [ ] Claude Code, Codex, or custom-harness pages are either omitted or explicitly marked as future/custom/coming-soon patterns unless backed by current repository examples.
  - [ ] Each supported harness/example page states prerequisites, setup path, expected behavior, and at least one verification or smoke-check signal.
- **Functional verification:**
  - [ ] Run `npm run docs:build`; pass condition: integration/example pages build successfully.
  - [ ] Run `rg "examples/pi-dev/README.md|pristine_recall|search-session-history|expected outcome|prerequisite" docs/pages/pi-dev.mdx docs/pages/examples.mdx`; pass condition: Pi integration/example pages contain required links and adoption details.
  - [ ] Manually inspect each harness/example page touched by this story; pass condition: every page states prerequisites, setup path, expected behavior, and a verification/smoke-check signal.
  - [ ] Run `rg "Claude Code|Coming soon" docs/pages`; pass condition: Claude Code appears in the docs and is explicitly labeled `Coming soon`.
  - [ ] Manually inspect any Claude Code, Codex, or custom-harness page touched by this story; pass condition: each unsupported page is omitted or explicitly labeled as a future/custom/coming-soon pattern, not fully supported.
- **Regression verification:**
  - [ ] Run `npm run test:unit -- tests/examples/pi-dev`; pass condition: referenced Pi-dev helper behavior still passes existing tests.
  - [ ] Run `test -f examples/pi-dev/README.md`; pass condition: linked Pi runbook exists.
- **Manual-only verification:** Inspect each harness/example page touched by this story; pass condition: each supported page states prerequisites, setup path, expected behavior, and verification/smoke-check signal, and unsupported harness pages are omitted or labeled future/custom/coming-soon.
- **Planned commits:**
  1. `docs: organize integrations by harness` — update Pi integration and examples structure.
- **Technical notes:** The quickstart can stay prompt-first; detailed command/runbook content should live in integration/example pages and the existing `examples/pi-dev/README.md`.

#### Story 6: Consolidate reference pages and docs evidence checks
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
  - Findings: P1 from sprint-doc-reviewer: Reference back-links and docs verification checklist had no explicit functional verification.
  - Resolution: Added targeted Reference link check and command-set/checklist presence check.
- **As a** SDK developer or docs maintainer, **I want** reference/configuration pages and lightweight docs evidence checks aligned with the new structure, **so that** the docs remain navigable and public API details stay accurate after the restructure.
- **Dependencies:** Story 1, Story 2, Story 3, Story 4, Story 5
- **Acceptance criteria:**
  - [ ] API and Configuration pages live under the Reference navigation while existing `/api` and `/configuration` URLs continue to build.
  - [ ] Reference pages link back to Memory, Privacy, and Integrations pages where users need conceptual context.
  - [ ] A lightweight docs verification checklist or scriptable command set is recorded in the sprint doc or docs contribution notes for grouped sidebar, compatibility routes, prompt presence, and stale-name checks.
  - [ ] No generated `docs/dist` artifacts are committed as part of docs source edits unless the repository already expects them in the sprint workflow.
- **Functional verification:**
  - [ ] Run `npm run docs:build`; pass condition: Reference pages and compatibility routes build successfully.
  - [ ] Run `rg "/memory|/privacy|/pi-dev|/integrations" docs/pages/api.mdx docs/pages/configuration.mdx`; pass condition: Reference pages link back to Memory, Privacy, and integration context where relevant.
  - [ ] Run `rg "docs verification|sidebar|compatibility routes|prompt presence|PristineLocal" docs/sprints/sprint-029.md docs/pages`; pass condition: a lightweight docs verification checklist or command set is recorded for the new docs structure.
  - [ ] Run `! rg "PristineLocal|TODO|TBD" docs/pages vocs.config.ts`; pass condition: no stale public name or placeholder markers remain in public docs source.
- **Regression verification:**
  - [ ] Run `npm run verify:public-api-types`; pass condition: reference examples remain aligned with exported public types.
  - [ ] Run `git status --short docs/dist`; pass condition: no generated docs artifacts are staged or modified for commit unless intentionally documented.
- **Manual-only verification:** N/A — docs build, grep checks, and public API type verification cover this story.
- **Planned commits:**
  1. `docs: align reference pages with new structure` — update Reference navigation/content links and record docs evidence checks.
- **Technical notes:** Prefer source docs and config changes only. If Vocs generates `docs/dist` during verification, leave generated changes unstaged unless repository policy requires otherwise.

#### Final Story: Sprint Verification & Completion
- **Planning review:**
  - Findings: P2 from sprint-doc-reviewer: verification delta table should explicitly include all canonical verification type rows, including zero-count rows.
  - Resolution: Added a Final Story acceptance criterion requiring every canonical verification type row, including zero-count rows. Final reviewer returned no remaining findings and mergeability 5/5.
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
  - [ ] Verification delta is reported by canonical type, showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals.
  - [ ] The verification delta table includes every canonical verification type row, including zero-count rows.
  - [ ] The sprint doc status is updated to `🟢 Complete` only if completion criteria are met.
  - [ ] A `## Final Review` section is appended to the sprint doc with the final completion message quoted for auditability.
- **Functional verification:**
  - [ ] Run all functional verification items from every story and record pass/fail evidence.
- **Regression verification:**
  - [ ] Run all targeted regression verification items from every story and record pass/fail evidence.
  - [ ] Run the full available regression verification suite and record pass/fail evidence.
- **Manual-only verification:** N/A — no manual-only verification required
- **Planned commits:**
  1. `docs: complete sprint 029 verification` — final verification evidence and sprint doc completion update.
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
