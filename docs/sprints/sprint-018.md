# Pristine — Sprint 018
**Date:** 2026-04-28 – TBD
**Goal:** Tighten the public SDK surface so Phase 6 reference tools and external dogfooding consumers (e.g., wiring Pristine into pi.dev harness) have a clean, complete, intentional API to call.
**Status:** 🟡 Planning

---

## Handoff

### Project Context

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript (strict, ESM), Node 18+, `better-sqlite3` + `sqlite-vec`, `@huggingface/transformers` (Nomic Embed v1.5, 768-d), Vitest. Local-first — zero outbound network calls in production code.
- **Current state:** Sprint-016 just shipped spec-005 Phase 4 — `Pristine.create({...}).storeAsync(...)` populates the corpus end-to-end and `client.searcher` exposes `vectorSearch`, `ftsSearch`, `hybridSearch`, and `sessionVectorSearch` with filter-first scoping + RRF fusion. The integration suite and 537/537 unit tests are green. **However**, the public SDK surface (`src/index.ts` barrel + `PristineLocal` public methods) has real gaps: `indexer.buildSessionVector` is private (so the session leg of `hybridSearch` is dead-on-arrival for any consumer using only the public API); `runEmbedWorker` is exported only from internal `./memory/indexer/embed-worker.js` (consumers can't drain the queue without reaching into internals); and the barrel mixes legitimate primitives with internal leakage (`IngestQueue` class, `IngestTask`, `IngestQueueConfig`) and stale types from the pre-spec-005 era (`Memory`).
- **Implementation spec:** `docs/specs/implementation-spec-005.md` — §5.1 (core primitives) is authoritative for what should be on the public surface; §5.2 (reference implementations) describes Phase 6's needs from this sprint.

### Sprint-Level Technical Context

- **API hygiene, NOT new features.** Every primitive this sprint exposes already exists in the codebase — they're just hidden behind `private` fields, missing from the barrel, or buried behind legacy exports that should be removed. The work is exposing the right things, hiding the wrong things, and documenting the contract.
- **Schema/DDL changes: NONE.** No `vec_windows`/`vec_sessions`/`messages_fts` DDL touches. No queue table changes. Pure TypeScript surface area — types, exports, and thin passthrough methods on `PristineLocal`.
- **No breaking changes to existing public methods.** `storeAsync`, `searchConversations`, `getConversation`, `secureAndRedact`, `reveal`, `scrubOutput`, `dispose` keep their current signatures. Only additive changes (new public methods, new exports) and pure removals (legacy exports that nothing depends on). Any deprecation lands as JSDoc + alternative pointer, not a runtime change.
- **Standing commit-floor exemption (Stories 2, 3, 4, 5).** Each of these stories ships ≤4 commits — below the template's 5-8 floor. The deliverable shape in every case is "single shim / single removal-set / single doc block on one file" + tests + JSDoc. Splitting per-AC creates artificial granularity since the safety check (delegation correctness, no internal consumers, prose accuracy) is inseparable from the change itself. Each affected story restates this exemption locally for grep-ability.
- **`searchConversations` decision moved to sprint-019.** Originally Story 5 of this sprint, the decision (keep / align / remove `searchConversations`) was relocated to sprint-019 because that sprint ships `searcher.sql` — which is the recipe-alternative for the "remove" path. Bundling the decision with the alternative makes the investigation honest instead of pre-decided. Sprint-018 leaves `searchConversations` untouched; sprint-019 picks it up alongside `searcher.sql`.
- **Out of scope (explicit):**
  - **LLM-removal sprint** — ripping `llmClients`, the privacy LLM classifier, and the `LlmClient` / `LlmClients` interfaces is its own sprint per sprint-016 retro. This sprint does NOT touch them.
  - **Phase 5 `searcher.sql` primitive** — bounded read-only SQL surface, separate sprint.
  - **Phase 6 reference tools** (`search_memory` + `query_memory`) — the consumer of this sprint's clean API surface; planned next.
  - **Sprint-017 embedder-spike** — separate parallel effort; not gated on this sprint.
  - **Renaming or breaking-change refactors of existing public methods** — hygiene, not API redesign. If a method's name is wrong but it works and no consumer is broken, leave it.

### User Flows

The sprint surfaces existing primitives through new public methods; it doesn't introduce new user flows. It DOES affect the documented public-API behavior of two existing flows.

- **Affected (existing):**
  - **Flow 1 — Ingestion** (`docs/specs/implementation-spec-005.md` §15): adds a public worker-drain entry point (Story 3) so consumers can synchronously drain the embed queue without reaching into internal modules. Affects the documented post-`storeAsync` consumer pattern.
  - **Flow 2 — Retrieval** (§15): adds a public `buildSessionVector` entry point (Story 2). The session leg of `hybridSearch` becomes meaningfully populated for consumers using only the public API — a behavior change in retrieval quality, not the algorithm.
- **New (this sprint):** None. All primitives exist; we're just exposing them.

### Test Harness Pattern

Story 1 ships a public-API-only integration harness — `tests/integration/public-api.test.ts` — that imports **only** from `@pristine/shield-local` (the package's `src/index.ts` barrel). Reaching into internal paths (`./memory/...`, `./conversations/...`, etc.) is forbidden by an ESLint rule shipped with the harness. The harness ships RED outer-loop tests for the **primary behavioral AC** of Stories 2 and 3 (drain + buildSessionVector — the new public methods) plus Story 4's runtime export-absence assertion; secondary ACs (lite-throw, empty-id throw, etc.) are inner-loop unit-test scope, not outer-loop. Story 5 (JSDoc) is a non-test deliverable.

**Outer-loop test plan (Story 1 ships RED):**

```typescript
// tests/integration/public-api.test.ts — Story 1 ships this RED.
// Imports ONLY from the package barrel (src/index.ts via path alias).
import { Pristine, type Searcher, type HybridHit } from '../../src/index.js';

describe('public-API integration harness', () => {
  it('round-trip: storeAsync → drainEmbedQueue → hybridSearch returns hits @AC-Story2-1', async () => {
    // RED: client.drainEmbedQueue does not exist yet (Story 2 ships it).
  });

  it('session leg of hybridSearch populates after client.buildSessionVector @AC-Story3-1', async () => {
    // RED: client.buildSessionVector does not exist yet (Story 3 ships it).
  });

  it('barrel does not export IngestQueue / IngestTask / IngestQueueConfig / Memory @AC-Story4-1', async () => {
    // RED: barrel currently exports these; Story 4 removes them.
    // Verified via runtime `expect(barrel.X).toBeUndefined()` per Story 1 AC-4 — no tsd / @ts-expect-error.
  });
});
```

**Inner-loop tests** (unit tests for new shim methods, ESLint-rule logic, etc.) live with the implementing story.

**`@manual` plumbing:** Sprint is backend-only; no `@manual` tests expected.

### Stories

**Constraints:** Target a maximum of 5-8 stories per sprint. Target a maximum of 5-8 commits per story. If a story needs more than 8 commits during planning, try to split it unless it makes sense for them to not be split.

#### Story 1: Public-API integration harness

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [x] Within size limits (5-8 commits; split if larger)
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings (iter-2): P2 — AC-1 didn't name the integration-test gate command literally; cross-story (Story 1↔3) drift between "enqueued tasks" (Story 1 commit 3) and "tasks drained" (Story 3 AC-1) — semantically same in test corpus but term should match.
  - Resolution: AC-1 updated to name `npm run test:integration` explicitly. Story 1 commit 3 message updated from "enqueued tasks" → "tasks drained" to mirror Story 3 AC-1.
- **As a** Pristine SDK consumer wiring Pristine into a harness (pi.dev, Claude Code hooks, etc.), **I want** an end-to-end test suite that exercises only the public package barrel, **so that** the maintainers can detect regressions in the consumer-facing surface (a method going private, an export disappearing, a lifecycle assumption breaking) without my external repo discovering them first.
- **Dependencies:** None (Story 1 always ships first)
- **Acceptance criteria:**
  - [ ] `tests/integration/public-api.test.ts` exists, imports ONLY from `src/index.ts` (no `../memory/...`, no `../conversations/...`, no `../client.js` directly), and is wired into `npm run test:integration` (i.e., included in the glob the script resolves).
  - [ ] An ESLint rule (or test-level lint check) enforces "imports inside `tests/integration/public-api.test.ts` resolve only via `src/index.ts`". Adding an internal-path import fails the lint step in pre-push.
  - [ ] The harness ships RED outer-loop tests for Story 2 (`client.drainEmbedQueue` drains queue) and Story 3 (`client.buildSessionVector` populates session leg). Each test contains a `// @ts-expect-error — sprint-018 Story N ships PristineLocal.<method>` directive on the missing-method call site. The directive suppresses the TS error that would otherwise block pre-push typecheck (`tsc --noEmit`); when the corresponding story ships, the suppressed line stops being erroneous and TS6133 (`Unused '@ts-expect-error' directive`) fires on the directive itself, forcing Story N's implementer to remove the directive as part of "AC goes GREEN". This is the type-level forcing function — the method genuinely doesn't exist (no "not implemented" stub), so until removal the test still fails RED at runtime via `TypeError: client.<method> is not a function`. Iter-3 review intent ("TypeScript-level failure") is preserved through the directive's removal-forcing semantics; the strict no-`@ts-expect-error` ban is dropped because it's incompatible with the pre-push typecheck gate.
  - [ ] Story 4's outer-loop assertion is a **hybrid** check: (a) a runtime `expect(barrel.IngestQueue).toBeUndefined()` for the value export (the class, runtime-visible), and (b) a static-source check for the three type-only re-exports — `IngestTask`, `IngestQueueConfig`, `Memory` — that TypeScript erases at runtime. The static check reads `src/index.ts` via `readFile(new URL('../../src/index.ts', import.meta.url), 'utf8')` and asserts each name does NOT appear as a standalone identifier in an export list (regex anchored to a line containing only `<name>` with optional trailing comma — `^\s*<Name>\s*,?\s*$` with the multi-line flag). The line-anchored regex avoids the false-positive risk of bare `\b<Name>\b` matching against future comments or JSDoc that mention these tokens. Currently FAILS (those exports exist); Story 4's removal flips it GREEN. No `@ts-expect-error` for this AC's mechanism.
  - [ ] The harness's setup uses real Nomic v1.5 (matching the existing `tests/integration/searcher.test.ts` pattern); per-hook + per-it timeouts are set to `SLOW_TEST_TIMEOUT_MS = 120_000` to match sprint-016's hookTimeout fix.
  - [ ] `npm run test:integration` is documented in the sprint doc as the gate; integration suite green excluding the RED outer-loop tests Story 1 just shipped.
- **Testing approach:** Unit-test the ESLint rule (or whichever mechanism enforces import-path scoping). Write the outer-loop tests as RED-by-construction. Run the integration suite locally to confirm only the new RED tests fail.
- **QA:**
  - Manual: N/A (backend test harness).
  - Automated: `npm run test:integration` — RED tests for Stories 2-3-4 visible as failures; all other integration tests still pass.
- **Planned commits:**
  1. `chore(test): scaffold tests/integration/public-api.test.ts with imports-from-barrel-only ESLint rule`
  2. `test(public-api): RED outer-loop test for Story 2 — client.drainEmbedQueue returns N (count of tasks drained) and vec_windows row count = N afterward`
  3. `test(public-api): RED outer-loop test for Story 3 — client.buildSessionVector populates session leg of hybridSearch (asserts ≥1 kind:'session' hit after the call)`
  4. `test(public-api): RED outer-loop runtime-absence assertion for Story 4 — barrel.IngestQueue / IngestTask / IngestQueueConfig / Memory all toBeUndefined`
  5. `chore(test): wire SLOW_TEST_TIMEOUT_MS hookTimeout for the new file (real Nomic gating)`
- **Technical notes:**
  - **Imports-from-barrel-only enforcement.** Project-local ESLint rule using `no-restricted-imports` with a path pattern matching `../**` from inside `tests/integration/public-api.test.ts`. Standard pattern, integrates with the existing pre-push lint gate.
  - **Export-absence check is hybrid runtime + static-source.** Story 4's RED assertion is `expect(barrel.IngestQueue).toBeUndefined()` for the value export plus a line-anchored regex grep on `src/index.ts` source for the three type-only re-exports (`IngestTask`, `IngestQueueConfig`, `Memory`). TypeScript's `export type { ... }` erases at runtime, so a runtime-only check on the type names false-negative passes green TODAY; the static-source check makes the AC strictly falsifiable. Regex shape is `^\s*<Name>\s*,?\s*$` with the multi-line flag — anchored to a line that contains the identifier in standalone position (matches the `Name,` / `Name` shape inside an `export type { ... }` list) and explicitly does not match comments or JSDoc that happen to mention these tokens. The runtime check's "stays green-by-default" property is preserved on the value-export side.
  - **`@ts-expect-error` for the absent-method RED tests (Stories 2, 3).** The tests put `// @ts-expect-error — sprint-018 Story N ships PristineLocal.<method>` on each missing-method call site. The directive suppresses the TS error that would otherwise block pre-push `tsc --noEmit`; when each story ships and the call site stops erroring, TS6133 fires on the directive itself, forcing the implementer to remove it as part of "AC goes GREEN". This is the type-level forcing function. The runtime failure mode (`TypeError: client.<method> is not a function`) is the test's user-visible RED state until the method exists. Iter-3 review's intent ("TypeScript-level failure, not a 'not implemented' stub") is preserved through this removal-forcing mechanism; the strict no-`@ts-expect-error` ban from earlier iterations is dropped because it is incompatible with the pre-push typecheck gate. (Story 4's mechanism is separate and continues to NOT use `@ts-expect-error`.)
  - **Path alias.** Vitest resolves `../../src/index.js` from `tests/integration/`; that's the canonical "barrel" path the test should use. Don't add a TS path alias just for this sprint.
  - **Fixture corpus.** Reuse `seedCompactCorpus` from `tests/integration/searcher.test.ts` if exposed, otherwise inline a small 4-conversation × 1-project corpus. Don't introduce a new fixture format.
- **Priority:** Must-have

#### Story 2: Expose embed-worker drain on the public surface

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [x] Within size limits (5-8 commits; split if larger)
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings (iter-2): P2 — commit 1 bundles `drainEmbedQueue` method + `--once` flag on `scripts/embed-worker.ts` (two responsibilities). Reviewer flagged as borderline given the standing commit-floor exemption.
  - Resolution: Accepted as-is. The `--once` flag exists specifically to verify AC-4; splitting the commit creates a temporal coupling (the verification commit must follow the method commit immediately) that doesn't add review value. Standing exemption documented in Sprint-Level Technical Context covers this shape.
- **As a** Pristine SDK consumer that just called `storeAsync` and wants to wait until embed work completes (e.g., before running `hybridSearch` synchronously in a CLI), **I want** a public way to drain the embed queue, **so that** I don't need to import from `./memory/indexer/embed-worker.js` (an internal path) or run `scripts/embed-worker.ts` as a subprocess.
- **Dependencies:** Story 1 (outer-loop test exists)
- **Acceptance criteria:**
  - [ ] `PristineLocal` exposes `public async drainEmbedQueue(): Promise<number>` returning the number of tasks completed (matching `runEmbedWorker`'s return shape). Calls into the existing `runEmbedWorker(this.ingestQueue)` impl. Throws `InvalidArgumentError` on lite clients.
  - [ ] JSDoc on `drainEmbedQueue` covers: when to call (after `storeAsync` if you want synchronous completion before retrieval; not needed if you run `scripts/embed-worker.ts` as a daemon); idempotent (safe to call repeatedly); blocks until queue is empty (no streaming progress in this iteration).
  - [ ] `runEmbedWorker` is NOT additionally re-exported from `src/index.ts` — `client.drainEmbedQueue()` is the canonical surface. Document the rationale in JSDoc (one entry point, not two).
  - [ ] `scripts/embed-worker.ts` continues to work for daemon-mode use; it imports from internal paths because it's a script, not a consumer. **Pre-merge verification:** the story's automated QA runs `npx tsx scripts/embed-worker.ts --once` (or the equivalent one-shot flag the script exposes; if no such flag exists, this story adds it as part of commit 1) against the integration-test corpus and asserts `exit 0` + at least one task drained. The check runs in `npm run test:integration` or as a dedicated `package.json` script before merge.
  - [ ] Story 1's outer-loop drain test goes GREEN.
  - [ ] No regression in unit / integration test suites.
- **Testing approach:** Unit-test the shim (delegation, lite throw, completed-count return). Integration test via Story 1's outer-loop — `storeAsync` enqueues N tasks, `drainEmbedQueue` returns N, subsequent `hybridSearch` finds the windows.
- **QA:**
  - Manual: N/A.
  - Automated: `npm run test:unit` + `npm run test:integration`.
- **Planned commits:**
  1. `feat(client): add drainEmbedQueue public method on PristineLocal + --once flag on scripts/embed-worker.ts`
  2. `test(client): unit-test the new shim — delegation, completed-count return, lite throw`
  3. `docs(client): JSDoc on drainEmbedQueue — lifecycle + when-to-use`
- **Technical notes:**
  - **Why method, not barrel re-export.** Two reasons: (a) `runEmbedWorker(queue)` requires the consumer to also know about `client.ingestQueue` — that's two public surfaces for one operation. A method on the client encapsulates the queue reference. (b) Future evolution (streaming progress, abort signal, per-batch limits) is easier to extend on a method than on a free function whose signature is locked.
  - **`client.ingestQueue` itself.** Story 4 will hide the `IngestQueue` *type* from the barrel; the `client.ingestQueue` *field* stays public on `PristineLocal` for now (it's still useful for consumers who want to query queue depth, etc.). If Story 4's audit determines the field should also go private, that's part of Story 4's decision.
  - **Backpressure / progress reporting.** Out of scope. `drainEmbedQueue` blocks; consumers wanting non-blocking + progress can still spawn `scripts/embed-worker.ts`. A future sprint may add `drainEmbedQueue({ onProgress })` once we have a real consumer demanding it.
  - **`scripts/embed-worker.ts --once` flag.** Bundled into commit 1 because it's the verification mechanism for AC-4. If the script already runs once-and-exits by default (verify at story start), the flag is a no-op alias and the commit just adds the alias for clarity. Either way, the AC's pre-merge check is concrete and falsifiable.
  - **Below 5-8 commit floor by design.** Single shim + tests + JSDoc + one script flag. Same standing exemption applies to Stories 3, 4, 5 — see Sprint-Level Technical Context.
- **Priority:** Must-have

#### Story 3: Expose `client.buildSessionVector(conversationId)`

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [x] Within size limits (5-8 commits; split if larger)
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings (iter-2): No findings — AC concreteness and Story-2 (drainEmbedQueue) dependency lock addressed cleanly in iter-1 fixes. Iter-3 P2 raised on the missing-id error-class disjunction; resolved below.
  - Resolution: AC-4 (missing-id error) tightened — instead of accepting either `InvalidArgumentError` or `NotFoundError`, the shim wraps any indexer-raised error in `InvalidArgumentError` so the AC can pin to one class.
- **As a** Pristine SDK consumer who has just finished a session and wants the session-vector index populated for cross-session retrieval, **I want** to call `client.buildSessionVector(conversationId)` on the public surface, **so that** the session leg of `hybridSearch` returns meaningful hits without me reaching into private internals.
- **Dependencies:** Story 1 (outer-loop test exists), Story 2 (`drainEmbedQueue` must be public before Story 3's outer-loop test can populate `vec_windows` via the public-only path enforced by Story 1's ESLint rule)
- **Acceptance criteria:**
  - [ ] `PristineLocal` exposes `public async buildSessionVector(conversationId: string): Promise<void>` that delegates to the private `indexer.buildSessionVector`.
  - [ ] Calling on a `createLite()` client (no embedder) throws `InvalidArgumentError` with a clear message — same pattern as `storeAsync`.
  - [ ] Calling `buildSessionVector('')` throws `InvalidArgumentError` with message matching `/conversationId.*required|empty/i`.
  - [ ] Calling `buildSessionVector('does-not-exist-12345')` throws **`InvalidArgumentError`** (locked to one class) with a message containing the literal string `does-not-exist-12345`. The shim catches any error the indexer raises and re-throws as `InvalidArgumentError(originalMessage)` — keeps the public-surface error contract narrow and testable.
  - [ ] JSDoc on the method documents the lifecycle: "call after a session-close signal — typically when a conversation finishes appending turns; `storeAsync` does NOT auto-build session vectors per spec §5.1.2 (separate explicit call)."
  - [ ] Story 1's outer-loop session-leg test goes GREEN.
  - [ ] No regression in unit / integration test suites; typecheck + lint clean.
- **Testing approach:** Unit test the new shim (delegation, lite-client throw, empty-id throw, missing-id throw). Integration test via Story 1's outer-loop test — `storeAsync` → `drainEmbedQueue` (Story 2, already merged per dependency) → `client.buildSessionVector(conversationId)` → `hybridSearch(query, filters, limit)` returns at least one `kind: 'session'` hit.
- **QA:**
  - Manual: N/A (SDK method).
  - Automated: `npm run test:unit` for the new shim; `npm run test:integration` for the outer-loop GREEN.
- **Planned commits:**
  1. `feat(client): expose buildSessionVector on PristineLocal — public passthrough to indexer.buildSessionVector`
  2. `test(client): unit-test the new shim — lite throw, valid delegation, error mapping`
  3. `docs(client): JSDoc on buildSessionVector — lifecycle + spec §5.1.2 reference`
- **Technical notes:**
  - **Why a passthrough method, not a public `client.indexer`.** Spec §5.1.2 lists `indexer.ingest` and `indexer.buildSessionVector` as primitives, but `ingest` is correctly hidden behind `storeAsync` (the consumer surface). Exposing the whole `indexer` object also exposes `IndexerConfig`, internal helpers, and future plumbing — too wide. A single `client.buildSessionVector` passthrough exposes exactly the consumer-needed surface.
  - **Sequencing: Story 2 (drainEmbedQueue) merges before this story.** Numerical order = dependency order. Story 3's outer-loop test must populate `vec_windows` via `client.drainEmbedQueue()` (Story 2) — Story 1's ESLint rule forbids importing `runEmbedWorker` from the internal path inside `tests/integration/public-api.test.ts`. There is no fallback that respects the harness contract.
  - **Below 5-8 commit floor by design.** This is a single passthrough method on one class + its unit tests + JSDoc. Splitting further (one commit per AC) creates artificial granularity since the safety check (delegation correctness, error mapping) is inseparable from the method itself. Same pattern recurs in Stories 2, 4, 5 — see Sprint-Level Technical Context for the standing exemption.
- **Priority:** Must-have

#### Story 4: Hide internal queue exports + remove dead `Memory` type

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [x] Within size limits (5-8 commits; split if larger)
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings (iter-2): P2 — AC-3's negative-grep pattern `queue/ingest-queue` may not match the actual implementing path; should verify path token at story start. P2 — AC-1 lacks an explicit grep verification (covered implicitly by AC-4's runtime test).
  - Resolution: AC-3 fix added below. AC-1 grep verification accepted as additive but folded into AC-3's verification (one grep run covers both removal-from-barrel and no-internal-consumer-leakage at the same time; separating them creates two greps with overlapping coverage).
- **As a** Pristine SDK maintainer setting up the surface that Phase 6 reference tools will build on, **I want** `IngestQueue` (class export), `IngestTask` (type), `IngestQueueConfig` (type), and the dead pre-spec-005 `Memory` type to disappear from the barrel, **so that** consumers see only intentional API and the surface narrows to spec-005 §5.1 primitives.
- **Dependencies:** None (independent of Stories 2-3; can run before, after, or in parallel-by-time but sequentially-by-PR per the sprint sequencing rule)
- **Acceptance criteria:**
  - [ ] `IngestQueue`, `IngestTask`, `IngestQueueConfig` removed from `src/index.ts` exports. `IngestQueueError` (which consumers DO catch) stays exported from the errors block.
  - [ ] `Memory` type removed from `src/index.ts` exports. The type itself stays in `src/core/types.ts` for now (its removal from `core/types.ts` is the LLM-removal sprint's concern, since `SanitizedMemory` derives from it and the privacy LLM classifier may still reference it). Document this in a code comment at the removal site.
  - [ ] No internal consumers reach `IngestQueue` / `IngestTask` / `IngestQueueConfig` / `Memory` through the barrel. **Mandatory at story start**: run `find src -name "ingest-queue*"` and `find src -name "types.ts" -path "*/core/*"` to confirm the implementing-path tokens. **Expected tokens (locked unless step-1 reveals different paths):** `src/queue/ingest-queue.ts` for the queue trio, `src/core/types.ts` for `Memory`. If step-1 returns different paths, update the negative-pattern accordingly and document the change in the PR body. Then verify with two greps — both must return only direct-module imports (zero barrel hits): (a) `grep -rn "from ['\"][.]*\\/index" src/ scripts/ --include="*.ts"` (catches any sibling/parent index import); (b) `grep -rn "IngestQueue\\|IngestTask\\|IngestQueueConfig\\|\\bMemory\\b" src/ scripts/ --include="*.ts" | grep -vE "queue/ingest-queue|core/types"`. Each surviving hit must point at the implementing module, not the barrel.
  - [ ] Story 1's outer-loop runtime absence test goes GREEN.
  - [ ] `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration` all clean.
  - [ ] PR description includes a "Public-API delta" block listing what was removed and what stays — gives Phase 6 planners a clear reference.
- **Testing approach:** Run typecheck across the whole repo + scripts dir to confirm no internal consumer was reaching through the barrel. Story 1's outer-loop test catches the public-API absence.
- **QA:**
  - Manual: N/A.
  - Automated: full `npm run typecheck` + `lint` + `test:unit` + `test:integration`.
- **Planned commits:**
  1. `refactor(api): remove IngestQueue / IngestTask / IngestQueueConfig from public barrel — internal-only types`
  2. `refactor(api): remove dead Memory type from public barrel — pre-spec-005 fact-ledger shape`
  3. `chore(test): turn Story 1's outer-loop absence test GREEN; document the public-API delta in PR body`
- **Technical notes:**
  - **Why `IngestQueueError` stays.** Consumers catch this when calling `storeAsync` and want to handle the queue-failure case explicitly. It's a public concern, even though the queue *class* isn't.
  - **Why not also remove `createDatabase` and `LlmClient` / `LlmClients`.** Out of scope. `createDatabase` is a deliberate provider-integration escape hatch (the JSDoc already calls this out); removing it would break the documented power-user contract. `LlmClient` / `LlmClients` are scheduled for the LLM-removal sprint per sprint-016 retro — touching them here would entangle two sprints.
  - **`Memory` type sanity check.** Greps confirm no live consumer of `Memory` (as opposed to `SanitizedMemory`) outside the type re-export in `src/index.ts`. Verify this still holds at story-start (something may have crept in between sprint draft and sprint start).
  - **Below 5-8 commit floor by design** — pure removal of barrel exports; splitting per-symbol creates artificial granularity since the safety check (no internal consumers reaching through the barrel) is the same set of greps for all four symbols.
- **Priority:** Must-have

#### Story 5: Top-of-file JSDoc on `src/index.ts` — public-API contract

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [x] Within size limits (5-8 commits; split if larger)
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings (iter-2): P2 — AC-1 enumerates 7 sub-bullets but doesn't verify ordering; reviewer suggested adding "Manual reviewer confirms the 7 sections appear in the listed order" to QA Manual.
  - Resolution: Accepted; QA Manual updated.
- **As a** new Pristine SDK consumer who just imported `@pristine/shield-local` for the first time, **I want** a single block of JSDoc at the top of `src/index.ts` that orients me to the public surface, **so that** I can find the right method without reading the whole repo or guessing from section comments.
- **Dependencies:** Stories 2, 3, 4 (the doc reflects the post-sprint surface, not pre-sprint)
- **Acceptance criteria:**
  - [ ] `src/index.ts` has a top-of-file `/** ... */` JSDoc block (above the first `export`) that covers, in this order: (1) one-paragraph what-Pristine-is summary; (2) primary entry points (`Pristine.create` for full clients, `Pristine.createLite` for read-only); (3) lifecycle pattern (`storeAsync` → `drainEmbedQueue` → optionally `buildSessionVector` → `searcher.hybridSearch`); (4) DI interfaces (`Embedder`, `LlmClient`) and when consumers pass them; (5) errors consumers should catch (`AppError`, `EmbedderError`, `IngestQueueError`); (6) pointer to `docs/specs/implementation-spec-005.md` for primitive details; (7) pointer to "Phase 6 reference tools (when shipped)" for canonical tool wrappers.
  - [ ] Section header comments inside `src/index.ts` (the existing `// --- Client ---` etc. blocks) are kept and refreshed to match the post-sprint shape.
  - [ ] No emojis in the JSDoc per global coding standards.
  - [ ] `npm run typecheck`, `npm run lint` clean. (No test changes expected — pure doc.)
- **Testing approach:** N/A — rationale: docs-only commits with no behavioral change to test; lint + typecheck cover regressions; the cold-read judgment loop is captured in the Story Checklist (sub-agent review), not Testing approach.
- **QA:**
  - Manual: Read the JSDoc cold, verify a fresh consumer can answer "where do I write?", "where do I drain?", "where do I read?", "what do I catch?" from the top-of-file block alone. Confirm the 7 sub-bullets named in AC-1 appear in the JSDoc in the listed order (the AC is order-sensitive).
  - Automated: typecheck + lint.
- **Planned commits:**
  1. `docs(api): write top-of-file JSDoc on src/index.ts — public-API orientation block`
  2. `docs(api): refresh existing section header comments to match post-sprint shape`
- **Technical notes:**
  - **Why a single block, not per-export JSDoc.** Per-export JSDoc still belongs on the implementing modules (`PristineLocal`, `Searcher`, etc.). The top-of-file block is the orientation map — what's here, what's not, where to go next.
  - **Pointer to Phase 6.** Reference tools don't ship in this sprint. The pointer is "see `docs/examples/search-memory-tool/` (when shipped) and `docs/examples/query-memory-tool/` (when shipped)" — even though the dirs don't yet exist. This stages the convention so Phase 6 can drop in cleanly.
  - **Format.** Plain JSDoc — no special tags (`@deprecated`, `@since`) unless we have a use for them this sprint. Keep it readable.
  - **Below 5-8 commit floor by design** — pure documentation on a single file; splitting further creates artificial granularity. Same exemption as Stories 2/3/4.
- **Priority:** Must-have

### Sprint completion

After the last feature story merges into `sprint-018`, the agent runs the **sprint-completion workflow** — there is NO dedicated "evaluation story" PR. The canonical spec lives at `workflow-prompts/handle-sprint-completion.md`; this section describes the WHAT (two artifacts and the user-facing shape), not the HOW (commands, edge cases, escalation rules).

**1. 6-section chat message** emitted into the conversation. Sections in this exact order — `**Mergeability:** X/5` (headline), `## Sprint objective + accomplishments` (narrative: objective restated + per-story how-this-contributed-to-the-goal bullets), `## Why ready`, `## Open for your decision`, `## Delivered` (one row per AC), `## Drift from spec`. Only Pass ACs land in Delivered as `✅`; Ambiguous and `@manual` items go under "Open for your decision". The objective+accomplishments section is narrative-shaped (one bullet per story, not per AC) and explains WHY each story was done — Delivered is the pass/fail matrix, not a story. Drafting agents: copy the canonical schema from `handle-sprint-completion.md` Step 3 verbatim — that's the source of truth.

**2. Sprint-doc mutation** committed directly on `sprint-018` BEFORE the sprint-integration PR opens:

- Check every Pass AC checkbox across every story (`[ ]` → `[x]`). Failed and Ambiguous ACs stay unchecked — see the workflow's Escalation rule.
- Flip the `**Status:**` line from `🔵 In Progress` to `🟢 Complete`.
- Append a `## Final Review` section at the bottom of the sprint doc, quoting the chat message verbatim underneath.

The mutation commit is the durable audit trail: one sprint, one doc, one self-contained record. The chat message is the live verdict; the doc mutation is the permanent record.

After the mutation commit lands on `sprint-018`, the sprint-integration PR (`sprint-018 → main`) opens per `workflow-prompts/handle-pr-activity.md` Step 4a — its cumulative diff includes the mutation as evidence.

### Rules

- **Sprint-branch setup (before Story 1):** create `sprint-018` off `main` and push. Commit this sprint doc as the first commit on the branch. Story branches fork from `sprint-018`; story PRs target `sprint-018`. After the last feature story merges and the sprint-completion workflow (`workflow-prompts/handle-sprint-completion.md`) runs, open a sprint-integration PR (`sprint-018 → main`) as the final step. See AGENTS.md §3 for the full workflow + edge cases (mid-sprint hotfix, abandonment, cross-sprint deps).
- We sequentially do the stories. We do not do parallel work.
- **Review loop:** Open PRs, run `/review` (nudged by the PostToolUse hook), address findings, re-verify via `/review-fix` (capped at 3 passes per PR — see `workflow-prompts/handle-pr-activity.md`), confirm local checks are green and the last review turn returned mergeability ≥ 4/5 with no open P0/P1 findings, merge into `sprint-018`, then move to the next story. The sprint-integration PR goes through the same loop — cumulative-diff `/review` catches cross-story interactions.
- **Parallel experiment option (explicit exception):** when a story is explicitly scoped as an isolated experiment, consider `/skill:worktree create <branch>` to run it in a separate cmux workspace with its own Pi session, or to discard it cleanly via `/skill:worktree remove`. This does not change the default sequential rule above. See AGENTS.md §20 for prerequisites and scope.
- Record new dependencies in the Completion section's New Dependencies field.
- For everything else — commits, PR process, code quality, testing — follow your system instructions (the conventions loaded at session start).

### Definition of Done

- All must-have stories pass acceptance criteria
- System-instruction conventions satisfied (code quality, tests, PR process, conventional commits, local checks green, last review turn — `/review` or `/review-fix` — returned mergeability ≥ 4/5 with no open P0/P1 findings)
- **Sprint completion run** per `workflow-prompts/handle-sprint-completion.md` — sprint doc mutated (every AC box checked, Status `🟢 Complete`, `## Final Review` appended quoting the chat message verbatim); 6-section chat message emitted into conversation
- **Sprint-integration PR merged** (`sprint-018 → main`); `sprint-018` deleted from origin; local `main` fast-forwarded
- **If the sprint introduces new user flows** (N/A here — sprint exposes existing primitives through new public methods; Flows 1 + 2 in `implementation-spec-005.md` §15 are AFFECTED, not new): no spec §15 update needed beyond minor JSDoc-style notes inside Flow 1's "Detached embed-worker" branch and Flow 2's "session leg" call-out reflecting that the new public methods exist. Land those updates as part of Story 5 (the JSDoc + spec touchups together).
