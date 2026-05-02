import Database from 'better-sqlite3';

import { InvalidArgumentError, QueryTimeoutError } from '../../core/errors.js';

export const MAX_ROW_CAP = 10000;
export const DEFAULT_ROW_CAP = 1000;
export const MAX_TIMEOUT_MS = 10000;
export const MIN_TIMEOUT_MS = 100;
export const DEFAULT_TIMEOUT_MS = 5000;

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
