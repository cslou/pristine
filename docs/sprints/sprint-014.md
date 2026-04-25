# Pristine — Sprint 014
**Date:** 2026-04-24 – TBD
**Goal:** Execute §16 Phase 2 of spec-005 — extend the existing `ConversationStore` schema (Sprint 009) with the corpus-storage primitives (project scoping, oversize-chunk linkage, sliding-window + session vector indexes, summaries, public views, plus mutator/reader methods) that Phase 3's indexer and Phase 4's searcher will consume.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `~/projects/pristine` (getlou-gh/pristine)
- **Tech stack:** TypeScript strict / ESM / Node 20+ / better-sqlite3 / sqlite-vec / FTS5 / Nomic Embed v1.5 via `@huggingface/transformers` / Vitest
- **Current state:** sprint-013 (spec-005 Phase 1) just merged to `main`. The SDK surface is pruned to corpus + privacy + queue: `PristineLocal.create()` / `createLite()`, `storeAsync()`, `searchConversations()`, `getConversation()`, and the privacy triad. `src/memory/` contains only `orchestrator/chunker.ts` and `retriever/ranking.ts` — both doc-commented as Phase-3 / Phase-4 reuse targets. `IngestQueue.processNext()` currently throws because `orchestrator` is null on every construction path; this sprint does not wire it back up (that's Phase 3).
- **Implementation spec:** `docs/specs/implementation-spec-005.md` — this sprint executes **§16 Phase 2** (stories P2-S1 through P2-S6), consolidated here into four feature stories plus the mandatory evaluation story.

### Sprint-Level Technical Context
- **Schema-first sprint.** Stories 1–3 are additive DDL. Story 4 introduces the first method surface (`addMessage`, `addSummary`, `getRecentSummaries`) — no `src/memory/` runtime files should be added in this sprint. The indexer module lands in sprint-015 (Phase 3).
- **What stays untouched (do not modify):** `src/client.ts`, `src/core/*`, `src/embedder/*`, `src/engine/*`, `src/queue/ingest-queue.ts`, `src/privacy/*`, `src/memory/orchestrator/chunker.ts`, `src/memory/retriever/ranking.ts`. The Sprint-009 `conversations` / `messages` / `messages_fts` tables + their FTS5 triggers must be preserved verbatim — this phase extends the schema *additively*.
- **Migration safety.** Every DDL change must apply cleanly on a Sprint-009-era database (a user's existing `.pristine/data/pristine.db`). Use `ALTER TABLE ... ADD COLUMN` guarded by `PRAGMA table_info`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE VIEW IF NOT EXISTS`. No destructive operations — `DROP TABLE`, `ALTER COLUMN`, and `RENAME COLUMN` are forbidden by the safety-guard extension anyway.
- **Known deviations from spec §12 (explicit, not drift):**
  1. **`messages.id` stays `INTEGER AUTOINCREMENT`.** Spec §12 writes `id TEXT PRIMARY KEY` (UUID). Migrating that column in this sprint would force a full rowid rewrite + break the Sprint-009 FTS5 content-table rowid linkage. Decision: keep INTEGER in sprint-014 and in every FK that references it (`window_messages.message_id INTEGER`, future indexer writes). A follow-up backlog issue will track the TEXT migration for a later, isolated sprint when Phase-3/4 callers are built and know whether they actually need UUIDs.
  2. **`conversations.started_at` is view-aliased from `created_at` with type cast.** Spec §12 types `started_at INTEGER` (unix milliseconds). The physical Sprint-009 column is `created_at TEXT` (ISO string via `datetime('now')`). `conversations_public` casts to milliseconds so Phase-4 range filters work against integer-timestamp comparisons: `CAST(strftime('%s', created_at) * 1000 AS INTEGER) AS started_at`. Physical column unchanged.
  3. **`messages.turn_index` is view-aliased from `sort_order`.** Same pattern as above, but `sort_order` is already INTEGER — no cast needed. Physical column stays `sort_order`; `messages_public` aliases it.
  4. **`messages.timestamp`** — Sprint-009 writes TEXT here as well. `messages_public.timestamp` must apply the same `CAST(strftime('%s', timestamp) * 1000 AS INTEGER)` transform for Phase-4 range-filter compatibility. Physical column unchanged.
- **Privacy view invariant (critical).** Public views must exclude `metadata` and `parent_message_id` columns per spec §12. This is the consumer contract for the Phase-5 SQL primitive; a test must pin the view's column list so an accidental `SELECT *` future refactor doesn't leak them.
- **No new dependencies.** `better-sqlite3` + `sqlite-vec` only — the extension is already loaded by `src/core/database.ts` on DB boot.
- **Test count budget.** Pre-sprint: 413 unit / 446 e2e. Expected post-sprint: +30–50 unit tests covering migration idempotency, new column defaults, view column filtering, method behavior. No test decreases expected — we are extending, not removing.

### User Flows

**None — sprint-014 is a pure-schema infrastructure sprint.** No user-facing flows ship. The indexer primitive (sprint-015 / Phase 3) is the first phase that surfaces a new user flow (`indexer.ingest(...)`); the searcher (sprint-016 / Phase 4) adds the retrieval flow. This sprint's job is exclusively to have the DDL + helper methods in place before those primitives land.

- **Affected (existing):** None in spec-005 §15. The existing `storeAsync → searchConversations → getConversation` path runs on the Sprint-009 schema; this sprint adds columns, indexes, virtual tables, and views without touching their behavior.
- **New (this sprint):** None.

### Stories
**Constraints:** Target 5–8 stories per sprint; 5–8 commits per story.

#### Story 1: Extend messages + conversations columns (project_id, parent_message_id, supporting indexes)
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
- **As a** SDK consumer, **I want** conversations and messages to carry explicit `project_id` scope and a `parent_message_id` link for oversize-message chunks, **so that** future searcher calls can filter retrieval by project without cross-workspace bleed-through and Phase-3 chunking can preserve parent→child linkage.
- **Dependencies:** None
- **Acceptance criteria:**
  - [ ] `conversations` gains `project_id TEXT NOT NULL` — back-filled from `user_id` on migration with empty-string fallback: `COALESCE(NULLIF(user_id, ''), 'default')`
  - [ ] `messages` gains `project_id TEXT NOT NULL` mirroring the conversation scope (denormalized for filter-first vector search per spec §16 Phase 4)
  - [ ] `messages` gains `parent_message_id INTEGER NULL` (matches the INTEGER id convention; NULL for non-chunk rows, which is the default case)
  - [ ] Index `CREATE INDEX IF NOT EXISTS ix_conversations_project_started ON conversations(project_id, created_at DESC)` — per spec §12 (view aliases `created_at` as `started_at`)
  - [ ] Index `CREATE INDEX IF NOT EXISTS ix_messages_conv_sort ON messages(conversation_id, sort_order)` — per spec §12 `messages(conversation_id, turn_index)`; references the physical column name
  - [ ] Partial index `CREATE INDEX IF NOT EXISTS ix_messages_timestamp_nonchunk ON messages(timestamp DESC) WHERE parent_message_id IS NULL` — per spec §12
  - [ ] Index `CREATE INDEX IF NOT EXISTS ix_messages_parent ON messages(parent_message_id)` — for Phase-4 parent-resolution
  - [ ] Migration idempotent (re-run produces no error, no duplicate columns, no duplicate indexes) — guarded by `PRAGMA table_info` for ADD COLUMN and `IF NOT EXISTS` for indexes
  - [ ] `ConversationStore` init calls `db.pragma('foreign_keys = ON')` so Story 2's `window_messages` FK is actually enforced (better-sqlite3 defaults it OFF per connection — without this, FK violations fail silently)
  - [ ] Existing Sprint-009 tests pass unchanged — zero regressions on `addConversation` / `getConversation` / `searchConversations`
  - [ ] New unit tests: project_id back-fill from user_id (happy path + empty-string → 'default' fallback); parent_message_id defaults to NULL on normal `addConversation`; each new index present in `sqlite_master`; `PRAGMA foreign_keys` returns 1 after store init
- **Testing approach:** New unit tests in `tests/conversations/store.test.ts`:
  - Migration idempotency: call `new ConversationStore(db)` twice on a seeded DB; no error, no schema drift
  - Back-fill: seed a legacy row with `user_id = 'u-legacy'` before migration; confirm `project_id = 'u-legacy'` after; seed `user_id = ''`; confirm `project_id = 'default'`
  - Column defaults: `addConversation` still writes `parent_message_id = NULL` on each message (no behavior change)
  - Index presence: query `sqlite_master` for each of the four new indexes
  - Existing tests run untouched — the additive columns + indexes must not alter `searchConversations` / FTS5 behavior
- **QA:** N/A — schema change, no UI.
- **Planned commits:**
  1. `feat(store): enable PRAGMA foreign_keys = ON in ConversationStore init` — lands first so Story 2's FK is enforced from day one
  2. `feat(store): add project_id column + back-fill migration to conversations`
  3. `feat(store): add project_id column + back-fill migration to messages` — denormalized from the parent conversation
  4. `feat(store): add parent_message_id column to messages (nullable, INTEGER to match id type)`
  5. `feat(store): add conversations + messages indexes per spec §12` — the four `CREATE INDEX IF NOT EXISTS` statements in one DDL block
  6. `test(store): cover FK enforcement, project_id + parent_message_id migration idempotency, back-fill, and spec §12 index presence`
- **Technical notes:**
  - Use `PRAGMA table_info(conversations)` and `PRAGMA table_info(messages)` to detect already-migrated schemas before issuing ADD COLUMN — SQLite will error on duplicate-column if you don't guard.
  - **SQLite forbids `ADD COLUMN ... NOT NULL` without a `DEFAULT`** at DDL-parse time — it's not a runtime check, the `ALTER TABLE` statement itself rejects. Use this pattern:
    1. `ALTER TABLE conversations ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'` — establishes the column with the NOT NULL invariant satisfiable via the literal default
    2. `UPDATE conversations SET project_id = COALESCE(NULLIF(user_id, ''), 'default')` — back-fill from user_id, keep 'default' as the fallback sentinel for empty-string legacy rows
    3. No second `ALTER` needed — the NOT NULL constraint is already in place from step 1
  - Same pattern for `messages.project_id`, but the back-fill step reads from the parent conversation instead of `user_id`: `UPDATE messages SET project_id = (SELECT project_id FROM conversations WHERE conversations.id = messages.conversation_id) WHERE project_id = 'default'`. Denormalizes the scope so Phase-4 filter-first vector search doesn't need the join on every query.
  - `parent_message_id` is nullable so no default needed.
  - **Enable FK enforcement**: add `db.pragma('foreign_keys = ON')` at the top of `ConversationStore`'s constructor (or inside `initConversationTables(db)`). better-sqlite3 defaults the pragma to OFF per connection, which would silently disable the `window_messages.message_id → messages.id` FK that Story 2 provisions.
  - Consumers that want multi-project-per-user scoping will need to re-assign `project_id` post-migration — document in the migration commit message.
  - Spec §12 uses the column names `turn_index` and `started_at`; the physical columns stay `sort_order` and `created_at` (Sprint-009 shape). View aliases land in Story 3.
- **Priority:** Must-have

#### Story 2: Add vec_windows + window_messages + vec_sessions virtual tables
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
- **As a** future indexer, **I want** the sliding-window primary semantic index plus a whole-session secondary index in place, **so that** Phase-3 per-message-embed writes have a target and Phase-4 hybrid retrieval has both a fine-grained and a coarse-grained vector source per spec-005 §0.2.
- **Dependencies:** Story 1 (project_id column must land first so any later filter-first joins through `conversations` resolve correctly)
- **Acceptance criteria:**
  - [ ] `vec_windows` virtual table exists, created via sqlite-vec vec0 with constructor form: `CREATE VIRTUAL TABLE IF NOT EXISTS vec_windows USING vec0(conversation_id TEXT, window_index INTEGER, embedding float[768])` — the `float[768]` is the sqlite-vec vec0 typed-column syntax for a 768-d vector; spec §12's `BLOB` shorthand is satisfied by vec0's internal BLOB-in-row representation
  - [ ] `window_messages` regular join table exists: `(conversation_id TEXT NOT NULL, window_index INTEGER NOT NULL, message_id INTEGER NOT NULL REFERENCES messages(id), position INTEGER NOT NULL, PRIMARY KEY (conversation_id, window_index, message_id))` — NB: `message_id INTEGER` to match the INTEGER id decision in sprint tech context
  - [ ] `vec_sessions` virtual table exists: `CREATE VIRTUAL TABLE IF NOT EXISTS vec_sessions USING vec0(conversation_id TEXT PRIMARY KEY, embedding float[768], +updated_at INTEGER)` — the `+` prefix marks `updated_at` as a vec0 **auxiliary** (non-vector) column; vec0 auxiliary columns do not accept `NOT NULL`/`CHECK`/`DEFAULT` constraints at DDL, so the non-null invariant is enforced at the write-helper layer (deferred to sprint-015). No `project_id` column per spec §12; Phase-4 filters sessions via a pre-query join on `conversations.project_id`.
  - [ ] End-to-end round-trip test: insert a 768-element Float32Array embedding, read it back, confirm bit-identical return
  - [ ] `INSERT OR REPLACE` semantics test: write same `(conversation_id, window_index)` twice with different embeddings; second write wins; same for `vec_sessions.conversation_id`
  - [ ] `window_messages` FK rejects an insert whose `message_id` doesn't exist in `messages` (once FK enforcement is confirmed on via `PRAGMA foreign_keys`)
  - [ ] Migration idempotent
- **Testing approach:** New unit tests in `tests/conversations/store.test.ts`:
  - Virtual-table existence via `sqlite_master` query
  - Round-trip: bind embedding via `vec_f32(?)` (sqlite-vec binding function), read back, compare
  - `INSERT OR REPLACE` wins the second write
  - FK integrity — confirm `PRAGMA foreign_keys = ON` and an orphan insert throws
  - Dimension validation: insert a non-768-dim vector and confirm sqlite-vec rejects it (this pins the dim=768 invariant at schema level, not application level)
- **QA:** N/A — schema change.
- **Planned commits:**
  1. `feat(store): add vec_windows virtual table (sqlite-vec vec0, 768-d embeddings)` — DDL via the exact vec0 constructor form
  2. `feat(store): add window_messages join table with INTEGER message_id FK`
  3. `feat(store): add vec_sessions virtual table (whole-conversation secondary index)`
  4. `test(store): round-trip embeddings through vec_windows + vec_sessions + dim=768 guard`
  5. `test(store): window_messages FK rejects orphan message_id`
- **Technical notes:**
  - The `sqlite-vec` extension is already loaded by `src/core/database.ts` for the Sprint-009 DB boot — grep-verify before starting.
  - Write helpers (`addWindow`, `addSessionVector`) are deferred to sprint-015 (Phase 3 indexer); this story only provisions tables.
  - **vec0 auxiliary columns use the `+` prefix**, not standard SQL column syntax. `+updated_at INTEGER` declares `updated_at` as a stored auxiliary (non-vector) column. vec0 does **not** accept `NOT NULL`, `CHECK`, or `DEFAULT` on auxiliary columns at DDL time — trying to declare them errors or is silently dropped. Enforce non-null at the write-helper layer in sprint-015.
  - sqlite-vec vec0 tables do support `INSERT OR REPLACE` on the declared composite PK. If the exact behavior differs from a regular table in your sqlite-vec version, fall back to `DELETE THEN INSERT` inside a transaction — verify via the round-trip test.
  - `window_messages.message_id INTEGER` is deliberate (see sprint tech context — known deviation #1). Phase-3 writes and Phase-4 resolution both use INTEGER rowids.
  - `PRAGMA foreign_keys` is turned ON by Story 1's init commit — Story 2's FK-rejection test depends on that. If Story 2 starts and the test passes too easily, first confirm `db.pragma('foreign_keys')` returns `1`.
- **Priority:** Must-have

#### Story 3: Add public views — messages_public + conversations_public (summaries_public lands in Story 4 with the underlying table)
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
- **As a** Phase-5 SQL-primitive consumer, **I want** a stable view surface that aliases internal column names (`sort_order → turn_index`, `created_at → started_at`) and excludes private fields (`metadata`, `parent_message_id`), **so that** the Phase-5 scoped-read-only SQL layer can expose safe columns without plumbing sensitive fields downstream.
- **Dependencies:** Story 1 (project_id + parent_message_id columns must exist). This story ships only `messages_public` + `conversations_public` — `summaries_public` lands in Story 4 alongside the `summaries` table (a view on a nonexistent table would fail at DDL time).
- **Acceptance criteria:**
  - [ ] `messages_public` view exists with exactly `(id, conversation_id, turn_index, role, content, timestamp, project_id)` — `turn_index` aliased from `sort_order`; `timestamp` cast to unix milliseconds via `CAST(strftime('%s', timestamp) * 1000 AS INTEGER) AS timestamp`; no `metadata`, no `parent_message_id`
  - [ ] `conversations_public` view exists with exactly `(id, project_id, started_at)` — `started_at` cast from `created_at` via `CAST(strftime('%s', created_at) * 1000 AS INTEGER) AS started_at` (spec §12 types it INTEGER unix-ms); no `user_id`, no `content_hash`, no `metadata`, no `message_count`
  - [ ] **Privacy invariant test:** for each public view, `PRAGMA table_info(<view>)` returns EXACTLY the documented column set — no extras, no missing. Test fails loudly if a future refactor introduces `SELECT *` in a view definition or adds a column to the projection.
  - [ ] **Type-shape test:** `SELECT typeof(started_at) FROM conversations_public LIMIT 1` returns `'integer'` (not `'text'`); same check for `messages_public.timestamp` — confirms the milliseconds cast is live for Phase-4 range-filter compatibility
  - [ ] Views use `CREATE VIEW IF NOT EXISTS <name> (col1, col2, ...) AS SELECT ...` form — explicit column list keeps the contract stable even if the underlying SELECT grows
  - [ ] Round-trip test: insert a conversation + messages; confirm each row is visible in the corresponding public view with aliased column values correct (milliseconds-integer equals the expected epoch of the seed timestamp)
  - [ ] Migration idempotent (re-run does not drop-and-recreate; preserves any consumer-side view dependencies)
- **Testing approach:** Column-list snapshot tests per view — the privacy invariant; round-trip data test via `addConversation` + public-view read; idempotency check on re-init.
- **QA:** N/A — schema change.
- **Planned commits:**
  1. `feat(store): add messages_public view aliasing sort_order AS turn_index`
  2. `feat(store): add conversations_public view aliasing created_at AS started_at`
  3. `test(store): pin public-view column sets (privacy invariant)`
  4. `test(store): round-trip addConversation data through public views`
- **Technical notes:**
  - SQLite view column-list declarations with timestamp-cast:
    ```sql
    CREATE VIEW IF NOT EXISTS messages_public (id, conversation_id, turn_index, role, content, timestamp, project_id) AS
      SELECT id, conversation_id, sort_order AS turn_index, role, content,
             CAST(strftime('%s', timestamp) * 1000 AS INTEGER) AS timestamp,
             project_id
      FROM messages;

    CREATE VIEW IF NOT EXISTS conversations_public (id, project_id, started_at) AS
      SELECT id, project_id,
             CAST(strftime('%s', created_at) * 1000 AS INTEGER) AS started_at
      FROM conversations;
    ```
  - `strftime('%s', ...)` returns unix seconds; multiply by 1000 for milliseconds. This pairs with Phase-4's expected integer-millisecond filter format.
  - `summaries_public` lands in Story 4 alongside the `summaries` table — otherwise the view definition fails on the nonexistent table.
  - The privacy-invariant test reads view metadata via `PRAGMA table_info(messages_public)` — `table_info` works on views as well as tables in SQLite.
- **Priority:** Must-have

#### Story 4: Add summaries table + ConversationStore API surface (addMessage, addSummary, getRecentSummaries, summaries_public view)
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
- **As a** future indexer (sprint-015) and future reference summary-generator (Phase 5), **I want** (a) append-a-single-message + (b) write-and-read-back-summary methods on `ConversationStore` + the `summaries` table that backs them, **so that** Phase-3's sliding-window ingest and Phase-5's summary-injection flows have a concrete API without rolling their own SQL.
- **Dependencies:** Stories 1 + 2 (project_id column must exist; vec_windows not directly required but by-then all sprint schema is complete). Story 3 precedes this one for the two views already shipped.
- **Acceptance criteria:**
  - [ ] `summaries` table created with schema `(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, project_id TEXT NOT NULL, text TEXT NOT NULL, timestamp INTEGER NOT NULL, metadata TEXT)` — per spec §12
  - [ ] Index `CREATE INDEX IF NOT EXISTS ix_summaries_project_time ON summaries(project_id, timestamp DESC)` — per spec §12
  - [ ] `summaries_public` view exists with exactly `(id, session_id, project_id, text, timestamp)` — no `metadata`; privacy-invariant column-pin test included
  - [ ] `addMessage(conversationId, { role, content, timestamp, parentMessageId?, metadata? })` appends a row. **Project scope is read from the parent conversation row, NOT supplied by the caller** — prevents cross-project contamination. If the conversation doesn't exist, throws `ConversationNotFoundError` (new typed error in `src/core/errors.ts` extending `AppError`; add a named class rather than reusing the existing `IngestQueueError` since the concern is distinct).
  - [ ] `addMessage` computes `sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM messages WHERE conversation_id = ?)` atomically inside a `db.transaction(...)` — the SELECT+INSERT pair is serialized at the SQLite level; concurrent appends from Phase-3 worker threads (not this sprint — just the invariant it establishes) produce a gapless ordinal sequence
  - [ ] `addSummary({ sessionId, projectId, text, timestamp, metadata? })` inserts into `summaries`, returns the generated id. **Rejects empty text**: `text.trim().length === 0` throws a new `InvalidArgumentError` in `src/core/errors.ts` (extends `AppError`; gives callers a targetable catch class). `projectId` here IS caller-supplied (summaries aren't attached to a specific conversation).
  - [ ] `getRecentSummaries(projectId, limit = 10)` returns rows in `timestamp DESC` order via the `ix_summaries_project_time` index — verify EXPLAIN QUERY PLAN includes "USING INDEX ix_summaries_project_time" in its output
  - [ ] Existing methods (`addConversation`, `getConversation`, `searchConversations`) unchanged in behavior — regression tests still pass
  - [ ] JSDoc on all three new methods (signatures + one-line behavior summary + "why" for `addMessage`'s atomic `sort_order` computation and project-scope-from-parent rule)
- **Testing approach:** New unit tests in `tests/conversations/store.test.ts`:
  - Summaries table existence + idempotency
  - `summaries_public` column-pin test (same privacy-invariant pattern as Story 3)
  - `addMessage` happy path: appends with correct `sort_order = N+1` after an existing conversation with N messages; the appended row's `project_id` equals the parent conversation's `project_id` (verifies the "read from parent, don't trust caller" rule)
  - `addMessage` with an unknown `conversationId` throws `ConversationNotFoundError` (never inserts)
  - `addMessage` with `parentMessageId` writes non-null into the column
  - `addMessage` sequential gapless ordinal: 10 sequential calls produce sort_order values 0..9. (better-sqlite3 is synchronous; true worker-thread concurrency lands with the Phase-3 embed-worker in sprint-015 — at that point add a proper race test. For sprint-014, pin the "transaction serializes MAX+INSERT" contract via a sequential-append ordinal test.)
  - `addSummary` happy path returns an id, row is readable via `getRecentSummaries`
  - `addSummary` with empty/whitespace-only text throws `InvalidArgumentError`
  - `getRecentSummaries(projectId, limit)` returns at most `limit` rows in `timestamp DESC` order
  - EXPLAIN QUERY PLAN assertion: `getRecentSummaries` uses `ix_summaries_project_time`
  - Regression: all existing `addConversation` / `getConversation` / `searchConversations` tests still green
- **QA:** N/A — backend only.
- **Planned commits:**
  1. `feat(errors): add ConversationNotFoundError + InvalidArgumentError to core/errors.ts` — land the typed errors before the methods that throw them
  2. `feat(store): add summaries table + index (spec §12)`
  3. `feat(store): add summaries_public view with column-pin invariant`
  4. `feat(store): add addMessage with transactional sort_order + project-scope-from-parent`
  5. `feat(store): add addSummary + getRecentSummaries (empty-text guard, recency-index query)`
  6. `test(store): cover addMessage sequential gapless sort_order + ConversationNotFoundError path + parentMessageId write`
  7. `test(store): cover addSummary empty-text rejection + getRecentSummaries EQP index usage`
- **Technical notes:**
  - `addMessage` must use `this.db.transaction(() => { ... })()` (better-sqlite3's synchronous-transaction form) so the `MAX(sort_order) + 1` → INSERT sequence is serialized at the SQLite level. The sequential-append test confirms the contract; genuine-concurrency validation arrives with sprint-015's worker-thread embed-worker.
  - `addMessage` reads `project_id` from the parent conversation inside the same transaction — `SELECT project_id FROM conversations WHERE id = ? -- throw if missing; INSERT INTO messages (..., project_id) VALUES (..., <read value>)`. The caller does **not** pass `projectId`; this prevents cross-project contamination that would be near-impossible to diagnose later.
  - `sort_order` is ordinal, not contiguous; deleting a message and later appending yields `MAX(sort_order) + 1` (gap allowed). Document this invariant in the JSDoc.
  - `addSummary` generates `id` via the existing `randomUUID()` import pattern used elsewhere in `src/conversations/store.ts`. `session_id` is a harness-provided opaque string — **no FK to `conversations` is intentional per spec §12** (multiple conversations may share a session; session lifetime is harness-scoped, not corpus-scoped).
  - `ConversationNotFoundError` and `InvalidArgumentError` are new typed errors extending `AppError` in `src/core/errors.ts`. Follows the Story-1-of-sprint-013-era pattern where each new domain concern gets its own named class rather than reusing a generic `AppError`.
  - No pagination, no soft-delete, no update-by-id in this sprint. Phase 3 and 4 will add what they need.
- **Priority:** Must-have

#### Final Evaluation Story (mandatory, runs last)

Produce visual proof that every user flow in the "User Flows" section above works end-to-end. Assemble the artifacts into an HTML slide deck at `docs/sprints/eval/sprint-014.html`. This story runs after all feature stories are merged.

Use `~/projects/harness-config/templates/evaluation-matrix.md` to pick the tool per component type. Because sprint-014 has **no user flows** (pure schema infrastructure), the deck substitutes "flow videos" with **schema-surface evidence + regression receipts** — same template the sprint-013 evaluation used (which the matrix marks as the approach for `docs/config/diff` component types).

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
- **As a** stakeholder, **I want** embeddable visual proof that Phase 2's schema extensions are in place and backwards-compatible, **so that** sprint-014 completion is verifiable at a glance before sprint-015 starts wiring the indexer against this schema.
- **Dependencies:** Stories 1–4 must be merged into `sprint-014` before this story starts.
- **Acceptance criteria:**
  - [ ] Slide deck at `docs/sprints/eval/sprint-014.html` follows the 5-slide structure below. Total slide count ≤ 5.
  - [ ] Slide 1 — **Sprint Summary**: goal, four feature stories shipped, overall pass/fail count
  - [ ] Slide 2 — **Schema Surface Demonstrated**: `npm run test:unit` + `test:e2e` + `typecheck` + `build` receipts (pre vs post-sprint counts); schema snapshot via `PRAGMA table_info` for each new/modified table + virtual table + view
  - [ ] Slide 3 — **Key Changes**: schema diagram or table summarising the new columns, tables, indexes, and views (before/after), plus an explicit "known spec §12 deviations" callout (messages.id INTEGER, created_at/sort_order view aliases)
  - [ ] Slide 4 — **Test & Eval Results**: per-story test-count delta, pinned public-view column-list evidence, EXPLAIN QUERY PLAN output for the recency query
  - [ ] Slide 5 — **Repo Hygiene + AC Matrix**: `main` clean, no tmp files, no dangling branches, tests green, plus a table of every feature story's AC with pass/fail status
  - [ ] Tool chosen per `~/projects/harness-config/templates/evaluation-matrix.md` component-type mapping (HTML deck for `docs/config/diff`)
  - [ ] Bulky assets in sibling dir `docs/sprints/eval/sprint-014/` if needed
  - [ ] Images or Videos (≤120s each); committed binaries ≤ 10MB
- **Testing approach:** The artifacts themselves are the tests. Open the rendered HTML deck in a browser and walk through every slide before marking this story complete.
- **QA:**
  - Manual: Open `docs/sprints/eval/sprint-014.html` in a browser. Confirm every slide loads, every embedded visual displays, every AC shows pass/fail status.
  - Automated: N/A — visual proof is the artifact **THIS IS IMPORTANT**
- **Planned commits:**
  1. `feat: capture evaluation artifacts for sprint-014` — schema snapshots, test outputs, public-view column dumps into `docs/sprints/eval/sprint-014/`
  2. `feat: build sprint-014 evaluation slide deck` — single HTML file referencing the artifacts
- **Technical notes:** See `~/projects/harness-config/templates/evaluation-matrix.md` for the component → tool mapping. Schema-only sprint, so Slide 2 substitutes user-flow videos with schema-surface evidence (same approach used in sprint-013's Evaluation Story for the pure-removal content type).
- **Priority:** Must-have

### Rules
- **Sprint-branch setup (before Story 1):** create `sprint-014` off `main` and push. Commit this sprint doc as the first commit on the branch. Story branches fork from `sprint-014`; story PRs target `sprint-014`. After the evaluation story merges, open a sprint-integration PR (`sprint-014 → main`) as the final step. See AGENTS.md §3 for the full workflow + edge cases.
- We sequentially do the stories. We do not do parallel work.
- **Review loop:** Open PRs, run `/review` (nudged by the PostToolUse hook), address findings, re-verify via `/review-fix` (capped at 3 passes per PR), confirm local checks are green and the last review turn returned mergeability ≥ 4/5 with no open P0/P1 findings, merge into `sprint-014`, then move to the next story. The sprint-integration PR goes through the same loop — cumulative-diff `/review` catches cross-story interactions.
- Record new dependencies in the Completion section's New Dependencies field.
- For everything else — commits, PR process, code quality, testing — follow your system instructions (the conventions loaded at session start).

### Definition of Done
- All four must-have stories pass acceptance criteria
- System-instruction conventions satisfied (code quality, tests, PR process, conventional commits, local checks green, last review turn mergeability ≥ 4/5 with no open P0/P1 findings)
- **Final Evaluation Story complete** — `docs/sprints/eval/sprint-014.html` exists; each story has schema-surface evidence; repo hygiene slide shows clean state
- **Sprint-integration PR merged** (`sprint-014 → main`); `sprint-014` deleted from origin; local `main` fast-forwarded
- **No new user flows introduced** — spec-005 §15 unchanged by this sprint (pure schema infra)
- **Follow-up backlog item filed**: open a GitHub issue for the `messages.id INTEGER → TEXT UUID` migration deviation — reference spec §12 and the sprint-014 tech-context note that acknowledges the deviation. Link the issue here before marking the sprint done.

### Completion
- **Stories shipped:** *(filled at sprint close)*
- **Commits:** *(filled at sprint close)*
- **New dependencies:** None expected — sprint is pure DDL + method-surface extension on the existing `better-sqlite3` / `sqlite-vec` stack
- **Retro:** *(optional — flag anything unexpected)*
