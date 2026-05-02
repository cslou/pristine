# Pristine — Sprint 019
**Date:** TBD (sprint has not kicked off; planning doc only — populate Start/End at sprint-branch creation)
**Goal:** Ship spec-005 Phase 5 — the `searcher.sql` primitive: a read-only, public-view-scoped, row-capped, timeout-bounded SQL surface that lets consumers (and future Phase 6 reference tools) compose ad-hoc queries without exposing internal tables or any privacy/vault surface.
**Status:** 🟡 Planning

---

## Handoff

### Project Context
- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript (strict, ESM), Node 18+, `better-sqlite3` + `sqlite-vec`, `@huggingface/transformers` (Nomic Embed v1.5, 768-d), Vitest. Local-first — zero outbound network calls in production code.
- **Current state:** Sprints 015-016 shipped Phases 3 (indexer) and 4 (searcher: `vectorSearch` + `ftsSearch` + `hybridSearch` + `sessionVectorSearch`). The corpus tables, indexes, and public views (`messages_public`, `conversations_public`, `summaries_public`) already exist in `src/conversations/store.ts:226-282`. The `Searcher` interface at `src/memory/searcher/index.ts` exposes the four search methods but **does not yet expose `sql`** — that's the missing primitive this sprint adds. better-sqlite3 supports `SQLITE_OPEN_READONLY`, `progress_handler`, and prepared-statement parameter binding natively. The privacy boundary is already validated at the storage layer (vault tables stay out of the public-view DDLs); Phase 5's job is to enforce that no SQL query reaches past the views.
- **Implementation spec:** `docs/specs/implementation-spec-005.md` — §5.1.3 lists `searcher.sql(sql, opts?): Row[]` as a primitive (post-rebase: raw SQL only, no DSL); §15 Flow 3 describes the validation pipeline (parse + validate access surface → read-only conn → progress handler → row-cap cursor → execute); §16 Phase 5 enumerates stories P5-S1 through P5-S4 *as authored pre-rebase*; §8.6 specifies the adversarial test suite the privacy boundary must survive. Story 4 of this sprint lands the spec touchups that align §5.1.3, §15 Flow 3, §15 Flow 5, and §16 Phase-5 to the rebased surface shape.

### Sprint-Wide Context

- **Sprint type:** Feature
- **Shared context:**
  - **Phase 5 ships the THIRD of three primitives.** Sprint-015 shipped `indexer`; sprint-016 shipped `searcher.{vector,fts,hybrid,session}Search`; this sprint completes `searcher` with `searcher.sql`. After this sprint, the spec-005 §5.1 primitive surface is functionally complete.
  - **Single SQL surface, one code path.** Per spec §15 Flow 3 (rebased pre-sprint), every query — whether composed by the integrator's app code or emitted by an LLM through a future Phase 6 reference tool — is a raw SQL string with positional `?` parameters. The DSL originally drafted at spec creation was dropped at sprint-doc rebase: LLMs are competent at SQL, and an additional query grammar adds surface area (extra parser, extra type system, extra failure modes) without commensurate value. Story 2 ships the parser + allowlist; Stories 1 + 3 wire the read-only execution path.
  - **Privacy boundary is the load-bearing concern.** Story 4's adversarial test suite (matching spec §8.6) is non-negotiable: every adversarial query — DML, internal-table SELECT, vault SELECT, DoS via cartesian join — must be rejected with a typed error or row-capped before completion. **A privacy-boundary regression here is a P0 finding.** Each story ships its own functional + regression verification as part of its merge — Story 4 specifically owns the comprehensive adversarial battery on top of the public surface that Story 3 wired.
  - **No DDL changes (with one allowlist-extension exception).** The public views and underlying tables already exist. This sprint only ships the SQL-execution path on top of them. **Exception:** Story 2 may extend the default allowlist to include the existing `messages_fts` shadow table (no DDL change — just allowing it through the parser) IF its column footprint is private-safe; see Story 2 AC and Story 5's recipe. If a missing view surface comes up (e.g., `vec_windows_public`, `messages_fts_public`), defer to a follow-up sprint.
  - **`searchConversations` removal lives in this sprint as Story 5.** Originally drafted as Story 5 of sprint-018, the keep/align/remove decision was relocated here because `searcher.sql` (Stories 1-3 of THIS sprint) is the recipe-alternative that makes removal viable. The decision was locked to **Remove + recipe** by user direction during sprint-019 planning — keyword-search composition belongs at the skill / Phase 6 reference-tool layer, not on the SDK's public surface.
- **Non-goals:**
  - **Phase 6 reference tools** (`search_memory` / `query_memory`) — `query_memory` will compose `searcher.sql` once it ships, but the tool wrappers are a separate sprint.
  - **Mutation surface (DML / DDL).** This primitive is read-only by design (§5.1.3). Any mutation lives behind dedicated SDK methods (`storeAsync`, `addSummary` if/when exposed), never through `searcher.sql`. No `INSERT` / `UPDATE` / `DELETE` / `CREATE` ever runs through this path.
  - **Distributed query / federation.** Single SQLite file, single connection. No cross-database joins, no `ATTACH DATABASE` support.
  - **Caching of compiled prepared statements.** First-pass simplicity: `db.prepare()` per call; revisit if a benchmark demands it (Phase 7 territory).
  - **Worker-thread isolation for `executeReadOnly`.** better-sqlite3 is synchronous; up to `MAX_TIMEOUT_MS` (10s) the Node event loop is fully blocked. JSDoc documents this constraint; a worker-thread wrapper is a follow-up sprint when Phase 6 reference tools land on a hot path.
  - **LLM-removal sprint** — out of scope per the standing sprint-016 retro decision. Recorded here so the cross-sprint architectural decision survives the template migration.

### Affected Flows

- **Existing flows affected:**
  - **Flow 3 — SQL query (primitive)** (`docs/specs/implementation-spec-005.md` §15): this sprint **implements** the flow that §15 has documented since spec-005 was authored. The flow shape is rebased to raw-SQL-only (drop the DSL example block, drop the translator step from the diagram); Story 4 lands the spec touchup.
  - **Flow 5 — `query_memory` reference impl** (`docs/specs/implementation-spec-005.md` §15): the spec example currently composes a DSL; Story 4 updates it to show raw-SQL composition (LLM emits SQL, handler validates + executes). Reference tool wrappers themselves are out of scope (Phase 6).
- **New flows introduced:** None — `searcher.sql` was specified at spec creation; this sprint ships it. No new user-visible flow shape.

### Verification Strategy

This sprint follows verifiability-first engineering: every story must define how its new or changed behavior will be proven correct and which existing behavior it could regress.

Verification has two categories:

- **Functional verification:** new verification created for behavior introduced or changed by this sprint.
- **Regression verification:** existing verification for behavior that predates this sprint.

Each implementation story below includes:

- Functional verification for the new or changed behavior it delivers.
- Targeted regression verification for existing behavior most likely to be affected by that story.

The Final Verification Story runs all sprint functional verification plus the full available regression verification suite (unit, integration `SKIP_SLOW=1` and `SKIP_SLOW=0`, e2e, smoke-indexer, pre-merge gate). After the sprint completes, the sprint's functional verification becomes part of the regression suite for future sprints.

### Stories
**Constraints:** 5 implementation stories + 1 Final Verification Story (6 total). Each implementation story ships its own functional + regression verification (no upfront test-scaffolding story; each story owns the tests for its own deliverable). Each is small enough to review, verify, and merge independently against `sprint-019`.

#### Story 1: Read-only connection + progress-handler timeout + row-cap cursor
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Acceptance criteria are specific and testable
  - [ ] Functional verification items are concrete and have pass/fail conditions
  - [ ] Regression verification items are concrete and have pass/fail conditions
  - [ ] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [ ] Ready for Lou
- **Planning review:**
  - Findings: *(sprint-doc-reviewer findings for this story, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** Pristine SDK maintainer building the SQL primitive's safety envelope, **I want** a shared backend that opens a read-only SQLite connection, attaches a per-query timeout, and wraps the result cursor with a row cap, **so that** Story 2 (parser/allowlist) + Story 3 (wiring) can route validated raw SQL through one execution path.
- **Dependencies:** None (foundational backend story; the integration test file `tests/integration/searcher-sql.test.ts` is created later by Story 3 when the public surface comes online — Story 1 is purely unit-tested against the internal `executeReadOnly` module)
- **Acceptance criteria:**
  - [ ] New module `src/memory/searcher/sql-backend.ts` (or co-located with `searcher/index.ts` if size warrants) exposes `executeReadOnly(sql: string, params: readonly unknown[], opts: { rowCap: number; timeoutMs: number }): Promise<readonly Row[]>`.
  - [ ] Each `executeReadOnly` call opens a connection in `SQLITE_OPEN_READONLY` mode against the same DB file as the writable connection. Connection lifecycle: open → execute → close (no shared read-only connection across calls — keeps the row cap + timeout per-call).
  - [ ] Read-only connection aborts queries exceeding `timeoutMs` (default 5000) via `progress_handler` if exposed by the better-sqlite3 binding, OR via `setTimeout` + `db.interrupt()` fallback if not. Either mechanism throws `QueryTimeoutError` (new error class extending `AppError`); the exact mechanism chosen is documented in the Story 1 commit that lands `executeReadOnly` (planned commit #1 below — co-located with the code so future `git blame` traces preserve the rationale, NOT just in the PR body which is ephemeral).
  - [ ] Cursor wrapper enforces row cap: cursor is iterated up to `rowCap` (default 1000), then closed; any rows beyond the cap are silently dropped (NOT an error — caller chose the cap or accepted default). **Document this silent-drop behavior in the JSDoc on `executeReadOnly`** (checkable AC, not just a tech note).
  - [ ] Per-call options: `rowCap` (1 ≤ cap ≤ 10000 — `MAX_ROW_CAP`), `timeoutMs` (100 ≤ ms ≤ 10000 — `MAX_TIMEOUT_MS`). Out-of-range values throw `InvalidArgumentError`.
  - [ ] **`executeReadOnly` does NOT inspect the SQL string for a `LIMIT` clause that exceeds `rowCap`** — the row-cap cursor will silently truncate at `rowCap` regardless. Document in JSDoc that callers MUST keep their SQL `LIMIT` ≤ `rowCap`; mismatch is a caller bug, not an SDK error.
  - [ ] `Row` type is `Readonly<Record<string, unknown>>` — opaque to the backend; downstream typing happens at the consumer layer.
  - [ ] **Timeout helper export.** Story 1 exports a `withTimeout(prepareStmt, ms)` primitive (or equivalent shape) that wraps prepared-statement execution with the same `setTimeout` + `db.interrupt()` envelope. Both `executeReadOnly` and Story 2's validation phase consume this helper directly so the timeout mechanism isn't duplicated across modules.
- **Functional verification:**
  - [ ] Unit test: `executeReadOnly` honors row-cap with a deterministic 2000-row inline corpus — pass condition: `rowCap=500` returns exactly 500 rows; `rowCap=2000` returns 2000.
  - [ ] Unit test: timeout fires with a deliberately-slow query (`SELECT * FROM <large-table> CROSS JOIN <large-table>` against a small temp table; cap the test wall-time at `timeoutMs + 2s` ≈ 7s at default `timeoutMs=5000` — NOT the pipeline-level ≤12s DoS budget, which is too loose for a unit test) — pass condition: `QueryTimeoutError` thrown within `timeoutMs + 2000ms`.
  - [ ] Unit test: out-of-range `rowCap` and `timeoutMs` throw `InvalidArgumentError` — pass condition: error class match for `rowCap=0`, `rowCap=10001`, `timeoutMs=99`, `timeoutMs=10001`.
  - [ ] Unit test: connection close on success AND on error — pass condition: leaked-connection counter (or `db.open` flag observation) returns to zero after both paths.
  - [ ] Unit test: read-only connection rejects DML at the SQLite layer (sanity check — even if a future bug lets DML through the parser, the connection blocks it) — pass condition: `INSERT INTO messages ...` throws better-sqlite3 read-only error from the connection.
  - [ ] Unit test: `withTimeout(prepareStmt, ms)` is exported and callable — pass condition: `import { withTimeout } from '../../src/memory/searcher/sql-backend.js'` resolves; `withTimeout(db.prepare('SELECT 1'), 200)` returns rows without throwing on a fast query AND throws `QueryTimeoutError` on a deliberately-slow query.
  - [ ] Functional coverage of row-cap + timeout for THIS story is entirely via the unit tests above; integration tests against `client.searcher.sql(...)` only become possible after Story 3 wires the public surface and creates the integration test file.
- **Regression verification:**
  - [ ] `npm run test:unit` — pass condition: existing unit count + new tests, all pass.
  - [ ] `npm run test:integration` — pass condition: existing integration tests unaffected by the new internal module; no new integration test file created at this story (Story 3 creates `tests/integration/searcher-sql.test.ts`).
  - [ ] `bash .checks/pre-merge.sh` — pass condition: lint + typecheck + unit suite all pass.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `feat(searcher): sql-backend module — executeReadOnly with read-only conn + progress handler + row-cap cursor`
  2. `feat(errors): add QueryTimeoutError extending AppError`
  3. `feat(searcher): export withTimeout(prepareStmt, ms) primitive for cross-module reuse`
  4. `test(searcher): unit tests for sql-backend — row cap, timeout, opt validation, connection lifecycle, RO-conn DML rejection`
  5. `docs(searcher): JSDoc on executeReadOnly + Row type + withTimeout — caps, timeout behavior, sync-blocking constraint`
- **Technical notes:**
  - **Why per-call connection.** Sharing a single read-only connection across calls would let a slow query block subsequent ones (better-sqlite3 is synchronous; even with `progress_handler`, the cursor takes a tick). Per-call open is ~1ms on a warm OS file cache — acceptable overhead for the rare case where SQL primitive is on a hot path.
  - **Synchronous event-loop blocking (load-bearing constraint).** better-sqlite3 is synchronous — `executeReadOnly` returns a `Promise<readonly Row[]>` for caller ergonomics, but the underlying `db.prepare(sql).iterate()` runs synchronously on the Node event loop. A query running up to `MAX_TIMEOUT_MS` (10s) blocks the event loop for that full duration. JSDoc on `executeReadOnly` MUST document this constraint so callers know not to put `searcher.sql` on a latency-sensitive request path without a worker-thread wrapper.
  - **`progress_handler` semantics.** better-sqlite3's `db.function()` doesn't expose `sqlite3_progress_handler` directly — the Node binding is `db.aggregate('progress', ...)` or the stalled-query approach. **Verify at story start:** check the better-sqlite3 docs for the canonical timeout-via-progress-handler pattern. If the binding lacks a clean progress hook, fall back to wrapping `db.prepare(sql).iterate()` with a `setTimeout`-driven `db.interrupt()` call (also exposed by better-sqlite3) — the `withTimeout` primitive abstracts the choice.
  - **Row-cap silent drop vs error.** Spec §15 Flow 3 documents silent drop as the default. A future iteration could add `rowCapBehavior: 'drop' | 'error'` if a consumer demands it; not in scope this sprint.

#### Story 2: Public-view allowlist + SQL parser
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Acceptance criteria are specific and testable
  - [ ] Functional verification items are concrete and have pass/fail conditions
  - [ ] Regression verification items are concrete and have pass/fail conditions
  - [ ] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [ ] Ready for Lou
- **Planning review:**
  - Findings: *(sprint-doc-reviewer findings for this story, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** Pristine SDK maintainer enforcing the privacy boundary at the SQL surface, **I want** a parser that extracts referenced tables from a SQL string and rejects any query touching tables outside the allowlist, **so that** raw-SQL consumers cannot reach internal tables, vault surfaces, or any future sensitive table by accident or by attack.
- **Dependencies:** Story 1 (the parser may consume `withTimeout` for EXPLAIN-based parsing and feeds the same `executeReadOnly` backend at the wiring layer)
- **Acceptance criteria:**
  - [ ] `parseSqlAccess(sql: string): { tables: string[]; isSelect: boolean }` extracts every table reference from a SQL string and reports whether the top-level statement is a SELECT (including `SELECT ... UNION ...` and CTE-fronted `WITH ... SELECT` forms).
  - [ ] `validateSqlAccess(sql: string, allowlist: ReadonlySet<string>): void` calls `parseSqlAccess` and throws `InvalidSqlError` if (a) `isSelect` is false, OR (b) any table in `tables` is NOT in `allowlist`. The error message names the offending table or non-SELECT keyword for debuggability.
  - [ ] **Non-SELECT keyword set (locked):** `EXPLAIN`, `EXPLAIN QUERY PLAN`, `PRAGMA`, `ATTACH`, `DETACH`, `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `REINDEX`, `VACUUM`, `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`, `ANALYZE`, `REPLACE` are all NOT-SELECT (rejected). Top-level statement must be `SELECT` or `WITH ... SELECT`.
  - [ ] The default allowlist is `new Set(['messages_public', 'conversations_public', 'summaries_public'])` — exposed as `DEFAULT_PUBLIC_VIEW_ALLOWLIST` from the module for re-use in tests / future spec evolution.
  - [ ] **Story-start decision (decided autonomously by Story 2 — does NOT depend on Story 5 running first):** inspect `messages_fts`'s column footprint at story start via `PRAGMA table_info(messages_fts);` AND `SELECT name FROM sqlite_schema WHERE name LIKE 'messages_fts%';` (the second discovers FTS5 internal shadow tables: `messages_fts_data`, `messages_fts_idx`, `messages_fts_content`, `messages_fts_docsize`, `messages_fts_config` (and `messages_fts_vocab` if the FTS5 vocabulary auxiliary table exists in this binding — verify at story start via the `sqlite_schema LIKE 'messages_fts%'` query)). **Decision rule:** IF `messages_fts` exposes only the externally-projected `content` column (no `metadata`, no `parent_message_id`) AND none of the `messages_fts_*` shadow tables are accidentally added to the allowlist, extend the default allowlist to include exactly the literal string `messages_fts` (string-exact match, no prefix matching). Otherwise DO NOT extend — bounce the FTS-recipe requirement to a follow-up sprint that ships a `messages_fts_public` view. **Pass condition (checkable):** Story 2 PR body contains a `## messages_fts allowlist decision` heading whose body includes (a) one of the literal strings `extended` or `not extended`, (b) a one-paragraph reason, and (c) the verbatim `PRAGMA table_info(messages_fts)` + `sqlite_schema` query output. Story 5's executing agent consumes this heading as a read-only input at its story start without re-investigation.
  - [ ] Parser handles: identifier quoting (`"messages"`, `[messages]`, `` `messages` ``); **schema prefixes — only `main.` is stripped for allowlist comparison** (`main.messages_public` → `messages_public`); `temp.<anything>`, `aux.<anything>`, and any other schema prefix throw `InvalidSqlError` (defense-in-depth — the actual primary defense against `ATTACH` is the locked non-SELECT keyword set above which already rejects `ATTACH` outright; the read-only connection flag is a secondary safety net since SQLite restricts writes on read-only connections but does NOT prevent the `ATTACH` statement itself); case-insensitivity (`SELECT` / `select` / `Select` all detected as SELECT); comments (`-- comment`, `/* comment */`) stripped before parsing.
  - [ ] **Allowlist comparison is string-exact (no prefix or substring match)** so `messages_fts_data` is never matched as `messages_fts`.
  - [ ] Parser is conservative: if it cannot determine a table reference unambiguously (e.g., unrecognized SQL syntax), it throws `InvalidSqlError` rather than allowing the query through. Documented in JSDoc as "deny on parse uncertainty."
  - [ ] **Parser MUST ACCEPT (NOT reject) the following standard SQL feature forms when applied to allowlist tables.** This is the happy-path counterpart to deny-on-uncertainty — an over-aggressive parser that rejected aggregate-only SELECTs or `JOIN` would gut the SDK's usefulness. Locked acceptance set:
    - Aggregate functions: `SELECT COUNT(*) FROM messages_public WHERE project_id = ?`, `SELECT MIN(timestamp), MAX(timestamp) FROM messages_public`, `SELECT AVG(turn_index) FROM messages_public`.
    - `GROUP BY` / `HAVING`: `SELECT project_id, COUNT(*) AS n FROM messages_public GROUP BY project_id HAVING n > 0`.
    - `WHERE` with non-`=` operators: `IN (?, ?)`, `BETWEEN ? AND ?`, `LIKE ?`, `<`, `>`, `<=`, `>=`, `!=`, `IS NULL`, `IS NOT NULL`.
    - `JOIN` across allowlist tables: `SELECT * FROM messages_public m JOIN conversations_public c ON m.conversation_id = c.id` (INNER, LEFT OUTER variants).
    - `UNION` / `UNION ALL`: `SELECT id FROM messages_public UNION ALL SELECT id FROM conversations_public`.
    - CTE-fronted SELECTs: `WITH recent AS (SELECT * FROM messages_public ORDER BY timestamp DESC LIMIT 10) SELECT * FROM recent`.
    - `LIMIT` / `OFFSET`: `SELECT * FROM messages_public LIMIT ? OFFSET ?`.
    - `ORDER BY` over any allowlist-view column with `ASC` / `DESC`.
    - Column aliases (`AS`) and table aliases (`messages_public m`).
- **Functional verification:**
  - [ ] Unit tests: table-driven test list of 30+ SQL strings labeled `(input, expected: 'allow' | 'reject', reason)` — pass condition: every case matches expectation including the 12+ adversarial cases (SQL-injection-style payloads, identifier-encoding tricks, CTE attacks, `EXPLAIN QUERY PLAN` prefix, `PRAGMA` access).
  - [ ] Unit test: schema-prefix `main.messages_public` → resolves to `messages_public` (allow); `temp.messages_public` → reject; `aux.messages` → reject.
  - [ ] Unit test: `messages_fts_data` is rejected even if `messages_fts` is in the allowlist (string-exact match) — pass condition: `InvalidSqlError` thrown with the offending table name in the message.
  - [ ] Unit test: nested CTE `WITH a AS (WITH b AS (SELECT * FROM messages) SELECT * FROM b) SELECT * FROM a` is rejected (parser recurses into inner CTE). **Note:** this covers the unit layer; Story 4 adversarial class (e) exercises the same case at the integration layer — both layers required, not redundant.
  - [ ] Unit test: **happy-path acceptance matrix** — for every form in the "Parser MUST ACCEPT" AC bullet above, a table-driven test asserts `validateSqlAccess(form, DEFAULT_PUBLIC_VIEW_ALLOWLIST)` does NOT throw. Pass condition: every locked form runs to completion without raising. This is the counter-test to deny-on-uncertainty — proves the parser is permissive of standard SQL on allowlist tables, restrictive only on off-allowlist references and non-SELECT statements.
  - [ ] Unit test: deny-on-parse-uncertainty — `validateSqlAccess` on inputs whose TOP-LEVEL `FROM` clause has NO resolvable identifier for the static parser to extract (NOT inputs that hit the non-SELECT keyword set first AND NOT inputs that look like a table identifier the parser then rejects via allowlist — those exercise different branches). Locked example inputs: `'SELECT * FROM (VALUES (1, 2)) AS t(a, b)'` (top-level FROM is an inline VALUES subquery — no identifier); `'SELECT * FROM (SELECT 1 UNION SELECT 2) AS sub'` (top-level FROM is an inline derived-table subquery — no identifier); `'SELECT 1 FROM (VALUES (1)) AS x WHERE EXISTS (SELECT 1)'` (top-level FROM is a VALUES subquery; the EXISTS sub-clause has no FROM that names a table). Each must throw `InvalidSqlError`. Pass condition: error class is `InvalidSqlError` AND error message contains the offending input substring or the literal phrase "parse uncertainty" (the parser surfaces one of the two — locked at story start). **Out of scope for this FV item (would exercise the wrong branch):** any input whose top-level FROM names an identifier (whether a real table, a CTE, or a table-valued function like `generate_series(...)`) — those route through the allowlist-mismatch branch, not parse-uncertainty.
  - [ ] Functional coverage of the parser for THIS story is entirely via the unit tests above; integration tests against `client.searcher.sql(...)` (which calls `validateSqlAccess` end-to-end) become possible after Story 3 wires the public surface and creates the integration test file. Story 4 adds the comprehensive adversarial battery on top.
- **Regression verification:**
  - [ ] `npm run test:unit` — pass condition: existing unit count + new tests, all pass.
  - [ ] `npm run test:integration` — pass condition: existing integration tests unaffected by the new parser module (no integration test file for `searcher.sql` exists yet — Story 3 creates it).
  - [ ] `bash .checks/pre-merge.sh` — pass condition: lint + typecheck + unit suite all pass.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `feat(searcher): parseSqlAccess + validateSqlAccess + DEFAULT_PUBLIC_VIEW_ALLOWLIST`
  2. `feat(errors): add InvalidSqlError extending AppError`
  3. `test(searcher): unit tests for parser — happy paths + 12+ adversarial cases + nested-CTE + shadow-table exact-match`
  4. `docs(searcher): JSDoc on parser — deny-on-uncertainty rationale + supported SQL surface + messages_fts allowlist decision (PR body)`
- **Technical notes:**
  - **Don't write a full SQL parser.** Use better-sqlite3's built-in helpers where possible: `db.prepare(sql).reader` is `true` for SELECT-only statements (useful for the `isSelect` gate). For table extraction, two candidate mechanisms exist; pick at story start:
    1. `EXPLAIN QUERY PLAN <sql>` returns a row-set listing referenced tables. **Caveat (verify at story start, do NOT assume):** SQLite typically resolves views to their underlying tables in QUERY PLAN output — i.e., `SELECT * FROM messages_public` may show `messages` in the plan, NOT `messages_public`. If that holds, EXPLAIN cannot be the primary mechanism (it would force every legitimate view query through an `internal-table` rejection). Confirm with `db.prepare('EXPLAIN QUERY PLAN SELECT * FROM messages_public').all()` and read the output before locking in.
    2. A static parser over the SQL string (regex for the simple cases — `FROM <ident>`, `JOIN <ident>` — plus a tokeniser that handles quoting + comments). Slower to write but deterministic, no DB round-trip, no DoS surface during validation. **Recommended primary** if EXPLAIN resolves views to underlying tables.
    Whichever is chosen, **the validation path must NOT execute SQL against the read-only connection** before the row-cap + timeout are attached. EXPLAIN QUERY PLAN counts as execution — a pathological CTE bomb in EXPLAIN would DoS the parser (and could exhaust memory before any CPU-based interrupt fires, since `db.interrupt()` stops the query loop but doesn't reclaim allocations). If EXPLAIN is used, **reuse Story 1's exported `withTimeout(prepareStmt, ms)` helper directly** with a tight ≤200ms validation-phase budget (chosen so validation + per-call query timeout fits within Story 4's ≤12s DoS-test wall-time bound: 200ms + 10000ms + framework overhead < 12s). The static-parser path (option 2) avoids this entire surface and is the recommended primary unless EXPLAIN demonstrably handles all required cases at story-start verification.
  - **Why deny-on-uncertainty.** A permissive parser that allows unknown syntax through is a privacy-boundary risk. Better to reject a legitimate-but-novel query (the consumer can rephrase or open an issue to extend the parser) than to leak access to an internal table.
  - **CTE handling.** `WITH foo AS (SELECT ...) SELECT * FROM foo` references `foo` (CTE-local) and whatever the inner SELECT touches. Parser must extract the inner SELECT's tables, not just `foo`. Nested CTEs (CTE inside CTE) recurse.
  - **Why a separate error class for SQL.** Distinguishes parser-level rejection (`InvalidSqlError`) from runtime SQLite errors (which surface as the underlying better-sqlite3 error). Consumers can catch `InvalidSqlError` to render a "your query is not allowed" UX without confusing it with "the database is broken".

#### Story 3: Wire `searcher.sql` on the public Searcher interface (creates the integration test file + ships happy-path tests)
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Acceptance criteria are specific and testable
  - [ ] Functional verification items are concrete and have pass/fail conditions
  - [ ] Regression verification items are concrete and have pass/fail conditions
  - [ ] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [ ] Ready for Lou
- **Planning review:**
  - Findings: *(sprint-doc-reviewer findings for this story, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** Pristine SDK consumer ready to use the SQL primitive, **I want** `client.searcher.sql(sql, opts?)` to be the single public entry point AND a clear set of integration tests proving it returns the expected rows for realistic queries, **so that** I don't have to compose `executeReadOnly` and `validateSqlAccess` myself AND I have evidence the SDK delivers the SQL-feature surface I'm relying on.
- **Dependencies:** Story 1 (`executeReadOnly` + `withTimeout` exist), Story 2 (`validateSqlAccess` + parser exist; story-start consumed Story 2's PR-body `## messages_fts allowlist decision` if FTS-related test cases are needed)
- **Acceptance criteria:**
  - **Wiring deliverable:**
    - [ ] `Searcher` interface (`src/memory/searcher/index.ts`) gains `sql(sql: string, opts?: SqlOpts): Promise<readonly Row[]>`. JSDoc names the read-only contract, the positional-`?`-only parameter binding, the row-cap + timeout defaults, and the public-view allowlist.
    - [ ] `createSearcher` factory wires the two modules linearly: input SQL string → `validateSqlAccess` → `executeReadOnly`. No mode dispatch, no translator step. **Validate-then-execute ordering is non-negotiable.**
    - [ ] `SqlOpts` type: `{ params?: readonly unknown[]; rowCap?: number; timeoutMs?: number }`. `params` is bound positionally to `?` placeholders in the SQL string; out-of-range opts throw `InvalidArgumentError` (delegated to Story 1's `executeReadOnly`).
    - [ ] `searcher.sql` types are exported from `src/index.ts`: `SqlOpts` (this story), `Row` (Story 1), `InvalidSqlError` (Story 2), `QueryTimeoutError` (Story 1). No DSL types — the primitive accepts raw SQL only.
    - [ ] Pristine doc-comment block on the `Searcher` interface mentions `sql` alongside the four search methods (`vectorSearch`, `ftsSearch`, `hybridSearch`, `sessionVectorSearch`).
  - **Integration test file deliverable (this story owns creation since the public surface only exists from this story onwards):**
    - [ ] `tests/integration/searcher-sql.test.ts` exists, imports `Pristine` from `src/index.js` only (no internal-path imports), and is wired into `npm run test:integration`. Pass condition: `npm run test:integration -- --reporter=verbose` lists the file in its roster.
    - [ ] `seedSqlCorpus()` helper creates a deterministic, dim-stable corpus (2 projects × 3 conversations × 3 messages = 18 rows). Validated by an inline `expect()` block at the top of the `describe('searcher.sql primitive')` that asserts post-seeding `SELECT COUNT(*) FROM messages` (via the writable connection) returns 18. Per-hook + per-it timeouts set to `SLOW_TEST_TIMEOUT_MS = 120_000` matching the sprint-016 hookTimeout pattern.
    - [ ] **Five happy-path integration tests land in this story** (each test file `it()` block calls `client.searcher.sql(...)`):
      1. Raw SELECT against `messages_public` scoped by project — pass condition: returns the 9 messages seeded under the chosen project.
      2. Raw SELECT with `?` params against `conversations_public` — MUST exercise positional parameter binding by passing `'; DROP TABLE messages; --` as a `?`-bound value AND asserting both that the query succeeds AND that `messages` table is intact afterwards (recovers the SQL-injection coverage that the dropped DSL injection-round-trip test was providing).
      3. **Compound query (closes the SQL-feature happy-path gaps in one realistic query):** `SELECT conv.id AS conv_id, COUNT(m.id) AS msg_count FROM conversations_public AS conv JOIN messages_public AS m ON m.conversation_id = conv.id WHERE conv.project_id = ? GROUP BY conv.id ORDER BY msg_count DESC LIMIT 10` with `params: ['<seeded-project-id>']`. Pass condition: returns 3 rows (one per seeded conversation in the chosen project) each with `msg_count = 3` per the 2×3×3 shape; rows sorted by msg_count descending. Single test exercises JOIN, COUNT aggregate, GROUP BY, ORDER BY, LIMIT, WHERE-`=`, and `?` binding simultaneously.
      4. SELECT against `summaries_public` — seeds one summary via the writable `addSummary`-equivalent path, then runs `SELECT id, session_id, project_id, text, timestamp FROM summaries_public WHERE project_id = ?`. Pass condition: returns the seeded summary with the correct columns. Closes the third-allowlist-view gap.
      5. Non-`=` `WHERE` operators — `SELECT id, role FROM messages_public WHERE project_id = ? AND role IN (?, ?) AND timestamp BETWEEN ? AND ? AND content LIKE ?`. Pass condition: returns at least one row matching the seeded corpus. Confirms the parser does NOT reject `IN`/`BETWEEN`/`LIKE` via deny-on-uncertainty.
    - [ ] **Two safety-envelope smoke tests land in this story** (prove Story 1's row-cap + timeout actually fire end-to-end through the public surface; comprehensive adversarial coverage lands in Story 4):
      6. Row cap — call `client.searcher.sql('SELECT id FROM messages_public', { rowCap: 5 })` against the 18-row seeded corpus; pass condition: returns exactly 5 rows.
      7. Timeout — call `client.searcher.sql('<deliberately-slow query>', { timeoutMs: 200 })`; pass condition: throws `QueryTimeoutError` within `timeoutMs + 2000ms`.
- **Functional verification:**
  - [ ] Unit test: order-of-operations — spy on `validateSqlAccess` and `executeReadOnly` (vitest `vi.spyOn` on the imported module), call `searcher.sql(...)`, assert `validateSqlAccess.mock.invocationCallOrder[0] < executeReadOnly.mock.invocationCallOrder[0]`. Pass condition: validate runs strictly before execute on every code path.
  - [ ] Unit test: default-opt application — `searcher.sql('SELECT 1')` with no opts uses `rowCap=1000` + `timeoutMs=5000` defaults. Pass condition: defaults observed via the spied `executeReadOnly` call args.
  - [ ] JSDoc placement check: `grep -nE "vectorSearch|ftsSearch|hybridSearch|sessionVectorSearch|\\bsql\\b" src/memory/searcher/index.ts` shows all five methods named in the same JSDoc-comment block above the `Searcher` interface. Pass condition: a single contiguous JSDoc block contains references to all five names.
  - [ ] All 5 happy-path + 2 safety-envelope smoke tests (per AC above) pass — `npm run test:integration -- tests/integration/searcher-sql.test.ts` reports `7 passed` with zero failures.
- **Regression verification:**
  - [ ] **Baseline-capture step (run BEFORE writing `tests/integration/searcher-sql.test.ts`):** `npm run test:integration -- --reporter=verbose 2>&1 | grep -cE "^[[:space:]]*✓"` and record the count in the Story 3 PR body under a `## pre-Story-3 integration-test baseline` heading.
  - [ ] `npm run test:integration` (full suite, including the new 7 tests) — pass condition: post-Story-3 pass count equals the recorded baseline + 7 (the new tests). Existing integration tests unaffected by the new test file.
  - [ ] `npm run test:unit` — pass condition: existing unit count + new wiring unit tests, all pass; the four existing search methods (`vectorSearch`/`ftsSearch`/`hybridSearch`/`sessionVectorSearch`) unaffected.
  - [ ] `npm run test:e2e` — pass condition: existing e2e suite passes; no regression from the new `Searcher.sql` method.
  - [ ] `bash .checks/pre-merge.sh` — pass condition: lint + typecheck + unit suite all pass.
  - [ ] Public barrel diff: `git diff main..HEAD -- src/index.ts` shows ONLY the four new exports (`SqlOpts`, `Row`, `InvalidSqlError`, `QueryTimeoutError`); nothing previously-exported was changed or removed.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `feat(searcher): wire sql method on Searcher interface — validateSqlAccess + executeReadOnly`
  2. `feat(api): export SqlOpts / Row / InvalidSqlError / QueryTimeoutError from src/index.ts`
  3. `chore(test): scaffold tests/integration/searcher-sql.test.ts + seedSqlCorpus helper`
  4. `test(searcher-sql): happy-path integration tests — messages_public, conversations_public + ? binding, compound JOIN/aggregate/GROUP BY/ORDER BY/LIMIT, summaries_public, non-= WHERE`
  5. `test(searcher-sql): safety-envelope smoke tests — row-cap + timeout via the public surface`
  6. `test(searcher): unit tests for searcher.sql — default-opt application + validate-then-execute order`
  7. `docs(searcher): JSDoc on searcher.sql — single entry point, raw-SQL contract, opts contract`
- **Technical notes:**
  - **Validate-then-execute ordering is non-negotiable.** Any path that calls `executeReadOnly` before `validateSqlAccess` is a privacy-boundary regression. The factory wiring must be linear: input → validate → execute. A sub-agent reviewer should explicitly check this in story PR review.
  - **No DSL escape hatch.** The primitive accepts raw SQL only (sprint-doc rebase decision: LLMs are competent at SQL, no need for a second grammar). Consumers that want a typed query builder can compose one over `searcher.sql` in their own code; it isn't on the SDK surface.
  - **Integration test file shape parallels `searcher.test.ts`.** The existing sprint-016 cross-cutting integration test file at `tests/integration/searcher.test.ts` is the reference shape — same hookTimeout pattern, same seeded-corpus pattern, same per-method describe blocks. Don't reinvent.
  - **Test plan reference (illustrative, NOT prescriptive verbatim text):** the 7 `it(...)` titles should encode the AC anchor (`@AC-Story3-happy-1` through `@AC-Story3-happy-5`, `@AC-Story3-smoke-1`, `@AC-Story3-smoke-2`) so failures map back to the AC.
  - **Comprehensive adversarial coverage is Story 4's responsibility.** This story ships only the safety-envelope smoke tests (row-cap + timeout fire end-to-end). The 20+ adversarial cases (DML / internal-table / vault / DoS / identifier-encoding) are appended to this same file by Story 4.

#### Story 4: Adversarial privacy suite + spec touchups
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Acceptance criteria are specific and testable
  - [ ] Functional verification items are concrete and have pass/fail conditions
  - [ ] Regression verification items are concrete and have pass/fail conditions
  - [ ] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [ ] Ready for Lou
- **Planning review:**
  - Findings: *(sprint-doc-reviewer findings for this story, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** Pristine SDK maintainer locking in the privacy boundary, **I want** an adversarial test suite that systematically tries every attack class spec §8.6 names — DML, internal-table SELECT, vault SELECT, DoS, identifier-encoding tricks — and verifies each one is rejected or row-capped, **so that** Phase 5's privacy contract is provably enforced and any future regression fails CI loudly.
- **Dependencies:** Stories 1-3 (the SQL primitive must exist for adversarial tests to run against it; specifically, Story 3 created `tests/integration/searcher-sql.test.ts` which this story extends)
- **Acceptance criteria:**
  - [ ] Adversarial cases **appended to `tests/integration/searcher-sql.test.ts`** (locked — single file keeps the adversarial coverage co-located with Story 3's happy-path coverage and avoids fragmenting test-discovery globs) — at least 20 adversarial test cases organized into 5 attack classes under a top-level `describe('searcher.sql adversarial suite', ...)` block. **Locked describe titles (so vitest `-t` filters work and the DoS-budget verification command resolves to the right tests):** the attack-class sub-describes MUST be titled exactly `'(a) DML attempts'`, `'(b) Internal-table SELECT'`, `'(c) Vault / privacy surface SELECT'`, `'(d) DoS / row-cap escape'`, `'(e) Identifier-encoding tricks'`. The top-level filter `-t 'adversarial suite'` selects the entire suite; `-t '\(d\) DoS'` selects only the DoS sub-class. **Shell-quoting note:** single-quoted shell strings do NOT process backslashes, so `'\(d\) DoS'` passes the literal bytes `\(d\) DoS` to vitest, which compiles to the JS regex `/\(d\) DoS/` matching the literal `(d) DoS` substring. Do NOT use double-backslashes (`'\\(d\\) DoS'` would pass two literal backslashes per paren and the regex would fail to match the title).
    - **(a) DML attempts** (≥ 5 cases): `INSERT`, `UPDATE`, `DELETE`, `DROP TABLE`, `ALTER TABLE`. Each must throw `InvalidSqlError`.
    - **(b) Internal-table SELECT** (≥ 5 cases): `SELECT * FROM messages`, `SELECT * FROM conversations`, `SELECT * FROM vec_windows`, `SELECT * FROM vec_sessions`, `SELECT * FROM messages_fts`. Each must throw `InvalidSqlError`. **Allowlist-conditional substitution (decided at this story's start by reading Story 2's PR body):** if Story 2 extended the default allowlist to include `messages_fts` (decided autonomously in Story 2 — see Story 2 PR body's `## messages_fts allowlist decision` heading), drop `messages_fts` from this case set AND substitute **all FTS5 shadow tables** enumerated in Story 2's AC: `messages_fts_data`, `messages_fts_idx`, `messages_fts_content`, `messages_fts_docsize`, `messages_fts_config`, AND `messages_fts_vocab` (each must reject unconditionally — string-exact allowlist comparison rejects them whether the binding currently exposes them or not, so a rejection test is always safe and protects against a future binding that adds the vocab table). Also append `SELECT * FROM embed_jobs` and `SELECT * FROM migrations` IF those tables exist in `src/conversations/store.ts` (probe via `grep -n "CREATE TABLE" src/conversations/store.ts` at story start).
    - **(c) Vault / privacy surface SELECT** (≥ 3 cases): **canonical probe (locked, owned by this story):** `grep -rn "CREATE TABLE.*vault\\|CREATE TABLE.*key" src/privacy/`. The first ≥3 hits are the target tables; each `SELECT * FROM <hit>` must throw `InvalidSqlError`. **Fallback (locked):** if the probe returns zero privacy-module tables (post-sprint-020 the vault footprint may have shrunk), substitute 3 internal-corpus tables not in the public-view allowlist (e.g., `messages_fts`, `vec_windows`, `vec_sessions`); document the substitution in the test-file header.
    - **(d) DoS / row-cap escape** (≥ 3 cases): cartesian join over a small table that produces > 1M rows; the row cap must terminate iteration at `rowCap`. Long-running sleep-style query (using `randomblob(1000000)` recursion or a CTE bomb); the timeout must fire and throw `QueryTimeoutError`. Wall-time bound for each test: ≤(MAX_TIMEOUT_MS + 2000)ms = ≤12s. **Fallback (locked AC, NOT just tech-note prose):** if Story 1's row-cap cursor cannot short-circuit SQLite's join evaluation cleanly (verify at story start), the cartesian-join test instead asserts wall-time bound only (`≤12s` total) — flag the limitation in the story PR for a future optimization sprint; do NOT block this story on cursor short-circuit being optimal.
    - **(e) Identifier-encoding tricks** (≥ 5 cases): `SELECT * FROM "messages"`, `SELECT * FROM [messages]`, `` SELECT * FROM `messages` ``, `SELECT * FROM main.messages`, `SELECT * FROM temp.messages_public` (schema-prefix-other-than-`main.` must reject — confirms `main.`-only stripping), `SELECT * FROM messages -- comment`, `SELECT /* injected */ * FROM messages`, `WITH foo AS (SELECT * FROM messages) SELECT * FROM foo`, **nested-CTE attack** `WITH a AS (WITH b AS (SELECT * FROM messages) SELECT * FROM b) SELECT * FROM a`. Each must throw `InvalidSqlError`.
  - [ ] All adversarial tests run on every CI invocation (NOT marked `@skip` or `@manual`).
  - [ ] `docs/specs/implementation-spec-005.md` updated by anchor-based search (NOT line numbers — they shift as edits land in the same commit):
    - **§5.1.3 wording:** "scoped DSL (preferred) or raw SQL (escape hatch)" → "raw SQL with positional `?` parameter binding".
    - **§15 Flow 3:** anchor by `### Flow 3 — SQL query (primitive)` heading + the `searcher.sql({` typescript fence — DELETE the DSL example block; show `client.searcher.sql(sql, opts?)` as the single consumer surface, raw SQL only, no DSL/translator step in the diagram.
    - **§15 Flow 5:** anchor by `### Flow 5 — \`query_memory\`` heading — update reference impl to show raw-SQL composition rather than DSL (LLM emits SQL, handler validates + executes).
    - **§16 Phase-5:** anchor by `## §16` / `### Phase 5` heading — collapse P5-S1-S4 to the rebased 3-story implementation set (P5-S1: connection+timeout+row-cap; P5-S2: parser+allowlist; P5-S3: wire `searcher.sql` on Searcher).
    - **Fallback:** if any heading anchor cannot be located, fall back to a full-file grep for the exact heading text rather than guessing line numbers.
  - [ ] §16 Phase 5 Done-when checkboxes are all flipped to `[x]`. Pass condition: `awk '/^### Phase 5/,/^### Phase 6/' docs/specs/implementation-spec-005.md | grep -c '^- \[ \]'` returns `0` (no unchecked Phase-5 done-when items).
  - [ ] JSDoc on `searcher.sql` references §15 Flow 3 and §8.6 for the privacy contract.
- **Functional verification:**
  - [ ] `npm run test:integration` — pass condition: all ≥20 adversarial test cases pass.
  - [ ] `npm run test:integration` with deliberate-injection — pass condition: each DML / internal-table / vault / DoS / identifier-encoding case throws the expected error class with a message that names the offending construct (regex-pattern assertion).
  - [ ] DoS test wall-time check: `time npx vitest run tests/integration/searcher-sql.test.ts -t '\(d\) DoS'` (single-quoted single-backslash escaping — see this story's AC for the shell-quoting note; `\(` becomes the JS regex `\(` which matches a literal `(` in the locked describe title `'(d) DoS / row-cap escape'`). Pass condition: each DoS test completes within ≤12s wall time AND vitest's reporter shows `5 passed` (or higher) for the (d) sub-class — NOT `0 tests` (which would indicate the filter matched nothing — re-check the shell-escape).
  - [ ] Spec touchups verified by `grep` (multi-anchor, robust against DSL example formatting):
    - **Deletion checks (each must return 0 — use `grep -c` so the count is machine-checkable, not eyeball-checkable):**
      - `grep -c "scoped DSL" docs/specs/implementation-spec-005.md` returns `0` — the §5.1.3 wording was rewritten.
      - `grep -cE "searcher\.sql\(\{" docs/specs/implementation-spec-005.md` returns `0` — the DSL example block was deleted.
    - **Structural-integrity checks (each must return exactly 1 — `grep -c` enforces the count machine-readably; 0 means heading was renamed/deleted, 2+ means accidental duplicate):**
      - `grep -c "^### Flow 3 — SQL query (primitive)" docs/specs/implementation-spec-005.md` returns `1`.
      - `grep -c "^### Flow 5" docs/specs/implementation-spec-005.md` returns `1`.
- **Regression verification:**
  - [ ] `npm run test:unit` — pass condition: unit suite unaffected by adversarial suite addition.
  - [ ] `npm run test:integration` — pass condition: existing integration tests still pass at exact pre-Story-4 count (which already includes Story 3's 7 happy-path + smoke tests) + ≥20 new adversarial tests appended in this story.
  - [ ] `npm run test:e2e` — pass condition: e2e suite passes.
  - [ ] `bash .checks/pre-merge.sh` — pass condition: lint + typecheck + unit suite all pass.
- **Manual-only verification:** N/A.
- **Planned commits:**
  1. `test(searcher-sql): adversarial DML attempts — INSERT / UPDATE / DELETE / DROP / ALTER`
  2. `test(searcher-sql): adversarial internal-table SELECT — messages / conversations / vec_* / messages_fts (or substitute per Story 2 allowlist decision)`
  3. `test(searcher-sql): adversarial vault-table SELECT — every privacy-module table (with empty-vault fallback)`
  4. `test(searcher-sql): adversarial DoS — cartesian join + CTE bomb (row cap + timeout fire) bounded to ≤12s`
  5. `test(searcher-sql): adversarial identifier-encoding tricks — quoting / schema prefix / comments / nested CTE`
  6. `docs(spec): implementation-spec-005 §5.1.3 + §15 Flow 3 + §15 Flow 5 + §16 Phase-5 — raw-SQL surface, drop DSL example block, drop translator step from diagram, collapse P5-S1-S4`
- **Technical notes:**
  - **DoS test budget.** Each DoS test bounded by **wall-time ≤(MAX_TIMEOUT_MS + 2000)ms = ≤12s as the primary assertion** — NOT a tight `≤10s` bound. The +2000ms margin absorbs (a) Story 2's ≤200ms EXPLAIN validation envelope if EXPLAIN is the chosen parse path, and (b) Vitest framework overhead (teardown, error propagation, assertion setup) which can add hundreds of ms on slow CI runners. The cartesian-join attack against a 1500-row corpus produces ~2.25M-row joins; if the row-cap cursor short-circuits SQLite's join evaluation cleanly the test passes at ~1s, and if it doesn't (because SQLite materialises the full join before yielding), the timeout fires at MAX_TIMEOUT_MS=10s and the test still passes via `QueryTimeoutError` well within 12s. Either path is acceptable — row-cap optimisation is a perf nice-to-have, not a correctness condition.
  - **Identifier-encoding tricks are the highest-risk class.** Story 2's parser must treat `"messages"`, `[messages]`, and `` `messages` `` as identical to `messages` for allowlist comparison. Adversarial tests verify each form rejects.
  - **Spec touchup grew with the rebase.** Originally a single §15 Flow 3 edit. Post-rebase it touches §5.1.3 (surface wording), §15 Flow 3 (drop DSL example, simplify diagram), §15 Flow 5 (`query_memory` reference impl uses raw SQL not DSL), and §16 Phase-5 done-when. All in one commit so reviewers see the cumulative spec delta together.

#### Story 5: Remove `searchConversations` + ship raw-SQL recipe (relocated from sprint-018)
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template
  - [ ] Acceptance criteria are specific and testable
  - [ ] Functional verification items are concrete and have pass/fail conditions
  - [ ] Regression verification items are concrete and have pass/fail conditions
  - [ ] Story is small enough to review and merge independently
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed or explicitly recorded
  - [ ] Ready for Lou
- **Planning review:**
  - Findings: *(sprint-doc-reviewer findings for this story, or `None`)*
  - Resolution: *(changes made, accepted risk, or `N/A`)*
- **As a** Pristine SDK maintainer locking the public surface for Phase 6, **I want** `searchConversations` removed from the SDK (keyword-search composition belongs at the skill / Phase 6 reference-tool layer, not on `client`) and a copy-pasteable raw-SQL recipe shipped in spec §5.2 so future skills/tools can reproduce its shape, **so that** the SDK surface stays minimal and consumers have one canonical recipe instead of an overlapping legacy method.
- **Dependencies:** Stories 1-4 (the `searcher.sql` recipe requires the SQL primitive to exist + be tested). **Hard-input dependency:** Story 2 PR body must include the `## messages_fts allowlist decision` heading per Story 2 AC — Story 5's recipe shape (FTS5-backed vs deferred-with-follow-up-note) is determined by that heading's content (`extended` vs `not extended`); the method removal itself is unconditional.
- **Acceptance criteria:**
  - [ ] Decision is **locked at sprint planning to Remove + recipe** — the method is removed from the SDK unconditionally. Recipe shape is determined by Story 2's PR body `## messages_fts allowlist decision` heading: if `extended`, the recipe is the FTS5-backed form (locked example in technical notes below) and ships in JSDoc + spec §5.2; if `not extended`, the recipe ships in spec §5.2 with a documented note that the FTS5-backed form lands once a `messages_fts_public` view ships in a follow-up sprint. The SDK-method removal does NOT depend on Story 2's decision.
  - [ ] Investigation block in the story PR body answers: (1) **enumerate every consumer** — list every grep hit for `searchConversations` across `src/`, `tests/`, `scripts/`, and `docs/` (`grep -rn "searchConversations" src/ tests/ scripts/ docs/`), with a one-line note per hit identifying it as production / test / script / doc; (2) the concrete `searcher.sql` recipe that recovers `searchConversations`'s shape (input → output, with the actual raw-SQL string + positional `?` params), in whichever shape is reachable per Story 2's allowlist decision.
  - [ ] In-repo consumers (`scripts/search-conversations.ts`, any test fixtures) are updated to match the removal: the script either migrates to `searcher.sql` (using the documented recipe) or the script itself is removed (with a brief note in commit message).
  - [ ] Removal-audit pass: `grep -rn "searchConversations" src/ tests/` returns zero hits in production code (only spec / migration-recipe / sprint-doc references remain).
- **Functional verification:**
  - [ ] Recipe-equivalence unit test (only runs if Story 2 documented `extended`; otherwise marked `it.skip` with a comment pointing to the deferred follow-up sprint that ships `messages_fts_public`) — `searcher.sql` with the recipe's raw-SQL string returns row-equivalent results to the legacy `searchConversations` for at least 3 representative inputs (different keyword, different project, empty result). Pass condition: deep-equality of result sets after sorting by `id`.
  - [ ] Public-surface removal verified — `grep -nE "\bsearchConversations\b" src/client.ts` returns 0 hits OR only doc-comment references pointing to the migration recipe. Pass condition: `client.searchConversations` is no longer present on the public type.
- **Regression verification:**
  - [ ] `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration` — all clean after removal.
  - [ ] Removed-method audit — `grep -rn "searchConversations" src/ tests/` returns zero hits in production code (only spec / migration-recipe / sprint-doc references remain).
  - [ ] `bash .checks/pre-merge.sh` — pass condition: lint + typecheck + unit suite all pass.
- **Manual-only verification:**
  - If `scripts/search-conversations.ts` is migrated rather than removed, run it once locally against a small corpus to confirm the migration produces equivalent results. Tag this `@manual`. Pass condition: output rows match a baseline captured from the legacy script before migration. Skip this item if the script is removed outright.
- **Planned commits:**
  1. `docs(sprint): record searchConversations removal investigation in PR body`
  2. `refactor(client): remove PristineLocal.searchConversations + ConversationStore.searchConversations`
  3. `refactor(scripts): migrate scripts/search-conversations.ts to compose searcher.sql per the documented recipe (or remove the script with rationale)`
  4. `test(searcher-sql): recipe-equivalence unit test — searcher.sql with the raw-SQL recipe produces equivalent rows to the legacy searchConversations on 3+ inputs`
  5. `docs(spec): add migration recipe to implementation-spec-005.md §5.2 reference-implementations — concrete searcher.sql raw-SQL form`
- **Technical notes:**
  - **Concrete impl differences (validate at story start):** `searchConversations` (a) requires `userId` as primary scope; (b) returns `ConversationSearchResult[]` — one row per conversation with a `snippet` string; (c) uses `escapeFts5Query` defensively; (d) does NOT take a projectId. `searcher.ftsSearch` (a) requires `projectId`; (b) returns `MessageHit[]` — one per matching message; (c) propagates FTS5-query syntax errors as `InvalidArgumentError`. `searcher.sql` (Stories 1-3 of this sprint) (a) accepts raw SQL against `messages_public` / `conversations_public` (and `messages_fts` if Story 2's allowlist decision extends it); (b) returns `Row[]` opaque shape; (c) lets a consumer build the exact JOIN + snippet that `searchConversations` produces today. All three ride `messages_fts` underneath.
  - **Decision locked at sprint planning.** User direction during sprint-019 planning locked the Remove + recipe path unconditionally. Original sprint-018 draft biased toward Keep because no concrete `searcher.sql` alternative existed; sprint-019 ships that alternative in Stories 1-3, so the SDK no longer needs to carry the legacy method. Removing it does NOT preclude a future skill or Phase-6 reference tool from re-exposing keyword-search composition externally — the SDK just stops carrying it on the public surface.
  - **Recipe shape (locked).** The recipe must be a copy-pasteable raw-SQL string in the JSDoc and spec, NOT a prose description. Example shape (validate at story start; assumes Story 2 extended allowlist to include `messages_fts`):
    ```ts
    // Recipe: keyword search across a project's conversations, returning per-message snippets ordered by relevance.
    // NOTES (all enforced as caller-side preconditions; document in JSDoc when this recipe ships in spec §5.2):
    //   1. `limit` MUST be a positive integer satisfying `1 <= limit <= rowCap` (default rowCap=1000). Callers MUST
    //      validate / clamp before calling — the precondition guard MUST REJECT both `limit = 0` and `limit < 0`
    //      (do NOT pass them through). What SQLite would do if a non-positive value reached the engine: `LIMIT 0`
    //      returns zero rows silently (valid SQL, surprising UX); `LIMIT -1` is treated as "unlimited" so the
    //      row-cap cursor becomes the only bound (still bounded by rowCap, but degraded UX). The guard exists
    //      precisely so callers don't have to reason about either downstream behavior.
    //   2. The `snippet(...)` column returns the matching message-body text wrapped in `<b>` / `</b>` markers.
    //      The body is user-supplied data stored in `messages_public.content`, so the snippet string can contain
    //      `<script>`, HTML entities, or other browser-active payloads INDEPENDENT of the marker tags or the
    //      `keyword` argument. Consumers rendering this column in a browser MUST HTML-escape the ENTIRE snippet
    //      string before insertion into the DOM (escape first, then re-substitute neutral wrapper tokens for the
    //      bold markers if the UI wants emphasis). XSS risk applies to the body content, not just the markers.
    //   3. On multi-project corpora with broad keywords, the FTS5 MATCH executes BEFORE the project_id filter
    //      (FROM messages_fts ... JOIN ... WHERE ... AND m.project_id = ?). If the cross-project FTS hit set
    //      exceeds rowCap, the row-cap cursor truncates BEFORE the project filter narrows results, producing
    //      silently-incomplete project-scoped output. Mitigation: increase rowCap proportional to corpus
    //      cross-project breadth, or scope the recipe to single-project use until a `messages_fts_per_project`
    //      view ships.
    const rows = await client.searcher.sql(
      `SELECT m.id, m.conversation_id, m.role, m.timestamp,
              snippet(messages_fts, 0, '<b>', '</b>', '...', 32) AS snippet
       FROM messages_fts
       JOIN messages_public m ON m.id = messages_fts.rowid
       WHERE messages_fts MATCH ? AND m.project_id = ?
       ORDER BY rank
       LIMIT ?`,
      { params: [escapeFts5Query(keyword), projectId, limit] },
    );
    ```
    **Story-start verification (locked):** read Story 2's PR body for the `## messages_fts allowlist decision` heading. If Story 2 documented `extended` → ship the recipe in the FTS5-backed form above AND run the recipe-equivalence test. If Story 2 documented `not extended` → the SDK method removal still proceeds unconditionally, but the recipe ships in spec §5.2 with a documented note that the FTS5-backed form lands once a `messages_fts_public` view ships in a follow-up sprint; the recipe-equivalence test is `it.skip`-ed with a comment pointing at the deferred follow-up.

#### Final Story: Sprint Verification & Completion
- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Every functional verification item from Stories 1-5 has been run and marked pass / fail / ambiguous / unrun with evidence recorded in `## Final Review`
  - [ ] Every targeted regression verification item from Stories 1-5 has been run and marked pass / fail / ambiguous / unrun with evidence recorded in `## Final Review`
  - [ ] Final regression suite (unit, integration `SKIP_SLOW=1` AND `SKIP_SLOW=0`, e2e, smoke-indexer, pre-merge gate) has been run with command + exit-code evidence captured
  - [ ] Sprint doc Status updated to `🟢 Complete` only if all completion criteria are met
  - [ ] Ready for Lou
- **As a** maintainer, **I want** all sprint functional verification and all available regression verification run, **so that** the sprint can be integrated with evidence that new behavior works and existing behavior did not regress.
- **Dependencies:** All implementation stories (1-5)
- **Acceptance criteria:**
  - [ ] Every story's acceptance criteria are evaluated against implementation evidence.
  - [ ] Every story's functional verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [ ] Every story's targeted regression verification checkboxes are run, checked, or explicitly marked failed/ambiguous/unrun.
  - [ ] The full available regression verification suite is run, including existing unit, integration (`SKIP_SLOW=1` AND `SKIP_SLOW=0` for real-Nomic coverage), e2e, smoke (`scripts/smoke-indexer.ts`), and `.checks/pre-merge.sh`.
  - [ ] Failed, ambiguous, manual-only, or unrun verification items are documented in `## Final Review`.
  - [ ] The sprint's new functional verification (per-story FV blocks above) is identified as future regression verification.
  - [ ] **Verification delta is reported by canonical type** (unit / integration / e2e / smoke / static / manual), showing for each: count BEFORE sprint, ADDED this sprint, REMOVED, PENDING / NOT YET RUN, and AFTER-sprint total. Recorded as a table in `## Final Review`. Pass condition: every canonical type has all five columns populated; no row is left as "?" or omitted.
  - [ ] The sprint doc status is updated to `🟢 Complete` only if completion criteria are met.
  - [ ] A `## Final Review` section is appended to the sprint doc with the final completion message quoted for auditability.
- **Functional verification:**
  - [ ] Run all functional verification items from every story (1-5) and record pass/fail evidence in `## Final Review`.
- **Regression verification:**
  - [ ] Run all targeted regression verification items from every story and record pass/fail evidence.
  - [ ] Run the full available regression verification suite and record pass/fail evidence (each command's pass condition is `exit 0` AND no `FAILED` / `Error` lines in stdout/stderr unless the command prefixes its summary differently):
    - `npm run test:unit` — pass condition: exit 0, all unit suites pass.
    - `SKIP_SLOW=1 npm run test:integration` — pass condition: exit 0, no FAILED reporter line.
    - `SKIP_SLOW=0 npm run test:integration` — pass condition: exit 0, all integration suites pass with real Nomic v1.5 (gates sprint completion on full coverage).
    - `npm run test:e2e` — pass condition: exit 0, all e2e suites pass.
    - `npx tsx scripts/smoke-indexer.ts` — pass condition: script exits 0; stdout contains no `FAILED` / `Error` / `assertion failed` lines.
    - `bash .checks/pre-merge.sh` — pass condition: exit 0, lint + typecheck + unit gate all pass.
- **Manual-only verification:** Story 5's `@manual` script verification IF `scripts/search-conversations.ts` was migrated rather than removed outright (otherwise N/A).
- **Planned commits:**
  1. `docs(sprint-019): final verification evidence + Status → 🟢 Complete + ## Final Review section`
- **Technical notes:** Use the story sections plus the existing regression suite as the source of truth. Do not duplicate all AC/verification items here; run them, reference the evidence, and record final results in `## Final Review`. Use `workflow-prompts/handle-sprint-completion.md` for the final completion message shape — `## Final Review` is the durable audit copy of that message; emit the same summary to the user and append it to the sprint doc.

### Rules
- Use the sprint-branch workflow from AGENTS.md: `sprint-019` branches from `main`, story branches fork from `sprint-019`, and story PRs target `sprint-019`.
- Work through stories sequentially. The Final Verification Story is always last.
- Each story PR follows the normal review/fix/merge gates from AGENTS.md (open PR → `/review` → `/review-fix` until mergeability ≥ 4/5 with no open P0/P1 → merge into `sprint-019`).
- After the Final Verification Story merges, open the sprint-integration PR (`sprint-019 → main`). It uses the same gates, then pauses for the user's explicit merge command.
- Record new dependencies in `## Final Review`, or record `None` when no dependencies were added.
- **Parallel experiment option (explicit exception):** when a story is explicitly scoped as an isolated experiment, consider `/skill:worktree create <branch>` to run it in a separate cmux workspace. Default rule remains sequential. See AGENTS.md §20.

### Definition of Done
- All implementation stories pass acceptance criteria.
- Functional verification evidence is recorded for every implementation story.
- Targeted regression verification evidence is recorded for every implementation story.
- Final Verification Story has run all sprint functional verification and the full available regression verification suite (unit, integration `SKIP_SLOW=1` and `SKIP_SLOW=0`, e2e, smoke-indexer, pre-merge gate).
- Failed, ambiguous, manual-only, or unrun verification items are documented in `## Final Review`.
- Sprint doc status is `🟢 Complete` only when completion criteria are met.
- Sprint doc includes `## Final Review` with the final completion message, a New Dependencies field containing dependencies or `None`, and a **Verification delta table** by canonical type (unit / integration / e2e / smoke / static / manual) with columns: BEFORE sprint, ADDED this sprint, REMOVED, PENDING / NOT YET RUN, AFTER-sprint total — every row populated, no "?" entries.
- Sprint-integration PR is reviewed, passes the required gates, and is merged only after the explicit user merge command.
- **Spec touchup landed** (Story 4) — `docs/specs/implementation-spec-005.md` §5.1.3 + §15 Flow 3 + §15 Flow 5 + §16 Phase-5 reflect the shipped surface: `client.searcher.sql(sql, opts?)` with raw-SQL only, no DSL example block, no translator step in the diagram; §16 Phase 5 Done-when checkboxes ticked.
