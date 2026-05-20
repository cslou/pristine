# Pristine — Story: Remove unreleased deprecated memory API compatibility

**Date:** 2026-05-20
**Type:** Cleanup
**Status:** 🟢 Complete
**Target branch:** sprint-30-and-31
**Working branch:** chore/remove-deprecated-memory-api
**Related issue/spec/sprint/PR:** `docs/sprints/sprint-031.md`, PR #269

---

## Handoff

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript, ESM, Vitest, NodeNext package exports, Vocs docs
- **Current state:** The SDK has not been publicly released, but it still exposes deprecated compatibility names for the pre-`store`/`recall`/`forget` source-memory API: deprecated type aliases, deprecated `Pristine` client methods, root re-exports, docs, and compatibility tests.
- **Problem/current behavior:** Deprecated pre-release compatibility surface makes the public API look older and less intentional before open source release.
- **Expected behavior/outcome:** The public SDK exposes only the canonical `store`, `recall`, and `forget` source-memory API names and associated types; deprecated source-memory aliases/methods/docs/tests are removed before integration to `main`.
- **Branch context:** This standalone story is part of pre-integration hardening for the active `sprint-30-and-31` branch and PR #269, so its PR targets `sprint-30-and-31` rather than the repo default branch.

## Story

**As a** maintainer preparing the SDK for open source, **I want** unreleased deprecated memory compatibility APIs removed, **so that** the first public API surface is clean and professional.

- **Scope:** Remove deprecated source-memory compatibility type aliases, client methods, root exports, docs references, and tests/fixtures that assert those deprecated names.
- **Non-goals:** No behavior changes to `store`, `recall`, `forget`, privacy APIs, Pi extensions, memory storage/search internals, or package publishing/release work.

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

- **Existing flows affected:** Public SDK TypeScript import flow for source-memory APIs; `Pristine` client source-memory method surface; API docs; public API type fixture.
- **New flows introduced:** None — canonical `store`, `recall`, and `forget` flows remain the only supported source-memory flows.

## Acceptance Criteria

- [x] `src/client.ts` no longer declares deprecated source-memory type aliases (`IndexSourceChunksOptions`, `IndexedSourceChunk`, `SearchSourceChunksOptions`, `DeleteSourceChunksOptions`, `DeleteSourceChunksResult`, `SourceChunkSearchHit`) or deprecated methods (`indexSourceChunks`, `searchSourceChunks`, `deleteSourceChunks`). Pass condition: `rg "indexSourceChunks|searchSourceChunks|deleteSourceChunks|IndexSourceChunksOptions|IndexedSourceChunk|SearchSourceChunksOptions|DeleteSourceChunksOptions|DeleteSourceChunksResult|SourceChunkSearchHit" src/client.ts` returns no matches, and any remaining `@deprecated` in `src/client.ts` is explicitly documented as unrelated or removed.
- [x] `src/index.ts` no longer re-exports deprecated source-memory compatibility types or includes the deprecated compatibility comment. Pass condition: `rg "Deprecated compatibility|IndexSourceChunksOptions|IndexedSourceChunk|SearchSourceChunksOptions|DeleteSourceChunksOptions|DeleteSourceChunksResult|SourceChunkSearchHit" src/index.ts` returns no matches.
- [x] Public docs and public API fixture no longer advertise or type-check deprecated source-memory names. Pass condition: `rg "indexSourceChunks|searchSourceChunks|deleteSourceChunks|IndexSourceChunksOptions|IndexedSourceChunk|SearchSourceChunksOptions|DeleteSourceChunksOptions|DeleteSourceChunksResult|SourceChunkSearchHit|Deprecated compatibility" docs/pages tests/smoke README.md` returns no matches except historical story files if intentionally excluded from the command.
- [x] Canonical source-memory API remains available and tested. Pass condition: public API fixture and source-memory tests compile/pass using `StoreOptions`, `StoredMemory`, `RecallOptions`, `RecalledMemory`, `ForgetOptions`, `ForgetResult`, `store`, `recall`, and `forget`.

## Implementation Plan

- **Touched modules/files:** `src/client.ts`, `src/index.ts`, `docs/pages/api.mdx`, `tests/smoke/public-api-types-fixture.mts`, `tests/client/source-memory-store.test.ts`, possibly related docs/tests discovered by `rg`.
- **Approach:** Delete unreleased compatibility aliases/methods/exports and remove docs/test expectations for them. Keep canonical method/type names unchanged and avoid broad refactors. Keep this story on `sprint-30-and-31` because it is pre-integration cleanup before PR #269 lands in `main`.
- **Risks/rollback:** Low risk / normal git revert. Main risk is missing a stale deprecated reference or accidentally weakening canonical source-memory coverage.
- **New dependencies:** None
- **Planned commits:**
  1. `chore: remove deprecated source memory api aliases` — remove deprecated source-memory API surface and update docs/tests/fixtures.

## Verification Plan

This story follows verifiability-first engineering: define how the new or changed behavior will be proven correct and which existing behavior it could regress before implementation starts.

- **Functional verification:**
  - [x] Run `rg "indexSourceChunks|searchSourceChunks|deleteSourceChunks|IndexSourceChunksOptions|IndexedSourceChunk|SearchSourceChunksOptions|DeleteSourceChunksOptions|DeleteSourceChunksResult|SourceChunkSearchHit|Deprecated compatibility" src docs/pages tests/smoke tests/client README.md`; pass condition: no deprecated source-memory API matches remain outside story docs or explicitly documented false positives.
  - [x] Run `pnpm run verify:public-api-types`; pass condition: public API type fixture compiles using only canonical source-memory API names.
- **Regression verification:**
  - [x] Run `pnpm run test:unit -- tests/client/source-memory-store.test.ts`; pass condition: canonical `store`, `recall`, and `forget` source-memory tests pass after deprecated aliases are removed.
  - [x] Run `pnpm run test:smoke`; pass condition: package build, public API type verification, and smoke suite pass after public API cleanup.
  - [x] Run `pnpm run docs:build`; pass condition: public docs build successfully after deprecated API references are removed from MDX docs.
  - [x] Run `pnpm run lint && pnpm run typecheck`; pass condition: lint and TypeScript checks pass without errors.
- **Manual-only verification:** N/A — API cleanup is covered by static checks, public type fixture, and automated tests.

## Completion Evidence

(Fill this in before marking the story `🟢 Complete`.)

- **PR:** #270 (`chore: remove deprecated source memory api aliases` targeting `sprint-30-and-31`)
- **Commits:** `81a2964 chore: remove deprecated source memory api aliases`
- **Acceptance criteria evidence:** Removed deprecated aliases/methods from `src/client.ts`, root compatibility exports from `src/index.ts`, public docs references from `docs/pages/api.mdx`, public type fixture imports/usages from `tests/smoke/public-api-types-fixture.mts`, and deprecated compatibility assertions from `tests/client/source-memory-store.test.ts`. Renamed the internal source-index search hit type to avoid keeping the deprecated public compatibility name in `src/`.
- **Functional verification evidence:** PASS — `rg "indexSourceChunks|searchSourceChunks|deleteSourceChunks|IndexSourceChunksOptions|IndexedSourceChunk|SearchSourceChunksOptions|DeleteSourceChunksOptions|DeleteSourceChunksResult|SourceChunkSearchHit|Deprecated compatibility" src docs/pages tests/smoke tests/client README.md` returned no matches (exit 1). PASS — `pnpm run verify:public-api-types`.
- **Regression verification evidence:** PASS — `pnpm run test:unit -- tests/client/source-memory-store.test.ts`; PASS — `pnpm run test:smoke`; PASS — `pnpm run docs:build`; PASS — `pnpm run lint`; PASS — `pnpm run typecheck`; PASS — push hook standard tier (`pnpm run lint`, `pnpm run typecheck`, `pnpm run test:unit`) with 38 unit files / 410 tests passing.
- **Manual-only verification evidence:** N/A
- **Failed, ambiguous, or unrun verification:** None
- **Review evidence:** `/review` for PR #270 returned 0 P0, 0 P1, 7 P2 (six git-history churn context notes plus one PR-body public-API-impact wording note that was addressed); mergeability 4/5.
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
