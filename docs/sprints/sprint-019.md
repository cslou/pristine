# Pristine — Sprint 019
**Date:** 2026-04-28 – TBD
**Goal:** Ship spec-005 Phase 5 — the `searcher.sql` primitive: a read-only, public-view-scoped, row-capped, timeout-bounded SQL surface that lets consumers compose ad-hoc queries (and future Phase 6 reference tools) without exposing internal tables or any privacy/vault surface.
**Status:** 🟡 Planning

---

## Handoff

### Project Context

- **Repo:** `/Users/lou/projects/pristine`
- **Tech stack:** TypeScript (strict, ESM), Node 18+, `better-sqlite3` + `sqlite-vec`, `@huggingface/transformers` (Nomic Embed v1.5, 768-d), Vitest. Local-first — zero outbound network calls in production code.
- **Current state:** Sprints 015-016 shipped Phases 3 (indexer) and 4 (searcher: `vectorSearch` + `ftsSearch` + `hybridSearch` + `sessionVectorSearch`). The corpus tables, indexes, and public views (`messages_public`, `conversations_public`, `summaries_public`) already exist in `src/conversations/store.ts:226-282`. The `Searcher` interface at `src/memory/searcher/index.ts` exposes the four search methods but **does not yet expose `sql`** — that's the missing primitive this sprint adds. Every other Phase-5 building block is in place: better-sqlite3 supports `SQLITE_OPEN_READONLY`, `progress_handler`, and prepared-statement parameter binding natively. The privacy boundary is already validated at the storage layer (vault tables stay out of the public-view DDLs); Phase 5's job is to enforce that no SQL query — DSL or raw — can reach past the views.
- **Implementation spec:** `docs/specs/implementation-spec-005.md` — §5.1.3 lists `searcher.sql(queryDsl | rawSql, params): Row[]` as a primitive; §15 Flow 3 describes the validation pipeline (validate access surface → DSL translate / raw parse → read-only conn → progress handler → row-cap cursor → execute); §16 Phase 5 enumerates stories P5-S1 through P5-S4; §8.6 specifies the adversarial test suite the privacy boundary must survive.

### Sprint-Level Technical Context

- **Phase 5 ships the THIRD of three primitives.** Sprint-015 shipped `indexer`; sprint-016 shipped `searcher.{vector,fts,hybrid,session}Search`; this sprint completes `searcher` with `searcher.sql`. After this sprint, the spec-005 §5.1 primitive surface is functionally complete.
- **No DDL changes.** The public views (`messages_public`, `conversations_public`, `summaries_public`) and the underlying tables already exist. This sprint only ships the SQL-execution path on top of them. If a missing column or view surface comes up during DSL design (e.g., a needed `vec_windows_public`), defer that as a follow-up sprint — do NOT bundle DDL changes into this sprint.
- **Two SQL surfaces, one code path.** Per spec §15 Flow 3, both DSL and raw-SQL modes converge on the same read-only-connection + progress-handler + row-cap pipeline. Story 2 ships that shared backend; Stories 3 and 4 ship the two parsers/translators that feed it.
- **Privacy boundary is the load-bearing concern.** Story 6's adversarial test suite (matching spec §8.6) is non-negotiable: every adversarial query — DML, internal-table SELECT, vault SELECT, DoS via cartesian join — must be rejected with a typed error or row-capped before completion. **A privacy-boundary regression here is a P0 finding.** Story 1's harness ships RED outer-loop tests for these adversarial cases; Stories 2-5 turn them GREEN.
- **`searchConversations` decision lives in this sprint as Story 7.** Originally drafted as Story 5 of sprint-018, the decision (keep / align / remove the sprint-009-era `searchConversations`) was relocated here because `searcher.sql` (Stories 2-5 of THIS sprint) is the recipe-alternative for the "remove" path. Bundling the decision with the alternative makes the investigation honest instead of pre-decided. Sprint-018 ships unchanged; sprint-019 picks up Story 7 after the SQL primitive ships.
- **Out of scope (explicit):**
  - **Phase 6 reference tools** (`search_memory` / `query_memory`) — `query_memory` will compose `searcher.sql` once it ships, but the tool wrappers are a separate sprint.
  - **Mutation surface (DML / DDL).** This primitive is read-only by design (§5.1.3). Any mutation lives behind dedicated SDK methods (`storeAsync`, `addSummary` if/when exposed), never through `searcher.sql`. No `INSERT` / `UPDATE` / `DELETE` / `CREATE` ever runs through this path.
  - **Distributed query / federation.** Single SQLite file, single connection. No cross-database joins, no `ATTACH DATABASE` support.
  - **Caching of compiled prepared statements.** First-pass simplicity: `db.prepare()` per call; revisit if a benchmark demands it (Phase 7 territory).
  - **LLM-removal sprint** — out of scope per the standing sprint-016 retro decision.

### User Flows

- **Affected (existing):**
  - **Flow 3 — SQL query (primitive)** (`docs/specs/implementation-spec-005.md` §15): this sprint **implements** the flow that §15 has documented since spec-005 was authored. The flow doc itself stays unchanged in shape; Story 6 lands a JSDoc-style spec touchup if implementation reveals nuance the spec missed.
- **New (this sprint):** None — `searcher.sql` was specified at spec creation; this sprint ships it. No new user-visible flow shape.

### Test Harness Pattern

Story 1 ships a SQL-primitive integration harness — `tests/integration/searcher-sql.test.ts` — that exercises both DSL and raw-SQL paths against a seeded corpus + the existing public views. The harness ships **RED outer-loop tests** for each AC of Stories 2-5 plus the adversarial suite (Story 6 inner-loop, but the harness wires the test scaffolding so Story 6 just adds adversarial cases). Outer-loop tests use the public `client.searcher.sql(...)` surface only — no reaching into internals; the imports-from-public-API rule from sprint-018 Story 1 (if landed) is reused here, otherwise this sprint adds the equivalent constraint locally.

**Outer-loop test plan (Story 1 ships RED):**

```typescript
// tests/integration/searcher-sql.test.ts — Story 1 ships RED.
import { Pristine } from '../../src/index.js';

describe('searcher.sql primitive', () => {
  it('DSL select returns rows from messages_public scoped by project @AC-Story4-1', async () => {
    // RED: searcher.sql does not exist yet (Stories 2-5 ship it).
  });

  it('raw SQL escape hatch executes a SELECT against conversations_public @AC-Story4-2', async () => {
    // RED: same.
  });

  it('rejects non-SELECT raw SQL (INSERT / UPDATE / DELETE / DROP) with InvalidSqlError @AC-Story3-1', async () => {
    // RED: allowlist parser does not exist yet.
  });

  it('rejects raw SQL referencing internal table (messages, conversations, vault_*) with InvalidSqlError @AC-Story3-2', async () => {
    // RED: same.
  });

  it('hits row cap at default 1000 rows; configurable per call up to MAX_ROW_CAP @AC-Story2-1', async () => {
    // RED: row-cap cursor wrapper does not exist yet.
  });

  it('aborts long-running query at progress-handler timeout (default 5s) @AC-Story2-2', async () => {
    // RED: progress handler does not exist yet.
  });

  it('rejects vault-table access via raw SQL with InvalidSqlError @AC-Story6-1', async () => {
    // RED — adversarial; Story 6 turns it GREEN once allowlist is in place.
  });
});
```

**Inner-loop tests** live with the implementing story (allowlist parser tests with Story 3, DSL translator tests with Story 4, etc.).

**`@manual` plumbing:** Backend-only sprint; no `@manual` tests expected. The adversarial DoS test (Story 6) runs automated with a small synthetic table that exercises the row-cap + timeout simultaneously.

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
  - Findings: iter-1 surfaced 1 P1 (orderBy shape ambiguity, Story 4) + multiple P2s (mechanism vagueness, missing fallbacks, cross-story drift on grep pattern + adversarial test file location). Iter-2 returned 5/5 with no findings.
  - Resolution: All P1/P2s addressed inline (Story 4 array-of-objects shape locked; Story 1 stub-throw locked; Story 2 progress_handler/db.interrupt fallback in AC; Story 3 non-SELECT keyword set added; Stories 4/5 testing-approach assertion shapes locked; Story 6 fallbacks for empty-vault and cursor-short-circuit added; cross-story grep pattern + adversarial-suite file location standardized). Iter-2 confirmed clean.
- **As a** Pristine SDK maintainer shipping the read-only SQL primitive, **I want** an integration harness that exercises every AC of every later story end-to-end (DSL + raw + adversarial paths), **so that** Stories 2-5 can be turned green incrementally and Story 6's adversarial suite slots in without re-scaffolding the harness.
- **Dependencies:** None (Story 1 always ships first)
- **Acceptance criteria:**
  - [ ] `tests/integration/searcher-sql.test.ts` exists, imports `Pristine` from `src/index.js` only, and is wired into `npm run test:integration`.
  - [ ] Harness ships RED outer-loop tests for each downstream-story AC: DSL select (Story 4), raw-SELECT escape (Story 4), non-SELECT rejection (Story 3), internal-table rejection (Story 3), row cap (Story 2), timeout (Story 2), and at least one vault-access adversarial test (Story 6). **Mechanism (locked, uniform across all 7 tests):** Story 1 ships a stub `searcher.sql = async () => { throw new Error('searcher.sql: not implemented (Story N pending)'); }` so each test fails at the runtime stub-throw — NOT at TS-level "Property does not exist" and NOT at module-resolution. This matches the canonical sprint-template guidance for compiled stacks (RED-by-stub, not RED-by-missing-symbol).
  - [ ] Harness uses real Nomic v1.5 only where embed is needed for setup (most SQL tests don't need embedding; seeding writes a few rows directly via `client.storeAsync` + `client.drainEmbedQueue` for the messages-with-content tests). Per-hook + per-it timeouts set to `SLOW_TEST_TIMEOUT_MS = 120_000` matching the sprint-016 hookTimeout pattern.
  - [ ] Harness includes a `seedSqlCorpus()` helper that creates 2 projects × 3 conversations × 3 messages — small, deterministic, dim-stable (no random IDs in assertions).
  - [ ] `npm run test:integration` green excluding the new RED tests; the new RED tests fail as expected.
- **Testing approach:** RED-by-construction outer-loop tests; `seedSqlCorpus` validated by a small inline check that verifies row counts match expected values before any `searcher.sql` call.
- **QA:**
  - Manual: N/A (backend test harness).
  - Automated: `npm run test:integration` — RED tests for Stories 2/3/4/6 visible as failures; existing integration tests still pass.
- **Planned commits:**
  1. `chore(test): scaffold tests/integration/searcher-sql.test.ts + seedSqlCorpus helper`
  2. `test(searcher-sql): RED outer-loop tests for DSL-select + raw-SELECT escape (Story 4)`
  3. `test(searcher-sql): RED outer-loop tests for non-SELECT rejection + internal-table rejection (Story 3)`
  4. `test(searcher-sql): RED outer-loop tests for row cap + progress-handler timeout (Story 2)`
  5. `test(searcher-sql): RED outer-loop test for vault-access rejection (Story 6 adversarial)`
- **Technical notes:**
  - **Harness shape parallels `searcher.test.ts`.** The existing sprint-016 cross-cutting harness at `tests/integration/searcher.test.ts` is the reference shape — same hookTimeout pattern, same seeded-corpus pattern, same per-method describe blocks. Don't reinvent.
  - **Vault-access adversarial test (canonical probe — referenced by Story 6 AC-1(c)).** The vault / privacy tables live in `src/privacy/`. **Standardized probe pattern (locked, used by Stories 1 + 6 verbatim):** `grep -rn "CREATE TABLE.*vault\\|CREATE TABLE.*key" src/privacy/`. The RED test at Story 1 verifies `client.searcher.sql(...)` rejects a raw `SELECT * FROM <first-discovered-table>` with `InvalidSqlError`. If the probe returns zero hits, swap in `messages` (an internal corpus table not in the public-view allowlist) and document the swap in the test-file header — Story 6's adversarial suite uses the same fallback so the two stories can't drift.
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
  - Findings: iter-1 surfaced 1 P1 (orderBy shape ambiguity, Story 4) + multiple P2s (mechanism vagueness, missing fallbacks, cross-story drift on grep pattern + adversarial test file location). Iter-2 returned 5/5 with no findings.
  - Resolution: All P1/P2s addressed inline (Story 4 array-of-objects shape locked; Story 1 stub-throw locked; Story 2 progress_handler/db.interrupt fallback in AC; Story 3 non-SELECT keyword set added; Stories 4/5 testing-approach assertion shapes locked; Story 6 fallbacks for empty-vault and cursor-short-circuit added; cross-story grep pattern + adversarial-suite file location standardized). Iter-2 confirmed clean.
- **As a** Pristine SDK maintainer building the SQL primitive's safety envelope, **I want** a shared backend that opens a read-only SQLite connection, attaches a per-query timeout, and wraps the result cursor with a row cap, **so that** Stories 3 and 4 (parsers) can route both DSL-translated and raw queries through one validated execution path.
- **Dependencies:** Story 1 (outer-loop tests exist)
- **Acceptance criteria:**
  - [ ] New module `src/memory/searcher/sql-backend.ts` (or co-located with `searcher/index.ts` if size warrants) exposes `executeReadOnly(sql: string, params: unknown[], opts: { rowCap: number; timeoutMs: number }): Promise<readonly Row[]>`.
  - [ ] Each `executeReadOnly` call opens a connection in `SQLITE_OPEN_READONLY` mode against the same DB file as the writable connection. Connection lifecycle: open → execute → close (no shared read-only connection across calls — keeps the row cap + timeout per-call).
  - [ ] Read-only connection aborts queries exceeding `timeoutMs` (default 5000) via `progress_handler` if exposed by the better-sqlite3 binding, OR via `setTimeout` + `db.interrupt()` fallback if not. Either mechanism throws `QueryTimeoutError` (new error class extending `AppError`); the exact mechanism chosen is documented in a Story-2 commit comment so reviewers know which code path to scrutinize.
  - [ ] Cursor wrapper enforces row cap: cursor is iterated up to `rowCap` (default 1000), then closed; any rows beyond the cap are silently dropped (NOT an error — caller chose the cap or accepted default). Document this behavior in JSDoc.
  - [ ] Per-call options: `rowCap` (1 ≤ cap ≤ 10000 — `MAX_ROW_CAP`), `timeoutMs` (100 ≤ ms ≤ 30000 — `MAX_TIMEOUT_MS`). Out-of-range values throw `InvalidArgumentError`.
  - [ ] `Row` type is `Readonly<Record<string, unknown>>` — opaque to the backend; downstream typing happens at the DSL / consumer layer.
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
  - Findings: iter-1 surfaced 1 P1 (orderBy shape ambiguity, Story 4) + multiple P2s (mechanism vagueness, missing fallbacks, cross-story drift on grep pattern + adversarial test file location). Iter-2 returned 5/5 with no findings.
  - Resolution: All P1/P2s addressed inline (Story 4 array-of-objects shape locked; Story 1 stub-throw locked; Story 2 progress_handler/db.interrupt fallback in AC; Story 3 non-SELECT keyword set added; Stories 4/5 testing-approach assertion shapes locked; Story 6 fallbacks for empty-vault and cursor-short-circuit added; cross-story grep pattern + adversarial-suite file location standardized). Iter-2 confirmed clean.
- **As a** Pristine SDK maintainer enforcing the privacy boundary at the SQL surface, **I want** a parser that extracts referenced tables from a SQL string and rejects any query touching tables outside the allowlist (`messages_public`, `conversations_public`, `summaries_public`), **so that** raw-SQL escape-hatch consumers cannot reach internal tables, vault surfaces, or any future sensitive table by accident or by attack.
- **Dependencies:** Story 1 (outer-loop tests exist), Story 2 (the parser feeds `executeReadOnly`)
- **Acceptance criteria:**
  - [ ] `parseSqlAccess(sql: string): { tables: string[]; isSelect: boolean }` extracts every table reference from a SQL string and reports whether the top-level statement is a SELECT (including `SELECT ... UNION ...` and CTE-fronted `WITH ... SELECT` forms).
  - [ ] `validateSqlAccess(sql: string, allowlist: ReadonlySet<string>): void` calls `parseSqlAccess` and throws `InvalidSqlError` if (a) `isSelect` is false, OR (b) any table in `tables` is NOT in `allowlist`. The error message names the offending table or non-SELECT keyword for debuggability.
  - [ ] **Non-SELECT keyword set (locked):** `EXPLAIN`, `EXPLAIN QUERY PLAN`, `PRAGMA`, `ATTACH`, `DETACH`, `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `REINDEX`, `VACUUM`, `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`, `ANALYZE`, `REPLACE` are all NOT-SELECT (rejected). Top-level statement must be `SELECT` or `WITH ... SELECT`.
  - [ ] The default allowlist is `new Set(['messages_public', 'conversations_public', 'summaries_public'])` — exposed as `DEFAULT_PUBLIC_VIEW_ALLOWLIST` from the module for re-use in tests / future spec evolution.
  - [ ] Parser handles: identifier quoting (`"messages"`, `[messages]`, `\`messages\``), schema prefixes (`main.messages` should be detected as `messages` for allowlist comparison — reject with table-name `messages`), case-insensitivity (`SELECT` / `select` / `Select` all detected as SELECT), comments (`-- comment`, `/* comment */`) stripped before parsing.
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
  - **Don't write a full SQL parser.** Use better-sqlite3's built-in helpers where possible: `db.prepare(sql).reader` is `true` for SELECT-only statements (useful for the `isSelect` gate). For table extraction, `EXPLAIN QUERY PLAN <sql>` returns a row-set listing referenced tables — far more reliable than regex-matching identifiers. **Story-start verification:** confirm `EXPLAIN QUERY PLAN` returns the table names cleanly on `messages_public` queries (it should — views resolve to underlying tables, but the QUERY PLAN output names the view in the surface text). If `EXPLAIN QUERY PLAN` resolves views to underlying tables, prepare a regex/AST-fallback path; flag the tradeoff in the story PR.
  - **Why deny-on-uncertainty.** A permissive parser that allows unknown syntax through is a privacy-boundary risk. Better to reject a legitimate-but-novel query (the consumer can use the DSL or open an issue to extend the parser) than to leak access to an internal table.
  - **CTE handling.** `WITH foo AS (SELECT ...) SELECT * FROM foo` references `foo` (CTE-local) and whatever the inner SELECT touches. Parser must extract the inner SELECT's tables, not just `foo`.
  - **Why a separate error class for SQL.** Distinguishes parser-level rejection (`InvalidSqlError`) from runtime SQLite errors (which surface as the underlying better-sqlite3 error). Consumers can catch `InvalidSqlError` to render a "your query is not allowed" UX without confusing it with "the database is broken".
  - **Below 5-8 commit floor.** 4 commits. Standing exemption — the parser is one cohesive unit.
- **Priority:** Must-have

#### Story 4: DSL surface + SQL translator

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [x] Within size limits (5-8 commits; split if larger)
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: iter-1 surfaced 1 P1 (orderBy shape ambiguity, Story 4) + multiple P2s (mechanism vagueness, missing fallbacks, cross-story drift on grep pattern + adversarial test file location). Iter-2 returned 5/5 with no findings.
  - Resolution: All P1/P2s addressed inline (Story 4 array-of-objects shape locked; Story 1 stub-throw locked; Story 2 progress_handler/db.interrupt fallback in AC; Story 3 non-SELECT keyword set added; Stories 4/5 testing-approach assertion shapes locked; Story 6 fallbacks for empty-vault and cursor-short-circuit added; cross-story grep pattern + adversarial-suite file location standardized). Iter-2 confirmed clean.
- **As a** Pristine SDK consumer who wants to query the corpus without writing raw SQL (or worrying about SQL injection), **I want** a typed DSL `{view, where, orderBy, limit, projection}` that compiles to parameterized SQL, **so that** common queries are ergonomic and the SQL-injection surface is closed at the type level.
- **Dependencies:** Story 1 (outer-loop tests), Story 2 (executeReadOnly backend), Story 3 (validateSqlAccess for the post-translation safety check)
- **Acceptance criteria:**
  - [ ] `SqlDslQuery` type — canonical post-sprint shape; `orderBy` is **array-of-objects** (locked):
    ```ts
    interface SqlDslQuery {
      view: 'messages_public' | 'conversations_public' | 'summaries_public';
      where?: Record<string, SqlDslWhereValue>;       // { project_id: 'pristine', role: { in: ['user', 'assistant'] }, timestamp: { gte: 1700000000000 } }
      orderBy?: readonly { column: string; direction: 'asc' | 'desc' }[];
      limit?: number;
      projection?: readonly string[];                  // selected columns; omit = SELECT *
    }
    type SqlDslWhereValue = string | number | boolean | null
                          | { in: readonly (string | number)[] }
                          | { gte: number | string } | { lte: number | string }
                          | { gt: number | string } | { lt: number | string };
    ```
    Rationale for the array-of-objects shape (vs the record-map `{ timestamp: 'desc' }` form currently in spec §15 examples at lines 948 and 996): array form supports multi-column ordering deterministically (record-key iteration order is engine-specified for non-integer keys but ergonomically opaque); array-of-objects also gives forward room for per-column options (`{ column, direction, nullsFirst? }`) without breaking shape. Story 6 lands the spec touchup updating the §15 examples to the array form.
  - [ ] `translateDslToSql(query: SqlDslQuery): { sql: string; params: unknown[] }` produces parameterized SQL that round-trips through `validateSqlAccess` (Story 3) cleanly.
  - [ ] `searcher.sql(query: SqlDslQuery | string, opts?: { params?: unknown[]; rowCap?: number; timeoutMs?: number }): Promise<readonly Row[]>` is the public surface (added in Story 5; this story ships the translator + types). DSL mode: pass an object. Raw mode: pass a string and use `opts.params` for parameter binding.
  - [ ] DSL type-checks at compile time: `view` is union-typed; `where` keys reject unknown column names if we can derive them at compile time (if not feasible, runtime-validate against the view's column set with a clear error).
  - [ ] DSL-translator output uses positional `?` placeholders only (no string concatenation of values). Inner-loop test asserts `'; DROP TABLE messages; --` in any `where` value produces a parameter-bound query, NOT injected SQL.
  - [ ] Story 1's DSL-select RED test goes GREEN.
  - [ ] Inner-loop unit tests cover every operator (`in`, `gte`, `lte`, `gt`, `lt`, equality, null) + composition (multiple where keys + ordering + projection + limit).
- **Testing approach:** Inner-loop unit tests on the translator are the bulk: table-driven `(dsl, expected: { sql, params })` cases. **Injection-attempt assertion shape (locked):** for `where: { project_id: "'; DROP TABLE messages; --" }`, the test asserts `expect(result.sql).not.toContain('DROP TABLE')` AND `expect(result.params).toContain("'; DROP TABLE messages; --")` — i.e. the malicious string is bound as a parameter, never interpolated into the SQL. Outer-loop tests via Story 1 round-trip the DSL through the full backend.
- **QA:**
  - Manual: N/A (typed API).
  - Automated: `npm run test:unit` + `npm run test:integration`.
- **Planned commits:**
  1. `feat(searcher): SqlDslQuery + SqlDslWhereValue types + translateDslToSql`
  2. `test(searcher): unit tests for translator — every operator + composition + injection-attempt round-trip`
  3. `docs(searcher): JSDoc on the DSL types + translator`
- **Technical notes:**
  - **Compile-time `where` key validation.** Hard to do generically across three views. Pragmatic: validate at runtime against a per-view column set defined inline in `translateDslToSql` (e.g., `MESSAGES_PUBLIC_COLS = new Set(['id', 'conversation_id', 'turn_index', 'role', 'content', 'timestamp', 'project_id'])`). Compile-time would require generic-conditional types over a const view-name → column-set map; pursue if it doesn't bloat the type signature.
  - **Spec §15 Flow 3 example today (lines 948 + 996) uses record-map `orderBy: { timestamp: 'desc' }`.** AC-1 above locks the canonical post-sprint shape to **array-of-objects** for the reasons cited in the AC. Story 6 updates both spec example sites to the new shape. No third shape is in play; the AC is the single source of truth for the executing agent.
  - **Below 5-8 commit floor.** 3 commits. Standing exemption — DSL translator is a single unit; tests + JSDoc are inseparable from the implementation.
- **Priority:** Must-have

#### Story 5: Wire `searcher.sql` on the public Searcher interface

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [x] Within size limits (5-8 commits; split if larger)
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: iter-1 surfaced 1 P1 (orderBy shape ambiguity, Story 4) + multiple P2s (mechanism vagueness, missing fallbacks, cross-story drift on grep pattern + adversarial test file location). Iter-2 returned 5/5 with no findings.
  - Resolution: All P1/P2s addressed inline (Story 4 array-of-objects shape locked; Story 1 stub-throw locked; Story 2 progress_handler/db.interrupt fallback in AC; Story 3 non-SELECT keyword set added; Stories 4/5 testing-approach assertion shapes locked; Story 6 fallbacks for empty-vault and cursor-short-circuit added; cross-story grep pattern + adversarial-suite file location standardized). Iter-2 confirmed clean.
- **As a** Pristine SDK consumer ready to use the SQL primitive, **I want** `client.searcher.sql(query, opts?)` to be the single public entry point, **so that** I don't have to compose `executeReadOnly`, `validateSqlAccess`, and `translateDslToSql` myself.
- **Dependencies:** Stories 2, 3, 4 (the three building blocks)
- **Acceptance criteria:**
  - [ ] `Searcher` interface (`src/memory/searcher/index.ts`) gains `sql(query: SqlDslQuery | string, opts?: SqlOpts): Promise<readonly Row[]>`. JSDoc names the read-only contract, the row-cap + timeout defaults, and the public-view allowlist.
  - [ ] `createSearcher` factory wires the three modules: DSL → `translateDslToSql` → `validateSqlAccess` (sanity check on translator output) → `executeReadOnly`. Raw → `validateSqlAccess` directly → `executeReadOnly`. Both paths validate before executing.
  - [ ] `SqlOpts` type: `{ params?: unknown[]; rowCap?: number; timeoutMs?: number }`. `params` is honored for raw-SQL mode only; passing `params` with a DSL query throws `InvalidArgumentError` (the DSL embeds its own params).
  - [ ] `searcher.sql` types are exported from `src/index.ts`: `SqlDslQuery` (defined in Story 4 AC-1), `SqlDslWhereValue` (Story 4 AC-1), `SqlOpts` (defined in this story's AC-3), `Row` (defined in Story 2 AC-6), `InvalidSqlError` (Story 3 AC-2), `QueryTimeoutError` (Story 2 AC-3).
  - [ ] Story 1's outer-loop tests for DSL-select, raw-SELECT, non-SELECT rejection, internal-table rejection, row cap, and timeout all GREEN.
  - [ ] Pristine doc-comment block on the Searcher interface mentions `sql` alongside the four search methods.
  - [ ] No regression in unit / integration suites.
- **Testing approach:** Wiring-level integration tests via Story 1's outer-loop suite. Story 5's own unit tests are minimal — covering `params`-on-DSL throw, default-opt application, and the validate-then-execute order. **Order-of-operations assertion (locked):** spy on `validateSqlAccess` and `executeReadOnly` (e.g. via vitest `vi.spyOn` on the imported module), call `searcher.sql(...)`, assert `validateSqlAccess.mock.invocationCallOrder[0] < executeReadOnly.mock.invocationCallOrder[0]`.
- **QA:**
  - Manual: N/A.
  - Automated: full `npm run test:integration` GREEN for Story 1's RED tests (Story 6 adversarial still RED until that story).
- **Planned commits:**
  1. `feat(searcher): wire sql method on Searcher interface — DSL + raw modes through validateSqlAccess + executeReadOnly`
  2. `feat(api): export SqlDslQuery / SqlDslWhereValue / SqlOpts / Row / InvalidSqlError / QueryTimeoutError from src/index.ts`
  3. `test(searcher): unit tests for searcher.sql — params-on-DSL throw, default-opt application, validate-then-execute order`
  4. `docs(searcher): JSDoc on searcher.sql — single entry point, mode dispatch, opts contract`
- **Technical notes:**
  - **Validate-then-execute ordering is non-negotiable.** Any path that calls `executeReadOnly` before `validateSqlAccess` is a privacy-boundary regression. The factory wiring must be linear: input → validate → execute. A sub-agent reviewer should explicitly check this in story PR review.
  - **Why validate translator output.** Belt-and-braces: the DSL translator should produce only allowlist-safe SQL by construction, but running it through `validateSqlAccess` adds a defense-in-depth check. If the validator rejects translator output, that's a parser bug — fix the parser, don't loosen the validator.
  - **Below 5-8 commit floor.** 4 commits. Standing exemption — wiring is a single integration unit.
- **Priority:** Must-have

#### Story 6: Adversarial privacy suite + spec §15 Flow 3 update + JSDoc

- **Story Checklist:** (MUST BE CHECKED OFF BEFORE STARTING THE SPRINT)
  - [x] Follows sprint template (acceptance criteria, testing approach, automated QAs for agents, manual QAs for Lou, planned commits)
  - [x] Within size limits (5-8 commits; split if larger)
  - [x] Reviewed by sub-agent
  - [x] Review findings addressed and have sub-agent review again until they state that it is ok (fixes applied or disagreements noted)
  - [ ] Each AC verified against git diff and test output before marking done
  - [ ] Ready for Lou
- **Review:**
  - Findings: iter-1 surfaced 1 P1 (orderBy shape ambiguity, Story 4) + multiple P2s (mechanism vagueness, missing fallbacks, cross-story drift on grep pattern + adversarial test file location). Iter-2 returned 5/5 with no findings.
  - Resolution: All P1/P2s addressed inline (Story 4 array-of-objects shape locked; Story 1 stub-throw locked; Story 2 progress_handler/db.interrupt fallback in AC; Story 3 non-SELECT keyword set added; Stories 4/5 testing-approach assertion shapes locked; Story 6 fallbacks for empty-vault and cursor-short-circuit added; cross-story grep pattern + adversarial-suite file location standardized). Iter-2 confirmed clean.
- **As a** Pristine SDK maintainer locking in the privacy boundary, **I want** an adversarial test suite that systematically tries every attack class spec §8.6 names — DML, internal-table SELECT, vault SELECT, DoS — and verifies each one is rejected or row-capped, **so that** Phase 5's privacy contract is provably enforced and any future regression fails CI loudly.
- **Dependencies:** Stories 2-5 (the SQL primitive must exist for adversarial tests to run against it)
- **Acceptance criteria:**
  - [ ] Adversarial cases **appended to `tests/integration/searcher-sql.test.ts`** (locked — single file keeps the harness's adversarial coverage co-located with its happy-path coverage and avoids fragmenting test-discovery globs) — at least 20 adversarial test cases organized into 4 attack classes under a top-level `describe('searcher.sql adversarial suite', ...)` block:
    - **(a) DML attempts** (≥ 5 cases): `INSERT`, `UPDATE`, `DELETE`, `DROP TABLE`, `ALTER TABLE`. Each must throw `InvalidSqlError`.
    - **(b) Internal-table SELECT** (≥ 5 cases): `SELECT * FROM messages`, `SELECT * FROM conversations`, `SELECT * FROM vec_windows`, `SELECT * FROM vec_sessions`, `SELECT * FROM messages_fts`. Each must throw `InvalidSqlError`.
    - **(c) Vault / privacy surface SELECT** (≥ 3 cases): use the standardized probe defined in Story 1 Tech Notes (`grep -rn "CREATE TABLE.*vault\\|CREATE TABLE.*key" src/privacy/`) to enumerate target tables. **Fallback (locked):** if the probe returns zero privacy-module tables, substitute 3 internal-corpus tables not in the public-view allowlist (e.g., `messages_fts`, `vec_windows`, `vec_sessions`); document the substitution in the test-file header so reviewers know why vault tables aren't there. Each must throw `InvalidSqlError`.
    - **(d) DoS / row-cap escape** (≥ 3 cases): cartesian join over a small table that produces > 1M rows; the row cap must terminate iteration at `rowCap`. Long-running sleep-style query (using `randomblob(1000000)` recursion or a CTE bomb); the timeout must fire and throw `QueryTimeoutError`. **Fallback (locked):** if Story 2's row-cap cursor cannot short-circuit SQLite's join evaluation cleanly (verify at story start), the cartesian-join test instead asserts wall-time bound (`≤10s`) — flag the limitation in the story PR for a future optimization sprint; do NOT block this story on cursor short-circuit being optimal.
    - **(e) Identifier-encoding tricks** (≥ 4 cases): `SELECT * FROM "messages"`, `SELECT * FROM main.messages`, `SELECT * FROM messages -- comment`, `WITH foo AS (SELECT * FROM messages) SELECT * FROM foo`. Each must throw `InvalidSqlError`.
  - [ ] All adversarial tests run on every CI invocation (NOT marked `@skip` or `@manual`).
  - [ ] `docs/specs/implementation-spec-005.md` §15 Flow 3 updated with: (a) reference to `client.searcher.sql` as the consumer surface; (b) **both spec examples at lines 948 and 996** changed from record-map `orderBy: { timestamp: 'desc' }` to array-of-objects `orderBy: [{ column: 'timestamp', direction: 'desc' }]` per Story 4 AC-1's canonical shape; (c) note that `validateSqlAccess` runs even on translator output as defense-in-depth.
  - [ ] §16 Phase 5 Done-when checkboxes can all be checked: SQL primitive safe + useful, adversarial tests pass, privacy boundary validated.
  - [ ] JSDoc on `searcher.sql` references §15 Flow 3 and §8.6 for the privacy contract.
- **Testing approach:** Adversarial test cases are the deliverable. Each test asserts a specific error class + a message-pattern match (the error message names the offending construct). DoS tests assert wall-time bounds (no test should run > 30s).
- **QA:**
  - Manual: N/A.
  - Automated: full `npm run test:integration` — Story 1's adversarial RED tests now GREEN; the other 19+ adversarial cases pass.
- **Planned commits:**
  1. `test(searcher-sql): adversarial DML attempts — INSERT / UPDATE / DELETE / DROP / ALTER`
  2. `test(searcher-sql): adversarial internal-table SELECT — messages / conversations / vec_* / messages_fts`
  3. `test(searcher-sql): adversarial vault-table SELECT — every privacy-module table`
  4. `test(searcher-sql): adversarial DoS — cartesian join + CTE bomb (row cap + timeout fire)`
  5. `test(searcher-sql): adversarial identifier-encoding tricks — quoting / schema prefix / comments / CTE`
  6. `docs(spec): implementation-spec-005 §15 Flow 3 — public surface + orderBy-array correction + defense-in-depth note`
- **Technical notes:**
  - **DoS test budget.** Each DoS test should bound to ≤10s wall time. The cartesian-join attack against a 1500-row corpus produces ~2.25M-row joins; the row-cap cursor terminates iteration at the configured cap before all rows materialize, so the test runtime is dominated by SQLite's row-by-row evaluation up to the cap (~1ms per row in benchmark = ~1s for cap=1000). Verify at story start that the cap-terminate-cursor pattern actually short-circuits SQLite's join evaluation.
  - **Identifier-encoding tricks are the highest-risk class.** Story 3's parser must treat `"messages"`, `[messages]`, and `\`messages\`` as identical to `messages` for allowlist comparison. The story's adversarial tests verify each form rejects.
  - **Spec touchup is in this story, not Story 4.** Keeps the spec edit alongside the privacy-contract evidence so reviewers see them together.
  - **Below 5-8 commit floor — N/A here.** 6 commits, in range.
- **Priority:** Must-have

#### Story 7: Decide on `searchConversations` — keep, align, or remove (relocated from sprint-018)

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
- **Dependencies:** Stories 2-6 (the `searcher.sql` recipe path requires the SQL primitive to exist + be tested)
- **Acceptance criteria:**
  - [ ] Investigation block in the story PR body answers: (1) how does `searchConversations` differ from `searcher.ftsSearch` and `searcher.sql` semantically (scoping, granularity, return shape, snippet rendering); (2) **enumerate every consumer** — list every grep hit for `searchConversations` across `src/`, `tests/`, `scripts/`, and `docs/` (use `grep -rn "searchConversations" src/ tests/ scripts/ docs/`), with a one-line note per hit identifying it as production / test / script / doc; (3) the concrete `searcher.sql` recipe that recovers `searchConversations`'s shape (input → output, with the actual DSL or raw-SQL string).
  - [ ] Decision is one of: **(a) Keep with doc clarification** — JSDoc on `searchConversations`, `searcher.ftsSearch`, AND `searcher.sql` explaining when to reach for each; **(b) Align with project-scoping** — make `searchConversations` accept `projectId` (additive — `userId` becomes optional) and harmonize the contract with `searcher.*`; **(c) Remove + recipe** — delete the method, ship the concrete `searcher.sql` recipe in JSDoc + spec §5.2 reference-implementations.
  - [ ] Decision is implemented in this PR (whichever path).
  - [ ] In-repo consumers (`scripts/search-conversations.ts`, any test fixtures) are updated to match the decision. If the decision is (c), the script either migrates to `searcher.sql` (using the AC's documented recipe) or the script itself is removed (with a brief note in commit message).
  - [ ] If decision is (a) or (b), the JSDoc cross-references are bidirectional (each method points at its alternatives).
  - [ ] `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration` all clean.
- **Testing approach:** Inner-loop unit tests for any signature change (option b) or migration recipe (option c). For option (c), the recipe MUST be exercised by a unit test that runs `searcher.sql` with the recipe's DSL/SQL and asserts equivalent rows to the legacy `searchConversations` for at least 3 representative inputs. No new outer-loop tests — the decision determines the shape, then existing tests verify the chosen behavior.
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
  4. `test(searcher-sql): recipe-equivalence unit test — searcher.sql with the recipe DSL produces equivalent rows to the legacy searchConversations on 3+ inputs`
  5. `docs(spec): add migration recipe to implementation-spec-005.md §5.2 reference-implementations — concrete searcher.sql DSL + raw-SQL forms`
- **Technical notes:**
  - **Concrete impl differences (validate at story start):** `searchConversations` (a) requires `userId` as primary scope; (b) returns `ConversationSearchResult[]` — one row per conversation with a `snippet` string; (c) uses `escapeFts5Query` defensively; (d) does NOT take a projectId. `searcher.ftsSearch` (a) requires `projectId`; (b) returns `MessageHit[]` — one per matching message; (c) propagates FTS5-query syntax errors as `InvalidArgumentError`. `searcher.sql` (Stories 2-5 of this sprint) (a) accepts `messages_public` / `conversations_public` views; (b) returns `Row[]` opaque shape; (c) raw-SQL escape hatch lets a consumer build the exact JOIN + snippet that `searchConversations` produces today. All three ride `messages_fts` underneath.
  - **Bias reset by user input.** Original sprint-018 draft biased toward (a) Keep — because no concrete `searcher.sql` alternative existed. Now that Stories 2-5 of THIS sprint ship `searcher.sql`, (c) Remove + recipe becomes the cleanest path: one less leaky-by-user-scoping API on the public surface, one explicit recipe in the spec. Investigation should re-evaluate from a (c)-friendly default. If the recipe-equivalence unit test reveals an irreducible gap (e.g., FTS5 snippet rendering is awkward through the SQL DSL), fall back to (a) with a documented "stays for ergonomic snippet rendering" rationale.
  - **If decision is (b) — align with projectId.** Backwards-compat path: accept `userId` OR `projectId`; enforce at least one; document precedence in JSDoc. Avoid breaking the existing call shape.
  - **If decision is (c) — recipe shape.** The recipe must be a copy-pasteable DSL or raw-SQL string in the JSDoc and spec, NOT a prose description. Example shape (validate at story start):
    ```ts
    // Recipe: keyword search across a user's conversations, returning per-conversation snippets
    const rows = await client.searcher.sql({
      view: 'messages_public',
      where: { project_id, content: { match: keyword } },  // pseudo — verify FTS5-MATCH support in DSL
      orderBy: [{ column: 'timestamp', direction: 'desc' }],
      limit: 10,
    });
    ```
    If the DSL doesn't support FTS5 `MATCH`, the recipe falls back to raw-SQL form using `messages_fts` allowlisted directly. **Story-start verification:** check whether Story 4's DSL supports an FTS-MATCH operator; if not, raw-SQL is the canonical recipe and the recipe-equivalence test exercises that path.
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
- **Spec touchup landed** (Story 6) — `docs/specs/implementation-spec-005.md` §15 Flow 3 reflects the shipped surface (consumer entry point, `orderBy` array form, defense-in-depth note); §16 Phase 5 Done-when checkboxes ticked
