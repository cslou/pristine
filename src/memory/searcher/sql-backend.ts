import Database from 'better-sqlite3';

import { InvalidArgumentError, QueryTimeoutError } from '../../core/errors.js';

export const MAX_ROW_CAP = 10000;
export const DEFAULT_ROW_CAP = 1000;
export const MAX_TIMEOUT_MS = 10000;
export const MIN_TIMEOUT_MS = 100;
export const DEFAULT_TIMEOUT_MS = 5000;

/**
 * A single row returned by {@link SqlBackend.executeReadOnly}. The shape is
 * deliberately opaque at this layer: column names and value types are whatever
 * SQLite produces for the caller-supplied SQL. Story-3 wiring may narrow the
 * surface for specific public-view shapes.
 */
export type Row = Readonly<Record<string, unknown>>;

export interface ExecuteOpts {
  readonly rowCap: number;
  readonly timeoutMs: number;
}

export interface SqlBackend {
  executeReadOnly(
    sql: string,
    params: readonly unknown[],
    opts: ExecuteOpts,
  ): Promise<readonly Row[]>;

  withTimeout<T>(
    stmt: Database.Statement<unknown[], T>,
    params: readonly unknown[],
    ms: number,
  ): IterableIterator<T>;
}

export interface SqlBackendDeps {
  readonly dbPath: string;
}

export function createSqlBackend(deps: SqlBackendDeps): SqlBackend {
  const { dbPath } = deps;

  function validateOpts(opts: ExecuteOpts): void {
    if (!Number.isInteger(opts.rowCap) || opts.rowCap < 1 || opts.rowCap > MAX_ROW_CAP) {
      throw new InvalidArgumentError(
        `rowCap must be an integer in [1, ${String(MAX_ROW_CAP)}]; got ${String(opts.rowCap)}`,
      );
    }
    if (
      !Number.isInteger(opts.timeoutMs) ||
      opts.timeoutMs < MIN_TIMEOUT_MS ||
      opts.timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new InvalidArgumentError(
        `timeoutMs must be an integer in [${String(MIN_TIMEOUT_MS)}, ${String(MAX_TIMEOUT_MS)}]; got ${String(opts.timeoutMs)}`,
      );
    }
  }

  /**
   * Wraps a prepared {@link Database.Statement}'s row cursor with a
   * per-iteration elapsed-time budget. Yields each row until either the
   * underlying statement completes or `Date.now() - startMs > ms` is true at
   * a yield boundary, in which case it throws {@link QueryTimeoutError}.
   *
   * Limitation: better-sqlite3 v12 does not expose a JS-callable
   * `db.interrupt()` and the per-iteration check only fires between row
   * yields. A statement that runs to completion entirely in C without
   * yielding (a pure aggregate or sort that materialises its full result
   * before producing the first row) cannot be interrupted mid-flight; the
   * row-cap on {@link executeReadOnly} remains the primary safety net for
   * cursor-based queries.
   *
   * Exposed on {@link SqlBackend} so Story-2's parser-driven path can reuse
   * the same primitive.
   */
  function* withTimeout<T>(
    stmt: Database.Statement<unknown[], T>,
    params: readonly unknown[],
    ms: number,
  ): IterableIterator<T> {
    const startMs = Date.now();
    const iter = stmt.iterate(...params);
    for (const row of iter) {
      if (Date.now() - startMs > ms) {
        throw new QueryTimeoutError(`Query exceeded timeoutMs=${String(ms)}`);
      }
      yield row;
    }
  }

  /**
   * Executes a SQL statement against a fresh `SQLITE_OPEN_READONLY` connection
   * opened at `deps.dbPath`, returning rows up to `opts.rowCap` and bounded by
   * `opts.timeoutMs` per-iteration elapsed time.
   *
   * Lifecycle. A new connection is opened per call and closed in a `finally`
   * block on both success and error paths. The statement is prepared, rows are
   * pulled through {@link withTimeout}, and the cursor is broken at `rowCap`.
   * Connection cleanup runs whether the cursor completed naturally, threw
   * {@link QueryTimeoutError}, hit the rowCap break, or surfaced an underlying
   * SQLite error.
   *
   * Read-only at the SQLite level. The connection is opened with
   * `{ readonly: true }`, so DML attempts (`INSERT`, `UPDATE`, `DELETE`,
   * `CREATE`, etc.) are rejected by the engine with a "readonly database"
   * error before any rows are produced. Callers do not need to pre-validate
   * the SQL string for write intent — the connection enforces it.
   *
   * Row-cap silent-drop. When the cursor produces more than `rowCap` rows,
   * `executeReadOnly` returns the first `rowCap` rows and discards the rest.
   * Callers MUST keep their own `LIMIT` / pagination clauses ≤ `rowCap`; a
   * mismatch is a caller bug, not a recoverable state.
   *
   * Bounds. `opts.rowCap` ∈ [1, {@link MAX_ROW_CAP}]; `opts.timeoutMs` ∈
   * [{@link MIN_TIMEOUT_MS}, {@link MAX_TIMEOUT_MS}]. Out-of-range values
   * throw {@link InvalidArgumentError} before any DB work begins.
   *
   * Synchronous-blocking constraint. better-sqlite3 executes synchronously,
   * so a runaway query can block the Node event loop for up to
   * {@link MAX_TIMEOUT_MS} (~10s) before the per-iteration check aborts it.
   * The async signature is intentional: it lets the public Story-3 surface
   * (`searcher.sql`) return a `Promise` without further wrapping, even though
   * no asynchronous work happens inside.
   *
   * Timeout mechanism. The timeout is enforced by a per-iteration elapsed-time
   * check in {@link withTimeout}; see that function's docstring for the
   * non-yielding-statement limitation.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async function executeReadOnly(
    sql: string,
    params: readonly unknown[],
    opts: ExecuteOpts,
  ): Promise<readonly Row[]> {
    validateOpts(opts);

    const db = new Database(dbPath, { readonly: true });
    try {
      const stmt = db.prepare<unknown[], Row>(sql);
      const rows: Row[] = [];
      for (const row of withTimeout<Row>(stmt, params, opts.timeoutMs)) {
        rows.push(row);
        if (rows.length >= opts.rowCap) break;
      }
      return rows;
    } finally {
      db.close();
    }
  }

  return { executeReadOnly, withTimeout };
}
