import { describe, expect, it } from 'vitest';

import { InvalidSqlError } from '../../../src/core/errors.js';
import {
  DEFAULT_PUBLIC_VIEW_ALLOWLIST,
  parseSqlAccess,
  validateSqlAccess,
} from '../../../src/memory/searcher/sql-parser.js';

const ALLOW = DEFAULT_PUBLIC_VIEW_ALLOWLIST;

describe('parseSqlAccess + validateSqlAccess — table-driven cases', () => {
  // Each case has a label, the SQL, and the expected outcome. validateSqlAccess
  // is run against the default allowlist; reject cases also assert the error
  // class. The 12 adversarial cases (`adv-*`) plus the 30+ allow/reject mix
  // satisfy AC line 143.
  const cases: ReadonlyArray<{
    label: string;
    sql: string;
    expected: 'allow' | 'reject';
  }> = [
    // ---------- ALLOW: bread-and-butter SELECT shapes ----------
    { label: 'simple select', sql: 'SELECT * FROM messages_public', expected: 'allow' },
    {
      label: 'select with where',
      sql: 'SELECT id FROM messages_public WHERE project_id = ?',
      expected: 'allow',
    },
    {
      label: 'select multi-column with where',
      sql: 'SELECT id, conversation_id, content FROM messages_public WHERE id > ?',
      expected: 'allow',
    },
    {
      label: 'select with limit/offset',
      sql: 'SELECT * FROM messages_public LIMIT ? OFFSET ?',
      expected: 'allow',
    },
    {
      label: 'select with order by asc',
      sql: 'SELECT * FROM messages_public ORDER BY timestamp ASC',
      expected: 'allow',
    },
    {
      label: 'select with order by desc',
      sql: 'SELECT * FROM messages_public ORDER BY timestamp DESC',
      expected: 'allow',
    },
    {
      label: 'count aggregate',
      sql: 'SELECT COUNT(*) FROM messages_public',
      expected: 'allow',
    },
    {
      label: 'min/max aggregate',
      sql: 'SELECT MIN(timestamp), MAX(timestamp) FROM messages_public',
      expected: 'allow',
    },
    {
      label: 'avg aggregate',
      sql: 'SELECT AVG(turn_index) FROM messages_public',
      expected: 'allow',
    },
    {
      label: 'group by + having',
      sql: 'SELECT project_id, COUNT(*) AS n FROM messages_public GROUP BY project_id HAVING n > 0',
      expected: 'allow',
    },
    {
      label: 'where IN list',
      sql: 'SELECT * FROM messages_public WHERE id IN (?, ?)',
      expected: 'allow',
    },
    {
      label: 'where BETWEEN',
      sql: 'SELECT * FROM messages_public WHERE id BETWEEN ? AND ?',
      expected: 'allow',
    },
    {
      label: 'where LIKE',
      sql: 'SELECT * FROM messages_public WHERE content LIKE ?',
      expected: 'allow',
    },
    {
      label: 'where IS NULL',
      sql: 'SELECT * FROM messages_public WHERE parent_message_id IS NULL',
      expected: 'allow',
    },
    {
      label: 'inner join allowlist',
      sql: 'SELECT * FROM messages_public m JOIN conversations_public c ON m.conversation_id = c.id',
      expected: 'allow',
    },
    {
      label: 'left outer join allowlist',
      sql: 'SELECT * FROM messages_public m LEFT OUTER JOIN summaries_public s ON m.id = s.message_id',
      expected: 'allow',
    },
    {
      label: 'union all allowlist',
      sql: 'SELECT id FROM messages_public UNION ALL SELECT id FROM conversations_public',
      expected: 'allow',
    },
    {
      label: 'cte fronted select',
      sql: 'WITH recent AS (SELECT * FROM messages_public ORDER BY timestamp DESC LIMIT 10) SELECT * FROM recent',
      expected: 'allow',
    },
    {
      label: 'table alias without AS',
      sql: 'SELECT m.id FROM messages_public m WHERE m.id > ?',
      expected: 'allow',
    },
    {
      label: 'column alias with AS',
      sql: 'SELECT id AS message_id FROM messages_public',
      expected: 'allow',
    },
    {
      label: 'main.-prefixed allowlist',
      sql: 'SELECT * FROM main.messages_public WHERE id = ?',
      expected: 'allow',
    },
    {
      label: 'comma-separated allowlist tables',
      sql: 'SELECT * FROM messages_public, conversations_public WHERE 1=1',
      expected: 'allow',
    },
    {
      label: 'line comment stripped before parsing',
      sql: '-- a comment\nSELECT * FROM messages_public',
      expected: 'allow',
    },
    {
      label: 'block comment stripped before parsing',
      sql: '/* block */ SELECT * FROM messages_public',
      expected: 'allow',
    },
    {
      label: 'mixed-case keywords',
      sql: 'select * From messages_public Where id > ?',
      expected: 'allow',
    },
    {
      label: 'trailing semicolon allowed',
      sql: 'SELECT * FROM messages_public;',
      expected: 'allow',
    },

    // ---------- REJECT: non-SELECT keywords (sample of the 19) ----------
    {
      label: 'reject INSERT',
      sql: 'INSERT INTO messages_public (id) VALUES (1)',
      expected: 'reject',
    },
    { label: 'reject UPDATE', sql: 'UPDATE messages_public SET id = 1', expected: 'reject' },
    { label: 'reject DELETE', sql: 'DELETE FROM messages_public', expected: 'reject' },
    { label: 'reject DROP', sql: 'DROP TABLE messages_public', expected: 'reject' },
    { label: 'reject CREATE', sql: 'CREATE TABLE foo (id INT)', expected: 'reject' },
    { label: 'reject ALTER', sql: 'ALTER TABLE messages ADD COLUMN x INT', expected: 'reject' },
    { label: 'reject VACUUM', sql: 'VACUUM', expected: 'reject' },
    { label: 'reject ANALYZE', sql: 'ANALYZE messages_public', expected: 'reject' },
    { label: 'reject REPLACE', sql: 'REPLACE INTO messages_public VALUES (1)', expected: 'reject' },
    { label: 'reject ATTACH', sql: "ATTACH 'other.db' AS other", expected: 'reject' },
    { label: 'reject DETACH', sql: 'DETACH other', expected: 'reject' },

    // ---------- REJECT: off-allowlist references (basic) ----------
    {
      label: 'reject off-allowlist top-level',
      sql: 'SELECT * FROM messages',
      expected: 'reject',
    },
    {
      label: 'reject off-allowlist via subquery in WHERE',
      sql: 'SELECT * FROM messages_public WHERE id IN (SELECT id FROM secret_table)',
      expected: 'reject',
    },
    {
      label: 'reject off-allowlist via JOIN',
      sql: 'SELECT * FROM messages_public m JOIN secret_table s ON s.id = m.id',
      expected: 'reject',
    },
    {
      label: 'reject CTE body referencing off-allowlist',
      sql: 'WITH x AS (SELECT * FROM messages) SELECT * FROM x',
      expected: 'reject',
    },

    // ---------- REJECT: 12+ adversarial cases ----------
    {
      label: 'adv-1: multi-statement (SQL-injection style)',
      sql: 'SELECT * FROM messages_public; DROP TABLE messages',
      expected: 'reject',
    },
    {
      label: 'adv-2: PRAGMA access',
      sql: 'PRAGMA table_info(messages_public)',
      expected: 'reject',
    },
    {
      label: 'adv-3: EXPLAIN prefix',
      sql: 'EXPLAIN SELECT * FROM messages_public',
      expected: 'reject',
    },
    {
      label: 'adv-4: EXPLAIN QUERY PLAN prefix',
      sql: 'EXPLAIN QUERY PLAN SELECT * FROM messages_public',
      expected: 'reject',
    },
    {
      label: 'adv-5: ATTACH attempt',
      sql: "ATTACH DATABASE 'leak.db' AS leak",
      expected: 'reject',
    },
    {
      label: 'adv-6: REINDEX attempt',
      sql: 'REINDEX messages_public',
      expected: 'reject',
    },
    {
      label: 'adv-7: identifier-encoding trick (double-quoted off-allowlist)',
      sql: 'SELECT * FROM "messages"',
      expected: 'reject',
    },
    {
      label: 'adv-8: identifier-encoding trick (square-bracket off-allowlist)',
      sql: 'SELECT * FROM [messages]',
      expected: 'reject',
    },
    {
      label: 'adv-9: identifier-encoding trick (backtick off-allowlist)',
      sql: 'SELECT * FROM `messages`',
      expected: 'reject',
    },
    {
      label: 'adv-10: nested-CTE attack referencing internal',
      sql: 'WITH a AS (WITH b AS (SELECT * FROM messages) SELECT * FROM b) SELECT * FROM a',
      expected: 'reject',
    },
    {
      label: 'adv-11: schema-prefix attempt to bypass via temp.',
      sql: 'SELECT * FROM temp.messages_public',
      expected: 'reject',
    },
    {
      label: 'adv-12: schema-prefix attempt via aux.',
      sql: 'SELECT * FROM aux.messages',
      expected: 'reject',
    },
    {
      label: 'adv-13: comment-disguised second statement',
      sql: 'SELECT * FROM messages_public; /* */ DROP TABLE messages',
      expected: 'reject',
    },
    {
      label: 'adv-14: trailing UNION onto off-allowlist',
      sql: 'SELECT id FROM messages_public UNION SELECT id FROM messages',
      expected: 'reject',
    },
    {
      label: 'adv-15: shadow-table exact-match (messages_fts_data is not messages_fts)',
      sql: 'SELECT * FROM messages_fts_data WHERE rowid > 0',
      expected: 'reject',
    },
  ];

  for (const tc of cases) {
    if (tc.expected === 'allow') {
      it(`allow: ${tc.label}`, () => {
        expect(() => {
          validateSqlAccess(tc.sql, ALLOW);
        }).not.toThrow();
      });
    } else {
      it(`reject: ${tc.label}`, () => {
        expect(() => {
          validateSqlAccess(tc.sql, ALLOW);
        }).toThrow(InvalidSqlError);
      });
    }
  }
});

describe('schema-prefix handling (AC line 144)', () => {
  it('main.messages_public resolves to messages_public', () => {
    expect(() => {
      validateSqlAccess('SELECT * FROM main.messages_public', ALLOW);
    }).not.toThrow();
  });

  it('temp.messages_public is rejected', () => {
    expect(() => {
      validateSqlAccess('SELECT * FROM temp.messages_public', ALLOW);
    }).toThrow(InvalidSqlError);
  });

  it('aux.messages is rejected', () => {
    expect(() => {
      validateSqlAccess('SELECT * FROM aux.messages', ALLOW);
    }).toThrow(InvalidSqlError);
  });

  it('reject schema-prefix message names the offending qualifier', () => {
    let caught: unknown;
    try {
      validateSqlAccess('SELECT * FROM temp.messages_public', ALLOW);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidSqlError);
    expect((caught as Error).message).toContain('temp');
  });
});

describe('shadow-table exact-match (AC line 145)', () => {
  it('messages_fts_data is rejected even with messages_fts in allowlist', () => {
    let caught: unknown;
    try {
      validateSqlAccess('SELECT * FROM messages_fts_data WHERE rowid > 0', ALLOW);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidSqlError);
    expect((caught as Error).message).toContain('messages_fts_data');
  });

  it('messages_fts_idx, _docsize, _config also rejected', () => {
    for (const t of ['messages_fts_idx', 'messages_fts_docsize', 'messages_fts_config']) {
      expect(() => {
        validateSqlAccess(`SELECT * FROM ${t}`, ALLOW);
      }).toThrow(InvalidSqlError);
    }
  });

  it('the literal messages_fts is allowed (extended allowlist)', () => {
    expect(() => {
      validateSqlAccess(
        'SELECT rowid, content FROM messages_fts WHERE messages_fts MATCH ?',
        ALLOW,
      );
    }).not.toThrow();
  });
});

describe('nested-CTE rejection (AC line 146)', () => {
  it('nested CTE referencing off-allowlist messages is rejected', () => {
    let caught: unknown;
    try {
      validateSqlAccess(
        'WITH a AS (WITH b AS (SELECT * FROM messages) SELECT * FROM b) SELECT * FROM a',
        ALLOW,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidSqlError);
    expect((caught as Error).message).toContain('messages');
  });
});

describe('happy-path acceptance matrix (AC line 147)', () => {
  // Every form in the "Parser MUST ACCEPT" AC bullet — locked.
  const acceptedForms: ReadonlyArray<{ label: string; sql: string }> = [
    { label: 'COUNT(*)', sql: 'SELECT COUNT(*) FROM messages_public WHERE project_id = ?' },
    {
      label: 'MIN/MAX',
      sql: 'SELECT MIN(timestamp), MAX(timestamp) FROM messages_public',
    },
    { label: 'AVG', sql: 'SELECT AVG(turn_index) FROM messages_public' },
    {
      label: 'GROUP BY + HAVING',
      sql: 'SELECT project_id, COUNT(*) AS n FROM messages_public GROUP BY project_id HAVING n > 0',
    },
    { label: 'IN', sql: 'SELECT * FROM messages_public WHERE id IN (?, ?)' },
    { label: 'BETWEEN', sql: 'SELECT * FROM messages_public WHERE id BETWEEN ? AND ?' },
    { label: 'LIKE', sql: 'SELECT * FROM messages_public WHERE content LIKE ?' },
    { label: '<', sql: 'SELECT * FROM messages_public WHERE id < ?' },
    { label: '>', sql: 'SELECT * FROM messages_public WHERE id > ?' },
    { label: '<=', sql: 'SELECT * FROM messages_public WHERE id <= ?' },
    { label: '>=', sql: 'SELECT * FROM messages_public WHERE id >= ?' },
    { label: '!=', sql: 'SELECT * FROM messages_public WHERE id != ?' },
    { label: 'IS NULL', sql: 'SELECT * FROM messages_public WHERE parent_message_id IS NULL' },
    {
      label: 'IS NOT NULL',
      sql: 'SELECT * FROM messages_public WHERE parent_message_id IS NOT NULL',
    },
    {
      label: 'INNER JOIN',
      sql: 'SELECT * FROM messages_public m JOIN conversations_public c ON m.conversation_id = c.id',
    },
    {
      label: 'LEFT OUTER JOIN',
      sql: 'SELECT * FROM messages_public m LEFT OUTER JOIN summaries_public s ON m.id = s.message_id',
    },
    {
      label: 'UNION ALL',
      sql: 'SELECT id FROM messages_public UNION ALL SELECT id FROM conversations_public',
    },
    {
      label: 'UNION',
      sql: 'SELECT id FROM messages_public UNION SELECT id FROM conversations_public',
    },
    {
      label: 'CTE-fronted SELECT',
      sql: 'WITH recent AS (SELECT * FROM messages_public ORDER BY timestamp DESC LIMIT 10) SELECT * FROM recent',
    },
    { label: 'LIMIT/OFFSET', sql: 'SELECT * FROM messages_public LIMIT ? OFFSET ?' },
    {
      label: 'ORDER BY ASC',
      sql: 'SELECT * FROM messages_public ORDER BY timestamp ASC',
    },
    {
      label: 'ORDER BY DESC',
      sql: 'SELECT * FROM messages_public ORDER BY timestamp DESC',
    },
    {
      label: 'column alias AS',
      sql: 'SELECT id AS message_id FROM messages_public',
    },
    { label: 'table alias bare', sql: 'SELECT m.id FROM messages_public m' },
    { label: 'table alias AS', sql: 'SELECT m.id FROM messages_public AS m' },
  ];

  for (const f of acceptedForms) {
    it(`accepts ${f.label}`, () => {
      expect(() => {
        validateSqlAccess(f.sql, ALLOW);
      }).not.toThrow();
    });
  }
});

describe('deny-on-parse-uncertainty (AC line 148)', () => {
  // The locked example inputs from AC line 148 — TOP-LEVEL FROM has NO
  // resolvable identifier (inline VALUES / inline derived-table subquery).
  const cases: ReadonlyArray<{ label: string; sql: string }> = [
    {
      label: 'top-level FROM is inline VALUES subquery',
      sql: 'SELECT * FROM (VALUES (1, 2)) AS t(a, b)',
    },
    {
      label: 'top-level FROM is inline derived-table subquery',
      sql: 'SELECT * FROM (SELECT 1 UNION SELECT 2) AS sub',
    },
    {
      label: 'top-level FROM is VALUES with EXISTS sub-clause',
      sql: 'SELECT 1 FROM (VALUES (1)) AS x WHERE EXISTS (SELECT 1)',
    },
  ];

  for (const tc of cases) {
    it(`reject + parse-uncertainty error: ${tc.label}`, () => {
      let caught: unknown;
      try {
        validateSqlAccess(tc.sql, ALLOW);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(InvalidSqlError);
      // Pass condition: error message contains the literal phrase
      // "parse uncertainty" (the parser surfaces it consistently).
      expect((caught as Error).message).toContain('parse uncertainty');
    });
  }
});

describe('parseSqlAccess return shape', () => {
  it('returns isSelect=true and the extracted tables for a simple SELECT', () => {
    const result = parseSqlAccess('SELECT * FROM messages_public WHERE id = ?');
    expect(result.isSelect).toBe(true);
    expect(result.tables).toEqual(['messages_public']);
  });

  it('extracts multiple tables from a JOIN', () => {
    const result = parseSqlAccess(
      'SELECT * FROM messages_public m JOIN conversations_public c ON m.conversation_id = c.id',
    );
    expect(result.isSelect).toBe(true);
    expect(result.tables).toEqual(['messages_public', 'conversations_public']);
  });

  it('skips CTE-local names but extracts inner-body tables', () => {
    const result = parseSqlAccess(
      'WITH recent AS (SELECT * FROM messages_public) SELECT * FROM recent',
    );
    expect(result.isSelect).toBe(true);
    expect(result.tables).toEqual(['messages_public']);
  });

  it('strips main. prefix in extracted tables', () => {
    const result = parseSqlAccess('SELECT * FROM main.messages_public');
    expect(result.tables).toEqual(['messages_public']);
  });
});

describe('error-message debuggability (AC line 125)', () => {
  it('off-allowlist error names the offending table', () => {
    let caught: unknown;
    try {
      validateSqlAccess('SELECT * FROM secret_table', ALLOW);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidSqlError);
    expect((caught as Error).message).toContain('secret_table');
  });

  it('non-SELECT keyword error names the offending keyword', () => {
    let caught: unknown;
    try {
      validateSqlAccess('DROP TABLE messages_public', ALLOW);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidSqlError);
    expect((caught as Error).message).toContain('DROP');
  });
});
