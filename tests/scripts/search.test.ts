import { describe, expect, it, vi, beforeEach } from 'vitest';
import { parseSearchArgs } from '../../scripts/search.js';
import { parseSearchConversationsArgs } from '../../scripts/search-conversations.js';
import { parseGetConversationArgs } from '../../scripts/get-conversation.js';

// ---------------------------------------------------------------------------
// search.ts
// ---------------------------------------------------------------------------

describe('search.ts', () => {
  describe('parseSearchArgs()', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('parses --user-id and --query', () => {
      const args = parseSearchArgs(['--user-id', 'user-1', '--query', 'Tokyo']);
      expect(args.userId).toBe('user-1');
      expect(args.query).toBe('Tokyo');
    });

    it('parses all optional flags', () => {
      const args = parseSearchArgs([
        '--user-id',
        'user-1',
        '--query',
        'Tokyo',
        '--temporal-mode',
        'full',
        '--top-k',
        '10',
        '--db-path',
        '/tmp/test.db',
      ]);
      expect(args.temporalMode).toBe('full');
      expect(args.topK).toBe(10);
      expect(args.dbPath).toBe('/tmp/test.db');
    });

    it('exits when --user-id is missing', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      expect(() => parseSearchArgs(['--query', 'test'])).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits when --query is missing', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      expect(() => parseSearchArgs(['--user-id', 'user-1'])).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits on invalid --temporal-mode', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      expect(() =>
        parseSearchArgs(['--user-id', 'u', '--query', 'q', '--temporal-mode', 'invalid']),
      ).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('must be one of'));
    });
  });
});

// ---------------------------------------------------------------------------
// search-conversations.ts
// ---------------------------------------------------------------------------

describe('search-conversations.ts', () => {
  describe('parseSearchConversationsArgs()', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('parses --user-id', () => {
      const args = parseSearchConversationsArgs(['--user-id', 'user-1']);
      expect(args.userId).toBe('user-1');
    });

    it('parses all optional flags', () => {
      const args = parseSearchConversationsArgs([
        '--user-id',
        'user-1',
        '--keyword',
        'coffee',
        '--date-from',
        '2024-01-01',
        '--date-to',
        '2024-12-31',
        '--limit',
        '5',
        '--db-path',
        '/tmp/test.db',
      ]);
      expect(args.keyword).toBe('coffee');
      expect(args.dateFrom).toBe('2024-01-01');
      expect(args.dateTo).toBe('2024-12-31');
      expect(args.limit).toBe(5);
      expect(args.dbPath).toBe('/tmp/test.db');
    });

    it('exits when --user-id is missing', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      expect(() => parseSearchConversationsArgs([])).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});

// ---------------------------------------------------------------------------
// get-conversation.ts
// ---------------------------------------------------------------------------

describe('get-conversation.ts', () => {
  describe('parseGetConversationArgs()', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('parses positional conversationId', () => {
      const args = parseGetConversationArgs(['abc-123']);
      expect(args.conversationId).toBe('abc-123');
    });

    it('parses conversationId with --db-path', () => {
      const args = parseGetConversationArgs(['abc-123', '--db-path', '/tmp/test.db']);
      expect(args.conversationId).toBe('abc-123');
      expect(args.dbPath).toBe('/tmp/test.db');
    });

    it('parses --db-path before conversationId', () => {
      const args = parseGetConversationArgs(['--db-path', '/tmp/test.db', 'abc-123']);
      expect(args.conversationId).toBe('abc-123');
      expect(args.dbPath).toBe('/tmp/test.db');
    });

    it('exits when conversationId is missing', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      expect(() => parseGetConversationArgs([])).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
