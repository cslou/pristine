# Pristine — Sprint 027
**Date:** 2026-05-12 – 2026-05-12
**Goal:** Convert `docs/` into a public Vocs documentation site, remove internal planning/history docs from GitHub tracking, and refresh the GitHub README so the repository is ready for public docs review.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript strict ESM, Node.js, Vitest, ESLint, SQLite via `better-sqlite3`, `sqlite-vec`, `@huggingface/transformers` local embeddings, public docs to be built with Vocs.
- **Current state:** `main` is clean after Sprint 026 and follow-up Pi-dev tool-name cleanup. `docs/` currently mixes public-facing docs (`docs/public-api.md`, `docs/agent-integration.md`, `docs/release-checklist.md`) with internal planning/history folders (`docs/sprints/`, `docs/specs/`, `docs/stories/`, `docs/security-audits/`, `docs/analysis/`, `docs/architecture/`, `docs/research/`, `docs/conventions/`). The README is comprehensive but too implementation/history-heavy for a public launch landing page.
- **Implementation spec:** None — no implementation spec for this sprint

### Sprint-Wide Context

- **Sprint type:** Docs / Tooling / Cleanup
- **Shared context:** `docs/` becomes the public Vocs documentation root. Vocs pages should live directly under `docs/` (`docs/index.mdx`, `docs/quickstart.mdx`, etc.) with `vocs.config.ts` at the repo root. Internal docs are removed from tracked Git and protected with targeted `.gitignore` entries; public-worthy information from internal docs may be rewritten into public docs, but the original internal files should not remain tracked. Because AGENTS.md requires the active sprint audit file at `docs/sprints/sprint-027.md`, this sprint preserves that one file through sprint completion as a temporary workflow exception, records final evidence there on the sprint branch, then removes it in the Final Story before the sprint-integration PR so no sprint docs remain tracked in the public target. This sprint creates buildable in-repo docs only; it does not add hosting/deployment.
- **Non-goals:** Deploying docs to GitHub Pages, Vercel, Netlify, or a custom domain; changing SDK runtime behavior or public API semantics; publishing a package release; preserving historical sprint/spec/security-audit files in the public repository; adding generated API documentation beyond what can be maintained and verified in this sprint.

### Expected Touch List

- **Docs tooling:** `package.json`, `package-lock.json`, `vocs.config.ts`, possible docs verification scripts.
- **Public docs root:** `docs/index.mdx`, `docs/quickstart.mdx`, `docs/concepts.mdx`, `docs/api.mdx`, `docs/privacy.mdx`, `docs/pi-dev.mdx`, `docs/configuration.mdx`, `docs/examples.mdx`.
- **Internal docs removal:** `docs/sprints/`, `docs/specs/`, `docs/stories/`, `docs/security-audits/`, `docs/analysis/`, `docs/architecture/`, `docs/research/`, `docs/conventions/`.
- **Repo presentation:** `.gitignore`, `README.md`.
- **Verification:** `scripts/verify-public-docs.mjs`, `tests/smoke/public-api-types-fixture.mts`, existing lint/type/build/test scripts.

### Affected Flows

- **Existing flows affected:** Developer reads README to understand/install/use Pristine; developer runs docs verification; maintainer reviews tracked docs for public-readiness; Pi-dev integrator discovers `examples/pi-dev/README.md` from public docs.
- **New flows introduced:** Developer runs `npm run docs:build` to verify the public Vocs documentation site; public reader uses `docs/*.mdx` as the canonical documentation source. No product/runtime flow is introduced; because no implementation spec exists and `docs/specs/` is being removed, the new docs-build flow is documented in `package.json`, public docs, and the sprint final review rather than an implementation spec.

### Verification Strategy

This sprint follows verifiability-first engineering: every story must define how its new or changed behavior will be proven correct and which existing behavior it could regress.

Verification has two categories:

- **Functional verification:** new verification created for behavior introduced or changed by this sprint.
- **Regression verification:** existing verification for behavior that predates this sprint.

Each implementation story must include:

- Functional verification for the new or changed behavior it delivers.
- Targeted regression verification for existing behavior most likely to be affected by that story.

The Final Verification Story runs all sprint functional verification plus the full available regression verification suite. After the sprint completes, the sprint's functional verification becomes part of the regression suite for future sprints.

### Story Selection Rationale

1. **Vocs scaffold first** so public docs have a buildable site shell before content is migrated or internal docs are removed.
2. **Public docs content second** so launch-critical SDK and Pi-dev documentation exists before deleting old docs that may contain source material.
3. **Internal docs cleanup third** so tracked Git no longer exposes sprint/spec/security-audit/process history after public docs replace it.
4. **README refresh fourth** so README links to docs paths that already exist and reflects the final public docs structure.
5. **Final verification last** so the sprint integration has complete docs-build, link/snippet, tracked-file, and full regression evidence.

### Sprint Doc Review

- **Pass 1:** Mergeability 2/5. P1 findings: Story 3 attempted to remove/ignore `docs/sprints/` before the active sprint doc could receive final review evidence; the template DoD referenced folding new flows into an implementation spec while this sprint has no spec and removes `docs/specs/`. P2 findings: Story 2 needed a factual content-accuracy check for docs claims; Story 4 needed an observable threshold for “concise”; Final Story needed the exact canonical verification delta rows from `handle-sprint-completion.md`.
- **Resolution:** Preserved `docs/sprints/sprint-027.md` as a temporary workflow exception through final completion, required Final Story cleanup to remove that active sprint doc before sprint integration while copying final audit evidence into the sprint-integration PR body, clarified that the new docs-build flow is documented in package/public docs/final review rather than a removed implementation spec, added docs content-accuracy verification, made README concision measurable, and updated the final verification delta row list to the exact canonical rows.
- **Pass 2:** Mergeability 5/5. No per-story or cross-story findings.

### Stories

#### Story 1: Vocs Scaffold and Build Scripts
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
- **As a** maintainer, **I want** Vocs installed and configured with a minimal buildable docs site, **so that** public docs have deterministic tooling before content migration begins.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] `vocs` is added as an exact pinned `devDependency`, and `package-lock.json` records the dependency deterministically. **Pass condition:** `npm install` produces no unpinned Vocs dependency range in `package.json`, and `npm ci` can install the lockfile.
  - [ ] `package.json` includes docs scripts for local development and verification, including `docs:dev` and `docs:build`; `docs:preview` may be added if supported by the chosen Vocs setup. **Pass condition:** `npm run docs:build` is the canonical noninteractive docs build command.
  - [ ] `vocs.config.ts` exists at the repo root and defines a navigation/sidebar for the initial public docs pages: Intro, Quickstart, Concepts, API, Privacy, Pi-dev, Configuration, and Examples. **Pass condition:** the Vocs build includes those pages without unresolved route/config errors.
  - [ ] Minimal placeholder pages exist directly under `docs/` as `.mdx` files: `index.mdx`, `quickstart.mdx`, `concepts.mdx`, `api.mdx`, `privacy.mdx`, `pi-dev.mdx`, `configuration.mdx`, and `examples.mdx`. **Pass condition:** no Vocs content pages are placed under `docs/pages/` in this sprint.
- **Functional verification:**
  - [ ] Run `npm run docs:build`. **Pass condition:** Vocs completes a production build with exit code 0 and no missing-page/sidebar errors.
  - [ ] Run `node -e "const semver = /^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$/; const pkg = require('./package.json'); if (!semver.test(pkg.devDependencies?.vocs ?? '')) process.exit(1);"`. **Pass condition:** Vocs exists as an exact semver devDependency, not a range/tag such as `^`, `~`, `latest`, `*`, or `>=`.
- **Regression verification:**
  - [ ] Run `npm run typecheck`. **Pass condition:** adding `vocs.config.ts` and docs scripts does not break TypeScript checking for the package.
  - [ ] Run `npm run build`. **Pass condition:** SDK package build still succeeds after adding docs tooling.
- **Manual-only verification:** N/A — no manual-only verification required.
- **Planned commits:**
  1. `docs: add vocs documentation scaffold`
- **Technical notes:** Prefer the smallest Vocs setup that supports static build verification. Keep docs tooling in devDependencies only. Do not add deployment workflows or hosting configuration in this story.

#### Story 2: Public Documentation Content
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
  - Findings: P2 — functional verification checked links/snippets/stale terms but did not define how factual Concepts/Privacy/Configuration claims are checked against current behavior.
  - Resolution: Added a bounded public docs content-accuracy checklist with explicit source files/tests and pass/fail criteria.
- **As a** public SDK reader, **I want** user-journey docs for Pristine's install, concepts, APIs, privacy model, configuration, examples, and Pi-dev integration, **so that** I can adopt Pristine without reading internal sprint/spec documents.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [ ] `docs/index.mdx` explains what Pristine is, the local-first/privacy promise, supported package/runtime status, and links to Quickstart, API, Privacy, and Pi-dev pages. **Pass condition:** the page contains no references to sprint numbers, implementation-spec files, internal audits, or private planning process.
  - [ ] `docs/quickstart.mdx` provides install and minimal SDK usage for `createPristineLocal`, `store`, `recall`, and `forget`. **Pass condition:** code snippets use the current public API names and do not mention deprecated source-chunk method names.
  - [ ] `docs/concepts.mdx` explains source-owned memory, source pointers, project scoping, local embeddings, and SQLite storage at a public-reader level. **Pass condition:** it describes behavior without relying on internal schema/planning jargon.
  - [ ] `docs/api.mdx` documents the public SDK surface needed for launch: creation/configuration, memory primitives, privacy primitives, key rotation/migration where public, and exported result shapes at a concise level. **Pass condition:** documented names match exports from `src/index.ts`.
  - [ ] `docs/privacy.mdx` explains local-only operation, redaction/reveal/scrub flows, key storage expectations, and what data does or does not leave the device by default. **Pass condition:** no claim contradicts `README.md`, `SECURITY.md`, or current implementation behavior, verified by the content-accuracy checklist in functional verification.
  - [ ] `docs/pi-dev.mdx` points Pi integrators to `examples/pi-dev/README.md` as the integration runbook and uses `pristine_recall` as the only Pi search tool name. **Pass condition:** the page contains no `pristine_vector_search` references.
  - [ ] `docs/configuration.mdx` and `docs/examples.mdx` cover practical options, database paths, embedding configuration basics, and representative SDK/Pi examples. **Pass condition:** examples are compatible with the current public package surface.
- **Functional verification:**
  - [ ] Update or add docs verification so public docs snippets/links are checked where practical. **Pass condition:** `npm run verify:docs` reads the Vocs `.mdx` docs, validates local links, and verifies TypeScript package import snippets or delegates to `npm run verify:public-api-types` for compiled API snippets.
  - [ ] Run a public docs content-accuracy checklist comparing `docs/concepts.mdx`, `docs/api.mdx`, `docs/privacy.mdx`, and `docs/configuration.mdx` against `src/index.ts`, `src/client.ts`, `README.md`, `SECURITY.md`, and existing public tests. **Pass condition:** each factual claim about API names, local-only behavior, storage, embeddings, privacy operations, and configuration is either supported by a cited file/test or rewritten/removed; the completed checklist is recorded in the story PR body.
  - [ ] Run `rg "implementation-spec|docs/sprints|docs/specs|docs/security-audits|pristine_vector_search|indexSourceChunks|searchSourceChunks|deleteSourceChunks" docs/*.mdx`. **Pass condition:** command returns no unapproved public-doc hits; any intentional legacy API mention must be explicitly justified in the story PR body.
- **Regression verification:**
  - [ ] Run `npm run verify:public-api-types`. **Pass condition:** public API type fixture still compiles after docs/API wording updates.
  - [ ] Run `npm run docs:build`. **Pass condition:** authored `.mdx` content builds successfully in Vocs.
- **Manual-only verification:** N/A — no manual-only verification required.
- **Planned commits:**
  1. `docs: author public vocs content`
- **Technical notes:** Rewrite, do not copy, any useful information from internal `docs/analysis`, `docs/architecture`, `docs/research`, or `docs/conventions`. Keep public docs concise and user-journey oriented.

#### Story 3: Internal Documentation Removal and Ignore Policy
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
  - Findings: P1 — removing/ignoring `docs/sprints/` conflicts with the active sprint doc needing final review evidence before sprint completion.
  - Resolution: Story 3 now removes historical sprint docs but preserves `docs/sprints/sprint-027.md` as a temporary workflow exception through final completion.
- **As a** maintainer preparing a public repository, **I want** internal planning, audit, research, and convention docs removed from tracked Git and ignored going forward, **so that** the public repo exposes only public documentation under `docs/`.
- **Dependencies:** Story 2
- **Acceptance criteria:**
  - [ ] Remove tracked internal docs directories with `git rm -r`: `docs/specs/`, `docs/stories/`, `docs/security-audits/`, `docs/analysis/`, `docs/architecture/`, `docs/research/`, and `docs/conventions/`; remove historical sprint docs under `docs/sprints/` while preserving active `docs/sprints/sprint-027.md` through final completion. **Pass condition:** no files under those internal paths remain in `git ls-files` except `docs/sprints/sprint-027.md`.
  - [ ] Add targeted `.gitignore` entries for the removed internal docs paths and do not ignore the whole `docs/` directory; add a temporary negation for `docs/sprints/sprint-027.md` if needed so the active audit file remains tracked until the Final Story removes it. **Pass condition:** `git check-ignore docs/sprints/example.md docs/specs/example.md docs/stories/example.md docs/security-audits/example.md docs/analysis/example.md docs/architecture/example.md docs/research/example.md docs/conventions/example.md` reports ignored paths, while `git check-ignore --no-index docs/index.mdx` and `git check-ignore --no-index docs/sprints/sprint-027.md` exit non-zero during Story 3.
  - [ ] Keep public Vocs docs tracked directly under `docs/`. **Pass condition:** `git ls-files docs/*.mdx` includes all expected public docs pages.
  - [ ] Update docs verification inputs so removed internal docs are not required by `npm run verify:docs` or other public docs checks. **Pass condition:** docs verification succeeds after the internal directories are removed.
- **Functional verification:**
  - [ ] Run `git ls-files docs/sprints docs/specs docs/stories docs/security-audits docs/analysis docs/architecture docs/research docs/conventions`. **Pass condition:** command returns only `docs/sprints/sprint-027.md`; any other returned path fails the audit.
  - [ ] Run `git check-ignore docs/sprints/example.md docs/specs/example.md docs/stories/example.md docs/security-audits/example.md docs/analysis/example.md docs/architecture/example.md docs/research/example.md docs/conventions/example.md`. **Pass condition:** every path is printed as ignored.
  - [ ] Run `git check-ignore --no-index docs/index.mdx; test $? -eq 1` and `git check-ignore --no-index docs/sprints/sprint-027.md; test $? -eq 1`. **Pass condition:** public Vocs docs and the active sprint audit file are not ignored during Story 3.
- **Regression verification:**
  - [ ] Run `npm run verify:docs`. **Pass condition:** public docs verification no longer depends on removed internal dirs and exits 0.
  - [ ] Run `npm run docs:build`. **Pass condition:** Vocs site still builds after internal docs are removed.
- **Manual-only verification:** N/A — no manual-only verification required.
- **Planned commits:**
  1. `docs: remove internal documentation from public repo`
- **Technical notes:** Do not blanket-ignore `docs/`. Use git history as the backup for removed internal docs; do not create a local archive or public sanitized historical subset in this sprint.

#### Story 4: Public README Refresh
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
  - Findings: P2 — “concise” had no observable threshold.
  - Resolution: Added a README limit of under 220 lines and required deeper details to link to Vocs instead of duplicating API content.
- **As a** GitHub visitor, **I want** a concise public README that explains Pristine and points to the new Vocs docs, **so that** I can evaluate and start using the package without seeing internal planning artifacts.
- **Dependencies:** Story 3
- **Acceptance criteria:**
  - [ ] `README.md` is rewritten as a public landing page with: product summary, local-first/privacy promise, install command, minimal quickstart, core API overview, Pi-dev integration pointer, docs links, status, license, and security/reporting links. **Pass condition:** all listed sections are present, README stays under 220 lines, and deeper API/how-to detail links to Vocs instead of being duplicated inline.
  - [ ] README links point only to existing public files/routes such as `docs/index.mdx`, `docs/quickstart.mdx`, `docs/api.mdx`, `docs/privacy.mdx`, `docs/pi-dev.mdx`, `examples/pi-dev/README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and `LICENSE`. **Pass condition:** `npm run verify:docs` reports no missing README links.
  - [ ] README contains no links to removed internal paths and no internal planning terms such as sprint docs, implementation specs, story checklists, or security-audit files. **Pass condition:** `rg "docs/sprints|docs/specs|docs/stories|docs/security-audits|implementation-spec|Sprint [0-9]|Story Checklist" README.md` returns no hits.
  - [ ] README uses the current public memory and Pi tool names: `store`, `recall`, `forget`, and `pristine_recall`. **Pass condition:** README contains no `indexSourceChunks`, `searchSourceChunks`, `deleteSourceChunks`, or `pristine_vector_search` references.
- **Functional verification:**
  - [ ] Run `npm run verify:docs`. **Pass condition:** README and public docs links/snippets validate successfully.
  - [ ] Run `rg "docs/sprints|docs/specs|docs/stories|docs/security-audits|implementation-spec|pristine_vector_search|indexSourceChunks|searchSourceChunks|deleteSourceChunks" README.md docs/*.mdx`. **Pass condition:** no unapproved stale/internal hits remain in public-facing docs.
- **Regression verification:**
  - [ ] Run `npm run verify:package`. **Pass condition:** package contents remain valid and do not accidentally include removed internal docs beyond the intended npm package files.
  - [ ] Run `npm run test:smoke`. **Pass condition:** public package entrypoint and public API smoke tests still pass after README/docs changes.
- **Manual-only verification:** N/A — no manual-only verification required.
- **Planned commits:**
  1. `docs: refresh public readme`
- **Technical notes:** Keep README short enough to serve as GitHub landing content; defer deeper explanation to Vocs pages. Do not duplicate every API detail from `docs/api.mdx`.

#### Final Story: Sprint Verification & Completion
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Uses the story sections above and the existing regression suite as the verification source of truth
  - [x] Defines where final verification evidence will be recorded
  - [x] Includes full regression verification, not only areas believed to be touched
  - [x] Ready for Lou
- **As a** maintainer, **I want** all sprint functional verification and all available regression verification run, **so that** the sprint can be integrated with evidence that new public docs work and existing package behavior did not regress.
- **Dependencies:** All implementation stories
- **Acceptance criteria:**
  - [ ] Every story’s acceptance criteria are evaluated against implementation evidence.
  - [ ] Every story’s functional verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [ ] Every story’s targeted regression verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [ ] The full available regression verification suite is run, including existing unit, integration, e2e, smoke, static, docs-build, docs-link/snippet, tracked-file audit, and manual-only checks where applicable.
  - [ ] Failed, ambiguous, manual-only, or unrun verification items are documented.
  - [ ] The sprint’s new functional verification is identified as future regression verification: Vocs build, public docs verification, stale/internal public-doc audit, and internal-doc tracked-file/gitignore audit.
  - [ ] Verification delta is reported by canonical type, showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals. Include every canonical row from `workflow-prompts/handle-sprint-completion.md` even when the count is zero: Unit, Integration / contract, E2E / smoke, Simulator / device, AI / model evals, Static / local checks, Performance / load, Security / dependency, Accessibility / visual, Manual-only, Other verification, and Total. **Pass condition:** `Unknown` is not used as a row; any unknown counts are noted in the counting-basis text with a reason.
  - [ ] The sprint doc status is updated to `🟢 Complete` only if completion criteria are met.
  - [ ] A `## Final Review` section is appended to the sprint doc with the final completion message quoted for auditability before cleanup, and the same final review evidence is copied into the sprint-integration PR body because this sprint removes the active sprint doc before public integration.
  - [ ] After final review evidence is recorded, `docs/sprints/sprint-027.md` is removed from the sprint branch before opening the sprint-integration PR. **Pass condition:** `git ls-files docs/sprints` returns no files in the sprint-integration diff, and the sprint-integration PR body contains the final review evidence copied from the removed sprint doc.
- **Functional verification:**
  - [ ] Run all functional verification items from every story and record pass/fail evidence.
- **Regression verification:**
  - [ ] Run all targeted regression verification items from every story and record pass/fail evidence.
  - [ ] Run the full available regression verification suite and record pass/fail evidence.
- **Manual-only verification:** N/A — no manual-only verification required.
- **Planned commits:**
  1. `docs: complete sprint 027 verification`
  2. `docs: remove active sprint audit file before public integration`
- **Technical notes:** Use the story sections plus the existing regression suite as the source of truth. Do not duplicate all AC/verification items here; run them, reference the evidence, compute the verification delta table, and record final results in `## Final Review`. Use `workflow-prompts/handle-sprint-completion.md` for the final completion message shape. `## Final Review` is appended to the sprint doc on the sprint branch, copied into the sprint-integration PR body for durable public auditability, and then `docs/sprints/sprint-027.md` is removed before public integration. Record Vocs as a new dependency in `## Final Review` if it is added.

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
- Sprint doc includes `## Final Review` with the final completion message and a New Dependencies field containing dependencies or `None` before the final cleanup commit removes the active sprint doc from the public integration diff; the same final review content is copied into the sprint-integration PR body.
- Sprint-integration PR is reviewed, passes the required gates, and is merged only after the explicit user merge command.
- If the sprint introduces new product/runtime flows, they are folded into the implementation spec before sprint integration. For this sprint, no implementation spec exists and `docs/specs/` is removed; the docs-build developer verification flow must instead be documented in `package.json`, public docs, and `## Final Review` with this rationale.
