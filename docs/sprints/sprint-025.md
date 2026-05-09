# Pristine — Sprint 025
**Date:** 2026-05-10 – TBD
**Goal:** Make Pristine safe to open-source as a public alpha by proving legal, security, package, CI, documentation, history-audit, and API-stability readiness gates pass.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript strict ESM, Node.js, Vitest, ESLint, SQLite via `better-sqlite3`, `sqlite-vec`, `@huggingface/transformers` local embeddings.
- **Current state:** Sprint 024 is merged and all post-merge verification passed. The SDK core is functional and tested, but public-readiness review found release-blocking gaps: no open-source license, stale generated package artifacts in `dist/`, incomplete package metadata, critical dependency audit finding, unit-only CI, missing public contribution/security/release docs, stale/internal docs, and no repeatable repository history secret audit.
- **Implementation spec:** `docs/specs/implementation-spec-005.md`

### Sprint-Wide Context

- **Sprint type:** Mixed
- **Shared context:** This sprint is a public alpha readiness sprint. It does not add major SDK runtime features; it hardens legal, release, security, CI, documentation, and API-support boundaries so external users can inspect, install, and try the project with clear expectations.
- **Non-goals:** Publishing to npm; announcing publicly; changing the core memory architecture; solving all post-alpha migration/versioning work; replacing the local embedder architecture; adding new runtime dependencies unless required to fix an audited vulnerability.

### Affected Flows

- **Existing flows affected:** npm package install/pack flow; GitHub PR CI flow; maintainer release preparation flow; user README onboarding flow; security vulnerability reporting flow; local development verification flow; public import/API discovery flow.
- **New flows introduced:** Repeatable package-content verification; repeatable repository secret/history audit; public alpha release checklist; external contribution/PR onboarding.

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

Each story below is included because the public-readiness review identified it as necessary before external users can safely depend on the repository.

1. **Legal and package identity** is required because without a license and npm metadata, the repository is not actually open-source usable and consumers lack canonical project/runtime information.
2. **Security policy and dependency audit** is required because a privacy-positioned SDK cannot launch with a critical production audit finding or without a private vulnerability reporting path.
3. **Clean package artifact verification** is required because the current ignored `dist/` can contain stale removed modules and would misrepresent or leak obsolete code if packed.
4. **Public CI gate expansion** is required because external contributors and maintainers need GitHub checks to prove build, lint, typing, tests, and package smoke behavior, not only unit tests.
5. **Repository history and secret audit** is required because opening the repo exposes all reachable history; we need repeatable evidence that no secrets or unintended sensitive/internal information were committed.
6. **Public documentation and privacy threat model** is required because public users need accurate onboarding, offline/network expectations, storage/encryption boundaries, and stale internal docs removed or clearly marked.
7. **API stability and release process** is required because public users need to know which exports are supported, how breaking changes are handled, and how maintainers cut repeatable releases.

### Sprint Doc Review

- **Pass 1:** Mergeability 4/5. P2 findings on package-verifier specificity, secret-audit blocking language, missing contribution flow listing, and final verification delta row completeness.
- **Resolution:** Addressed all P2s inline and recorded per-story planning review findings/resolutions where applicable.
- **Pass 2:** Mergeability 5/5. No remaining findings. Verdict: Ready to start.

### Stories

#### Story 1: Legal License & Package Identity
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
- **As a** public user, **I want** clear license and package identity metadata, **so that** I can legally evaluate, install, and link to Pristine.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] A `LICENSE` file exists at the repo root with the selected open-source license text.
  - [ ] `package.json` includes `license`, `repository`, `bugs`, `homepage`, `keywords`, and `engines` fields with values matching the public repo and tested runtime.
  - [ ] README installation and package-name references match the package metadata.
  - [ ] If Node support is constrained by native dependencies or ESM behavior, the `engines.node` value and README support note state that constraint explicitly.
- **Functional verification:**
  - [ ] Run `node -e "const p=require('./package.json'); for (const k of ['license','repository','bugs','homepage','keywords','engines']) if (!(k in p)) throw new Error('missing '+k); if (!require('fs').existsSync('LICENSE')) throw new Error('missing LICENSE');"` and confirm it exits 0.
  - [ ] Run `npm pack --dry-run --json` and confirm the generated package metadata includes the chosen license and no metadata warning about missing license.
- **Regression verification:**
  - [ ] Run `npm run build` and confirm package metadata/doc-only changes do not affect compilation.
  - [ ] Run `npm run test:smoke` and confirm public package entrypoints still load.
- **Manual-only verification:** Validate with Lou which license to use before finalizing this story if the license was not specified in sprint-start instructions; pass condition is the sprint doc or PR body records the selected license.
- **Planned commits:**
  1. `docs: add public license and package metadata`
- **Technical notes:** Required because open-source use is legally ambiguous without a license. Prefer no runtime code changes in this story.

#### Story 2: Security Policy & Dependency Audit Gate
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
- **As a** privacy-conscious user, **I want** a documented vulnerability reporting path and a clean production dependency audit, **so that** I can trust the public alpha is not launching with known critical dependency risk.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [ ] `SECURITY.md` exists and documents supported versions, private vulnerability reporting instructions, disclosure expectations, and the local-first/privacy-sensitive nature of reports.
  - [ ] Production dependency audit no longer reports the critical `protobufjs <7.5.5` path from `@huggingface/transformers` / `onnxruntime-web`, either by safe upgrade, override, or documented dependency replacement.
  - [ ] `package-lock.json` reflects deterministic dependency changes when dependency versions or overrides change.
  - [ ] If dev-only audit findings remain, they are recorded in the story PR body with severity, affected package, and follow-up decision.
- **Functional verification:**
  - [ ] Run `npm audit --omit=dev --audit-level=moderate` and confirm it exits 0.
  - [ ] Run `node -e "const fs=require('fs'); const s=fs.readFileSync('SECURITY.md','utf8'); for (const term of ['Supported Versions','Reporting','Security']) if (!s.includes(term)) throw new Error('SECURITY.md missing '+term);"` and confirm it exits 0.
- **Regression verification:**
  - [ ] Run `npm run test:unit` and confirm dependency/security-policy changes do not regress unit behavior.
  - [ ] Run `npm run test:integration` and confirm the local embedder integration still works after dependency changes.
- **Manual-only verification:** N/A — no manual-only verification required unless the dependency vulnerability cannot be remediated automatically; in that case, record the exact advisory, mitigation, and residual risk for Lou before merge.
- **Planned commits:**
  1. `chore: remediate production dependency audit findings`
  2. `docs: add security policy`
- **Technical notes:** Required because public release of a privacy SDK with a known critical production advisory is not acceptable. Avoid broad dependency upgrades unless needed for the advisory.

#### Story 3: Clean Package Artifact & Pack Verification
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
  - Findings: P2 — package verifier was unnamed, and the stale-file negative test could be invalid if the script/prepack flow cleans `dist/` before scanning.
  - Resolution: Named the expected package verification script (`npm run verify:package`) and changed the negative verification to use an injected dry-run JSON fixture against a scan-only verifier path rather than relying on dirty `dist/` state.
- **As a** package consumer, **I want** the npm tarball to contain only current supported package artifacts, **so that** installing Pristine does not ship stale removed modules or misleading code.
- **Dependencies:** Story 1
- **Acceptance criteria:**
  - [ ] Package build or prepack flow removes stale `dist/` before rebuilding.
  - [ ] A repeatable package-content verification script exists and fails if `npm pack --dry-run --json` includes stale removed paths such as `dist/conversations/`, `dist/memory/indexer/`, `dist/memory/searcher/`, `dist/queue/`, or `dist/privacy/classifier/llm/` when those paths are not current supported package output.
  - [ ] `package.json` includes a `verify:package` npm script for package verification.
  - [ ] The verified tarball includes required public files: `package.json`, `README.md`, `LICENSE`, and current `dist/` entrypoint/type files.
- **Functional verification:**
  - [ ] Run `npm run verify:package` and confirm it exits 0 on a clean build.
  - [ ] Generate or fixture an `npm pack --dry-run --json` payload containing a forbidden path, run the verifier in scan-only mode (for example `node scripts/verify-package-contents.mjs --pack-json <fixture>`), and confirm it exits non-zero without relying on dirty `dist/` state.
- **Regression verification:**
  - [ ] Run `npm run test:smoke` and confirm built-package public API smoke tests still pass after package-script changes.
  - [ ] Run `npm run build` and confirm clean build still produces the expected `dist/` entrypoints.
- **Manual-only verification:** N/A — no manual-only verification required.
- **Planned commits:**
  1. `chore: add clean package artifact verification`
- **Technical notes:** Required because `dist/` is ignored and can contain stale local artifacts even when source is correct. Prefer a small `scripts/` verifier over adding a dependency.

#### Story 4: Public CI Regression Gate
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
- **As a** maintainer, **I want** GitHub CI to run the deterministic public gate, **so that** external PRs cannot pass with broken types, lint, build, smoke, integration, e2e, or package artifacts.
- **Dependencies:** Stories 2 and 3
- **Acceptance criteria:**
  - [ ] GitHub Actions runs `npm ci`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit`, `npm run test:smoke`, deterministic integration with slow model tests skipped, `npm run test:e2e`, and package verification.
  - [ ] CI avoids paid services, production endpoints, and model-download-only checks by default.
  - [ ] CI workflow names clearly distinguish deterministic public checks from local full/regression checks that may use real local models.
  - [ ] README or CONTRIBUTING docs state which checks run in CI and which checks maintainers run locally before release.
- **Functional verification:**
  - [ ] Run a local workflow-equivalent command sequence from the CI YAML and confirm every command exits 0.
  - [ ] Push the story branch and confirm the GitHub Actions check for this workflow passes on the story PR.
- **Regression verification:**
  - [ ] Run `.checks/pre-merge.sh` and confirm the local gate remains green.
  - [ ] Run `npm run test:unit` and confirm the existing unit suite count remains at or above the pre-sprint baseline unless removals are explicitly documented.
- **Manual-only verification:** GitHub-hosted CI pass is external but reproducible: pass condition is the story PR checks show success for the new/updated workflow.
- **Planned commits:**
  1. `ci: expand public regression gate`
- **Technical notes:** Required because unit-only CI is insufficient for public contributors. Use `SKIP_SLOW_TESTS=1 npm run test:integration` for deterministic hosted CI unless the repo already supports model caching in CI.

#### Story 5: Repository History & Secret Disclosure Audit
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
  - Findings: P2 — “remediated or escalated to Lou” did not itself prove no unresolved confirmed secret/sensitive history finding remains before public release.
  - Resolution: Tightened the criterion so confirmed findings must be remediated or explicitly block public release until Lou records an accepted resolution.
- **As a** maintainer preparing to open the repository, **I want** current files and reachable git history scanned for secrets and unintended sensitive information, **so that** public release does not expose credentials or private material accidentally left in commits.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] A repeatable repository audit script or documented command set scans tracked files and reachable git history for high-risk secret patterns before public release.
  - [ ] The audit covers at minimum API-key/token patterns, private key material, `.env`-style assignments, and benchmark/example files that mention external API providers.
  - [ ] The audit report is recorded in `docs/security-audits/` or another committed audit location with date, command(s), commit range, findings, false-positive rationale, and remediation status.
  - [ ] Any confirmed secret or sensitive internal data finding is remediated, or public release remains explicitly blocked until Lou records an accepted resolution in the audit report and sprint final review.
  - [ ] Optional benchmark or internal artifacts that mention hosted APIs are either clearly documented as non-SDK/evaluation-only or moved/excluded if they undermine the local-first public story.
- **Functional verification:**
  - [ ] Run the new or documented audit command against the current working tree and confirm it exits 0 or produces only documented false positives.
  - [ ] Run the audit command against reachable git history and confirm it exits 0 or produces only documented false positives.
  - [ ] Run `git grep -nE '(BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|AWS_SECRET_ACCESS_KEY|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,})' -- . ':!package-lock.json'` and confirm no unresolved findings remain.
- **Regression verification:**
  - [ ] Run `npm run lint` and confirm any new audit script follows repo lint rules if it is JavaScript/TypeScript.
  - [ ] Run `npm run test:unit` and confirm audit tooling/docs do not affect runtime behavior.
- **Manual-only verification:** Review the committed audit report for ambiguous findings; pass condition is each ambiguous item has a clear false-positive or remediation rationale recorded.
- **Planned commits:**
  1. `chore: add repository secret audit`
  2. `docs: record public-release history audit`
- **Technical notes:** Required because once the repo is public, commit history is public too. Prefer deterministic local scanning without adding a dependency; if an external scanner such as gitleaks or trufflehog is used, document installation and exact version/command.

#### Story 6: Public Documentation & Privacy Threat Model
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
- **As a** new public user, **I want** accurate public documentation and a clear privacy threat model, **so that** I can install, run, and evaluate Pristine without relying on stale internal sprint context.
- **Dependencies:** Stories 1, 2, and 3
- **Acceptance criteria:**
  - [ ] README includes a plain Node quickstart that covers creating a client, indexing source chunks, searching, and cleanup/error handling.
  - [ ] README privacy section explicitly states default model download behavior, offline/cache expectations, what data is stored in plaintext source chunks, what vault data is encrypted, and when configuring a non-local Ollama host sends text to that endpoint.
  - [ ] Stale docs that describe removed public APIs are either updated, archived with a clear historical banner, or removed from public onboarding paths.
  - [ ] Native/runtime troubleshooting is documented for `better-sqlite3`, `sqlite-vec`, Node version, ESM-only usage, and local model cache behavior.
  - [ ] Public docs distinguish core SDK primitives from examples/reference implementations.
- **Functional verification:**
  - [ ] Run README/public-doc link and code-fence checks if an existing checker exists; otherwise add/run a lightweight script that verifies referenced local files exist and package import snippets compile or are marked illustrative.
  - [ ] Run `npm run test:smoke` and confirm README-documented package entrypoints remain valid.
- **Regression verification:**
  - [ ] Run `npm run build` and confirm docs/example updates do not break package build.
  - [ ] Run `npm run test:e2e` and confirm documented privacy pipeline behavior still passes.
- **Manual-only verification:** Manually read README and any public onboarding doc from a first-time-user perspective; pass condition is no page instructs users to call APIs removed in Sprint 023/024.
- **Planned commits:**
  1. `docs: update public onboarding and privacy threat model`
  2. `docs: archive stale public-facing references`
- **Technical notes:** Required because external users will treat README/docs as the product contract. Keep internal sprint/spec docs available but avoid routing public users through stale APIs.

#### Story 7: Public API Stability, Contribution, and Release Process
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
  - Findings: P2 — Story 7 introduced external contribution workflow, but `New flows introduced` did not list contribution/PR onboarding.
  - Resolution: Added external contribution/PR onboarding to sprint-wide new flows.
- **As a** contributor or package consumer, **I want** a defined public API, contribution workflow, changelog, and release checklist, **so that** I know what is supported and how changes reach users safely.
- **Dependencies:** Stories 1, 3, 4, and 6
- **Acceptance criteria:**
  - [ ] `CONTRIBUTING.md` documents setup, local verification commands, slow-test controls, coding conventions, PR expectations, and how to run package verification.
  - [ ] `CHANGELOG.md` exists with an initial unreleased/public-alpha entry and a semver policy for pre-1.0 changes.
  - [ ] A release checklist documents clean build, audit, package verification, full regression, npm provenance/trusted publishing expectations, and the fact that actual publish remains out of scope for this sprint.
  - [ ] The root public exports are audited and documented as supported, intentionally internal, or deferred; any export-surface change has test coverage and migration notes.
  - [ ] `.github/PULL_REQUEST_TEMPLATE.md` and issue templates, if changed, are external-contributor friendly and still capture verification evidence.
- **Functional verification:**
  - [ ] Run a new or existing API export smoke test that imports every documented public root export from the built package and confirms each documented export exists.
  - [ ] Run `node -e "for (const f of ['CONTRIBUTING.md','CHANGELOG.md']) if (!require('fs').existsSync(f)) throw new Error('missing '+f);"` and confirm it exits 0.
- **Regression verification:**
  - [ ] Run `npm run test:smoke` and confirm public API smoke coverage still passes.
  - [ ] Run `npm run typecheck` and confirm any export-surface typing changes are valid.
- **Manual-only verification:** Review the release checklist against this sprint's package/CI/security stories; pass condition is every release gate has an owner command or explicit manual step.
- **Planned commits:**
  1. `docs: add contribution and release process`
  2. `test: document and verify public api exports`
- **Technical notes:** Required because public alpha users need a stable boundary even if version remains pre-1.0. Avoid expanding exports unless there is a clear documented support commitment.

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
  - [ ] Verification delta is reported by canonical type, showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals; every canonical verification type row is present, using zeroes where applicable.
  - [ ] The sprint doc status is updated to `🟢 Complete` only if completion criteria are met.
  - [ ] A `## Final Review` section is appended to the sprint doc with the final completion message quoted for auditability.
- **Functional verification:**
  - [ ] Run all functional verification items from every story and record pass/fail evidence.
- **Regression verification:**
  - [ ] Run all targeted regression verification items from every story and record pass/fail evidence.
  - [ ] Run the full available regression verification suite and record pass/fail evidence.
- **Manual-only verification:** License selection if unresolved before Story 1; GitHub-hosted CI pass verification from Story 4; manual first-time-user docs review from Story 6; release-checklist review from Story 7; ambiguous history-audit finding review from Story 5.
- **Planned commits:**
  1. `docs: complete sprint 025 verification`
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
