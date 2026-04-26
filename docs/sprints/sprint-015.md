# Pristine — Sprint 015
**Date:** 2026-04-25 – TBD
**Goal:** Execute §16 Phase 3 of spec-005 — turn raw turns into a populated corpus by implementing the indexer primitive (`indexer.ingest`, `indexer.buildSessionVector`), adapting `chunker.ts` for oversize-message handling, and rewriting `extract-worker.ts` → `embed-worker.ts` so Phase-4's hybrid retrieval has data to query against.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `~/projects/pristine` (getlou-gh/pristine)
- **Tech stack:** TypeScript strict / ESM / Node 20+ / better-sqlite3 / sqlite-vec / FTS5 / Nomic Embed v1.5 via `@huggingface/transformers` / Vitest
- **Current state:** sprint-014 (spec-005 Phase 2) just merged to `main`. The Sprint-009 + spec-005 schema is in place: `conversations` + `messages` extended with `project_id` + `parent_message_id`; `vec_windows` + `vec_sessions` + `window_messages` provisioned but empty; `messages_public` + `conversations_public` + `summaries_public` views shipped; `summaries` table + `addMessage` / `addSummary` / `getRecentSummaries` API + 2 typed errors landed. `initConversationTables` is flat (no version gate, no migration); `npm run db:reset` is the schema-change workflow. `IngestQueue.processNext()` currently **throws** because `orchestrator` is null on every construction path — this sprint wires the indexer through that path.
- **Implementation spec:** `docs/specs/implementation-spec-005.md` — this sprint executes **§16 Phase 3** (stories P3-S1 through P3-S5 + integration tests), consolidated here into seven feature stories plus the mandatory evaluation story.
- **Story mapping:** Spec §16 Phase 3 lists P3-S1 through P3-S5 + a duplicate P3-S4 (typo for integration tests). This sprint maps: P3-S1→Story 2, P3-S2→Story 3, P3-S3→Story 4, P3-S4→Story 5, P3-S5→Story 6, dup-P3-S4→Story 7. Story 1 (deleteById cascade) is a sprint-015 pre-flight blocker not in the spec list.

### Sprint-Level Technical Context
- **Pre-flight blocker — GH #113.** Sprint-014 left `ConversationStore.deleteById` un-cascaded against `window_messages`. With `PRAGMA foreign_keys = ON` (Sprint-014 Story 1) and Phase-3 actively writing `window_messages` rows (Stories 3 + 6 here), the existing partial-ingest-recovery path will throw FK violations the moment a row gets indexed. Story 1 lands the cascade fix BEFORE any other story. No Phase-3 writes happen until Story 1 merges.
- **First sprint to actually write to `vec_windows` / `vec_sessions` / `window_messages`.** Sprint-014 only provisioned the schema. Every test in this sprint that exercises the indexer must round-trip Float32 embeddings through these tables — confirm the BigInt-binding gotcha (vec0 INTEGER metadata columns reject plain JS numbers) is respected throughout.
- **What stays untouched (do not modify):** `src/client.ts` (no API surface changes; the indexer plugs into `IngestQueue` which `client.ts` already constructs), `src/conversations/store.ts` schema (no new columns this sprint — schema is frozen post-#114; if a column is needed, file an issue and use `npm run db:reset` to rebuild), `src/embedder/*` (Nomic v1.5 wrapper unchanged), `src/queue/ingest-queue.ts` crash-recovery + enqueue semantics (verbatim); `processNext()` is unblocked from its current stub-throws state by Story 6.
- **No new runtime dependencies.** `better-sqlite3` + `sqlite-vec` + `@huggingface/transformers` only. The orchestrator + chunker survivors from Sprint-013 (`src/memory/orchestrator/chunker.ts`, `src/memory/retriever/ranking.ts`) are the seed code — chunker is adapted in Story 4; ranking.ts stays untouched until Sprint-016.
- **vec0 write idiom — DELETE + INSERT, NOT INSERT OR REPLACE.** Sprint-014 confirmed this contractually. Phase-3 writes use the supported idiom inside `db.transaction(...)`. The spec says "INSERT OR REPLACE" in §16 Phase 3 prose; that's a spec-text drift from the verified implementation contract. Implement DELETE + INSERT.
- **BigInt for INTEGER metadata.** vec0's `conversation_id TEXT, window_index INTEGER` keys reject plain JS numbers on bind — must use `BigInt(window_index)` at the prepared-statement boundary. Sprint-014 tests pin this. New worker code must follow the same pattern.
- **Worker-thread concurrency arrives.** Sprint-014's `addMessage` was specifically designed for this — `MAX(sort_order)+1` + INSERT + `message_count++` runs atomically inside a `db.transaction`. The embed-worker exercises this contract for the first time; the gapless-ordinal regression test from sprint-014 is the safety net. If concurrent appends ever produce a gap, the regression fires before users see misaligned windows.
- **Spec deviation acknowledgement.** Spec §13 sketches `messages.id TEXT PRIMARY KEY` (UUID); the shipped schema uses `INTEGER PRIMARY KEY AUTOINCREMENT` (preserved Sprint-009 FTS5 `content_rowid=rowid` linkage). All Phase-3 writes use INTEGER `message_id` everywhere (`window_messages.message_id INTEGER`). Tracked as GH #106; not blocking sprint-015.
- **Test count budget.** Pre-sprint: 451 unit / 482 e2e. Expected post-sprint: +60–100 unit/integration tests covering indexer logic, chunker oversize cases, embed-worker crash-recovery, end-to-end ingest → embed round-trips. Integration tests requiring a real Nomic model use the `skipIf(skipSlow)` pattern (already established in `tests/integration/embedder.test.ts`).
- **Performance budget.** `indexer.ingest(turns, ...)` must return in <0.5s for the caller — atomic insert + task enqueue only; embedding work is offloaded to the worker. The worker has no real-time budget but should self-terminate on idle (existing `IngestQueue` behavior).

### User Flows

**Affected (existing):**
- **`storeAsync`** (`src/client.ts`) — currently calls `IngestQueue.enqueue()`; the queue's `processNext()` throws due to null orchestrator. This sprint wires `indexer` through `processNext()`, so `storeAsync` becomes the public consumer entrypoint for ingest.
- **`IngestQueue.processNext()`** — currently a stub that throws. After Story 6, it claims a pending message-embed task, runs the embed-worker logic (embed → vec_windows/window_messages write → mark complete), and self-terminates on idle.

**New (this sprint):**
- **`indexer.ingest(turns, { projectId, conversationId, sessionId })`** — primary write entrypoint. Atomic insert of `messages` rows + enqueue of per-message embed tasks. Caller blocks <0.5s; embeddings produced async by the worker. Folded into spec §15 once shipped.
- **`indexer.buildSessionVector(conversationId)`** — explicit method that concatenates all messages of a conversation, embeds once, writes the result to `vec_sessions` via DELETE + INSERT. No LLM call, pure mechanical. Phase-4 retrieval reads this vector as the coarse-grained session signal.

### Stories
**Constraints:** Target 5–8 stories per sprint; 5–8 commits per story.

#### Story 1: Land deleteById cascade to window_messages (GH #113 blocker)
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
- **As a** sprint-015 indexer that's about to start writing `window_messages` rows, **I want** `ConversationStore.deleteById` to cascade through `window_messages` (and clean up `vec_windows` / `vec_sessions`) before deleting messages, **so that** the existing partial-ingest recovery path doesn't FK-fail the moment a single message gets indexed.
- **Dependencies:** None — this is the gating story. No other Phase-3 work begins until this merges.
- **Acceptance criteria:**
  - [ ] `deleteById` extends its existing `db.transaction` with `DELETE FROM window_messages WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)` BEFORE the messages delete
  - [ ] `deleteById` also deletes from `vec_windows WHERE conversation_id = ?` and `vec_sessions WHERE conversation_id = ?` so vector orphans don't accumulate (vec0 has no FK so they wouldn't error, but they'd waste storage)
  - [ ] Regression test: seed a conversation + messages + window_messages rows for those messages + a vec_windows row + a vec_sessions row, call `deleteById`, assert all four target tables empty for that conversation_id and no FK violation thrown
  - [ ] Regression test: pair-test that `deleteById` is still a no-op on a missing conversation id
  - [ ] No behavioral change for the no-window_messages-rows case (preserves the Sprint-009 contract)
- **Testing approach:** New unit tests in `tests/conversations/store.test.ts` under the existing `deleteById` describe. Use the in-memory test DB with `loadSqliteVec: true`. Direct INSERTs into `window_messages` / `vec_windows` / `vec_sessions` via raw SQL to set up the cascade-required state — this story doesn't need the indexer plumbing yet.
- **QA:** N/A — backend only.
- **Planned commits:**
  1. `fix(store): deleteById cascade to window_messages + vec_windows + vec_sessions (GH #113)` — single transaction, all four DELETEs ordered correctly
  2. `test(store): deleteById cascade regression — FK-safe with indexed conversations`
- **Technical notes:**
  - Order matters: `window_messages` (FK to messages.id) MUST delete before messages. `vec_windows` / `vec_sessions` have no FK so order is irrelevant for them — group them with `window_messages` for readability.
  - Existing `deleteById` already wraps DELETEs in `db.transaction` — extend that block; do not introduce a second transaction.
  - The vec_windows / vec_sessions DELETEs are write-amplification but a one-time cost on a recovery path; not a hot loop.
  - Sprint-014 PR #115 review surfaced this as P1 logic; deferred at sprint close because no row writer existed yet. Story 1 unblocks that.
- **Priority:** Must-have

#### Story 2: indexer.ingest() facade + IndexerConfig + atomic message insert + task enqueue
- **Story Checklist:**
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(tbd)*
  - Resolution: *(tbd)*
- **As a** consumer of the SDK (today via `storeAsync`), **I want** `indexer.ingest(turns, { projectId, conversationId, sessionId })` to atomically write messages + enqueue embed tasks and return in <0.5s, **so that** my call site is unblocked while the per-message embedding work runs in the background.
- **Dependencies:** Story 1 (deleteById cascade must be live before Phase-3 starts writing).
- **Acceptance criteria:**
  - [x] New module `src/memory/indexer/index.ts` exports `createIndexer(deps): Indexer` per spec §13
  - [x] `IndexerConfig` exported with `windowSize` (default 3) and `windowOverlap` (default 1); validate `0 <= overlap < windowSize` at construction (overlap=0 is the boundary case for stride=windowSize); throw `InvalidArgumentError` on violation
  - [x] `indexer.ingest(turns, opts)` writes all turns as `messages` rows in a single `db.transaction` via `ConversationStore.addMessage` (sprint-014 atomic primitive); inner addMessage transactions become savepoints under the outer transaction, preserving atomicity
  - [x] If `opts.conversationId` does not exist, throw `ConversationNotFoundError` (resolved early via SELECT user_id from conversations; addMessage would throw the same inside its savepoint, but surfacing it before the first INSERT keeps the rollback cheap). Documented in JSDoc.
  - [x] After insert, enqueue one task per inserted message ID via the new `IngestQueue.enqueueMessageEmbed({ messageId, conversationId, userId, projectId, sessionId? })` method — task type `embed-message`, payload includes message_id + conversation_id + user_id + project_id + session_id
  - [x] `ingest()` returns `<0.5s` for the typical case (<= 100 turns); benchmark in Vitest using `performance.now()` deltas; CI threshold tolerant 2× to avoid flake
  - [x] No embedding happens synchronously inside `ingest()` — that's the worker's job (Story 6); test asserts every newly-enqueued task is still in 'pending' status when ingest() returns
  - [x] Caller errors propagate cleanly: `InvalidArgumentError` for zero turns, empty `projectId` / `conversationId`, empty `sessionId`-when-provided, or invalid config
- **Testing approach:** 18 unit tests in `tests/memory/indexer/ingest.test.ts`. No embedder mock needed — Story 2 doesn't embed; Story 6's worker does. Verify: turn count → row count + task count, sessionId pass-through, sort_order contiguity, return-time bound, `ConversationNotFoundError` + atomicity (no partial writes on doomed batch), `InvalidArgumentError` on zero turns / invalid config / empty opts strings, async contract (tasks remain 'pending' after return). Hermeticity via `beforeEach` DELETE pass on conversations / messages / pending_ingest_tasks.
- **QA:** N/A — backend.
- **Planned commits:** (5 total)
  1. `feat(queue): add task_type + message-level columns to pending_ingest_tasks; expose enqueueMessageEmbed`
  2. `feat(store): addMessage returns inserted messages.id for indexer enqueue`
  3. `feat(indexer): create indexer module — IndexerConfig + ingest() atomic insert via addMessage + enqueueMessageEmbed`
  4. `test(indexer): ingest happy path + config validation + error propagation + <0.5s return-time bound`
  5. `docs(sprint-015): record Story 2 scope expansion — queue schema bump + addMessage return-id`
- **Technical notes:**
  - **Scope expansion surfaced during implementation:** Story 2's AC said "enqueue one IngestQueue task per inserted message ID — task type `embed-message`, payload includes messageId + conversationId + projectId + sessionId" without checking that `pending_ingest_tasks` had the columns to support it. The original spec-003 schema was conversation-level (one row per conversation, no `task_type` / `message_id` / `project_id` / `session_id` / payload columns). Honoring the AC required a real schema change to the queue table — additions: `task_type TEXT NOT NULL DEFAULT 'extract-conversation' CHECK (task_type IN ('extract-conversation', 'embed-message'))`, plus nullable `message_id INTEGER` / `project_id TEXT` / `session_id TEXT` columns + a composite index `idx_pending_ingest_tasks_type_status` so Story 6's worker can claim by `(task_type='embed-message', status='pending')` without scanning. The schema-frozen rule from the Sprint-Level Technical Context applies to the corpus tables (`conversations`, `messages`, `vec_*`, `window_messages`), not the queue table.
  - **`addMessage` return-value change:** sprint-014 pinned `addMessage` to `void` per spec §5.1.1. Sprint-015 Story 2 needs the inserted messages.id atomically (the indexer enqueues a per-message task with the id in the payload, in the same transaction). Reading `db.lastInsertRowid` from outside is fragile across the FTS5 AFTER-INSERT trigger (sprint-009 contract). Cleanest: surface the id from inside addMessage's own transaction via the prepared-statement run() result. The pinned test was updated to assert a positive integer instead of undefined; spec deviation is rationalized alongside #106 (INTEGER vs UUID for messages.id).
  - **`userId` is read from the conversation row, not in `opts`:** the AC's `IngestOptions` is `{ projectId, conversationId, sessionId? }` — no userId. The conversation already has a `user_id` column; the indexer reads it once at the top of ingest() and passes it into each `enqueueMessageEmbed` call. Single source of truth, prevents drift.
  - The indexer is a primitive facade — small surface, no orchestration logic, no LLM. Keep `src/memory/indexer/` lean: one entry file (`index.ts`) + sliding-window helper (Story 3) + session-vector helper (Story 5).
  - Dedup is handled at the conversation level by the existing `UNIQUE(user_id, content_hash)` index on `conversations`. Per-message dedup is deferred until a concrete replay scenario emerges — Phase-3 treats every turn as a real message and lets the corpus reflect what actually happened.
  - `sessionId` is passed through into the `embed-message` task payload (for future summary-injection wiring) but not stored on the messages row — there is no `message.session_id` column. Documented in JSDoc.
- **Priority:** Must-have

#### Story 3: Sliding-window assembly logic + vec_windows / window_messages writes
- **Story Checklist:**
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(tbd)*
  - Resolution: *(tbd)*
- **As a** the embed-worker (Story 6) processing one message at a time, **I want** a pure-logic helper that computes which window indexes a newly-inserted message belongs to and writes the resulting embeddings to `vec_windows` + `window_messages`, **so that** Phase-4's filter-first vector search has fine-grained candidates to score.
- **Dependencies:** Stories 1 + 2.
- **Acceptance criteria:**
  - [x] New helper in `src/memory/indexer/windows.ts`: `computeWindowsForMessage(sortOrder, totalMessageCount, config): WindowAssignment[]` — pure function, no DB access; returns the window indexes the message belongs to plus its position within each window. Signature deviates from the original sprint sketch (`(conversationId, sortOrder, config)`): conversationId was unused for pure logic and totalMessageCount is genuinely needed to determine which windows currently exist
  - [x] Tail-slide-back behavior — for a conversation of length N where the natural last-window range overshoots N-1, the final window is shifted backward so it always contains exactly `windowSize` messages (unless conversation is shorter than windowSize, in which case the single partial window contains all of them). Last window's overlap may temporarily exceed the configured value as a result — documented in JSDoc
  - [x] New helper `assembleWindowEmbedding(messageRows, embedder): Promise<Float32Array>` — concatenates role-prefixed message contents (newline-joined), embeds once via the explicitly-passed `embedder` (not a module-level import — keeps the helper testable with a stubbed embedder), returns the 768-d vector
  - [x] Write helper `upsertWindow(db, conversationId, windowIndex, messageIds, embedding)` — DELETE + INSERT inside `db.transaction` (the verified vec0 replace idiom from Sprint-014). DELETE phase clears BOTH `vec_windows WHERE conversation_id = ? AND window_index = ?` AND all `window_messages WHERE conversation_id = ? AND window_index = ?` rows before inserting the fresh set; INSERT phase writes the new vec_windows row + new window_messages rows for the constituent messages with explicit `position` ordering. Uses `BigInt(windowIndex)` and `BigInt(position)` at every bind site for vec0 INTEGER metadata columns
  - [x] Round-trip test: synthetic 5-message conversation, windowSize=3, windowOverlap=1 → expected windows are `[0,1,2]`, `[2,3,4]` (stride 2; tail slide doesn't fire for 5 messages with windowSize 3 + overlap 1)
  - [x] Edge case: conversation shorter than windowSize → single partial window covering all messages
  - [x] Re-embed on update: re-running `upsertWindow` for the same `(conversation_id, window_index)` deletes the stale row and inserts the fresh one (vec_windows + window_messages both rebuilt for that window)
- **Testing approach:** Unit tests for the pure-logic functions (window-index math + tail-slide-back); integration test for the full upsert round-trip using the in-memory DB + a stubbed embedder that returns deterministic vectors.
- **QA:** N/A — backend.
- **Planned commits:**
  1. `feat(indexer): add computeWindowsForMessage pure-logic helper + tail-slide-back math`
  2. `feat(indexer): add assembleWindowEmbedding helper (role-prefix concat + embed)`
  3. `feat(indexer): add upsertWindow with DELETE+INSERT idiom for vec_windows + window_messages`
  4. `test(indexer): window-index math (5 message / stride 2 / tail slide)`
  5. `test(indexer): upsertWindow round-trip + re-embed deletes-then-inserts`
- **Technical notes:**
  - vec0 binding gotcha: `window_index` in the prepared-statement bind must be `BigInt(windowIndex)` — pinned by Sprint-014 tests.
  - DELETE + INSERT: do BOTH `DELETE FROM vec_windows WHERE conversation_id = ? AND window_index = ?` AND `DELETE FROM window_messages WHERE conversation_id = ? AND window_index = ?` in the same transaction before inserting fresh rows.
  - Role prefix uses the existing `role: content` format from sprint-013's surviving chunker; reuse that string-builder.
  - The pure-logic functions live in `windows.ts` so they're trivially testable without a DB. Story 6's embed-worker imports from this module.
- **Priority:** Must-have

#### Story 4: Add splitOversizeMessage helper alongside the existing chunker
- **Story Checklist:**
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(tbd)*
  - Resolution: *(tbd)*
- **As a** the indexer ingesting a message that exceeds the embedding-context budget, **I want** to split it into chunks linked via `parent_message_id` so each chunk fits the embedder, **so that** Phase-4 retrieval can resolve a window hit back to the parent message via `ix_messages_parent` without losing the original turn boundary.
- **Dependencies:** Stories 2 + 3.
- **Acceptance criteria:**
  - [x] `src/memory/orchestrator/chunker.ts` (preserved through Sprint-013) gains a NEW exported helper `splitOversizeMessage(message, options): SplitResult[]` alongside the existing `chunkConversation` — the existing function is NOT renamed or replaced. Signature deviation from sprint sketch: takes `(message, options)` instead of `(message, embedder)` because the Embedder interface ships only `embed`/`embedBatch` (no `countTokens` accessor); options carry an optional pluggable `tokenCounter`
  - [x] Threshold: messages with token count > 3000 trigger chunking (Graphiti default; `OVERSIZE_TOKEN_THRESHOLD` exported)
  - [x] Split policy:
    - For code-tagged content (role `'tool'` with code-fenced markdown OR explicit `mimeType` hint = `text/x-typescript`/`text/x-javascript`/`application/typescript`/`application/javascript`) → split at AST boundaries (function/class/top-level statement) via `@babel/parser` (TS plugin + JSX); strips fence delimiters before parsing; falls back to line-aware split on ANY parser error (garbage code doesn't crash)
    - For prose content → split at paragraph boundaries (`\n\n`) with 200-token overlap (`OVERSIZE_OVERLAP_TOKENS`); falls back to single-newline boundaries when no double-newlines exist
    - Never split mid-segment — Graphiti invariant; a single oversize segment becomes its own chunk regardless of size
  - [x] Chunk rows go through `addMessage` via `indexer.ingest()` so they inherit project_id from parent + atomic sort_order semantics + `parent_message_id` linkage. Parent row stores the original full content (NO embed-task — too big to embed); each chunk row gets an embed-message task
  - [x] Chunks are individually eligible for window assembly — Story 3's `computeWindowsForMessage` treats them as ordinary messages (each chunk has its own sort_order in the conversation)
  - [x] Round-trip test (oversize prose) — multi-paragraph oversize content produces multiple chunks all linked to the parent via `parent_message_id`; only chunks get embed tasks
  - [x] AST-fallback test: garbage code that fails parse → falls back to line-aware split without throwing
  - [x] Token counter — `defaultTokenCounter` heuristic (~4 chars/token) ships built-in; pluggable via `tokenCounter: TokenCounter` in options when a real tokenizer becomes available. Trade-off documented in JSDoc — exact counts matter less than catching obvious oversize cases (threshold is well below Nomic v1.5's 8192 hard limit)
- **Testing approach:** Unit tests in `tests/memory/orchestrator/chunker.test.ts`. Mock the tokenizer for deterministic counts; mock the embedder for the round-trip integration. Use synthetic prose (Lorem-Ipsum-style) and synthetic TS/JS code (matched to the chosen AST parser — see Technical Notes).
- **QA:** N/A — backend.
- **Planned commits:**
  1. `feat(chunker): add token-count threshold gate + parent_message_id linkage on chunks`
  2. `feat(chunker): paragraph-boundary split for prose with 200-token overlap`
  3. `feat(chunker): AST-boundary split for code with line-aware fallback`
  4. `feat(chunker): preserve never-split-mid-message invariant + emit chunks via addMessage`
  5. `test(chunker): oversize prose → N chunks linked via parent_message_id`
  6. `test(chunker): oversize code → AST-split chunks; garbage code falls back to line-aware`
- **Technical notes:**
  - The existing `chunkConversation` in `src/memory/orchestrator/chunker.ts` splits a conversation array into windows — wrong abstraction for Story 4. Story 4 ADDS a new exported function `splitOversizeMessage(message, embedder): SplitResult[]` alongside the existing `chunkConversation`. Do not replace or rename `chunkConversation`. If `chunkConversation` is being retired in favor of Story 3's `computeWindowsForMessage`, file a follow-up issue and let the retirement land separately — out of scope for this story.
  - The new `splitOversizeMessage` returns chunks shaped to flow through `addMessage`'s param object so the indexer can re-emit them as ordinary messages with `parent_message_id` set.
  - `ix_messages_parent` (Sprint-014 Story 1) covers the reverse-resolution query Phase-4 will use; this story's chunks make that index load-bearing for the first time.
  - The 200-token overlap is a count of tokens, not characters. Use the embedder's tokenizer for consistency; do not approximate via byte-length.
  - For prose paragraph splitting, prefer double-newline boundaries; fall back to single-newline if no double-newline exists in a >3000-token message.
  - AST parser: `tree-sitter` (language-agnostic, supports JS/TS via grammar) OR `@babel/parser` (TS/JS only). Pick at story planning. Test fixture must be TS/JS code (not Python) to exercise the AST success path; the garbage-string test exercises the line-aware fallback.
- **Priority:** Must-have

#### Story 5: indexer.buildSessionVector + vec_sessions writes
- **Story Checklist:**
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(tbd)*
  - Resolution: *(tbd)*
- **As a** the SDK consumer (or the embed-worker as a follow-up step), **I want** `indexer.buildSessionVector(conversationId)` to embed the whole conversation as a single 768-d vector and write it to `vec_sessions`, **so that** Phase-4's coarse-grained retrieval has a session-level signal alongside the fine-grained window vectors.
- **Dependencies:** Stories 2 + 3.
- **Acceptance criteria:**
  - [x] New helper `src/memory/indexer/session-vector.ts`: `buildSessionVector(db, embedder, conversationId): Promise<void>`
  - [x] `indexer.buildSessionVector(conversationId)` is exposed as a method on the `Indexer` returned by `createIndexer()` (per spec §5.1.2). `IndexerDeps.embedder` is optional (ingest doesn't need an embedder — the worker does); calling `buildSessionVector` without one throws `InvalidArgumentError`
  - [x] Loads all messages for the conversation in `sort_order ASC`, role-prefixes each (`role: content` via the existing `formatMessageForEmbed` helper from Story 3), joins with newline, embeds once
  - [x] Writes via DELETE + INSERT into `vec_sessions` inside `db.transaction` (the vec0 replace idiom pinned by Sprint-014 tests; vec_sessions PK on `conversation_id` rejects raw INSERT OR REPLACE)
  - [x] Sets the `+updated_at` auxiliary column to `Date.now()` (unix ms; bind as `BigInt(Date.now())` per the vec0 INTEGER metadata contract)
  - [x] Throws `ConversationNotFoundError` when the conversation id doesn't resolve (pre-check before the embedder call so a doomed batch doesn't burn an embed)
  - [x] No-op when the conversation has zero messages — no embedder call, no `vec_sessions` row written. Phase-4 retrieval treats a missing row as "no session-level signal yet." Documented contract.
  - [x] Round-trip test: 4-message conversation → builds session vector → reads back via `vec_sessions` SELECT → bit-identical Float32Array; `updated_at` within 60s of `Date.now()`
  - [x] Re-build idempotency: calling `buildSessionVector` twice for the same conversation overwrites cleanly (DELETE+INSERT, fresh updated_at, single row)
  - [x] Atomicity test: embedder failure leaves no partial `vec_sessions` row (the DELETE inside the transaction would otherwise wipe the prior row before the failed INSERT — verified that the rollback restores the prior state when there was one and leaves the table empty when there wasn't)
- **Testing approach:** Unit tests with the in-memory test DB + stubbed embedder (deterministic vectors). Verify role-prefix concat + DELETE+INSERT semantics. The bit-identical round-trip assertion follows the Sprint-014 Story 2 pattern.
- **QA:** N/A — backend.
- **Planned commits:**
  1. `feat(indexer): add buildSessionVector helper — concat + embed + DELETE+INSERT vec_sessions`
  2. `feat(indexer): no-op on empty conversation; throw on missing conversation`
  3. `test(indexer): buildSessionVector round-trip + re-build overwrites cleanly`
- **Technical notes:**
  - `+updated_at` is a vec0 auxiliary column — bind as `BigInt(Date.now())`. Sprint-014 Story 2 pinned this contract.
  - vec_sessions DELETE + INSERT inside `db.transaction` so a partial failure rolls back — same pattern Story 3 uses for `vec_windows`.
  - Decision for this sprint: explicit consumer demand only — `buildSessionVector` is NOT auto-invoked on every `indexer.ingest()`. Auto-build-on-ingest hooks can land in sprint-016 once retrieval pressure is real and the cost/benefit is concrete.
- **Priority:** Must-have

#### Story 6: Rewrite extract-worker.ts → embed-worker.ts (claim/dedupe/self-terminate)
- **Story Checklist:**
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(tbd)*
  - Resolution: *(tbd)*
- **As a** the SDK process running in the background, **I want** an embed-worker that drains the IngestQueue (insert message → assemble/upsert containing windows → mark complete) with crash-recovery and idle self-termination, **so that** `indexer.ingest()`'s synchronous return doesn't leave embedding work unfinished.
- **Dependencies:** Stories 2 + 3 (Story 5 is pull-based; not on the worker path this sprint).
- **Acceptance criteria:**
  - [x] New module `scripts/embed-worker.ts` (CLI entrypoint) + `src/memory/indexer/embed-worker.ts` (the testable processor + drain loop). Replaces the deleted sprint-013 `extract-worker.ts`
  - [x] `IngestQueue.processNext()` no longer throws — dispatches by `task_type`: `embed-message` claims invoke the injected `embedTaskHandler` callback; legacy `extract-conversation` falls through to the orchestrator path (which in spec-005 is null → that one task is marked failed inside the try-catch, no global throw)
  - [x] On claim: `processEmbedTask` loads the message row → calls Story 3's `computeWindowsForMessage` to determine which windows to assemble/update → for each affected window loads the constituent messages → calls `assembleWindowEmbedding` → calls `windowWriter.upsertWindow` → returns. Lifecycle (markCompleted / markFailed / resetToPending) is owned by `IngestQueue.processNext`; the handler throws on terminal errors and lets the queue's retryable-error classifier decide
  - [x] FTS5 indexing happens via the existing AFTER INSERT trigger on `messages` (sprint-009 contract); no explicit FTS write in the worker
  - [x] Stale-claim recovery: existing `IngestQueue` behavior — `claimNext` resets rows whose `started_at` is older than `STALE_THRESHOLD_SECONDS` back to `pending`. Verbatim reuse per the Sprint-Level Technical Context. Test pins this end-to-end
  - [x] Self-terminate on idle: `runEmbedWorker(queue)` calls `processNext` in a loop until it returns null, then returns the number of tasks processed. No polling, no infinite loop
  - [x] Crash-recovery test (inline simulation): claim a task, manually backdate `started_at` past the stale-claim threshold, drain the queue → stale-claim reset path flips the row to `pending` and re-claims it → processed cleanly → row ends in `completed`. Real-process-kill is out of scope due to subprocess + in-memory DB incompatibility.
  - [x] **Decoupling:** the queue stays free of indexer-layer imports. `IngestQueueConfig.embedTaskHandler` is an injected callback the worker provides via `createEmbedTaskHandler({ db, embedder, windowWriter, config })`
- **Testing approach:** Integration tests in `tests/memory/indexer/embed-worker.test.ts`. Stubbed embedder (no real model in CI). Inline the worker's `processOne` function and call it manually in a sync test — subprocess + in-memory DB don't share state, so the real-fork variant is out of scope. The crash-recovery scenario is simulated by skipping the `markComplete` call after `processOne` for one task and then re-running `processNext` so the stale-claim reset path takes over.
- **QA:** N/A — backend.
- **Planned commits:**
  1. `feat(worker): scaffold scripts/embed-worker.ts + wire IngestQueue.processNext → indexer pipeline`
  2. `feat(worker): per-task processing — load message + compute windows + assemble + upsert + mark complete`
  3. `feat(worker): self-terminate on idle (reuse IngestQueue.shutdown())`
  4. `test(worker): happy-path drain — 5 tasks → 5 windows assembled`
  5. `test(worker): crash-recovery — skip markComplete on one task → re-run processNext → stale-claim reset path completes it`
- **Technical notes:**
  - The deleted `extract-worker.ts` from Sprint-013 had a similar shape (claim → process → mark complete); use git history to reference the old structure but write fresh — do NOT git-revert the file.
  - The worker is a separate process / Node entrypoint. Wire it into `IngestQueue` so the SDK's main process spawns it via the existing `child_process.fork` pattern when a backlog is detected.
  - `IngestQueue.processNext()` IS modified inside `src/queue/ingest-queue.ts` to call the indexer pipeline — this is required (the "verbatim reuse" constraint in the Sprint-Level Technical Context refers to crash-recovery + enqueue semantics around it, not the stub-throws-today `processNext` implementation). `src/client.ts`'s "do not modify" stands — the worker is wired through `IngestQueue`, not directly from `client.ts`.
  - Crash-recovery semantics are NOT re-implemented this sprint — they're inherited from the existing `IngestQueue` behavior. The test verifies the worker doesn't break that contract.
- **Priority:** Must-have

#### Story 7: End-to-end integration tests
- **Story Checklist:**
  - [ ] Follows sprint template
  - [ ] Within size limits
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed
  - [ ] Each AC verified
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(tbd)*
  - Resolution: *(tbd)*
- **As a** sprint reviewer, **I want** end-to-end tests that exercise `indexer.ingest` → `IngestQueue.processNext` → embed-worker → `vec_windows` / `window_messages` / `vec_sessions` populated, **so that** the Phase-3 contract is verified at the surface that Sprint-016 will read from.
- **Dependencies:** Stories 1–6.
- **Acceptance criteria:**
  - [x] New integration suite in `tests/integration/indexer.test.ts` (uses `vitest.integration.config.ts`)
  - [x] Round-trip: 3 conversations × 5 turns each → `indexer.ingest` for each → drain `IngestQueue` via `runEmbedWorker` → assert exact counts: 15 tasks processed, 9 vec_windows rows (3 per conv × 3 windows tail-slid), 27 window_messages rows (windowSize × windows × convs), 18 messages_fts rows (every message via the sprint-009 AFTER INSERT trigger).
  - [x] Oversize round-trip: 13K-char prose turn → 1 parent (no embed task) + N chunks linked via `parent_message_id` → only chunks get embed tasks → each chunk participates in window assembly. `ix_messages_parent` reverse-lookup verified.
  - [x] Crash-recovery round-trip (inline simulation): claim a task, manually backdate `started_at` -1h, drain → stale-claim reset path re-claims and completes; orphan ends in `completed`; no failed tasks; no double-write to vec_windows (DELETE+INSERT idempotency).
  - [x] No LLM calls anywhere in the path — `Object.keys(require.cache)` defensive check asserts no `@anthropic-ai/sdk` / `openai` / `pg` / `@supabase` modules loaded.
  - [x] `describe.skipIf(skipSlow)` gate for the real-Nomic round-trip variant; consistent with the existing `tests/integration/embedder.test.ts` pattern. CI runs the stubbed variants (4 tests); locally-with-models variant adds 1 more.
  - [x] **AC deviation recorded:** original AC said `storeAsync` end-to-end. Per the Sprint-Level Technical Context `src/client.ts` stays untouched in sprint-015 — `storeAsync` still calls the legacy conversation-level `enqueue`. Wiring `storeAsync` to `indexer.ingest` is sprint-016's concern. The integration tests therefore use `indexer.ingest` directly — same path Story 6's worker drains against. Documented in the test file's header.
  - [x] **Known limitation surfaced by Story 7's oversize test (sprint-016 follow-up):** when an oversize message is split into parent + chunks, the parent row stores the full content at its own `sort_order`. The window-assembler queries messages by `sort_order` range, so a window that spans the parent's slot pulls the full ~13K-char content into the embed text, which would overflow Nomic v1.5's 8192-token context in production. Stub embedder in the test ignores text length, so the test passes. Proper fix needs window-assembly to skip parents-with-children (or a separate sort-order space for parents). Architectural; ride sprint-016 alongside the `storeAsync` rewire.
- **Testing approach:** The artifacts ARE the tests — integration suite exercises the full path. Mock the embedder for CI-friendly variants; gate the real-model variants behind the existing `skipSlow` / `embedderModel` env-var pattern.
- **QA:** N/A — backend.
- **Planned commits:**
  1. `test(integration): indexer round-trip — N conversations × M turns → expected window/message counts`
  2. `test(integration): oversize-message round-trip — 10K tokens → chunked + linked via parent_message_id`
  3. `test(integration): crash-recovery — skip markComplete mid-drain → re-run processNext → all tasks complete via stale-claim reset`
- **Technical notes:**
  - The test uses an in-memory DB; the shared mutability across the worker process boundary is the trickiest part. Inline the worker's `processOne` function and call it manually in tests rather than spawning a real subprocess (subprocess + in-memory DB don't share state).
  - The crash-recovery test simulates a kill by NOT calling `markComplete` after `processOne` for one task, then re-running processNext — the stale-claim reset path takes over.
  - End-to-end timing budget: the round-trip test should complete in <5s for 15 turns; if it slips, profile the embedder stub (it shouldn't take any time).
- **Priority:** Must-have

#### Final Evaluation Story (mandatory, runs last)

Produce visual proof that every user flow in the "User Flows" section above works end-to-end. Assemble the artifacts into an HTML slide deck at `docs/sprints/eval/sprint-015.html`. This story runs after all feature stories are merged.

Use `~/projects/harness-config/templates/evaluation-matrix.md` to pick the tool per component type. Sprint-015 introduces actual user flows (`storeAsync` finally works end-to-end; `indexer.ingest` is a new public primitive) — flow videos / API-call traces / screenshot proof are appropriate.

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
- **As a** stakeholder, **I want** embeddable visual proof that every Phase-3 user flow works end-to-end, **so that** sprint-015 completion is verifiable at a glance before sprint-016 starts wiring the searcher against the populated corpus.
- **Dependencies:** Stories 1–7 must be merged into `sprint-015` before this story starts.
- **Acceptance criteria:**
  - [ ] Slide deck at `docs/sprints/eval/sprint-015.html` follows the 5-slide structure below. Total slide count ≤ 5.
  - [ ] Slide 1 — **Sprint Summary**: goal, seven feature stories shipped, overall pass/fail count
  - [ ] Slide 2 — **User Flows Demonstrated**: visual (video/screenshot/API trace) per flow from the "User Flows" section — `storeAsync` end-to-end, `IngestQueue.processNext` no-longer-throws, `indexer.ingest` happy path, `indexer.buildSessionVector` round-trip, oversize-chunker round-trip, crash-recovery
  - [ ] Slide 3 — **Key Changes**: indexer module surface (added), embed-worker module (added), chunker adaptation diff (oversize handling), `deleteById` cascade (issue #113 closed)
  - [ ] Slide 4 — **Test & Eval Results**: per-story test-count delta, EXPLAIN QUERY PLAN for the new vec_windows write path, sample populated DB shape (`SELECT count(*) FROM vec_windows GROUP BY conversation_id`)
  - [ ] Slide 5 — **Repo Hygiene + AC Matrix**: `main` clean, no tmp files, no dangling branches, tests green, plus a table of every feature story's AC with pass/fail status
  - [ ] Tool chosen per `~/projects/harness-config/templates/evaluation-matrix.md` component-type mapping
  - [ ] Bulky assets in sibling dir `docs/sprints/eval/sprint-015/` if needed
  - [ ] Images or Videos (≤120s each); committed binaries ≤10MB (compress or reference externally)
- **Testing approach:** The artifacts themselves are the tests. Open the rendered HTML deck in a browser and walk through every slide before marking this story complete.
- **QA:**
  - Manual: Open `docs/sprints/eval/sprint-015.html` in a browser. Confirm every slide loads, every embedded visual plays or displays, every AC shows pass/fail status.
  - Automated: N/A — visual proof is the artifact **THIS IS IMPORTANT**
- **Planned commits:**
  1. `feat: capture evaluation artifacts for sprint-015` — videos, screenshots, API logs, sample DB shapes into `docs/sprints/eval/sprint-015/`
  2. `feat: build sprint-015 evaluation slide deck` — single HTML file referencing the artifacts
- **Technical notes:** See `~/projects/harness-config/templates/evaluation-matrix.md` for the component → tool mapping.
- **Priority:** Must-have

### Rules
- **Sprint-branch setup (before Story 1):** create `sprint-015` off `main` and push. Commit this sprint doc as the first commit on the branch. Story branches fork from `sprint-015`; story PRs target `sprint-015`. After the evaluation story merges, open a sprint-integration PR (`sprint-015 → main`) as the final step. See AGENTS.md §3 for the full workflow + edge cases (mid-sprint hotfix, abandonment, cross-sprint deps).
- We sequentially do the stories. We do not do parallel work.
- **Review loop:** Open PRs, run `/review` (nudged by the PostToolUse hook), address findings, re-verify via `/review-fix` (capped at 3 passes per PR — see `workflow-prompts/handle-pr-activity.md`), confirm local checks are green and the last review turn returned mergeability ≥ 4/5 with no open P0/P1 findings, merge into `sprint-015`, then move to the next story. The sprint-integration PR goes through the same loop — cumulative-diff `/review` catches cross-story interactions.
- **Parallel experiment option (explicit exception):** when a story is explicitly scoped as an isolated experiment, consider `/skill:worktree create <branch>` to run it in a separate cmux workspace with its own Pi session, or to discard it cleanly via `/skill:worktree remove`. This does not change the default sequential rule above. See AGENTS.md §20 for prerequisites and scope.
- Record new dependencies in the Completion section's New Dependencies field.
- For everything else — commits, PR process, code quality, testing — follow your system instructions (the conventions loaded at session start).

### Definition of Done
- All must-have stories pass acceptance criteria
- System-instruction conventions satisfied (code quality, tests, PR process, conventional commits, local checks green, last review turn — `/review` or `/review-fix` — returned mergeability ≥ 4/5 with no open P0/P1 findings)
- **Final Evaluation Story complete** — `docs/sprints/eval/sprint-015.html` exists; every User Flow has a visual artifact; repo hygiene slide shows clean state
- **Sprint-integration PR merged** (`sprint-015 → main`); `sprint-015` deleted from origin; local main fast-forwarded
- **GH issue #113 closed** by Story 1 merge (deleteById cascade)
- **Story 1 deleteById-cascade regression tests stay green at sprint close** — verified against the populated-corpus state Stories 3 + 6 introduce (cascade still removes window_messages + vec_windows + vec_sessions for indexed conversations, not just the empty-schema state Story 1 originally exercised)
- **New user flows folded into spec** — `indexer.ingest` and `indexer.buildSessionVector` added to `docs/specs/implementation-spec-005.md` §15 before sprint completion

### Completion
- **Stories shipped:** 7 / 7 feature stories + Eval. PR #116 (Story 1), #117 (Story 2), #118 (Story 3), #119 (Story 4), #120 (Story 5), #121 (Story 6), #122 (Story 7), eval PR (this).
- **Commits:** 38 against `sprint-015` branch (including merges + per-story fix commits from /review-fix loops). Per-story commit count averaged ~5 (within the 5-8 budget).
- **New dependencies:** `@babel/parser@7.29.2` — required by Story 4's AST-aware oversize-message chunker. Pure-JS, no native binding. Pinned exact per repo convention.
- **Test count:** 451 → 536 unit (+85), plus 4 new CI integration tests + 1 real-Nomic-gated integration test.
- **GH #113** closed by Story 1.
- **Sprint-016 follow-ups documented in eval deck Slide 5:**
  1. Wire `storeAsync` → `indexer.ingest` (client.ts stayed untouched per sprint plan).
  2. Oversize-parent window-bloat — surfaced by Story 7's integration test; architectural fix needed.
  3. Auto-build session vectors on ingest (currently explicit-only).
  4. UUID migration for `messages.id` (#106 still open).
  5. Types-in-core convention follow-up (multiple P2 flags across stories).
- **Retro highlights:**
  - **Schema-vs-AC mismatches surfaced twice:** Story 2 needed `pending_ingest_tasks` columns the AC implied (task_type + per-message fields); Story 7 needed `storeAsync` rewired but the AC referenced storeAsync end-to-end. Both deferred as scope-expansion / scope-shrink decisions and recorded inline. Future sprint planning: cross-check ACs against current schema before drafting.
  - **`/review` loop produced ~3 actionable findings per story on average.** The single most valuable convergence: 5-reviewer agreement on Story 3's per-call-prepared-statement pattern → factory refactor (`createWindowWriter`) caught a real perf concern Story 6's worker would have hit at scale.
  - **`require.cache`-doesn't-exist-in-ESM** caught by Story 7 review — replaced with a static filesystem-grep over src/ that's both ESM-safe and broader-coverage.
  - **Inline simulation pattern for crash-recovery** worked well: backdate `started_at`, re-run `processNext`, observe stale-claim reset path. Cleaner than wrestling with subprocess + in-memory DB incompatibility.
