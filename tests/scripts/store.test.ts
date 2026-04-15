import { describe, expect, it, vi, beforeEach } from 'vitest';
import { parseStoreArgs } from '../../scripts/store.js';

describe('store.ts', () => {
  describe('parseStoreArgs()', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('parses --user-id flag', () => {
      const args = parseStoreArgs(['--user-id', 'test-user']);
      expect(args.userId).toBe('test-user');
      expect(args.dbPath).toBeUndefined();
    });

    it('parses --user-id and --db-path flags', () => {
      const args = parseStoreArgs(['--user-id', 'test-user', '--db-path', '/tmp/test.db']);
      expect(args.userId).toBe('test-user');
      expect(args.dbPath).toBe('/tmp/test.db');
    });

    it('parses flags in any order', () => {
      const args = parseStoreArgs(['--db-path', '/tmp/test.db', '--user-id', 'test-user']);
      expect(args.userId).toBe('test-user');
      expect(args.dbPath).toBe('/tmp/test.db');
    });

    it('exits with code 1 when --user-id is missing', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      expect(() => parseStoreArgs([])).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });
  });
});
