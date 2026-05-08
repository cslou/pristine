# Pristine — Sprint 023

**Date:** TBD – TBD
**Goal:** Using sprint-022 Pi proof evidence, refactor Pristine from raw conversation ownership to a source-pointer semantic index: remove raw transcript storage as a core requirement, store vector-indexed chunks with optional metadata and source pointers, and keep search useful even when source metadata is partial.
**Status:** 🟢 Complete

---

## Handoff

### Project Context

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript strict ESM, Node 18+, `better-sqlite3` + `sqlite-vec`, `@huggingface/transformers` with Nomic Embed v1.5 default, Vitest.
- **Current state:** Pristine currently has conversation/message tables, queue/indexer logic built around stored raw messages, vector windows in `vec_windows`, session vectors in `vec_sessions`, FTS/SQL public views, and search APIs returning conversation/message-centric results. Sprint-022 is complete and proved the Pi JSONL vector-search → JSONL-inspection workflow with source pointers into the authoritative Pi JSONL store. Architecture cleanup uses that evidence: harnesses typically already own authoritative transcript state (Pi JSONL, other harness SQLite/JSONL/etc.), so Pristine should not duplicate raw transcripts by default.
- **Implementation spec:** `docs/specs/implementation-spec-005.md` must be updated by this sprint because the core primitive model changes from raw corpus owner to semantic index over source-owned records.

### Sprint-Wide Context

- **Sprint type:** Refactor / Architecture cleanup.
- **Shared context:** Depends on sprint-022 Pi proof evidence. No user-data compatibility burden. Remove dead/incorrect raw transcript ownership now rather than preserving dual modes. Pristine stores embeddings, indexed snippets, and optional source pointers/metadata; source systems remain authoritative for raw context. Metadata must be optional because not every harness exposes session IDs, line numbers, timestamps, or stable entry IDs.
- **Non-goals:** No new Pi reference implementation in this sprint beyond consuming evidence from sprint-022. No default embedder swap. No migration support for old Pristine DBs. No fact extraction. No SQL query tool over raw conversations. No published package split. No replacement SQL/debug primitive over source-index tables unless a later sprint explicitly reintroduces one.

### Affected Flows

- **Existing flows affected:** Memory ingest/index, vector search, FTS/hybrid search if retained, SQL public views if removed/replaced, spec/reference flows `search_memory` and `query_memory`, tests around `ConversationStore`, client APIs that expose `storeAsync`, `drainEmbedQueue`, `buildSessionVector`, and search result shapes.
- **New flows introduced:** Generic source-chunk indexing with optional source metadata and pointer-based vector search results.

### Regression Invariants to Preserve

- Project isolation is enforced before any search result is returned.
- Embedding dimension mismatch remains a loud domain error, not an opaque sqlite-vec failure or bogus score.
- Search results include enough source pointer/provenance data for a harness to inspect the authoritative raw source when metadata is available.
- Minimal metadata indexing works: text plus generated chunk ID is sufficient to index and retrieve.
- Stable source-pointer reindex behavior is deterministic: duplicate/replacement semantics are documented and tested.
- Delete/replace cleanup prevents stale vector hits from removed or superseded source chunks.
- Pristine does not require or imply ownership of raw transcripts, threads, or messages.
- Local-first/no-network guarantees remain documented and verified.
- Deterministic regression tiers remain green; the deep gate includes the first-class smoke suite from PR #188.

### SQL Primitive Decision

- The current public `searcher.sql(...)` primitive is planned for removal during this cleanup because it exists to query curated SQL views over Pristine-owned raw conversation/message mirrors (`messages_public`, `conversations_public`, `messages_fts`, and `summaries_public`).
- Source systems remain authoritative for raw context inspection; Pristine should return pointers/snippets, not expose a transcript SQL surface.
- A future source-index-only SQL/debug primitive may be designed later, but it is out of scope for this sprint and must not preserve the current raw-transcript SQL contract.

### Verification Strategy

This sprint follows verifiability-first engineering: every story must define how its new or changed behavior will be proven correct and which existing behavior it could regress.

Verification has two categories:

- **Functional verification:** new verification created for behavior introduced or changed by this sprint.
- **Regression verification:** existing verification for behavior that predates this sprint.

Each implementation story must include functional verification for new behavior and targeted regression verification for affected existing behavior. The Final Verification Story runs all sprint functional verification plus the full available regression suite.

### Stories

**Constraints:** Target 5-8 stories per sprint. Each story should be small enough to review, verify, and merge independently.

#### Story 1: Update spec and public architecture language for source-pointer indexing

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
  - Findings: P1 contradictions in active spec sections initially still referenced raw conversations, SQL/FTS/hybrid primitives, and legacy `searcher.sql`; P2 ambiguity around whether `projectId` is required chunk metadata.
  - Resolution: Updated active sections to source-pointer semantic index architecture, marked remaining legacy sections historical/non-target, removed active raw SQL/FTS/hybrid primitive language, and made `projectId` an indexing-call option while minimal chunk metadata remains text plus generated chunk ID.
- **As a** SDK maintainer, **I want** the spec to define Pristine as a semantic index over source-owned records, **so that** implementation work removes raw transcript ownership intentionally rather than as an ad-hoc deletion.
- **Dependencies:** Sprint 022 complete
- **Acceptance criteria:**
  - [x] Sprint-022 final evidence from `docs/sprints/sprint-022.md` `

## Final Review

**Mergeability:** 5/5

## Sprint objective + accomplishments

**Objective:** Refactor Pristine from raw conversation ownership to a source-pointer semantic index: remove raw transcript storage as a core requirement, store vector-indexed chunks with optional metadata and source pointers, and keep search useful when source metadata is partial.

**What was accomplished:**
- **Story 1 — Update spec and public architecture language for source-pointer indexing** — Updated `docs/specs/implementation-spec-005.md` to make source-owned raw records authoritative and Pristine responsible for semantic source chunks, snippets, embeddings, and pointers. The spec now removes the raw-transcript `searcher.sql(...)` primitive from the target architecture and documents text-only/minimal metadata behavior.
- **Story 2 — Introduce generic source chunk/index types and storage schema** — Added source chunk input/types, `source_chunks`, `vec_source_chunks`, dimension validation, metadata validation, project-scoped identity, collision-safe vector keys, and stale-vector cleanup. Unit/schema coverage verifies full, partial, minimal, invalid, duplicate, and dimension-specific storage behavior.
- **Story 3 — Replace raw conversation ingest with source chunk indexing API** — Added `PristineLocal.indexSourceChunks()` as the synchronous source-chunk ingest path. Tests prove metadata/vector rows are queryable after the call, duplicate replacement is atomic/project-scoped, invalid inputs avoid embedding cost, and failed batches roll back.
- **Story 4 — Return source pointers from vector search and remove conversation-centric result assumptions** — Added `PristineLocal.searchSourceChunks()` returning chunk IDs, indexed text/snippets, scores, nullable source pointers, and metadata without conversation/message joins. Tests cover full metadata, minimal metadata, project isolation, argument validation, and query embedding dimension mismatch.
- **Story 5 — Remove raw conversation/message storage and obsolete SQL/public views** — Deleted raw `ConversationStore`, ingest queue, indexer/window/session-vector modules, FTS/hybrid/searcher SQL modules, obsolete scripts, and tests that only verified raw transcript ownership. Kept source-index and privacy regression coverage, added a real-model source-index smoke, and removed unused dependencies.
- **Story 6 — Update docs, examples, and exports to source-index terminology** — Rewrote README/package-facing docs around source chunks, source pointers, persisted indexed text/snippets, and first-use model download caveats. Added package-entrypoint smoke coverage against built `dist/index.js` and updated smoke to build before import.
- **Final Story — Sprint Verification & Completion** — Ran all story verification plus full regression verification. The sprint doc is marked complete with this audit trail.

## Verification delta

| Verification type | Before sprint | Added this sprint | Removed | Pending / not yet run | After sprint | Notes |
|---|---:|---:|---:|---:|---:|---|
| Unit | 583 | +44 | 336 | 0 | 291 | Added source-index/client/regression coverage; removed raw conversation/search/indexer-only tests. |
| Integration / contract | 171 | +0 | 153 | 0 | 18 | Retained privacy/embedder integration; removed raw transcript/search integration. |
| E2E / smoke | 4 | +2 | 0 | 0 | 6 | Added package-entrypoint smoke and source-index real-model smoke; deterministic e2e retained. |
| Simulator / device | 0 | +0 | 0 | 0 | 0 | Not applicable. |
| AI / model evals | 0 | +1 | 1 | 0 | 1 | Replaced real-model indexer smoke with source-index real-model smoke. |
| Static / local checks | 5 | +1 | 0 | 0 | 6 | Added smoke build/package-entrypoint contract; lint/typecheck/build/regression tiers retained. |
| Performance / load | 0 | +0 | 0 | 0 | 0 | Not applicable. |
| Security / dependency | 0 | +0 | 0 | 0 | 0 | No dedicated audit; privacy/security tests run in unit/integration/e2e. |
| Accessibility / visual | 0 | +0 | 0 | 0 | 0 | Not applicable. |
| Manual-only | 0 | +0 | 0 | 0 | 0 | Fully automated verification. |
| Other verification | 0 | +3 | 0 | 0 | 3 | Grep/deletion audits and package/docs checks. |
| **Total** | **763** | **+51** | **490** | **0** | **319** |  |

Counting basis: Vitest test counts plus scripted verification surfaces from regression tiers, smoke scripts, and grep audits. Removed counts are intentional deletion of raw conversation/message ownership verification after replacement source-index coverage landed.
Regression summary: 0 existing retained regression verifications pending/not yet run; full tier passed with 9/9 checks green.

## Why ready
- Every implementation story AC remains in the sprint body and is checked against merged story PR evidence plus final audit commands.
- Functional verification for source-index schema, indexing, pointer search, deletion audit, docs/export package entrypoint, and final completion passed.
- Full regression verification passed: `.checks/regression.sh --tier=full` green, score 5/5.
- Required final suite components passed directly or as named full-tier components: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build`, `npm run test:smoke`, `SKIP_SLOW_TESTS=1 npm run test:integration`, `npm run test:e2e`, `npm run test:integration`, and `node scripts/smoke-source-index.mjs`.
- Package-entrypoint verification is preserved: `npm run test:smoke` now runs `npm run build` first and includes `tests/smoke/package-entrypoint.smoke.test.ts` importing built `../../dist/index.js`.
- Final Story PR review gate will carry the last `/review` / `/review-fix` result before merge.

## Open for your decision
- None — fully automated verification.

## Delivered

| Story | Item | Status | Evidence |
|---|---|---|---|
| Story 1 — Spec architecture | Source-pointer architecture replaces raw transcript ownership | ✅ | `docs/specs/implementation-spec-005.md`; PR #189 |
| Story 2 — Source chunk schema | Source chunk tables/types/validation | ✅ | `tests/memory/source-index/schema.test.ts`; PR #190 |
| Story 3 — Indexing API | Direct source chunk indexing and atomic writes | ✅ | `tests/client.test.ts`; PR #191 |
| Story 4 — Pointer search | Source chunk vector search result shape | ✅ | `tests/client.test.ts`; PR #192 |
| Story 5 — Raw transcript removal | Conversation/message/searcher SQL modules removed | ✅ | deletion audit; PR #193 |
| Story 6 — Docs/exports | README/package docs and package-entrypoint smoke | ✅ | `tests/smoke/package-entrypoint.smoke.test.ts`; PR #194 |
| Final Story — Regression | Full regression suite | ✅ | `.checks/regression.sh --tier=full` green 5/5 |

## Drift from spec
- Intentional implementation drift from earlier historical spec sections: raw conversation/message ownership, raw SQL/searcher views, FTS/hybrid/session-vector APIs, and queue/indexer modules were removed rather than adapted.
- Source-index flow is now the live contract: `indexSourceChunks()` plus `searchSourceChunks()` over source pointers.

## New Dependencies
- None. Removed unused dependencies `@babel/parser` and `p-limit` with the raw-message chunker/queue cleanup.
