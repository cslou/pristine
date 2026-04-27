# Pristine — Sprint 016
**Date:** 2026-04-27 – TBD
**Goal:** Wire `storeAsync` to the indexer pipeline and ship spec-005 Phase 4 — the searcher primitive (filter-first vector + FTS + hybrid RRF + fan-out).
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript (strict, ESM), Node 18+, `better-sqlite3` + `sqlite-vec`, `@huggingface/transformers` (Nomic Embed v1.5), Vitest. Local-first — zero outbound network calls in production code.
- **Current state:** spec-005 Phase 1 (extraction removal — sprint-013), Phase 2 (schema — sprint-014), and Phase 3 (indexer primitive — sprint-015) shipped. The corpus pipeline is fully wired internally (`indexer.ingest` → `pending_ingest_tasks` → embed-worker → `vec_windows` / `window_messages` / `vec_sessions` / `messages_fts`) and proven e2e via `scripts/smoke-indexer.ts`. The SDK's public `storeAsync` entrypoint still calls the dead legacy `IngestQueue.enqueue` (orchestrator-based) path — its `task_type='extract-conversation'` rows reach a `processNext()` branch that throws because the orchestrator was deleted in sprint-013. Sprint-014 retro flagged storeAsync as a planning self-contradiction (User Flows said "wire it"; Technical Context said "don't touch client.ts"); deferred to this sprint. No retrieval primitives exist yet — `searcher` is empty, `src/memory/retriever/ranking.ts` survives from Phase 1 P1-S6 with only fact-temporal boost helpers (no RRF helper yet).
- **Implementation spec:** `docs/specs/implementation-spec-005.md` (§5.1.3 retrieval primitive surface, §12 schema, §16 Phase 4 stories P4-S1..P4-S5)

### Sprint-Level Technical Context

- **Storage schema is frozen for this sprint.** All Phase 2 / Phase 3 tables (`conversations`, `messages`, `summaries`, `vec_windows`, `window_messages`, `vec_sessions`, `messages_fts`, `pending_ingest_tasks`, `*_public` views) stay as-is — including `messages_fts`'s active tokenizer (`unicode61`, NOT porter — see Story 3 Technical Notes for the spec deviation). The only schema additions tolerated are **secondary B-tree indexes on existing tables** that support filter-first candidate-set SQL (confirm need via EXPLAIN QUERY PLAN; the existing `ix_conversations_project_started` likely covers Story 2's hot path already). Treat any index addition as a Story 2 / Story 3 sub-commit, not a separate story. FTS5 tokenizer migration to porter is OUT OF SCOPE — file a sprint-close follow-up issue.
- **Embedder is `Embedder` (interface, not class).** `searcher.vectorSearch` takes a query string, calls `embedder.embed(query)`, then runs vec0 KNN. The interface signature is in `src/core/interfaces.ts`. Tests inject `LocalEmbedder` for real e2e and a deterministic stub embedder for fast unit tests (same pattern as sprint-015 Story 7).
- **vec0 query syntax — KNN with `MATCH` + `k = ?`.** `sqlite-vec` exposes vec0 KNN as `SELECT ... FROM vec_windows WHERE embedding MATCH ? AND k = ?`. Filter-first ordering means the candidate set is pre-narrowed via a regular SQL pass; vec0 KNN runs over only the surviving `(conversation_id, window_index)` keys. Confirm exact syntax against the latest `sqlite-vec` docs before drafting Story 2 — version-drift here is a likely review finding.
- **`src/memory/retriever/ranking.ts` is the sole Phase-1 survivor.** Its current contents are fact-temporal helpers (`currentFactBoost`, `RECENCY_MAX_BOOST`, etc.) — these are NOT used in this sprint and must NOT be deleted (see Phase-1 P1-S6 preservation note in spec). RRF helper(s) for Phase 4 land as additions to this file, not a new file. Keep the existing exports intact.
- **Do not modify `src/conversations/store.ts` schema/init/migration code.** The searcher is read-only and filter-first; it issues SELECTs against existing tables / views. Indexes added per the first bullet land in `RETRIEVAL_INDEXES_DDL`.
- **Privacy boundary** — `searcher.sql` (out of scope this sprint — Phase 5) is the read-only DSL surface. This sprint's `searcher.{vector,fts,hybrid}Search` methods are TypeScript functions over `better-sqlite3`'s normal connection — no scoped read-only connection yet. Document this gap in the eval deck so Phase 5 has a clean handoff.
- **No new top-level dependencies.** All work uses existing `better-sqlite3`, `sqlite-vec`, `@huggingface/transformers`. If a story planner thinks otherwise, surface during /sprint review — do not add silently.

### User Flows

- **Affected (existing):**
  - **`storeAsync(conversation, userId)`** (`src/client.ts`) — deferred from sprint-015. Currently calls the dead `IngestQueue.enqueue()` (orchestrator-based) path; this sprint rewires it to `addConversation` + `indexer.ingest()` so the SDK's public ingest surface lands embed-message tasks the worker actually drains. After Story 1, `storeAsync` becomes the canonical path the smoke script `scripts/smoke-indexer.ts` proves works end-to-end.
- **New (this sprint):**
  - **`searcher.vectorSearch(query, filters, limit)`** (`src/memory/searcher/`) — filter-first KNN over `vec_windows`. Builds a candidate set via filter SQL (project_id / conversation_id / role / date range) FIRST, then runs sqlite-vec KNN over only those candidates. Returns ranked window hits with `(conversationId, windowIndex, score, messageIds[])`.
  - **`searcher.ftsSearch(query, filters, limit)`** — FTS5 `MATCH` against `messages_fts`, scoped to the same candidate set. Returns ranked message hits with `(messageId, conversationId, score)`.
  - **`searcher.hybridSearch(query, filters, limit)`** — fans out across `vec_windows` + `vec_sessions` + `messages_fts` in parallel, fuses via reciprocal rank fusion. Window hits resolve to constituent `messageIds[]` via `window_messages`; session hits return whole `conversationId`. The unified result type carries source provenance per hit.

### Stories
**Constraints:** Target a maximum of 5-8 stories per sprint. Target a maximum of 5-8 commits per story. If a story needs more than 8 commits during planning, try to split it unless it makes sense for them to not be split.

#### Story 1: Wire `storeAsync` to `indexer.ingest` (sprint-015 deferred)

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (5-8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** SDK consumer calling `Pristine.create({...}).storeAsync(messages, userId)`, **I want** that call to land messages + enqueue embed-message tasks the worker actually drains, **so that** the public ingest entrypoint produces a populated corpus end-to-end (matching what `scripts/smoke-indexer.ts` already proves at the module level).
- **Dependencies:** None (sprint-015 indexer + worker ship)
- **Acceptance criteria:**
  - [ ] `Pristine.create({...})` constructs an `Indexer` (via `createIndexer`) and an `IngestQueue` with `embedTaskHandler` set, alongside the existing `ConversationStore`. `client.ts` exposes the indexer as a private field, not a public surface.
  - [ ] `storeAsync(conversation, userId, projectId?)` in order: (a) `conversationStore.addConversation(conversation, userId, projectId)` → `conversationId`, (b) `indexer.ingest(conversation, { projectId, conversationId })` → `IndexResult`. Returns the `conversationId` (string) — NOT a task id; this is a contract change from the legacy return shape.
  - [ ] Duplicate-conversation behavior preserved — `addConversation` throws raw `UNIQUE constraint failed` on `(user_id, content_hash)` collision (this error has NO id payload). `storeAsync` catches via `error.message.includes('UNIQUE constraint failed')`, then calls `conversationStore.findByMessages(messages, userId)` (already exists at `src/conversations/store.ts:596`) to recover the existing `conversationId`, and returns it. The `findByMessages` helper recomputes the same content hash as `addConversation` — verify the contract before relying on it. No second `indexer.ingest()` call on the duplicate path (the existing conversation already has its tasks). Documented in JSDoc.
  - [ ] Legacy `IngestQueue.enqueue(messages, userId)` method + the `task_type='extract-conversation'` dispatch branch in `processNext()` are deleted. The orchestrator was removed in sprint-013; the legacy path's only surviving consumer is `storeAsync` itself, which this story rewires. `IngestTaskType` collapses to `'embed-message'` only.
  - [ ] `client.ts`'s `orchestrator` field + `OrchestratorDeps` plumbing in `Pristine.create()` is deleted (it was always `null` after sprint-013).
  - [ ] **`createLite()` behavior:** `Pristine.createLite()` constructs without an `Embedder`, so `storeAsync` cannot run the indexer pipeline. After this story, `createLite().storeAsync(...)` throws `InvalidArgumentError('storeAsync requires Pristine.create() — createLite has no embedder; use addConversation directly for write-only flows')`. The JSDoc on `createLite` is updated to remove the `storeAsync()` claim and document the new constraint. Test added pinning the throw.
  - [ ] All `tests/queue/ingest-queue.test.ts` tests asserting against `task_type='extract-conversation'` are deleted or rewritten to assert `'embed-message'` shape. No skipped tests.
  - [ ] `tests/client.test.ts` (or wherever `storeAsync` is tested) gains a test that drives the full path: `storeAsync` → drain worker → assert `vec_windows` row count matches the smoke prediction for the input conversation.
  - [ ] Spec-005 §15 Flow 1 (Ingestion) is updated to match shipped reality — folded in as part of this story's docs commit.
- **Testing approach:** Unit + integration. Unit: `storeAsync` delegates to `addConversation` + `indexer.ingest` correctly with mocked store/indexer. Integration: full path test with stub embedder asserting populated-corpus counts (mirrors sprint-015 Story 7 round-trip shape, but driven by `storeAsync` not `indexer.ingest`).
- **QA:**
  - Manual: `npm run db:reset` then run the smoke flow via `scripts/smoke-indexer.ts` rewritten to drive through `storeAsync` (commit it as part of this story to replace the indexer-direct version) — confirm same 7 expected counts (6 messages, 3 vec_windows, 9 window_messages, 1 vec_sessions, 6 messages_fts, 5 completed tasks, 0 failed). Snapshot the terminal output for Slide 2.
  - Automated: integration test described above. **THIS IS IMPORTANT**
- **Planned commits:**
  1. `refactor(client): construct Indexer + IngestQueue with embedTaskHandler in Pristine.create` — wire dependencies, expose indexer as private field, no behavior change to `storeAsync` yet
  2. `feat(client): rewire storeAsync → addConversation + indexer.ingest` — the actual rewire; legacy `enqueue` still exists at this point
  3. `chore(queue): delete legacy enqueue + extract-conversation dispatch` — drop the dead path; collapse `IngestTaskType` to `'embed-message'` only; remove orchestrator field from client
  4. `test(client): storeAsync end-to-end populates corpus via worker drain` — full integration test
  5. `chore(scripts): rewrite smoke-indexer to drive through storeAsync` — replace the module-level wiring with the SDK-level one; confirm same 7 counts
  6. `docs(spec): update spec-005 §15 Flow 1 to match shipped storeAsync` — close the planning loop sprint-015 retro flagged
- **Technical notes:** Returning `conversationId` instead of taskId is the right shape — callers doing `await searcher.vectorSearch(...)` later filter by conversation, so the conversation handle is the load-bearing identifier. The `taskId` shape was orchestrator-era and exposed implementation. If `storeAsync`'s consumer wants to await drain completion for testability, expose a separate `awaitDrain()` test helper rather than leaking task ids. Do NOT rebuild the orchestrator-removal sweep in this story — it was completed in sprint-013; this story only deletes residual surface in `client.ts` + `ingest-queue.ts`.
- **Priority:** Must-have

#### Story 2: `searcher.vectorSearch` — filter-first KNN over `vec_windows` (P4-S1)

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (5-8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** consumer wanting semantic recall over a corpus, **I want** `searcher.vectorSearch(query, filters, limit)` that runs filter-first KNN over `vec_windows`, **so that** I get the top-k window hits inside my project / conversation / role / date scope without leaking results from other scopes.
- **Dependencies:** Story 1 (so the corpus is populated via the SDK path)
- **Acceptance criteria:**
  - [ ] New module `src/memory/searcher/` with `index.ts` exporting `createSearcher(deps): Searcher` and types `Searcher`, `SearchFilters`, `WindowHit`. Module is independently testable.
  - [ ] **`Pristine.create({...})` constructs a `Searcher` and exposes it as the public field `pristine.searcher`** (parallel to `storeAsync` being a public method). Asymmetry vs Story 1's indexer-as-private is deliberate: `searcher` is the consumer-facing query surface; `indexer` is plumbing the SDK drives internally on `storeAsync`'s behalf. Stories 3-5 extend the same `pristine.searcher` instance with `ftsSearch` / `hybridSearch` / `sessionVectorSearch` — no per-story re-wiring of the client class.
  - [ ] `Pristine.createLite()` does NOT expose `pristine.searcher` (no embedder = no vector path). Accessing `pristine.searcher` on a `createLite` instance returns `undefined` (typed as `Searcher | undefined` on the lite shape) OR throws on construction — pick one in implementation, document in JSDoc, pin with a test. The `ftsSearch`-only subset is technically embedder-free but not worth the type-shape complexity in this sprint; defer if a consumer asks.
  - [ ] `vectorSearch(query: string, filters: SearchFilters, limit: number): Promise<WindowHit[]>`: (a) embeds query via injected `Embedder`, (b) builds candidate-window key list via filter SQL over `vec_windows` JOIN `conversations`, (c) runs vec0 KNN restricted to candidate keys, (d) returns hits with `{conversationId, windowIndex, score, messageIds: number[]}` (messageIds resolved via `window_messages`).
  - [ ] `SearchFilters` supports at minimum: `projectId` (required), `conversationId?` (string), `role?` ('user'|'assistant'|'system'), `dateFrom?` / `dateTo?` (ISO 8601). Additional filters surfaced during planning land as follow-ups, not scope creep here.
  - [ ] Filter-first ordering verified by EXPLAIN QUERY PLAN on the candidate-set query — must hit a B-tree index, not a full scan. The candidate set comes from `vec_windows JOIN conversations`, so the hot filter column is `conversations.project_id` — `ix_conversations_project_started ON conversations(project_id, created_at DESC)` already exists at `src/conversations/store.ts:125-126` and should satisfy this. Confirm via EXPLAIN; only add a new index if the existing one isn't picked. Document the captured plan in the test file as a comment.
  - [ ] **vec0 KNN read-path syntax verified before commit.** Run a manual smoke against an in-memory DB with `sqlite-vec` loaded to confirm the `WHERE embedding MATCH ? AND k = ?` syntax (and the candidate-restriction shape — `IN (...)` vs JOIN against a temp table) matches the installed `sqlite-vec` version. Sprint-014's PK-rejection test pinned the WRITE-path syntax; the READ-path KNN syntax has not been exercised yet in this codebase. Document the confirmed syntax inline in a test comment.
  - [ ] Cross-project isolation test: insert two projects with deliberately similar content (both contain "machine learning models"), query project A, assert zero results from project B regardless of vector similarity.
  - [ ] Empty-candidate-set behavior: returns empty `WindowHit[]` (not throws) when filters narrow to zero candidates.
  - [ ] Limit-zero rejected via `InvalidArgumentError`. Limit > 1000 rejected (KNN cost ceiling — match against the integration round-trip's max corpus size).
  - [ ] Unit tests assert: scoring monotonicity (closer vector → higher score), tie-breaking by `(conversationId, windowIndex)`, NaN-vector input rejected.
- **Testing approach:** Unit tests with stub embedder (returning known vectors) for math correctness; integration test with real Nomic against the smoke corpus for empirical recall sanity. Cross-project isolation test is the blocking AC — without it, the filter-first claim is unverified.
- **QA:**
  - Manual: extend `scripts/smoke-indexer.ts` with a vectorSearch round-trip that ingests two projects, queries one, prints the scope-leak count (must be 0). Capture for Slide 2.
  - Automated: full unit + integration suite. **THIS IS IMPORTANT**
- **Planned commits:**
  1. `feat(searcher): scaffold module + Searcher interface + SearchFilters/WindowHit types`
  2. `feat(searcher): vectorSearch — filter-first candidate query + vec0 KNN + window→messageIds resolution`
  3. `chore(store): add RETRIEVAL_INDEXES_DDL entry for filter-first plan` (if EXPLAIN shows a scan)
  4. `test(searcher): vectorSearch math + scoring + edge cases`
  5. `test(searcher): cross-project isolation + empty-candidate + limit guards`
  6. `feat(scripts): smoke-indexer vectorSearch round-trip via pristine.searcher (two-project leak check)`
- **Technical notes:** vec0 KNN restriction to a candidate set is `WHERE embedding MATCH ? AND k = ? AND conversation_id IN (...) AND window_index IN (...)`. The IN-list grows linearly with candidates — for large candidate sets the right shape is a temp table of `(conversation_id, window_index)` and a `JOIN`. Pick whichever shape EXPLAIN QUERY PLAN handles best at the smoke-corpus size; document the choice. **vec0 query syntax — verify against the latest `sqlite-vec` docs before implementing.** Sprint-014's PK-rejection test pinned the write-path syntax; the read-path KNN syntax has not been exercised yet in this codebase, so version-drift is a real risk. If neighbor expansion is requested later, that's a `searcher.sql`-flavor consumer composition, not a primitive (per spec §5.1.3) — do NOT add it here.
- **Priority:** Must-have

#### Story 3: `searcher.ftsSearch` — FTS5 over candidate set (P4-S2)

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (5-8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** consumer wanting keyword recall (proper nouns, error codes, exact phrases), **I want** `searcher.ftsSearch(query, filters, limit)` that runs FTS5 MATCH against `messages_fts` scoped to my filter set, **so that** literal-match queries that defeat semantic similarity still hit the right messages.
- **Dependencies:** Story 2 (reuses `SearchFilters` shape)
- **Acceptance criteria:**
  - [ ] `ftsSearch(query: string, filters: SearchFilters, limit: number): Promise<MessageHit[]>` returning `{messageId, conversationId, score, snippet?}`. `snippet` uses FTS5's `snippet()` highlighter when content is non-trivial.
  - [ ] `messages_fts` query is `MATCH ?` with bm25 ranking; filter SQL narrows by joining `messages_fts` ↔ `messages` ↔ `conversations` on the same `SearchFilters` keys as Story 2.
  - [ ] FTS5 query-syntax errors (unbalanced quotes, invalid operators) caught + rethrown as `InvalidArgumentError` with the underlying SQLite message preserved. No raw SQLite errors leak to callers.
  - [ ] Empty-corpus behavior: returns `[]` not throws when `messages_fts` has zero rows.
  - [ ] Cross-project isolation test (same shape as Story 2's vector isolation): seed two projects with overlapping keywords, query one, assert zero leaks.
  - [ ] Unit tests cover at minimum: phrase matching (`"exact phrase"`), boolean operators (`foo AND NOT bar`), prefix matching (`run*`). **Stem matching is NOT covered** — see Technical Notes for why and the deferred follow-up.
- **Testing approach:** Unit tests with seeded message rows; integration test against the smoke corpus for shape verification. No stem-matching tests — `unicode61` tokenizer is active (see Technical Notes for the spec deviation and follow-up).
- **QA:**
  - Manual: extend smoke script with an FTS round-trip — ingest a conversation containing a unique error-code-shaped string, search for it, assert exactly one hit with the right messageId. Capture for Slide 2.
  - Automated: unit + integration. **THIS IS IMPORTANT**
- **Planned commits:**
  1. `feat(searcher): ftsSearch — MATCH against messages_fts with filter scope`
  2. `feat(searcher): FTS5 query-syntax error handling → InvalidArgumentError`
  3. `test(searcher): ftsSearch phrase + boolean + prefix operators`
  4. `test(searcher): ftsSearch cross-project isolation + empty-corpus`
  5. `feat(scripts): smoke-indexer ftsSearch error-code lookup round-trip`
- **Technical notes:** `messages_fts` is content-rowid-linked to `messages.id` per sprint-014 schema — joining is `messages_fts JOIN messages ON messages_fts.rowid = messages.id`. **Tokenizer reality check:** the DDL at `src/conversations/store.ts:106-107` is `USING fts5(content, content=messages, content_rowid=rowid)` with NO `tokenize` clause, which means FTS5's default `unicode61` tokenizer is active — NOT porter, despite spec §5.5's "porter stemmer" claim. So `"running"` does NOT match `"run"`. Phrase + boolean + prefix queries DO work. Switching to porter requires DROP + CREATE on the virtual table (no ALTER for FTS5) plus a corpus rebuild — that's a schema-modifying change explicitly disallowed by the Sprint-Level Technical Context. **File a follow-up issue** during sprint-016 close to track the porter migration as a future sprint's work; reconcile spec §5.5 with shipped reality (either change the spec or schedule the migration). For this sprint, document the active tokenizer in `searcher`'s JSDoc so consumers don't expect stem matching. FTS5's `bm25()` ranking function returns a NEGATIVE score by default (lower = better); normalize to a non-negative monotone score in the result so Story 4's RRF fusion sees consistent ordering across vector + FTS sources.
- **Priority:** Must-have

#### Story 4: `searcher.hybridSearch` — vector + FTS RRF fusion (P4-S3)

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (5-8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** consumer wanting balanced semantic + keyword recall, **I want** `searcher.hybridSearch(query, filters, limit)` that runs both vector and FTS in parallel and fuses via reciprocal rank fusion, **so that** I get the union of "topically similar" and "literally matches" without having to call two methods and merge by hand.
- **Dependencies:** Stories 2 + 3
- **Acceptance criteria:**
  - [ ] Add `reciprocalRankFusion<T>(rankedLists: readonly T[][], idOf: (t: T) => string, opts?: { k?: number }): T[]` to `src/memory/retriever/ranking.ts`. `idOf` is REQUIRED (not optional) — there's no sensible default for a heterogeneous union like `WindowHit | MessageHit | SessionHit` (Story 5 extends to 3 sources). Caller normalizes its hit shape into a stable id at the boundary (`window:{conversationId}:{windowIndex}` / `message:{messageId}` / `session:{conversationId}`). RRF formula: `score(d) = Σᵢ 1 / (k + rankᵢ(d))` with `k=60` per Cormack et al. 2009 default. Pure function, deterministic, exhaustively unit-tested. **Caller-side type widening:** the searcher widens its `WindowHit[]` and `MessageHit[]` (and Story 5's `SessionHit[]`) to a single `HybridHit[]` union BEFORE passing into `reciprocalRankFusion` — the function's generic parameter `T` is the already-unified `HybridHit` type. This keeps the RRF helper agnostic about searcher internals.
  - [ ] `hybridSearch(query, filters, limit)`: runs `vectorSearch(query, filters, limit*2)` and `ftsSearch(query, filters, limit*2)` in parallel via `Promise.all`. Fuses results via RRF on a unified id (`window:{conversationId}:{windowIndex}` for window hits; `message:{messageId}` for FTS hits). Returns top-`limit` `HybridHit` results carrying source provenance (`source: 'vector' | 'fts' | 'both'`) and the underlying hit payload.
  - [ ] `HybridHit` shape unifies window + message hits without losing detail: `{kind: 'window', conversationId, windowIndex, messageIds[], score, source}` or `{kind: 'message', messageId, conversationId, score, source, snippet?}`.
  - [ ] Both sides over-fetch (`limit*2`) so RRF has enough candidates to fuse meaningfully — pinned by test (a query that ranks 5 vector hits + 5 FTS hits with overlap should produce <10 fused hits, not just the top-5 of one side).
  - [ ] Either side returning empty does NOT short-circuit the other — `hybridSearch` returns the non-empty side's results unchanged when one side is empty. Documented in JSDoc.
  - [ ] If both `vectorSearch` and `ftsSearch` reject (e.g., embedder error + FTS syntax error simultaneously), `hybridSearch` rethrows the vector error (the embedder failure is the higher-impact one). Documented.
- **Testing approach:** Unit tests for `reciprocalRankFusion` math (known input → known output, ties broken deterministically). Integration tests for `hybridSearch` shape (over-fetch behavior, source-provenance tagging, partial-empty short-circuit).
- **QA:**
  - Manual: smoke script gets a hybrid round-trip. Show that a query like "the connection error we hit yesterday" recalls both the topically-similar window (vector) AND the message containing the literal error code (FTS), fused. Capture for Slide 2.
  - Automated: full unit + integration. **THIS IS IMPORTANT**
- **Planned commits:**
  1. `feat(retriever/ranking): add reciprocalRankFusion helper with k=60 default`
  2. `test(retriever/ranking): RRF math + tie-breaking + edge cases`
  3. `feat(searcher): hybridSearch — parallel vector + FTS + RRF fusion`
  4. `feat(searcher): HybridHit unified type + source provenance`
  5. `test(searcher): hybrid over-fetch + partial-empty + dual-error behavior`
  6. `feat(scripts): smoke-indexer hybrid round-trip (semantic + literal example)`
- **Technical notes:** RRF lives in `ranking.ts` not the searcher because Phase-1 P1-S6 explicitly preserved this file as the home for fusion utilities — keep that contract. Do NOT delete the existing `currentFactBoost` / `RECENCY_MAX_BOOST` exports; those are sprint-013 survivors with unit tests still gating their behavior. The `k=60` constant comes from the original RRF paper; fairness across vector + FTS rank scales has held empirically — don't tune until Phase 7's eval suite says otherwise. Fan-out to `vec_sessions` is Story 5, NOT this story — keep Story 4's fusion bi-source.
- **Priority:** Must-have

#### Story 5: `searcher.hybridSearch` fan-out — vec_windows + vec_sessions + FTS triple-source (P4-S4)

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (5-8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** consumer querying long-running multi-session work, **I want** `hybridSearch` to also look at `vec_sessions` (whole-conversation embeddings) so multi-session and long-range references surface even when no individual window matches, **so that** I get the +5.6 R@5 / +15 multi-session lift the spec § 5.1.2 cites from mcp-memory-service.
- **Dependencies:** Story 4
- **Acceptance criteria:**
  - [ ] New helper `searcher.sessionVectorSearch(query, filters, limit): Promise<SessionHit[]>` returning `{conversationId, score}`. Same filter-first pattern as `vectorSearch`, but the candidate set is `(conversation_id)` rather than `(conversation_id, window_index)`.
  - [ ] `hybridSearch` extended to fan-out 3-way: `[vectorSearch, ftsSearch, sessionVectorSearch]` in parallel. RRF fuses across all three sources — session hits resolve to `kind: 'session'` results carrying `conversationId` (no message ids — the whole conversation IS the unit).
  - [ ] `HybridHit` extended with `kind: 'session'` variant — stable discriminated union, no breaking change to Story 4's window/message variants.
  - [ ] Test pinning the +5.6 R@5 / +15 multi-session premise — synthetic scenario: a conversation references content from a previous conversation by topic without any single window containing that topic. Without `vec_sessions` the recall is 0; with it ≥ 1. The numerical lift is not pinned (eval-quality work belongs in Phase 7), but the qualitative behavior is.
  - [ ] Window-vs-session tie-breaking: when a single conversation surfaces from BOTH `vec_windows` and `vec_sessions`, RRF naturally promotes it via score-summing — assert this in a test rather than special-casing the dedup.
  - [ ] Empty `vec_sessions` (no `buildSessionVector` calls run yet for this corpus) → fan-out gracefully degrades to bi-source (vector + FTS); session source contributes zero hits, hybrid still returns valid results. Documented.
- **Testing approach:** Heavy on integration — synthetic two-conversation corpus where the cross-conversation reference is the only winning path. Unit-test the `kind: 'session'` shape + RRF cross-source fusion math.
- **QA:**
  - Manual: smoke script gets a 3-source round-trip with two conversations and a cross-conversation reference query. Show that the second conversation surfaces only because of `vec_sessions`. Capture for Slide 2.
  - Automated: integration test pinning the cross-conversation recall lift. **THIS IS IMPORTANT**
- **Planned commits:**
  1. `feat(searcher): sessionVectorSearch — filter-first KNN over vec_sessions`
  2. `feat(searcher): hybridSearch 3-source fan-out + kind:'session' HybridHit variant`
  3. `test(searcher): cross-conversation reference recall — vec_sessions promotes the right conversation`
  4. `test(searcher): session-empty graceful degradation`
  5. `feat(scripts): smoke-indexer 3-source hybrid (cross-conversation reference example)`
- **Technical notes:** `vec_sessions` is keyed only by `conversation_id`, so the candidate set for `sessionVectorSearch` is just the conversation list filtered by `projectId` / `dateFrom` / `dateTo` (role filtering doesn't apply at session granularity — document this as a filter-shape edge case, NOT a bug). **`storeAsync` does NOT auto-call `indexer.buildSessionVector`** — by design per sprint-015 §5 Technical Notes (explicit consumer demand only, deferred auto-invocation to sprint-016+ when retrieval pressure is real). So Story 5's integration tests must call `indexer.buildSessionVector(conversationId)` explicitly after each `storeAsync` in their fixture setup. The smoke script gets the same treatment. A forgotten call silently produces an empty `vec_sessions`, masking the test's intent — add an explicit "vec_sessions row count > 0" assertion at the start of each Story 5 test as a fixture sanity check. **Open question for sprint close retro:** should `storeAsync` (or a `storeAsyncAndSeal` variant) auto-invoke `buildSessionVector` once retrieval consumers exist? Defer the answer to Phase 7 eval data.
- **Priority:** Must-have

#### Story 6: Cross-cutting tests — filter correctness, ranking stability, isolation (P4-S5)

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (5-8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** maintainer guarding the searcher contract over future sprints, **I want** a cross-cutting integration suite that pins filter correctness, ranking stability, window-to-messages resolution, and project isolation across all three search methods, **so that** Phase 5 (`searcher.sql`) and Phase 7 (eval framework) can build on a verified foundation without each retesting the basics.
- **Dependencies:** Stories 1-5
- **Acceptance criteria:**
  - [ ] New file `tests/integration/searcher.test.ts` runs the cross-cutting suite end-to-end with `LocalEmbedder` (`SKIP_SLOW_TESTS=0` gate, same pattern as sprint-015 Story 7's real-Nomic round-trip).
  - [ ] Filter correctness matrix: each filter dimension (`projectId`, `conversationId`, `role`, `dateFrom`, `dateTo`) tested across all three methods (`vectorSearch`, `ftsSearch`, `hybridSearch`). Tabular structure — N filter dims × 3 methods = parameterized test cases.
  - [ ] Ranking stability: identical query against an idempotent corpus returns the same result order across runs. Asserts no nondeterminism in tie-breaking.
  - [ ] Window-to-messages resolution: a `vectorSearch` hit's `messageIds[]` reads the same as a manual `SELECT message_id FROM window_messages WHERE conversation_id = ? AND window_index = ?` (no off-by-one in `position` ordering).
  - [ ] Cross-project isolation pinned for ALL three methods (not just vector — `ftsSearch` and `hybridSearch` get the same isolation guarantee).
  - [ ] Static src/ filesystem grep for forbidden imports — same pattern as sprint-015 Story 7's import guard. New module must not have introduced an `@anthropic-ai/sdk` / `openai` / `pg` / `@supabase` import.
  - [ ] CI variant (stub embedder) covers all of the above; `SKIP_SLOW_TESTS=0` adds a real-Nomic recall sanity check. Test count baseline locked.
- **Testing approach:** Integration suite mirroring the structure of `tests/integration/indexer.test.ts`. The synthetic corpus is intentionally compact (≤ 3 projects × 2 conversations × 6 messages each) — large enough to exercise every filter dimension without making the suite slow.
- **QA:**
  - Manual: visually walk through the test file's `describe` blocks during PR review — the test names ARE the documentation of the searcher contract. Treat them as a spec.
  - Automated: the suite is the artifact. **THIS IS IMPORTANT**
- **Planned commits:**
  1. `test(integration): scaffold searcher.test.ts with shared corpus + helpers`
  2. `test(integration): filter correctness matrix across all three methods`
  3. `test(integration): ranking stability + window→messages resolution`
  4. `test(integration): cross-project isolation pinned for all three methods`
  5. `test(integration): static src/ grep guard for forbidden LLM imports`
  6. `test(integration): real-Nomic recall sanity check (gated)`
- **Technical notes:** This story is INTENTIONALLY light on production-code changes — its job is to lock the searcher contract. If a test surfaces a real bug, fix it inside the relevant feature story branch (Story 2-5) and re-PR; do NOT bundle production fixes into Story 6's commits. That keeps the integration-test PR's diff readable as a contract-pinning artifact rather than a bug-fix grab-bag.
- **Priority:** Must-have

#### Final Evaluation Story (mandatory, runs last)

Produce visual proof that every user flow in the "User Flows" section above works end-to-end. Assemble the artifacts into an HTML slide deck at `docs/sprints/eval/sprint-016.html`. This story runs after all feature stories are merged.

Use `~/projects/harness-config/templates/evaluation-matrix.md` to pick the tool per component type. If a component type isn't in the matrix, document your approach in Technical Notes and propose a matrix update in the Retro.

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template (acceptance criteria, testing approach, planned commits)
  - [ ] Within size limits (5-8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok
  - [ ] Each AC verified against git diff and the rendered HTML deck before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(summary of review feedback)*
  - Resolution: *(agreed + fixed / disagreed + reason)*
- **As a** stakeholder, **I want** embeddable visual proof that every user flow in this sprint works end-to-end, **so that** sprint completion is verifiable at a glance without re-running the code.
- **Dependencies:** All feature stories in this sprint must be merged before this story starts.
- **Acceptance criteria:**
  - [ ] Slide deck at `docs/sprints/eval/sprint-016.html` follows the 5-slide structure below. Total slide count ≤5.
  - [ ] Slide 1 — **Sprint Summary**: goal, stories shipped (titles only), overall pass/fail count
  - [ ] Slide 2 — **User Flows Demonstrated**: visual (terminal capture / API trace) per flow — `storeAsync` populates corpus, `vectorSearch` filter-first hit, `ftsSearch` literal hit, `hybridSearch` semantic+literal fusion, 3-source fan-out cross-conversation recall. Smoke script terminal recordings consolidate onto this single slide.
  - [ ] Slide 3 — **Key Changes**: `searcher` module structure diagram, RRF formula + parameter, candidate-set EXPLAIN QUERY PLAN snapshot, `storeAsync` before/after diff
  - [ ] Slide 4 — **Test & Eval Results**: per-story test-count delta, integration suite shape, real-Nomic gate status, cross-project isolation pinned-by-test count
  - [ ] Slide 5 — **Repo Hygiene + AC Matrix**: `main` clean, no tmp files, no dangling branches, tests green, plus a table of every feature story's AC with pass/fail status
  - [ ] Tool chosen per `~/projects/harness-config/templates/evaluation-matrix.md` component-type mapping — searcher is "backend SDK API" so terminal captures + API call traces are the right fit (no screenshots needed)
  - [ ] Bulky assets in sibling dir `docs/sprints/eval/sprint-016/` if needed
  - [ ] Images or Videos (≤120s each); committed binaries ≤10MB (compress or reference externally)
- **Testing approach:** The artifacts themselves are the tests. Open the rendered HTML deck in a browser and walk through every slide before marking this story complete.
- **QA:**
  - Manual: Open `docs/sprints/eval/sprint-016.html` in a browser. Confirm every slide loads, every embedded visual plays or displays, every AC shows pass/fail status.
  - Automated: N/A — visual proof is the artifact **THIS IS IMPORTANT**
- **Planned commits:**
  1. `feat: capture evaluation artifacts for sprint-016` — terminal captures of `scripts/smoke-indexer.ts` runs (storeAsync, vectorSearch, ftsSearch, hybridSearch, 3-source), API call traces, EXPLAIN QUERY PLAN snapshots into `docs/sprints/eval/sprint-016/`
  2. `feat: build sprint-016 evaluation slide deck` — single HTML file referencing the artifacts
- **Technical notes:** See `~/projects/harness-config/templates/evaluation-matrix.md` for the component → tool mapping. Searcher is a backend SDK primitive — terminal captures of the smoke script are the load-bearing artifacts, same as sprint-015's eval deck. EXPLAIN QUERY PLAN snapshots for the candidate-set query are the proof-of-correctness for filter-first ordering — show them inline in the slide rather than linking out.
- **Priority:** Must-have

### Rules
- **Sprint-branch setup (before Story 1):** create `sprint-016` off `main` and push. Commit this sprint doc as the first commit on the branch. Story branches fork from `sprint-016`; story PRs target `sprint-016`. After the evaluation story merges, open a sprint-integration PR (`sprint-016 → main`) as the final step. See AGENTS.md §3 for the full workflow + edge cases (mid-sprint hotfix, abandonment, cross-sprint deps).
- We sequentially do the stories. We do not do parallel work.
- **Review loop:** Open PRs, run `/review` (nudged by the PostToolUse hook), address findings, re-verify via `/review-fix` (capped at 3 passes per PR — see `workflow-prompts/handle-pr-activity.md`), confirm local checks are green and the last review turn returned mergeability ≥ 4/5 with no open P0/P1 findings, merge into `sprint-016`, then move to the next story. The sprint-integration PR goes through the same loop — cumulative-diff `/review` catches cross-story interactions.
- **Parallel experiment option (explicit exception):** when a story is explicitly scoped as an isolated experiment, consider `/skill:worktree create <branch>` to run it in a separate cmux workspace with its own Pi session, or to discard it cleanly via `/skill:worktree remove`. This does not change the default sequential rule above. See AGENTS.md §20 for prerequisites and scope.
- Record new dependencies in the Completion section's New Dependencies field.
- For everything else — commits, PR process, code quality, testing — follow your system instructions (the conventions loaded at session start).

### Definition of Done
- All must-have stories pass acceptance criteria
- System-instruction conventions satisfied (code quality, tests, PR process, conventional commits, local checks green, last review turn — `/review` or `/review-fix` — returned mergeability ≥ 4/5 with no open P0/P1 findings)
- **Final Evaluation Story complete** — `docs/sprints/eval/sprint-016.html` exists; every User Flow has a visual artifact; repo hygiene slide shows clean state
- **Sprint-integration PR merged** (`sprint-016 → main`); `sprint-016` deleted from origin; local main branch fast-forwarded
- **If the sprint introduces new user flows** (N/A for pure process/infra sprints): fold them into the implementation spec (`implementation-spec-005.md` §15) before sprint completion — the `searcher.{vector,fts,hybrid,sessionVector}Search` flows must land in §15 alongside the `storeAsync` rewire (which folds into Flow 1)

---

## Completion

*(Filled in at sprint close)*

### Stories shipped
*(List as merged)*

### New dependencies
*(None expected — surface during /sprint review if otherwise)*

### Retro highlights
*(Filled at close)*
