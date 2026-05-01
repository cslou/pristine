# Pristine — Sprint 019
**Date:** 2026-04-28 – TBD
**Goal:** Ship spec-005 Phase 5 — the `searcher.sql` primitive: a read-only, public-view-scoped, row-capped, timeout-bounded SQL surface that lets consumers compose ad-hoc queries (and future Phase 6 reference tools) without exposing internal tables or any privacy/vault surface.
**Status:** 🟡 Planning

---

## Handoff

### Project Context

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript (strict, ESM), Node 18+, `better-sqlite3` + `sqlite-vec`, `@huggingface/transformers` (Nomic Embed v1.5, 768-d), Vitest. Local-first — zero outbound network calls in production code.
- **Current state:** Sprints 015-016 shipped Phases 3 (indexer) and 4 (searcher: `vectorSearch` + `ftsSearch` + `hybridSearch` + `sessionVectorSearch`). The corpus tables, indexes, and public views (`messages_public`, `conversations_public`, `summaries_public`) already exist in `src/conversations/store.ts:226-282`. The `Searcher` interface at `src/memory/searcher/index.ts` exposes the four search methods but **does not yet expose `sql`** — that's the missing primitive this sprint adds. Every other Phase-5 building block is in place: better-sqlite3 supports `SQLITE_OPEN_READONLY`, `progress_handler`, and prepared-statement parameter binding natively. The privacy boundary is already validated at the storage layer (vault tables stay out of the public-view DDLs); Phase 5's job is to enforce that no SQL query reaches past the views.
- **Implementation spec:** `docs/specs/implementation-spec-005.md` — §5.1.3 lists `searcher.sql(sql, opts?): Row[]` as a primitive (post-rebase: raw SQL only, no DSL); §15 Flow 3 describes the validation pipeline (parse + validate access surface → read-only conn → progress handler → row-cap cursor → execute); §16 Phase 5 enumerates stories P5-S1 through P5-S4 *as authored pre-rebase*; §8.6 specifies the adversarial test suite the privacy boundary must survive. Spec touchups in Story 5 align §5.1.3, §15 Flow 3, §15 Flow 5, AND §16 Phase-5 (collapse P5-S1-S4 → the rebased 3-story implementation set) to the rebased surface shape.

### Sprint-Level Technical Context

- **Phase 5 ships the THIRD of three primitives.** Sprint-015 shipped `indexer`; sprint-016 shipped `searcher.{vector,fts,hybrid,session}Search`; this sprint completes `searcher` with `searcher.sql`. After this sprint, the spec-005 §5.1 primitive surface is functionally complete.
- **No DDL changes (with one allowlist-extension exception).** The public views (`messages_public`, `conversations_public`, `summaries_public`) and the underlying tables already exist. This sprint only ships the SQL-execution path on top of them. If a missing column or view surface comes up (e.g., a needed `vec_windows_public` or `messages_fts_public`), defer that as a follow-up sprint — do NOT bundle DDL changes here. **Exception:** Story 3 may extend the default allowlist to include the existing `messages_fts` shadow table (no DDL change — just allowing it through the parser) IF its column footprint is already private-safe; see Story 3 AC and Story 6 path-(c) recipe.
- **Single SQL surface, one code path.** Per spec §15 Flow 3 (rebased this sprint), every query — whether composed by the integrator's app code or emitted by an LLM through a future Phase 6 reference tool — is a raw SQL string with positional `?` parameters. The DSL originally drafted for an additional Story-4 was dropped at sprint-doc rebase: LLMs are competent at SQL, and an additional query grammar adds surface area (extra parser, extra type system, extra failure modes) without commensurate value. Story 3 ships the parser + allowlist; Stories 2 + 4 wire the read-only execution path.
- **Privacy boundary is the load-bearing concern.** Story 5's adversarial test suite (matching spec §8.6) is non-negotiable: every adversarial query — DML, internal-table SELECT, vault SELECT, DoS via cartesian join — must be rejected with a typed error or row-capped before completion. **A privacy-boundary regression here is a P0 finding.** Story 1's harness ships RED outer-loop tests for these adversarial cases; Stories 2-4 turn them GREEN.
- **`searchConversations` decision lives in this sprint as Story 6.** Originally drafted as Story 5 of sprint-018, the decision (keep / align / remove the sprint-009-era `searchConversations`) was relocated here because `searcher.sql` (Stories 2-4 of THIS sprint) is the recipe-alternative for the "remove" path. Bundling the decision with the alternative makes the investigation honest instead of pre-decided. Sprint-018 ships unchanged; sprint-019 picks up Story 6 after the SQL primitive ships.
- **Out of scope (explicit):**
  - **Phase 6 reference tools** (`search_memory` / `query_memory`) — `query_memory` will compose `searcher.sql` once it ships, but the tool wrappers are a separate sprint.
  - **Mutation surface (DML / DDL).** This primitive is read-only by design (§5.1.3). Any mutation lives behind dedicated SDK methods (`storeAsync`, `addSummary` if/when exposed), never through `searcher.sql`. No `INSERT` / `UPDATE` / `DELETE` / `CREATE` ever runs through this path.
  - **Distributed query / federation.** Single SQLite file, single connection. No cross-database joins, no `ATTACH DATABASE` support.
  - **Caching of compiled prepared statements.** First-pass simplicity: `db.prepare()` per call; revisit if a benchmark demands it (Phase 7 territory).
  - **LLM-removal sprint** — out of scope per the standing sprint-016 retro decision.

### User Flows

- **Affected (existing):**
  - **Flow 3 — SQL query (primitive)** (`docs/specs/implementation-spec-005.md` §15): this sprint **implements** the flow that §15 has documented since spec-005 was authored. The flow shape is rebased to raw-SQL-only (drop the DSL example block, drop the translator step from the diagram); Story 5 lands the spec touchup.
- **New (this sprint):** None — `searcher.sql` was specified at spec creation; this sprint ships it. No new user-visible flow shape.

### Test Harness Pattern

Story 1 ships a SQL-primitive integration harness — `tests/integration/searcher-sql.test.ts` — that exercises the raw-SQL path against a seeded corpus + the existing public views. The harness ships **RED outer-loop tests** for each AC of Stories 2-4 plus the adversarial suite (Story 5 inner-loop, but the harness wires the test scaffolding so Story 5 just adds adversarial cases). Outer-loop tests use the public `client.searcher.sql(...)` surface only — no reaching into internals; the imports-from-public-API rule from sprint-018 Story 1 (if landed) is reused here, otherwise this sprint adds the equivalent constraint locally.

**Outer-loop test plan (Story 1 ships RED):**

```typescript
// tests/integration/searcher-sql.test.ts — Story 1 ships RED.
import { Pristine } from '../../src/index.js';

describe('searcher.sql primitive', () => {
  it('raw SELECT against messages_public scoped by project returns rows @AC-Story4-1', async () => {
    // RED: searcher.sql does not exist yet (Stories 2-4 ship it).
  });

  it('raw SELECT against conversations_public with positional ? params returns rows @AC-Story4-2', async () => {
    // RED: same.
  });

  it('rejects non-SELECT SQL (INSERT / UPDATE / DELETE / DROP) with InvalidSqlError @AC-Story3-1', async () => {
    // RED: allowlist parser does not exist yet.
  });

  it('rejects SQL referencing internal table (messages, conversations, vault_*) with InvalidSqlError @AC-Story3-2', async () => {
    // RED: same.
  });

  it('hits row cap at default 1000 rows; configurable per call up to MAX_ROW_CAP @AC-Story2-1', async () => {
    // RED: row-cap cursor wrapper does not exist yet.
  });

  it('aborts long-running query at progress-handler timeout (default 5s) @AC-Story2-2', async () => {
    // RED: progress handler does not exist yet.
  });

  it('rejects vault-table access via raw SQL with InvalidSqlError @AC-Story5-1', async () => {
    // RED — adversarial; Story 5 turns it GREEN once allowlist is in place.
  });
});
```

**Inner-loop tests** live with the implementing story (allowlist parser tests with Story 3, wiring tests with Story 4, etc.).

**`@manual` plumbing:** Backend-only sprint; no `@manual` tests expected. The adversarial DoS test (Story 5) runs automated with a small synthetic table that exercises the row-cap + timeout simultaneously.

### Stories

**Constraints:** Target a maximum of 5-8 stories per sprint. Target a maximum of 5-8 commits per story. If a story needs more than 8 commits during planning, try to split it unless it makes sense for them to not be split.

#### Story 1: SQL primitive integration harness

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [x] Within size limits (5-8 commits; split if larger)
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings (pre-rebase, 7-story plan): iter-1 surfaced 1 P1 (orderBy shape ambiguity, original Story 4 DSL) + multiple P2s (mechanism vagueness, missing fallbacks, cross-story drift on grep pattern + adversarial test file location). Iter-2 returned 5/5 with no findings.
  - Resolution (pre-rebase): All P1/P2s addressed inline. Iter-2 confirmed clean. **Post-rebase note (2026-05-01):** sprint dropped the DSL surface (original Story 4) and renumbered Stories 5/6/7 → 4/5/6. The "orderBy array-of-objects" lock-in is moot (no DSL). All other locks (Story 1 stub-throw, Story 2 progress_handler/db.interrupt fallback, Story 3 non-SELECT keyword set, Story 5 [was 6] empty-vault + cursor-short-circuit fallbacks, cross-story grep pattern, adversarial-suite file location) carry forward unchanged. **Re-review pending:** sprint-doc-reviewer should run a fresh iter-1 pass on the rebased shape before the sprint kicks off.
- **As a** Pristine SDK maintainer shipping the read-only SQL primitive, **I want** an integration harness that exercises every AC of every later story end-to-end (raw-SQL happy path + adversarial paths), **so that** Stories 2-4 can be turned green incrementally and Story 5's adversarial suite slots in without re-scaffolding the harness.
- **Dependencies:** None (Story 1 always ships first)
- **Acceptance criteria:**
  - [ ] `tests/integration/searcher-sql.test.ts` exists, imports `Pristine` from `src/index.js` only, and is wired into `npm run test:integration`.
  - [ ] Harness ships RED outer-loop tests for each downstream-story AC: raw SELECT against `messages_public` (Story 4), raw SELECT with `?` params against `conversations_public` (Story 4), non-SELECT rejection (Story 3), internal-table rejection (Story 3), row cap (Story 2), timeout (Story 2), and at least one vault-access adversarial test (Story 5). The "raw SELECT with `?` params" test MUST exercise positional parameter binding (e.g. pass `'; DROP TABLE messages; --` as a `?`-bound value AND assert the query both succeeds + the table is intact afterwards) so SQL-injection coverage isn't lost with the dropped DSL injection-round-trip test. **Mechanism (locked, uniform across all 7 harness test cases):** Story 1 ships a stub `searcher.sql = async () => { throw new Error('searcher.sql: not implemented (Story N pending)'); }` so each test fails at the runtime stub-throw — NOT at TS-level "Property does not exist" and NOT at module-resolution. This matches the canonical sprint-template guidance for compiled stacks (RED-by-stub, not RED-by-missing-symbol).
  - [ ] Harness uses real Nomic v1.5 only where embed is needed for setup (most SQL tests don't need embedding; seeding writes a few rows directly via `client.storeAsync` + `client.drainEmbedQueue` for the messages-with-content tests). Per-hook + per-it timeouts set to `SLOW_TEST_TIMEOUT_MS = 120_000` matching the sprint-016 hookTimeout pattern.
  - [ ] Harness includes a `seedSqlCorpus()` helper that creates 2 projects × 3 conversations × 3 messages — small, deterministic, dim-stable (no random IDs in assertions).
  - [ ] `npm run test:integration` green excluding the new RED tests; the new RED tests fail as expected.
- **Testing approach:** RED-by-construction outer-loop tests; `seedSqlCorpus` validated by a small inline check that verifies row counts match expected values before any `searcher.sql` call.
- **QA:**
  - Manual: N/A (backend test harness).
  - Automated: `npm run test:integration` — RED tests for Stories 2/3/4/5 visible as failures; existing integration tests still pass.
- **Planned commits:**
  1. `chore(test): scaffold tests/integration/searcher-sql.test.ts + seedSqlCorpus helper`
  2. `test(searcher-sql): RED outer-loop tests for raw SELECT against messages_public + conversations_public (Story 4)`
  3. `test(searcher-sql): RED outer-loop tests for non-SELECT rejection + internal-table rejection (Story 3)`
  4. `test(searcher-sql): RED outer-loop tests for row cap + progress-handler timeout (Story 2)`
  5. `test(searcher-sql): RED outer-loop test for vault-access rejection (Story 5 adversarial)`
- **Technical notes:**
  - **Harness shape parallels `searcher.test.ts`.** The existing sprint-016 cross-cutting harness at `tests/integration/searcher.test.ts` is the reference shape — same hookTimeout pattern, same seeded-corpus pattern, same per-method describe blocks. Don't reinvent.
  - **Vault-access adversarial test (canonical probe — referenced by Story 5 AC-1(c)).** The vault / privacy tables live in `src/privacy/`. **Standardized probe pattern (locked, used by Stories 1 + 5 verbatim):** `grep -rn "CREATE TABLE.*vault\\|CREATE TABLE.*key" src/privacy/`. The RED test at Story 1 verifies `client.searcher.sql(...)` rejects a raw `SELECT * FROM <first-discovered-table>` with `InvalidSqlError`. If the probe returns zero hits (post-sprint-020 the vault footprint may have shrunk), swap in `messages` (an internal corpus table not in the public-view allowlist) and document the swap in the test-file header — Story 5's adversarial suite uses the same fallback so the two stories can't drift.
  - **Row-cap test corpus.** Seed 1500 rows for the row-cap test (default cap 1000). One test asserts default-cap behavior; another asserts a custom-cap-200 call returns 200 rows.
- **Priority:** Must-have

#### Story 2: Read-only connection + progress-handler timeout + row-cap cursor

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [x] Within size limits (5-8 commits; split if larger)
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings (pre-rebase, 7-story plan): iter-1 surfaced 1 P1 (orderBy shape ambiguity, original Story 4 DSL) + multiple P2s (mechanism vagueness, missing fallbacks, cross-story drift on grep pattern + adversarial test file location). Iter-2 returned 5/5 with no findings.
  - Resolution (pre-rebase): All P1/P2s addressed inline. Iter-2 confirmed clean. **Post-rebase note (2026-05-01):** sprint dropped the DSL surface (original Story 4) and renumbered Stories 5/6/7 → 4/5/6. The "orderBy array-of-objects" lock-in is moot (no DSL). All other locks (Story 1 stub-throw, Story 2 progress_handler/db.interrupt fallback, Story 3 non-SELECT keyword set, Story 5 [was 6] empty-vault + cursor-short-circuit fallbacks, cross-story grep pattern, adversarial-suite file location) carry forward unchanged. **Re-review pending:** sprint-doc-reviewer should run a fresh iter-1 pass on the rebased shape before the sprint kicks off.
- **As a** Pristine SDK maintainer building the SQL primitive's safety envelope, **I want** a shared backend that opens a read-only SQLite connection, attaches a per-query timeout, and wraps the result cursor with a row cap, **so that** Story 3 (parser/allowlist) + Story 4 (wiring) can route validated raw SQL through one execution path.
- **Dependencies:** Story 1 (outer-loop tests exist)
- **Acceptance criteria:**
  - [ ] New module `src/memory/searcher/sql-backend.ts` (or co-located with `searcher/index.ts` if size warrants) exposes `executeReadOnly(sql: string, params: unknown[], opts: { rowCap: number; timeoutMs: number }): Promise<readonly Row[]>`.
  - [ ] Each `executeReadOnly` call opens a connection in `SQLITE_OPEN_READONLY` mode against the same DB file as the writable connection. Connection lifecycle: open → execute → close (no shared read-only connection across calls — keeps the row cap + timeout per-call).
  - [ ] Read-only connection aborts queries exceeding `timeoutMs` (default 5000) via `progress_handler` if exposed by the better-sqlite3 binding, OR via `setTimeout` + `db.interrupt()` fallback if not. Either mechanism throws `QueryTimeoutError` (new error class extending `AppError`); the exact mechanism chosen is documented in a Story-2 commit comment so reviewers know which code path to scrutinize.
  - [ ] Cursor wrapper enforces row cap: cursor is iterated up to `rowCap` (default 1000), then closed; any rows beyond the cap are silently dropped (NOT an error — caller chose the cap or accepted default). Document this behavior in JSDoc.
  - [ ] Per-call options: `rowCap` (1 ≤ cap ≤ 10000 — `MAX_ROW_CAP`), `timeoutMs` (100 ≤ ms ≤ 10000 — `MAX_TIMEOUT_MS`, lowered from the originally-drafted 30000 to match the Story 5 DoS-test budget and to bound the synchronous-event-loop blocking — see tech note below). Out-of-range values throw `InvalidArgumentError`.
  - [ ] `Row` type is `Readonly<Record<string, unknown>>` — opaque to the backend; downstream typing happens at the consumer layer.
  - [ ] Story 1's row-cap and timeout RED tests go GREEN.
  - [ ] Unit tests for `executeReadOnly`: row-cap honoring, timeout firing, opt validation, connection close on success + on error.
  - [ ] No regression in unit / integration suites; typecheck + lint clean.
- **Testing approach:** Inner-loop unit tests on `sql-backend.ts` covering: read-only-mode-rejection of DML on the underlying connection (sanity check — even if a future bug lets a DML statement through the parser, the connection blocks it); row-cap honoring with a deterministic 2000-row inline corpus; timeout firing with a deliberately-slow query (`SELECT * FROM <large-table> CROSS JOIN <large-table>` against a small temp table — caps the test runtime). Outer-loop tests via Story 1.
- **QA:**
  - Manual: N/A.
  - Automated: `npm run test:unit` for inner-loop; `npm run test:integration` for outer-loop GREEN.
- **Planned commits:**
  1. `feat(searcher): sql-backend module — executeReadOnly with read-only conn + progress handler + row-cap cursor`
  2. `feat(errors): add QueryTimeoutError extending AppError`
  3. `test(searcher): unit tests for sql-backend — row cap, timeout, opt validation, connection lifecycle`
  4. `docs(searcher): JSDoc on executeReadOnly + Row type — caps + timeout behavior`
- **Technical notes:**
  - **Why per-call connection.** Sharing a single read-only connection across calls would let a slow query block subsequent ones (better-sqlite3 is synchronous; even with `progress_handler`, the cursor takes a tick). Per-call open is ~1ms on a warm OS file cache — acceptable overhead for the rare case where SQL primitive is on a hot path.
  - **Synchronous event-loop blocking (load-bearing constraint).** better-sqlite3 is synchronous — `executeReadOnly` returns a `Promise<readonly Row[]>` for caller ergonomics, but the underlying `db.prepare(sql).iterate()` runs synchronously on the Node event loop. A query running up to `MAX_TIMEOUT_MS` (10s) blocks the event loop for that full duration. JSDoc on `executeReadOnly` MUST document this constraint so callers know not to put `searcher.sql` on a latency-sensitive request path without a worker-thread wrapper. If Phase 6 reference tools (`query_memory`) end up on a hot path, a worker-thread wrapper is a follow-up sprint, not in scope here.
  - **`progress_handler` semantics.** better-sqlite3's `db.function()` doesn't expose `sqlite3_progress_handler` directly — the Node binding is `db.aggregate('progress', ...)` or the stalled-query approach. **Verify at story start:** check the better-sqlite3 docs for the canonical timeout-via-progress-handler pattern; the spec's "attach progress_handler" wording is shorthand for whatever the binding exposes. If the binding lacks a clean progress hook, fall back to wrapping `db.prepare(sql).iterate()` with a `setTimeout`-driven `db.interrupt()` call (also exposed by better-sqlite3).
  - **Row-cap silent drop vs error.** Spec §15 Flow 3 says "Wrap cursor with row cap (default 1000)" — silent drop is the documented default. A future iteration could add an option `rowCapBehavior: 'drop' | 'error'` if a consumer demands it; not in scope this sprint.
  - **Below 5-8 commit floor.** 4 commits — at the lower edge. Splitting (e.g., one commit per opt validation) creates artificial granularity given the tight coupling between connection lifecycle + cursor wrapper + error mapping. Standing exemption pattern from sprint-018 §Sprint-Level Technical Context.
- **Priority:** Must-have

#### Story 3: Public-view allowlist + SQL parser

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [x] Within size limits (5-8 commits; split if larger)
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings (pre-rebase, 7-story plan): iter-1 surfaced 1 P1 (orderBy shape ambiguity, original Story 4 DSL) + multiple P2s (mechanism vagueness, missing fallbacks, cross-story drift on grep pattern + adversarial test file location). Iter-2 returned 5/5 with no findings.
  - Resolution (pre-rebase): All P1/P2s addressed inline. Iter-2 confirmed clean. **Post-rebase note (2026-05-01):** sprint dropped the DSL surface (original Story 4) and renumbered Stories 5/6/7 → 4/5/6. The "orderBy array-of-objects" lock-in is moot (no DSL). All other locks (Story 1 stub-throw, Story 2 progress_handler/db.interrupt fallback, Story 3 non-SELECT keyword set, Story 5 [was 6] empty-vault + cursor-short-circuit fallbacks, cross-story grep pattern, adversarial-suite file location) carry forward unchanged. **Re-review pending:** sprint-doc-reviewer should run a fresh iter-1 pass on the rebased shape before the sprint kicks off.
- **As a** Pristine SDK maintainer enforcing the privacy boundary at the SQL surface, **I want** a parser that extracts referenced tables from a SQL string and rejects any query touching tables outside the allowlist (`messages_public`, `conversations_public`, `summaries_public`), **so that** raw-SQL escape-hatch consumers cannot reach internal tables, vault surfaces, or any future sensitive table by accident or by attack.
- **Dependencies:** Story 1 (outer-loop tests exist), Story 2 (the parser feeds `executeReadOnly`)
- **Acceptance criteria:**
  - [ ] `parseSqlAccess(sql: string): { tables: string[]; isSelect: boolean }` extracts every table reference from a SQL string and reports whether the top-level statement is a SELECT (including `SELECT ... UNION ...` and CTE-fronted `WITH ... SELECT` forms).
  - [ ] `validateSqlAccess(sql: string, allowlist: ReadonlySet<string>): void` calls `parseSqlAccess` and throws `InvalidSqlError` if (a) `isSelect` is false, OR (b) any table in `tables` is NOT in `allowlist`. The error message names the offending table or non-SELECT keyword for debuggability.
  - [ ] **Non-SELECT keyword set (locked):** `EXPLAIN`, `EXPLAIN QUERY PLAN`, `PRAGMA`, `ATTACH`, `DETACH`, `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `REINDEX`, `VACUUM`, `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`, `ANALYZE`, `REPLACE` are all NOT-SELECT (rejected). Top-level statement must be `SELECT` or `WITH ... SELECT`.
  - [ ] The default allowlist is `new Set(['messages_public', 'conversations_public', 'summaries_public'])` — exposed as `DEFAULT_PUBLIC_VIEW_ALLOWLIST` from the module for re-use in tests / future spec evolution. **Story-start decision (locked verbatim, decided autonomously by Story 3 — does NOT depend on Story 6 running first):** inspect `messages_fts`'s column footprint at story start via `PRAGMA table_info(messages_fts);` AND `SELECT name FROM sqlite_schema WHERE name LIKE 'messages_fts%';` (the second discovers FTS5 internal shadow tables: `messages_fts_data`, `messages_fts_idx`, `messages_fts_content`, `messages_fts_docsize`, `messages_fts_config`). Decision rule (rule, not vote): IF `messages_fts` exposes only the externally-projected `content` column (no `metadata`, no `parent_message_id`) AND none of the `messages_fts_*` shadow tables are accidentally added to the allowlist, extend the default allowlist to include exactly the literal string `messages_fts` (string-exact match, no prefix matching, never `messages_fts_data` / `messages_fts_idx` / etc.). Otherwise DO NOT extend — bounce the FTS-recipe requirement to a follow-up sprint that ships a `messages_fts_public` view. **Documented in Story 3 PR body under a `## messages_fts allowlist decision` heading (extended / not extended + reason + the table_info output)** so Story 6's executing agent can consume it at story start without re-investigation.
  - [ ] Parser handles: identifier quoting (`"messages"`, `[messages]`, `\`messages\``); **schema prefixes — only `main.` is stripped for allowlist comparison** (`main.messages_public` → `messages_public`); `temp.<anything>`, `aux.<anything>`, and any other schema prefix throw `InvalidSqlError` (a session-attached temp table named `messages_public` would otherwise bypass the allowlist check on read-only connections that resolve temp tables); case-insensitivity (`SELECT` / `select` / `Select` all detected as SELECT); comments (`-- comment`, `/* comment */`) stripped before parsing. **Allowlist comparison is string-exact (no prefix or substring match)** so `messages_fts_data` is never matched as `messages_fts`.
  - [ ] Parser is conservative: if it cannot determine a table reference unambiguously (e.g., unrecognized SQL syntax), it throws `InvalidSqlError` rather than allowing the query through. Documented in JSDoc as "deny on parse uncertainty."
  - [ ] Story 1's non-SELECT rejection + internal-table rejection RED tests go GREEN.
  - [ ] Inner-loop unit tests cover: every AC bullet above, plus 12+ adversarial cases (SQL-injection-style payloads, identifier-encoding tricks, CTE attacks, `EXPLAIN QUERY PLAN` prefix, `PRAGMA` access).
  - [ ] No regression in unit / integration suites.
- **Testing approach:** Inner-loop unit tests are the bulk of this story — table-driven test list of 30+ SQL strings labeled `(input, expected: 'allow' | 'reject', reason)`. Outer-loop tests via Story 1.
- **QA:**
  - Manual: N/A.
  - Automated: `npm run test:unit` (inner) + `npm run test:integration` (outer GREEN).
- **Planned commits:**
  1. `feat(searcher): parseSqlAccess + validateSqlAccess + DEFAULT_PUBLIC_VIEW_ALLOWLIST`
  2. `feat(errors): add InvalidSqlError extending AppError`
  3. `test(searcher): unit tests for parser — happy paths + 12+ adversarial cases`
  4. `docs(searcher): JSDoc on parser — deny-on-uncertainty rationale + supported SQL surface`
- **Technical notes:**
  - **Don't write a full SQL parser.** Use better-sqlite3's built-in helpers where possible: `db.prepare(sql).reader` is `true` for SELECT-only statements (useful for the `isSelect` gate). For table extraction, two candidate mechanisms exist; pick at story start:
    1. `EXPLAIN QUERY PLAN <sql>` returns a row-set listing referenced tables. **Caveat (verify at story start, do NOT assume):** SQLite typically resolves views to their underlying tables in QUERY PLAN output — i.e., `SELECT * FROM messages_public` may show `messages` in the plan, NOT `messages_public`. If that holds, EXPLAIN cannot be the primary mechanism (it would force every legitimate view query through an `internal-table` rejection). Confirm with `db.prepare('EXPLAIN QUERY PLAN SELECT * FROM messages_public').all()` and read the output before locking in.
    2. A static parser over the SQL string (regex for the simple cases — `FROM <ident>`, `JOIN <ident>` — plus a tokeniser that handles quoting + comments). Slower to write but deterministic, no DB round-trip, no DoS surface during validation. **Recommended primary** if EXPLAIN resolves views to underlying tables.
    Whichever is chosen, **the validation path must NOT execute SQL against the read-only connection** before the row-cap + timeout are attached. EXPLAIN QUERY PLAN counts as execution — a pathological CTE bomb in EXPLAIN would DoS the parser before the query body's progress handler is in place. If EXPLAIN is used, wrap it in the same `setTimeout` + `db.interrupt()` envelope Story 2 ships, with a tighter validation-phase budget (≤500ms).
  - **Why deny-on-uncertainty.** A permissive parser that allows unknown syntax through is a privacy-boundary risk. Better to reject a legitimate-but-novel query (the consumer can rephrase or open an issue to extend the parser) than to leak access to an internal table.
  - **CTE handling.** `WITH foo AS (SELECT ...) SELECT * FROM foo` references `foo` (CTE-local) and whatever the inner SELECT touches. Parser must extract the inner SELECT's tables, not just `foo`.
  - **Why a separate error class for SQL.** Distinguishes parser-level rejection (`InvalidSqlError`) from runtime SQLite errors (which surface as the underlying better-sqlite3 error). Consumers can catch `InvalidSqlError` to render a "your query is not allowed" UX without confusing it with "the database is broken".
  - **Below 5-8 commit floor.** 4 commits. Standing exemption — the parser is one cohesive unit.
- **Priority:** Must-have

#### Story 4: Wire `searcher.sql` on the public Searcher interface

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [x] Within size limits (5-8 commits; split if larger)
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings (pre-rebase, 7-story plan): iter-1 surfaced 1 P1 (orderBy shape ambiguity, original Story 4 DSL) + multiple P2s (mechanism vagueness, missing fallbacks, cross-story drift on grep pattern + adversarial test file location). Iter-2 returned 5/5 with no findings.
  - Resolution (pre-rebase): All P1/P2s addressed inline. Iter-2 confirmed clean. **Post-rebase note (2026-05-01):** sprint dropped the DSL surface (original Story 4) and renumbered Stories 5/6/7 → 4/5/6. The "orderBy array-of-objects" lock-in is moot (no DSL). All other locks (Story 1 stub-throw, Story 2 progress_handler/db.interrupt fallback, Story 3 non-SELECT keyword set, Story 5 [was 6] empty-vault + cursor-short-circuit fallbacks, cross-story grep pattern, adversarial-suite file location) carry forward unchanged. **Re-review pending:** sprint-doc-reviewer should run a fresh iter-1 pass on the rebased shape before the sprint kicks off.
- **As a** Pristine SDK consumer ready to use the SQL primitive, **I want** `client.searcher.sql(sql, opts?)` to be the single public entry point, **so that** I don't have to compose `executeReadOnly` and `validateSqlAccess` myself.
- **Dependencies:** Stories 2, 3 (the two building blocks)
- **Acceptance criteria:**
  - [ ] `Searcher` interface (`src/memory/searcher/index.ts`) gains `sql(sql: string, opts?: SqlOpts): Promise<readonly Row[]>`. JSDoc names the read-only contract, the positional-`?`-only parameter binding, the row-cap + timeout defaults, and the public-view allowlist.
  - [ ] `createSearcher` factory wires the two modules linearly: input SQL string → `validateSqlAccess` → `executeReadOnly`. No mode dispatch, no translator step.
  - [ ] `SqlOpts` type: `{ params?: readonly unknown[]; rowCap?: number; timeoutMs?: number }`. `params` is bound positionally to `?` placeholders in the SQL string; out-of-range opts throw `InvalidArgumentError` (delegated to Story 2's `executeReadOnly`).
  - [ ] `searcher.sql` types are exported from `src/index.ts`: `SqlOpts` (defined in this story's AC-3 above), `Row` (defined in Story 2's `Row` type AC bullet — `Readonly<Record<string, unknown>>`), `InvalidSqlError` (defined in Story 3's `InvalidSqlError` AC bullet), `QueryTimeoutError` (defined in Story 2's progress-handler AC bullet — new error class extending `AppError`). No DSL types — the primitive accepts raw SQL only.
  - [ ] Story 1's outer-loop tests for raw SELECT (×2), non-SELECT rejection, internal-table rejection, row cap, and timeout all GREEN.
  - [ ] Pristine doc-comment block on the Searcher interface mentions `sql` alongside the four search methods.
  - [ ] No regression in unit / integration suites.
- **Testing approach:** Wiring-level integration tests via Story 1's outer-loop suite. This story's own unit tests are minimal — covering default-opt application and the validate-then-execute order. **Order-of-operations assertion (locked):** spy on `validateSqlAccess` and `executeReadOnly` (e.g. via vitest `vi.spyOn` on the imported module), call `searcher.sql(...)`, assert `validateSqlAccess.mock.invocationCallOrder[0] < executeReadOnly.mock.invocationCallOrder[0]`.
- **QA:**
  - Manual: N/A.
  - Automated: full `npm run test:integration` GREEN for Story 1's RED tests (Story 5 adversarial still RED until that story).
- **Planned commits:**
  1. `feat(searcher): wire sql method on Searcher interface — validateSqlAccess + executeReadOnly`
  2. `feat(api): export SqlOpts / Row / InvalidSqlError / QueryTimeoutError from src/index.ts`
  3. `test(searcher): unit tests for searcher.sql — default-opt application + validate-then-execute order`
  4. `docs(searcher): JSDoc on searcher.sql — single entry point, raw-SQL contract, opts contract`
- **Technical notes:**
  - **Validate-then-execute ordering is non-negotiable.** Any path that calls `executeReadOnly` before `validateSqlAccess` is a privacy-boundary regression. The factory wiring must be linear: input → validate → execute. A sub-agent reviewer should explicitly check this in story PR review.
  - **No DSL escape hatch.** The primitive accepts raw SQL only (sprint-doc rebase decision: LLMs are competent at SQL, no need for a second grammar). Consumers that want a typed query builder can compose one over `searcher.sql` in their own code; it isn't on the SDK surface.
  - **Below 5-8 commit floor.** 4 commits. Standing exemption — wiring is a single integration unit.
- **Priority:** Must-have

#### Story 5: Adversarial privacy suite + spec §15 Flow 3 update + JSDoc

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [x] Within size limits (5-8 commits; split if larger)
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings (pre-rebase, 7-story plan): iter-1 surfaced 1 P1 (orderBy shape ambiguity, original Story 4 DSL) + multiple P2s (mechanism vagueness, missing fallbacks, cross-story drift on grep pattern + adversarial test file location). Iter-2 returned 5/5 with no findings.
  - Resolution (pre-rebase): All P1/P2s addressed inline. Iter-2 confirmed clean. **Post-rebase note (2026-05-01):** sprint dropped the DSL surface (original Story 4) and renumbered Stories 5/6/7 → 4/5/6. The "orderBy array-of-objects" lock-in is moot (no DSL). All other locks (Story 1 stub-throw, Story 2 progress_handler/db.interrupt fallback, Story 3 non-SELECT keyword set, Story 5 [was 6] empty-vault + cursor-short-circuit fallbacks, cross-story grep pattern, adversarial-suite file location) carry forward unchanged. **Re-review pending:** sprint-doc-reviewer should run a fresh iter-1 pass on the rebased shape before the sprint kicks off.
- **As a** Pristine SDK maintainer locking in the privacy boundary, **I want** an adversarial test suite that systematically tries every attack class spec §8.6 names — DML, internal-table SELECT, vault SELECT, DoS — and verifies each one is rejected or row-capped, **so that** Phase 5's privacy contract is provably enforced and any future regression fails CI loudly.
- **Dependencies:** Stories 2-4 (the SQL primitive must exist for adversarial tests to run against it)
- **Acceptance criteria:**
  - [ ] Adversarial cases **appended to `tests/integration/searcher-sql.test.ts`** (locked — single file keeps the harness's adversarial coverage co-located with its happy-path coverage and avoids fragmenting test-discovery globs) — at least 20 adversarial test cases organized into 4 attack classes under a top-level `describe('searcher.sql adversarial suite', ...)` block:
    - **(a) DML attempts** (≥ 5 cases): `INSERT`, `UPDATE`, `DELETE`, `DROP TABLE`, `ALTER TABLE`. Each must throw `InvalidSqlError`.
    - **(b) Internal-table SELECT** (≥ 5 cases): `SELECT * FROM messages`, `SELECT * FROM conversations`, `SELECT * FROM vec_windows`, `SELECT * FROM vec_sessions`, `SELECT * FROM messages_fts`. Each must throw `InvalidSqlError`. **NOTE (allowlist-conditional, locked at Story 1 scaffold time):** if Story 3 extended the default allowlist to include `messages_fts` (decided autonomously in Story 3 — see Story 3 PR body), drop `messages_fts` from this case set AND substitute the FTS5 shadow tables `messages_fts_data` and `messages_fts_idx` (both must reject — confirms the parser does string-exact matching, not prefix matching). Also append `SELECT * FROM embed_jobs` and `SELECT * FROM migrations` IF those tables exist in `src/conversations/store.ts` (probe via `grep -n "CREATE TABLE" src/conversations/store.ts` at scaffold time; substitute any internal-only table not in the public-view allowlist). The harness header records the locked substitution list once at Story 1 scaffold; Story 5 reads from that locked list rather than re-investigating.
    - **(c) Vault / privacy surface SELECT** (≥ 3 cases): use the standardized probe defined in Story 1 Tech Notes (`grep -rn "CREATE TABLE.*vault\\|CREATE TABLE.*key" src/privacy/`) to enumerate target tables. **Fallback (locked):** if the probe returns zero privacy-module tables, substitute 3 internal-corpus tables not in the public-view allowlist (e.g., `messages_fts`, `vec_windows`, `vec_sessions`); document the substitution in the test-file header so reviewers know why vault tables aren't there. Each must throw `InvalidSqlError`.
    - **(d) DoS / row-cap escape** (≥ 3 cases): cartesian join over a small table that produces > 1M rows; the row cap must terminate iteration at `rowCap`. Long-running sleep-style query (using `randomblob(1000000)` recursion or a CTE bomb); the timeout must fire and throw `QueryTimeoutError`. **Fallback (locked):** if Story 2's row-cap cursor cannot short-circuit SQLite's join evaluation cleanly (verify at story start), the cartesian-join test instead asserts wall-time bound (`≤10s`) — flag the limitation in the story PR for a future optimization sprint; do NOT block this story on cursor short-circuit being optimal.
    - **(e) Identifier-encoding tricks** (≥ 5 cases): `SELECT * FROM "messages"`, `SELECT * FROM [messages]`, `` SELECT * FROM `messages` ``, `SELECT * FROM main.messages`, `SELECT * FROM temp.messages_public` (schema-prefix-other-than-`main.` must reject — confirms the schema-stripping is `main.`-only per Story 3 AC), `SELECT * FROM messages -- comment`, `SELECT /* injected */ * FROM messages`, `WITH foo AS (SELECT * FROM messages) SELECT * FROM foo`, **nested-CTE attack** `WITH a AS (WITH b AS (SELECT * FROM messages) SELECT * FROM b) SELECT * FROM a` (parser must recurse into nested CTEs to extract inner-table refs). Each must throw `InvalidSqlError`.
  - [ ] All adversarial tests run on every CI invocation (NOT marked `@skip` or `@manual`).
  - [ ] `docs/specs/implementation-spec-005.md` §15 Flow 3 + §5.1.3 + §16 Phase-5 + Flow 5 updated with: (a) `client.searcher.sql(sql, opts?)` as the single consumer surface, raw SQL only — no DSL/translator step in the diagram; (b) **DSL example block under §15 Flow 3 DELETED** — anchor by the `### Flow 3 — SQL query (primitive)` heading and the `searcher.sql({` typescript fence underneath, NOT by line number (line numbers will shift as edits land in the same commit); (c) **§15 Flow 5 (`query_memory` reference impl) updated** to show raw-SQL composition rather than DSL — anchor by the `### Flow 4 — \`search_memory\``/`### Flow 5 — \`query_memory\`` heading; the LLM emits SQL, the handler validates + executes; (d) §5.1.3 wording "scoped DSL (preferred) or raw SQL (escape hatch)" replaced with "raw SQL with positional `?` parameter binding"; (e) §16 P5-S1-S4 collapsed to the rebased 3-story implementation set (P5-S1: connection+timeout+row-cap; P5-S2: parser+allowlist; P5-S3: wire `searcher.sql` on Searcher) — anchor by `## §16` / `### Phase 5` heading. Cross-reference: spec §5.1.3 and §15 must agree on the surface shape after the touchup. **If a section heading anchor cannot be located, fall back to a full-file grep for the exact heading text rather than guessing line numbers.**
  - [ ] §16 Phase 5 Done-when checkboxes can all be checked: SQL primitive safe + useful, adversarial tests pass, privacy boundary validated.
  - [ ] JSDoc on `searcher.sql` references §15 Flow 3 and §8.6 for the privacy contract.
- **Testing approach:** Adversarial test cases are the deliverable. Each test asserts a specific error class + a message-pattern match (the error message names the offending construct). DoS tests assert wall-time bounds (no test should run > 30s).
- **QA:**
  - Manual: N/A.
  - Automated: full `npm run test:integration` — Story 1's adversarial RED tests now GREEN; the other 19+ adversarial cases pass.
- **Planned commits:**
  1. `test(searcher-sql): adversarial DML attempts — INSERT / UPDATE / DELETE / DROP / ALTER`
  2. `test(searcher-sql): adversarial internal-table SELECT — messages / conversations / vec_* / messages_fts (or substitute per Story 3 allowlist decision)`
  3. `test(searcher-sql): adversarial vault-table SELECT — every privacy-module table (with empty-vault fallback)`
  4. `test(searcher-sql): adversarial DoS — cartesian join + CTE bomb (row cap + timeout fire)`
  5. `test(searcher-sql): adversarial identifier-encoding tricks — quoting / schema prefix / comments / CTE`
  6. `docs(spec): implementation-spec-005 §15 Flow 3 + §5.1.3 + Flow 5 — raw-SQL surface, drop DSL example block, drop translator step from diagram`
- **Technical notes:**
  - **DoS test budget.** Each DoS test bounded by **wall-time ≤10s as the primary assertion** (NOT by an optimistic row-count estimate). The cartesian-join attack against a 1500-row corpus produces ~2.25M-row joins; if the row-cap cursor short-circuits SQLite's join evaluation cleanly the test will pass at ~1s, and if it doesn't (because SQLite materialises the full join before yielding), the timeout fires at 10s and the test still passes via `QueryTimeoutError`. Either path is acceptable — the row-cap optimisation is a perf nice-to-have, not a correctness condition. Verify at story start which path SQLite takes; record the observation in the story PR for future optimisation work.
  - **Identifier-encoding tricks are the highest-risk class.** Story 3's parser must treat `"messages"`, `[messages]`, and `\`messages\`` as identical to `messages` for allowlist comparison. The story's adversarial tests verify each form rejects.
  - **Spec touchup grew with the rebase.** Originally a single §15 Flow 3 edit. Post-rebase it touches §5.1.3 (surface wording), §15 Flow 3 (drop DSL example, simplify diagram), §15 Flow 5 (`query_memory` reference impl uses raw SQL not DSL), and §16 Phase-5 done-when. All in one commit so reviewers see the cumulative spec delta together.
  - **Below 5-8 commit floor — N/A here.** 6 commits, in range.
- **Priority:** Must-have

#### Story 6: Decide on `searchConversations` — keep, align, or remove (relocated from sprint-018)

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [ ] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [ ] Within size limits (5-8 commits; split if larger)
  - [ ] Reviewed by sub-agent
  - [ ] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: *(populated at iter-2 sub-agent review of this sprint)*
  - Resolution: *(populated at iter-2 sub-agent review)*
- **As a** Pristine SDK maintainer evaluating overlap between sprint-009-era `searchConversations` (user-scoped, conversation-level FTS w/ snippets) and the spec-005 surface (`searcher.ftsSearch` message-level + `searcher.sql` over `messages_public` / `conversations_public`), **I want** an explicit decision committed to the docs and reflected in the API, **so that** Phase 6 reference tools and external consumers know which surface to reach for and don't accidentally bake in the legacy one.
- **Dependencies:** Stories 2-5 (the `searcher.sql` recipe path requires the SQL primitive to exist + be tested)
- **Acceptance criteria:**
  - [ ] Investigation block in the story PR body answers: (1) how does `searchConversations` differ from `searcher.ftsSearch` and `searcher.sql` semantically (scoping, granularity, return shape, snippet rendering); (2) **enumerate every consumer** — list every grep hit for `searchConversations` across `src/`, `tests/`, `scripts/`, and `docs/` (use `grep -rn "searchConversations" src/ tests/ scripts/ docs/`), with a one-line note per hit identifying it as production / test / script / doc; (3) the concrete `searcher.sql` recipe that recovers `searchConversations`'s shape (input → output, with the actual raw-SQL string + positional `?` params).
  - [ ] Decision is one of: **(a) Keep with doc clarification** — JSDoc on `searchConversations`, `searcher.ftsSearch`, AND `searcher.sql` explaining when to reach for each; **(b) Align with project-scoping** — make `searchConversations` accept `projectId` (additive — `userId` becomes optional) and harmonize the contract with `searcher.*`; **(c) Remove + recipe** — delete the method, ship the concrete `searcher.sql` raw-SQL recipe in JSDoc + spec §5.2 reference-implementations. **Path-(c) is GATED on Story 3's allowlist decision: if Story 3's PR body documents `not extended` for `messages_fts`, path-(c) is unreachable in this sprint and the decision MUST be (a) Keep** (Story 6 must NOT re-investigate; Story 3's logged outcome is authoritative). If Story 3 documents `extended`, all three paths remain in scope and the recipe-equivalence unit test (per the Testing-approach section below) is the path-(c) gate.
  - [ ] Decision is implemented in this PR (whichever path).
  - [ ] In-repo consumers (`scripts/search-conversations.ts`, any test fixtures) are updated to match the decision. If the decision is (c), the script either migrates to `searcher.sql` (using the AC's documented recipe) or the script itself is removed (with a brief note in commit message).
  - [ ] If decision is (a) or (b), the JSDoc cross-references are bidirectional (each method points at its alternatives).
  - [ ] `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration` all clean.
- **Testing approach:** Inner-loop unit tests for any signature change (option b) or migration recipe (option c). For option (c), the recipe MUST be exercised by a unit test that runs `searcher.sql` with the recipe's raw-SQL string and asserts equivalent rows to the legacy `searchConversations` for at least 3 representative inputs. No new outer-loop tests — the decision determines the shape, then existing tests verify the chosen behavior.
- **QA:**
  - Manual: If decision is (c) and `scripts/search-conversations.ts` is migrated rather than removed, run it once locally against a small corpus to confirm the migration produces equivalent results. Tag this `@manual`.
  - Automated: full suite green; recipe-equivalence unit test (option c only) passes.
- **Planned commits (path-conditional — pick the matching list at story start):**

  Common:
  1. `docs(sprint): record searchConversations investigation + chosen path in the PR body`

  **Path (a) — Keep with doc clarification (commits 2-3):**
  2. `docs(client): JSDoc on PristineLocal.searchConversations cross-referencing searcher.ftsSearch + searcher.sql`
  3. `docs(searcher): JSDoc on Searcher.ftsSearch + Searcher.sql cross-referencing client.searchConversations`

  **Path (b) — Align with projectId (commits 2-5):**
  2. `feat(conversations): searchConversations accepts projectId additively — userId becomes optional`
  3. `refactor(scripts): update scripts/search-conversations.ts to use the new param shape`
  4. `test(conversations): unit + integration tests for the new param resolution + precedence`
  5. `docs(client): JSDoc on the new param shape`

  **Path (c) — Remove + recipe (commits 2-5):**
  2. `refactor(client): remove PristineLocal.searchConversations + ConversationStore.searchConversations`
  3. `refactor(scripts): migrate scripts/search-conversations.ts to compose searcher.sql per the documented recipe (or remove the script with rationale)`
  4. `test(searcher-sql): recipe-equivalence unit test — searcher.sql with the raw-SQL recipe produces equivalent rows to the legacy searchConversations on 3+ inputs`
  5. `docs(spec): add migration recipe to implementation-spec-005.md §5.2 reference-implementations — concrete searcher.sql raw-SQL form`
- **Technical notes:**
  - **Concrete impl differences (validate at story start):** `searchConversations` (a) requires `userId` as primary scope; (b) returns `ConversationSearchResult[]` — one row per conversation with a `snippet` string; (c) uses `escapeFts5Query` defensively; (d) does NOT take a projectId. `searcher.ftsSearch` (a) requires `projectId`; (b) returns `MessageHit[]` — one per matching message; (c) propagates FTS5-query syntax errors as `InvalidArgumentError`. `searcher.sql` (Stories 2-4 of this sprint) (a) accepts raw SQL against `messages_public` / `conversations_public` (and `messages_fts` if Story 3's allowlist decision extends it); (b) returns `Row[]` opaque shape; (c) lets a consumer build the exact JOIN + snippet that `searchConversations` produces today. All three ride `messages_fts` underneath.
  - **Bias reset by user input.** Original sprint-018 draft biased toward (a) Keep — because no concrete `searcher.sql` alternative existed. Now that Stories 2-4 of THIS sprint ship `searcher.sql`, (c) Remove + recipe becomes the cleanest path: one less leaky-by-user-scoping API on the public surface, one explicit recipe in the spec. Investigation should re-evaluate from a (c)-friendly default. If the recipe-equivalence unit test reveals an irreducible gap (e.g., FTS5 snippet rendering can't be reproduced equivalently), fall back to (a) with a documented "stays for ergonomic snippet rendering" rationale.
  - **If decision is (b) — align with projectId.** Backwards-compat path: accept `userId` OR `projectId`; enforce at least one; document precedence in JSDoc. Avoid breaking the existing call shape.
  - **If decision is (c) — recipe shape.** The recipe must be a copy-pasteable raw-SQL string in the JSDoc and spec, NOT a prose description. Example shape (validate at story start; assumes Story 3 extended allowlist to include `messages_fts`):
    ```ts
    // Recipe: keyword search across a project's conversations, returning per-message snippets ordered by relevance.
    // NOTE: caller-supplied `limit` MUST satisfy `limit <= rowCap` (default rowCap=1000); the recipe-equivalence
    // unit test binds limit=10 to keep well under the row cap. If a caller passes limit>rowCap, the row-cap
    // cursor will silently truncate before LIMIT is satisfied, producing a confusing partial result.
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
    **Story-start verification (locked):** read Story 3's PR body for the `## messages_fts allowlist decision` heading. If Story 3 documented `extended` → path-(c) is reachable; proceed with the recipe + recipe-equivalence test. If Story 3 documented `not extended` → path-(c) is unreachable in this sprint; the decision MUST be (a) Keep (with JSDoc cross-references to `searcher.ftsSearch` + `searcher.sql`) and the spec touchup notes that the path-(c) recipe lands once `messages_fts_public` view ships in a follow-up sprint. Do NOT re-investigate the allowlist decision; consume Story 3's logged outcome as the read-only input.
- **Priority:** Must-have

### Sprint completion

After the last feature story merges into `sprint-019`, the agent runs the **sprint-completion workflow** — there is NO dedicated "evaluation story" PR. The canonical spec lives at `workflow-prompts/handle-sprint-completion.md`; this section describes the WHAT (two artifacts and the user-facing shape), not the HOW (commands, edge cases, escalation rules).

**1. 6-section chat message** emitted into the conversation. Sections in this exact order — `**Mergeability:** X/5` (headline), `## Sprint objective + accomplishments` (narrative: objective restated + per-story how-this-contributed-to-the-goal bullets), `## Why ready`, `## Open for your decision`, `## Delivered` (one row per AC), `## Drift from spec`. Only Pass ACs land in Delivered as `✅`; Ambiguous and `@manual` items go under "Open for your decision". The objective+accomplishments section is narrative-shaped (one bullet per story, not per AC) and explains WHY each story was done — Delivered is the pass/fail matrix, not a story. Drafting agents: copy the canonical schema from `handle-sprint-completion.md` Step 3 verbatim — that's the source of truth.

**2. Sprint-doc mutation** committed directly on `sprint-019` BEFORE the sprint-integration PR opens:

- Check every Pass AC checkbox across every story (`[ ]` → `[x]`). Failed and Ambiguous ACs stay unchecked — see the workflow's Escalation rule.
- Flip the `**Status:**` line from `🔵 In Progress` to `🟢 Complete`.
- Append a `## Final Review` section at the bottom of the sprint doc, quoting the chat message verbatim underneath.

The mutation commit is the durable audit trail: one sprint, one doc, one self-contained record. The chat message is the live verdict; the doc mutation is the permanent record.

After the mutation commit lands on `sprint-019`, the sprint-integration PR (`sprint-019 → main`) opens per `workflow-prompts/handle-pr-activity.md` Step 4a — its cumulative diff includes the mutation as evidence.

### Rules

- **Sprint-branch setup (before Story 1):** create `sprint-019` off `main` and push. Commit this sprint doc as the first commit on the branch. Story branches fork from `sprint-019`; story PRs target `sprint-019`. After the last feature story merges and the sprint-completion workflow (`workflow-prompts/handle-sprint-completion.md`) runs, open a sprint-integration PR (`sprint-019 → main`) as the final step. See AGENTS.md §3 for the full workflow + edge cases (mid-sprint hotfix, abandonment, cross-sprint deps).
- We sequentially do the stories. We do not do parallel work.
- **Review loop:** Open PRs, run `/review` (nudged by the PostToolUse hook), address findings, re-verify via `/review-fix` (capped at 3 passes per PR — see `workflow-prompts/handle-pr-activity.md`), confirm local checks are green and the last review turn returned mergeability ≥ 4/5 with no open P0/P1 findings, merge into `sprint-019`, then move to the next story. The sprint-integration PR goes through the same loop — cumulative-diff `/review` catches cross-story interactions.
- **Parallel experiment option (explicit exception):** when a story is explicitly scoped as an isolated experiment, consider `/skill:worktree create <branch>` to run it in a separate cmux workspace with its own Pi session, or to discard it cleanly via `/skill:worktree remove`. This does not change the default sequential rule above. See AGENTS.md §20 for prerequisites and scope.
- Record new dependencies in the Completion section's New Dependencies field.
- For everything else — commits, PR process, code quality, testing — follow your system instructions (the conventions loaded at session start).

### Definition of Done

- All must-have stories pass acceptance criteria
- System-instruction conventions satisfied (code quality, tests, PR process, conventional commits, local checks green, last review turn — `/review` or `/review-fix` — returned mergeability ≥ 4/5 with no open P0/P1 findings)
- **Sprint completion run** per `workflow-prompts/handle-sprint-completion.md` — sprint doc mutated (every AC box checked, Status `🟢 Complete`, `## Final Review` appended quoting the chat message verbatim); 6-section chat message emitted into conversation
- **Sprint-integration PR merged** (`sprint-019 → main`); `sprint-019` deleted from origin; local `main` fast-forwarded
- **Spec touchup landed** (Story 5) — `docs/specs/implementation-spec-005.md` §5.1.3 + §15 Flow 3 + §15 Flow 5 + §16 Phase-5 reflect the shipped surface: `client.searcher.sql(sql, opts?)` with raw-SQL only, no DSL example block, no translator step in the diagram; §16 Phase 5 Done-when checkboxes ticked
