# Pristine — Sprint 025
**Date:** 2026-05-10 – 2026-05-10
**Goal:** Make Pristine safe to open-source as a public alpha by proving legal, security, package, CI, documentation, history-audit, and API-stability readiness gates pass.
**Status:** 🟢 Complete

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
  - [x] A `LICENSE` file exists at the repo root with the selected open-source license text. Evidence: `LICENSE` contains MIT license text selected by Lou.
  - [x] `package.json` includes `license`, `repository`, `bugs`, `homepage`, `keywords`, and `engines` fields with values matching the public repo and tested runtime. Evidence: metadata check command passed.
  - [x] README installation and package-name references match the package metadata. Evidence: README install block uses `@pristine/shield-local` and public repo/runtime note was added.
  - [x] If Node support is constrained by native dependencies or ESM behavior, the `engines.node` value and README support note state that constraint explicitly. Evidence: `engines.node` is `>=22`; README notes Node.js 22+, ESM-only, and native SQLite dependencies.
- **Functional verification:**
  - [x] Run `node -e "const p=require('./package.json'); for (const k of ['license','repository','bugs','homepage','keywords','engines']) if (!(k in p)) throw new Error('missing '+k); if (!require('fs').existsSync('LICENSE')) throw new Error('missing LICENSE');"` and confirm it exits 0. Evidence: passed with MIT license assertion.
  - [x] Run `npm pack --dry-run --json` and confirm the generated package metadata includes the chosen license and no metadata warning about missing license. Evidence: passed; dry-run package includes `LICENSE` and `package.json`, and `package.json` declares `MIT`.
- **Regression verification:**
  - [x] Run `npm run build` and confirm package metadata/doc-only changes do not affect compilation. Evidence: passed.
  - [x] Run `npm run test:smoke` and confirm public package entrypoints still load. Evidence: passed, 5 smoke tests.
- **Manual-only verification:** Completed — Lou selected MIT before Story 1 implementation.
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
  - [x] `SECURITY.md` exists and documents supported versions, private vulnerability reporting instructions, disclosure expectations, and the local-first/privacy-sensitive nature of reports. Evidence: `SECURITY.md` added and content check passed.
  - [x] Production dependency audit no longer reports the critical `protobufjs <7.5.5` path from `@huggingface/transformers` / `onnxruntime-web`, either by safe upgrade, override, or documented dependency replacement. Evidence: `protobufjs` override pins `7.5.5`; `npm audit --omit=dev --audit-level=moderate` passed.
  - [x] `package-lock.json` reflects deterministic dependency changes when dependency versions or overrides change. Evidence: `npm install --package-lock-only --ignore-scripts` and `npm audit fix --package-lock-only --ignore-scripts` updated the lockfile.
  - [x] If dev-only audit findings remain, they are recorded in the story PR body with severity, affected package, and follow-up decision. Evidence: full `npm audit --audit-level=moderate` passed with 0 vulnerabilities after lockfile updates to `vite` and `postcss`.
- **Functional verification:**
  - [x] Run `npm audit --omit=dev --audit-level=moderate` and confirm it exits 0. Evidence: passed, `found 0 vulnerabilities`.
  - [x] Run `node -e "const fs=require('fs'); const s=fs.readFileSync('SECURITY.md','utf8'); for (const term of ['Supported Versions','Reporting','Security']) if (!s.includes(term)) throw new Error('SECURITY.md missing '+term);"` and confirm it exits 0. Evidence: passed.
- **Regression verification:**
  - [x] Run `npm run test:unit` and confirm dependency/security-policy changes do not regress unit behavior. Evidence: passed, 322 tests.
  - [x] Run `npm run test:integration` and confirm the local embedder integration still works after dependency changes. Evidence: passed, 19 tests including local embedder integration.
- **Manual-only verification:** N/A — no manual-only verification required.
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
  - [x] Package build or prepack flow removes stale `dist/` before rebuilding. Evidence: `build` now runs `clean` before `tsc`; `prepack` runs `build`.
  - [x] A repeatable package-content verification script exists and fails if `npm pack --dry-run --json` includes stale removed paths such as `dist/conversations/`, `dist/memory/indexer/`, `dist/memory/searcher/`, `dist/queue/`, or `dist/privacy/classifier/llm/` when those paths are not current supported package output. Evidence: `scripts/verify-package-contents.mjs` checks forbidden prefixes and negative fixture failed as expected.
  - [x] `package.json` includes a `verify:package` npm script for package verification. Evidence: `npm run verify:package` passed.
  - [x] The verified tarball includes required public files: `package.json`, `README.md`, `LICENSE`, and current `dist/` entrypoint/type files. Evidence: verifier requires those paths and passed on `npm pack --dry-run --json` output.
- **Functional verification:**
  - [x] Run `npm run verify:package` and confirm it exits 0 on a clean build. Evidence: passed; `package contents verified: 151 files`.
  - [x] Generate or fixture an `npm pack --dry-run --json` payload containing a forbidden path, run the verifier in scan-only mode (for example `node scripts/verify-package-contents.mjs --pack-json <fixture>`), and confirm it exits non-zero without relying on dirty `dist/` state. Evidence: fixture containing `dist/queue/ingest-queue.js` failed with `Package includes forbidden stale files`.
- **Regression verification:**
  - [x] Run `npm run test:smoke` and confirm built-package public API smoke tests still pass after package-script changes. Evidence: passed, 5 smoke tests.
  - [x] Run `npm run build` and confirm clean build still produces the expected `dist/` entrypoints. Evidence: passed.
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
  - [x] GitHub Actions runs `npm ci`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:smoke`, deterministic integration with slow model tests skipped, `npm run test:e2e`, and package verification. Evidence: `.github/workflows/unit-tests.yml` now defines the deterministic public gate with those steps, building before typecheck so smoke tests can resolve `dist` on a fresh checkout.
  - [x] CI avoids paid services, production endpoints, and model-download-only checks by default. Evidence: integration uses `SKIP_SLOW_TESTS=1`; no credentials or hosted services are configured.
  - [x] CI workflow names clearly distinguish deterministic public checks from local full/regression checks that may use real local models. Evidence: workflow is named `Public CI Gate`, job is `Deterministic public gate`.
  - [x] README or CONTRIBUTING docs state which checks run in CI and which checks maintainers run locally before release. Evidence: README development section lists CI commands and notes full local regression for real local model checks.
- **Functional verification:**
  - [x] Run a local workflow-equivalent command sequence from the CI YAML and confirm every command exits 0. Evidence: `rm -rf dist && npm ci && npm run build && npm run typecheck && npm run lint && npm run test:unit && npm run test:smoke && SKIP_SLOW_TESTS=1 npm run test:integration && npm run test:e2e && npm run verify:package` passed.
  - [x] Push the story branch and confirm the GitHub Actions check for this workflow passes on the story PR. Evidence: PR #208 `Deterministic public gate` passed in GitHub Actions run `25628281099`.
- **Regression verification:**
  - [x] Run `.checks/pre-merge.sh` and confirm the local gate remains green. Evidence: passed, regression score 5/5.
  - [x] Run `npm run test:unit` and confirm the existing unit suite count remains at or above the pre-sprint baseline unless removals are explicitly documented. Evidence: local workflow-equivalent command passed, 322 unit tests.
- **Manual-only verification:** Completed — PR #208 GitHub-hosted `Deterministic public gate` check passed.
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
  - [x] A repeatable repository audit script or documented command set scans tracked files and reachable git history for high-risk secret patterns before public release. Evidence: `scripts/audit-repository-secrets.mjs` scans current tree and reachable history.
  - [x] The audit covers at minimum API-key/token patterns, private key material, `.env`-style assignments, and benchmark/example files that mention external API providers. Evidence: script covers private-key blocks, GitHub/OpenAI-style tokens, selected secret env assignments, tests/docs/benchmarks false-positive classification.
  - [x] The audit report is recorded in `docs/security-audits/` or another committed audit location with date, command(s), commit range, findings, false-positive rationale, and remediation status. Evidence: `docs/security-audits/2026-05-10-sprint-025-history-audit.md` generated.
  - [x] Any confirmed secret or sensitive internal data finding is remediated, or public release remains explicitly blocked until Lou records an accepted resolution in the audit report and sprint final review. Evidence: audit reported 0 unresolved findings.
  - [x] Optional benchmark or internal artifacts that mention hosted APIs are either clearly documented as non-SDK/evaluation-only or moved/excluded if they undermine the local-first public story. Evidence: benchmark/spec/test hits are recorded as false positives/synthetic examples; unresolved count is 0.
- **Functional verification:**
  - [x] Run the new or documented audit command against the current working tree and confirm it exits 0 or produces only documented false positives. Evidence: `node scripts/audit-repository-secrets.mjs --output docs/security-audits/2026-05-10-sprint-025-history-audit.md` passed with 37 current findings, all false positives.
  - [x] Run the audit command against reachable git history and confirm it exits 0 or produces only documented false positives. Evidence: final rerun scanned 923 reachable commits before the report commit and 90 unique history findings, all false positives.
  - [x] Run `git grep -nE '(BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|AWS_SECRET_ACCESS_KEY|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,})' -- . ':!package-lock.json'` and confirm no unresolved findings remain. Evidence: equivalent patterns run by the audit script; all matches are documented false positives/synthetic fixtures with 0 unresolved findings.
- **Regression verification:**
  - [x] Run `npm run lint` and confirm any new audit script follows repo lint rules if it is JavaScript/TypeScript. Evidence: passed.
  - [x] Run `npm run test:unit` and confirm audit tooling/docs do not affect runtime behavior. Evidence: passed, 322 tests.
- **Manual-only verification:** Completed — audit report reviewed; ambiguous matches are documented as synthetic test/doc/benchmark fixtures and unresolved findings are 0.
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
  - [x] README includes a plain Node quickstart that covers creating a client, indexing source chunks, searching, and cleanup/error handling. Evidence: quickstart now uses `try`/`catch`/`finally`, `deleteSourceChunks`, and `dispose`.
  - [x] README privacy section explicitly states default model download behavior, offline/cache expectations, what data is stored in plaintext source chunks, what vault data is encrypted, and when configuring a non-local Ollama host sends text to that endpoint. Evidence: `Privacy threat model` section updated.
  - [x] Stale docs that describe removed public APIs are either updated, archived with a clear historical banner, or removed from public onboarding paths. Evidence: `docs/agent-integration.md` archived with a historical banner and current integration pointer.
  - [x] Native/runtime troubleshooting is documented for `better-sqlite3`, `sqlite-vec`, Node version, ESM-only usage, and local model cache behavior. Evidence: README native/runtime troubleshooting section added.
  - [x] Public docs distinguish core SDK primitives from examples/reference implementations. Evidence: README public documentation map distinguishes public primitives, `examples/pi-dev/`, and historical planning docs.
- **Functional verification:**
  - [x] Run README/public-doc link and code-fence checks if an existing checker exists; otherwise add/run a lightweight script that verifies referenced local files exist and package import snippets compile or are marked illustrative. Evidence: `npm run verify:docs` passed.
  - [x] Run `npm run test:smoke` and confirm README-documented package entrypoints remain valid. Evidence: passed, 5 smoke tests.
- **Regression verification:**
  - [x] Run `npm run build` and confirm docs/example updates do not break package build. Evidence: passed.
  - [x] Run `npm run test:e2e` and confirm documented privacy pipeline behavior still passes. Evidence: passed, 4 e2e tests.
- **Manual-only verification:** Completed — manually read README plus public onboarding docs; `rg 'storeAsync|getConversation|drainEmbedQueue|buildSessionVector|searcher\.sql|extract-worker|store\.ts|search-conversations' README.md docs/agent-integration.md examples/pi-dev/README.md` shows only negative/archived removed-API mentions, not live onboarding instructions.
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
  - [x] `CONTRIBUTING.md` documents setup, local verification commands, slow-test controls, coding conventions, PR expectations, and how to run package verification. Evidence: `CONTRIBUTING.md` added.
  - [x] `CHANGELOG.md` exists with an initial unreleased/public-alpha entry and a semver policy for pre-1.0 changes. Evidence: `CHANGELOG.md` added.
  - [x] A release checklist documents clean build, audit, package verification, full regression, npm provenance/trusted publishing expectations, and the fact that actual publish remains out of scope for this sprint. Evidence: `docs/release-checklist.md` added.
  - [x] The root public exports are audited and documented as supported, intentionally internal, or deferred; any export-surface change has test coverage and migration notes. Evidence: `docs/public-api.md` added and package-entrypoint smoke asserts exact runtime root exports.
  - [x] `.github/PULL_REQUEST_TEMPLATE.md` and issue templates, if changed, are external-contributor friendly and still capture verification evidence. Evidence: PR template now includes public API/docs impact and verification evidence prompts; no issue templates exist.
- **Functional verification:**
  - [x] Run a new or existing API export smoke test that imports every documented public root export from the built package and confirms each documented export exists. Evidence: `npm run test:smoke` passed with exact root export assertion.
  - [x] Run `node -e "for (const f of ['CONTRIBUTING.md','CHANGELOG.md']) if (!require('fs').existsSync(f)) throw new Error('missing '+f);"` and confirm it exits 0. Evidence: command passed.
- **Regression verification:**
  - [x] Run `npm run test:smoke` and confirm public API smoke coverage still passes. Evidence: passed, 5 smoke tests.
  - [x] Run `npm run typecheck` and confirm any export-surface typing changes are valid. Evidence: passed.
- **Manual-only verification:** Completed — reviewed `docs/release-checklist.md` against package, CI, dependency-audit, and repository-secret stories; every release gate has an owner command or explicit manual step.
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
  - [x] Every story’s acceptance criteria are evaluated against implementation evidence. Evidence: Stories 1–7 ACs are checked with file/command evidence.
  - [x] Every story’s functional verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun. Evidence: all story functional verification rows are checked with command evidence.
  - [x] Every story’s targeted regression verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun. Evidence: all story regression rows are checked with command evidence.
  - [x] The full available regression verification suite is run, including existing unit, integration, e2e, smoke, simulator/browser/device, static, and manual-only checks where applicable. Evidence: `.checks/regression.sh --tier=full` passed, 9/9 checks.
  - [x] Failed, ambiguous, manual-only, or unrun verification items are documented. Evidence: Final Review records manual-only checks and zero failed/unrun required checks.
  - [x] The sprint’s new functional verification is identified as future regression verification. Evidence: Final Review verification delta identifies added checks.
  - [x] Verification delta is reported by canonical type, showing before sprint, added this sprint, removed, pending/not yet run, and after sprint totals; every canonical verification type row is present, using zeroes where applicable. Evidence: Final Review delta table.
  - [x] The sprint doc status is updated to `🟢 Complete` only if completion criteria are met. Evidence: completion criteria met and status updated.
  - [x] A `## Final Review` section is appended to the sprint doc with the final completion message quoted for auditability. Evidence: section appended below.
- **Functional verification:**
  - [x] Run all functional verification items from every story and record pass/fail evidence. Evidence: Stories 1–7 functional checks are checked; final reruns included `verify:docs`, `verify:package`, `npm audit --omit=dev`, repository secret audit, and full regression.
- **Regression verification:**
  - [x] Run all targeted regression verification items from every story and record pass/fail evidence. Evidence: story regression checks are checked and final full regression passed.
  - [x] Run the full available regression verification suite and record pass/fail evidence. Evidence: `.checks/regression.sh --tier=full` passed, regression score 5/5.
- **Manual-only verification:** Completed — license selection, GitHub-hosted CI pass verification, first-time-user docs review, release-checklist review, and history-audit ambiguity review all passed or reported no open ambiguity.
- **Planned commits:**
  1. `docs: complete sprint 025 verification`
- **Technical notes:** Final verification uses the story sections plus the existing regression suite as the source of truth. `## Final Review` below is the durable audit copy of the completion message.

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

## Final Review

**Mergeability:** 5/5

## Sprint objective + accomplishments

**Objective:** Make Pristine safe to open-source as a public alpha by proving legal, security, package, CI, documentation, history-audit, and API-stability readiness gates pass.

**What was accomplished:**
- **Story 1 — Legal License & Package Identity** — Added the MIT license and public package metadata so users can legally evaluate and install the package. Evidence lives in `LICENSE`, `package.json`, and PR #205.
- **Story 2 — Security Policy & Dependency Audit** — Added `SECURITY.md`, remediated the production dependency audit, and proved `npm audit --omit=dev` reports 0 vulnerabilities. Evidence lives in `SECURITY.md`, `package-lock.json`, and PR #206.
- **Story 3 — Clean Package Artifact Verification** — Added package artifact verification so packed output contains only intended public files and no stale ignored build artifacts. Evidence lives in `scripts/verify-package-contents.mjs`, `package.json`, and PR #207.
- **Story 4 — Public CI Gate Expansion** — Expanded GitHub's deterministic public gate to build, typecheck, lint, test, smoke, and verify package contents for external contributors. Evidence lives in `.github/workflows/unit-tests.yml` and PR #208.
- **Story 5 — Repository History & Secret Disclosure Audit** — Added a repeatable current-tree/history secret audit with exact false-positive rationale and 0 unresolved findings. Evidence lives in `scripts/audit-repository-secrets.mjs`, `docs/security-audits/2026-05-10-sprint-025-history-audit.md`, and PR #209.
- **Story 6 — Public Documentation & Privacy Threat Model** — Updated README onboarding, privacy/network/storage expectations, troubleshooting, public-doc mapping, and archived stale agent-integration docs. Evidence lives in `README.md`, `docs/agent-integration.md`, `scripts/verify-public-docs.mjs`, and PR #210.
- **Story 7 — Public API Stability, Contribution, and Release Process** — Added contribution, changelog, release checklist, public API documentation, and exact root-export smoke coverage. Evidence lives in `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/release-checklist.md`, `docs/public-api.md`, and PR #211.

## Verification delta

| Verification type | Before sprint | Added this sprint | Removed | Pending / not yet run | After sprint | Notes |
|---|---:|---:|---:|---:|---:|---|
| Unit | 1 | +0 | 0 | 0 | 1 | `npm run test:unit` remains 322 tests. |
| Integration / contract | 2 | +0 | 0 | 0 | 2 | Deterministic and full real-model integration tiers both passed. |
| E2E / smoke | 3 | +0 | 0 | 0 | 3 | Smoke, e2e, and source-index real-model smoke passed; package-entrypoint smoke now asserts exact public exports. |
| Simulator / device | 0 | +0 | 0 | 0 | 0 | Not applicable for this Node SDK sprint. |
| AI / model evals | 0 | +0 | 0 | 0 | 0 | No LLM judge/golden evals in scope; local model integration/smoke counted above. |
| Static / local checks | 3 | +4 | 0 | 0 | 7 | Existing build/typecheck/lint plus package verification, docs verification, deterministic public CI, and local pre-merge/full regression wrappers. |
| Performance / load | 0 | +0 | 0 | 0 | 0 | No performance/load changes in scope. |
| Security / dependency | 1 | +3 | 0 | 0 | 4 | Existing privacy/security tests plus dependency audit, SECURITY policy, and repository secret/history audit. |
| Accessibility / visual | 0 | +0 | 0 | 0 | 0 | Not applicable. |
| Manual-only | 0 | +5 | 0 | 0 | 5 | License selection, hosted CI pass, docs first-user read, release-checklist review, and audit ambiguity review completed. |
| Other verification | 0 | +4 | 0 | 0 | 4 | License/package metadata, package contents, docs existence, and release-process checks. |
| **Total** | **10** | **+16** | **0** | **0** | **26** |  |

Counting basis: distinct verification command/checklist surfaces referenced by the sprint, not individual Vitest assertions except where noted. Full final regression evidence: `.checks/regression.sh --tier=full` passed 9/9 checks with regression score 5/5; `npm run verify:docs`, `npm run verify:package`, `npm audit --omit=dev`, and the repository secret audit also passed.
Regression summary: 0 required regression verifications pending/not yet run; 26 total verification surfaces referenced.

## Why ready
- All Story 1–7 acceptance criteria are checked with file, command, PR, or manual-review evidence.
- All story functional verification items are checked, including package verification, docs verification, dependency audit, and secret/history audit.
- Full available regression passed: lint, typecheck, unit, build, smoke, deterministic integration, e2e, full real-model integration, and source-index real-model smoke.
- Story PRs #205–#211 passed review/CI/local gates and merged into `sprint-025`; Final Verification Story local gates passed before PR.

## Open for your decision
- None — sprint implementation verification is complete. The future sprint-integration PR (`sprint-025` → target) still requires Lou's explicit merge command.

## Delivered

| Story | Item | Status | Evidence |
|---|---|---|---|
| Story 1 — Legal License & Package Identity | License/package metadata | ✅ | `LICENSE`, `package.json`, PR #205 |
| Story 2 — Security Policy & Dependency Audit | Security policy and dependency remediation | ✅ | `SECURITY.md`, `npm audit --omit=dev`, PR #206 |
| Story 3 — Clean Package Artifact Verification | Deterministic package contents verification | ✅ | `npm run verify:package`, PR #207 |
| Story 4 — Public CI Gate Expansion | Hosted deterministic public gate | ✅ | `.github/workflows/unit-tests.yml`, PR #208 CI pass |
| Story 5 — Repository History & Secret Disclosure Audit | Current tree/history audit with 0 unresolved findings | ✅ | `node scripts/audit-repository-secrets.mjs --output docs/security-audits/2026-05-10-sprint-025-history-audit.md`, PR #209 |
| Story 6 — Public Documentation & Privacy Threat Model | README/privacy docs and stale-doc archive | ✅ | `npm run verify:docs`, PR #210 |
| Story 7 — Public API Stability, Contribution, and Release Process | Contribution/release/API docs and exact export smoke | ✅ | `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/public-api.md`, `npm run test:smoke`, PR #211 |
| Final Verification | Full available regression | ✅ | `.checks/regression.sh --tier=full` passed 9/9 checks, score 5/5 |

## Drift from spec
- None — sprint matched the public-alpha readiness scope and did not change runtime architecture.

## New Dependencies
- None
