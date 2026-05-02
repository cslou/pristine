import { InvalidSqlError } from '../../core/errors.js';

export const DEFAULT_PUBLIC_VIEW_ALLOWLIST: ReadonlySet<string> = new Set([
  'messages_public',
  'conversations_public',
  'summaries_public',
  'messages_fts',
]);

const NON_SELECT_KEYWORDS: ReadonlySet<string> = new Set([
  'EXPLAIN',
  'PRAGMA',
  'ATTACH',
  'DETACH',
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'REINDEX',
  'VACUUM',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'RELEASE',
  'ANALYZE',
  'REPLACE',
]);

const ALLOWED_SCHEMA_PREFIX = 'main';

export interface ParseSqlAccessResult {
  readonly tables: readonly string[];
  readonly isSelect: boolean;
}

type TokenType =
  | 'word'
  | 'qident'
  | 'string'
  | 'number'
  | 'punct'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'semicolon'
  | 'dot';

interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly raw: string;
}

function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'") {
      const start = i;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += sql.slice(start, i);
      continue;
    }
    if (c === '"' || c === '`') {
      const end = c;
      const start = i;
      i += 1;
      while (i < sql.length && sql[i] !== end) i += 1;
      i += 1;
      out += sql.slice(start, i);
      continue;
    }
    if (c === '[') {
      const start = i;
      i += 1;
      while (i < sql.length && sql[i] !== ']') i += 1;
      i += 1;
      out += sql.slice(start, i);
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function tokenise(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
      const v = sql.slice(i, j);
      tokens.push({ type: 'word', value: v, raw: v });
      i = j;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      tokens.push({ type: 'string', value: sql.slice(i + 1, j - 1), raw: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"' || c === '`') {
      const end = c;
      let j = i + 1;
      while (j < sql.length && sql[j] !== end) j += 1;
      tokens.push({ type: 'qident', value: sql.slice(i + 1, j), raw: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (c === '[') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== ']') j += 1;
      tokens.push({ type: 'qident', value: sql.slice(i + 1, j), raw: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[0-9.]/.test(sql[j])) j += 1;
      tokens.push({ type: 'number', value: sql.slice(i, j), raw: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', value: '(', raw: '(' });
      i += 1;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', value: ')', raw: ')' });
      i += 1;
      continue;
    }
    if (c === ',') {
      tokens.push({ type: 'comma', value: ',', raw: ',' });
      i += 1;
      continue;
    }
    if (c === ';') {
      tokens.push({ type: 'semicolon', value: ';', raw: ';' });
      i += 1;
      continue;
    }
    if (c === '.') {
      tokens.push({ type: 'dot', value: '.', raw: '.' });
      i += 1;
      continue;
    }
    tokens.push({ type: 'punct', value: c, raw: c });
    i += 1;
  }
  return tokens;
}

function findMatchingRparen(tokens: readonly Token[], lparenIdx: number, end: number): number {
  let depth = 1;
  let i = lparenIdx + 1;
  while (i < end) {
    if (tokens[i].type === 'lparen') depth += 1;
    else if (tokens[i].type === 'rparen') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  throw new InvalidSqlError('parse uncertainty: unbalanced parentheses');
}

function extractOneTableRef(
  tokens: readonly Token[],
  idx: number,
  end: number,
  cteNames: ReadonlySet<string>,
  tables: string[],
): number {
  if (idx >= end) {
    throw new InvalidSqlError('parse uncertainty: end of input after FROM/JOIN');
  }
  const t = tokens[idx];
  if (t.type !== 'word' && t.type !== 'qident') {
    throw new InvalidSqlError(
      `parse uncertainty: FROM/JOIN target must be an identifier; got '${t.raw}'`,
    );
  }
  let identTok = t;
  let nextIdx = idx + 1;
  if (nextIdx < end && tokens[nextIdx].type === 'dot') {
    const schemaPrefix = identTok.value;
    nextIdx += 1;
    if (nextIdx >= end || (tokens[nextIdx].type !== 'word' && tokens[nextIdx].type !== 'qident')) {
      throw new InvalidSqlError(
        `parse uncertainty: expected identifier after schema prefix '${schemaPrefix}.'`,
      );
    }
    if (schemaPrefix.toLowerCase() !== ALLOWED_SCHEMA_PREFIX) {
      throw new InvalidSqlError(
        `disallowed schema prefix: ${schemaPrefix}.${tokens[nextIdx].value}`,
      );
    }
    identTok = tokens[nextIdx];
    nextIdx += 1;
  }
  if (cteNames.has(identTok.value)) return nextIdx;
  tables.push(identTok.value);
  return nextIdx;
}

function extractTableRefList(
  tokens: readonly Token[],
  startIdx: number,
  end: number,
  cteNames: ReadonlySet<string>,
  tables: string[],
): number {
  let i = extractOneTableRef(tokens, startIdx, end, cteNames, tables);
  while (i < end && tokens[i].type === 'comma') {
    i += 1;
    i = extractOneTableRef(tokens, i, end, cteNames, tables);
  }
  return i;
}

function walkAndExtract(
  tokens: readonly Token[],
  start: number,
  end: number,
  cteNames: Set<string>,
  tables: string[],
): void {
  let i = start;
  while (i < end) {
    const t = tokens[i];
    if (t.type === 'word') {
      const upper = t.value.toUpperCase();
      if (upper === 'FROM' || upper === 'JOIN') {
        i = extractTableRefList(tokens, i + 1, end, cteNames, tables);
        continue;
      }
      if (upper === 'WITH') {
        i = parseWithPreamble(tokens, i + 1, end, cteNames, tables);
        continue;
      }
      i += 1;
      continue;
    }
    if (t.type === 'lparen') {
      const closeIdx = findMatchingRparen(tokens, i, end);
      walkAndExtract(tokens, i + 1, closeIdx, cteNames, tables);
      i = closeIdx + 1;
      continue;
    }
    i += 1;
  }
}

function parseWithPreamble(
  tokens: readonly Token[],
  start: number,
  end: number,
  cteNames: Set<string>,
  tables: string[],
): number {
  let i = start;
  if (i < end && tokens[i].type === 'word' && tokens[i].value.toUpperCase() === 'RECURSIVE') {
    i += 1;
  }
  while (i < end) {
    if (tokens[i].type !== 'word' && tokens[i].type !== 'qident') {
      throw new InvalidSqlError(`parse uncertainty: expected CTE name, got '${tokens[i].raw}'`);
    }
    cteNames.add(tokens[i].value);
    i += 1;
    if (i < end && tokens[i].type === 'lparen') {
      const closeIdx = findMatchingRparen(tokens, i, end);
      i = closeIdx + 1;
    }
    if (i >= end || tokens[i].type !== 'word' || tokens[i].value.toUpperCase() !== 'AS') {
      throw new InvalidSqlError(
        `parse uncertainty: expected 'AS' in CTE definition, got '${i < end ? tokens[i].raw : 'end-of-input'}'`,
      );
    }
    i += 1;
    if (i < end && tokens[i].type === 'word' && tokens[i].value.toUpperCase() === 'NOT') i += 1;
    if (i < end && tokens[i].type === 'word' && tokens[i].value.toUpperCase() === 'MATERIALIZED') {
      i += 1;
    }
    if (i >= end || tokens[i].type !== 'lparen') {
      throw new InvalidSqlError(
        `parse uncertainty: expected '(' after AS in CTE definition, got '${i < end ? tokens[i].raw : 'end-of-input'}'`,
      );
    }
    const closeIdx = findMatchingRparen(tokens, i, end);
    walkAndExtract(tokens, i + 1, closeIdx, cteNames, tables);
    i = closeIdx + 1;
    if (i < end && tokens[i].type === 'comma') {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

export function parseSqlAccess(sql: string): ParseSqlAccessResult {
  const stripped = stripComments(sql);
  const trimmed = stripped.trim();
  if (trimmed.length === 0) {
    throw new InvalidSqlError('SQL is empty');
  }

  const tokens = tokenise(trimmed);
  if (tokens.length === 0) {
    throw new InvalidSqlError('SQL is empty after tokenisation');
  }

  let endTok = tokens.length;
  while (endTok > 0 && tokens[endTok - 1].type === 'semicolon') endTok -= 1;
  for (let k = 0; k < endTok; k += 1) {
    if (tokens[k].type === 'semicolon') {
      throw new InvalidSqlError('multiple statements not allowed');
    }
  }

  const first = tokens[0];
  if (first.type !== 'word') {
    throw new InvalidSqlError(`expected SELECT or WITH, got '${first.raw}'`);
  }
  const firstUpper = first.value.toUpperCase();
  if (NON_SELECT_KEYWORDS.has(firstUpper)) {
    throw new InvalidSqlError(`non-SELECT statement: ${firstUpper}`);
  }
  if (firstUpper !== 'SELECT' && firstUpper !== 'WITH') {
    throw new InvalidSqlError(`expected SELECT or WITH, got '${firstUpper}'`);
  }

  const cteNames = new Set<string>();
  const tables: string[] = [];

  let mainSelectStart: number;
  if (firstUpper === 'WITH') {
    mainSelectStart = parseWithPreamble(tokens, 1, endTok, cteNames, tables);
    if (mainSelectStart >= endTok) {
      throw new InvalidSqlError('parse uncertainty: WITH preamble has no main SELECT');
    }
    const mainTok = tokens[mainSelectStart];
    if (mainTok.type !== 'word') {
      throw new InvalidSqlError(
        `parse uncertainty: expected SELECT after WITH preamble, got '${mainTok.raw}'`,
      );
    }
    const mainUpper = mainTok.value.toUpperCase();
    if (NON_SELECT_KEYWORDS.has(mainUpper)) {
      throw new InvalidSqlError(`non-SELECT statement after WITH preamble: ${mainUpper}`);
    }
    if (mainUpper !== 'SELECT') {
      throw new InvalidSqlError(
        `parse uncertainty: expected SELECT after WITH preamble, got '${mainUpper}'`,
      );
    }
  } else {
    mainSelectStart = 0;
  }

  let depth = 0;
  let firstFromIdx = -1;
  for (let k = mainSelectStart; k < endTok; k += 1) {
    const t = tokens[k];
    if (t.type === 'lparen') {
      depth += 1;
      continue;
    }
    if (t.type === 'rparen') {
      depth -= 1;
      continue;
    }
    if (depth === 0 && t.type === 'word' && t.value.toUpperCase() === 'FROM') {
      firstFromIdx = k;
      break;
    }
  }
  if (firstFromIdx !== -1) {
    const after = tokens[firstFromIdx + 1];
    if (after?.type === 'lparen') {
      throw new InvalidSqlError(
        'parse uncertainty: top-level FROM is a subquery, derived table, or VALUES expression',
      );
    }
  }

  walkAndExtract(tokens, mainSelectStart, endTok, cteNames, tables);

  return { tables, isSelect: true };
}

export function validateSqlAccess(sql: string, allowlist: ReadonlySet<string>): void {
  const { tables, isSelect } = parseSqlAccess(sql);
  if (!isSelect) {
    throw new InvalidSqlError('non-SELECT statement');
  }
  for (const t of tables) {
    if (!allowlist.has(t)) {
      throw new InvalidSqlError(`table not in allowlist: ${t}`);
    }
  }
}
