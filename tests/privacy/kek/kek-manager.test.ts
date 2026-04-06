import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryKeyManager } from '../../helpers/in-memory-key-manager.js';
import {
  KekManager,
  generateKek,
  unwrapKek,
  wrapKek,
} from '../../../src/privacy/kek/kek-manager.js';
import { KekManagerError } from '../../../src/core/errors.js';
import { generateKeyPair } from '../../../src/privacy/vault/asymmetric-crypto.js';

let db: Database.Database;
let keyManager: InMemoryKeyManager;

beforeAll(() => {
  db = new Database(':memory:');
});

beforeEach(() => {
  db.exec('DROP TABLE IF EXISTS user_keks');
  keyManager = new InMemoryKeyManager();
});

afterAll(() => {
  db.close();
});

describe('generateKek', () => {
  it('returns a 32-byte Buffer', () => {
    const kek = generateKek();
    expect(Buffer.isBuffer(kek)).toBe(true);
    expect(kek.length).toBe(32);
  });

  it('produces different values on each call', () => {
    const a = generateKek();
    const b = generateKek();
    expect(a.equals(b)).toBe(false);
  });
});

describe('wrapKek / unwrapKek round-trip', () => {
  it('wraps and unwraps a KEK correctly', async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const kek = generateKek();

    const wrapped = wrapKek(kek, publicKey);
    const unwrapped = unwrapKek(wrapped, privateKey);

    expect(unwrapped.equals(kek)).toBe(true);
  });

  it('produces 512-byte wrapped output for RSA-4096', async () => {
    const { publicKey } = await generateKeyPair();
    const kek = generateKek();

    const wrapped = wrapKek(kek, publicKey);
    expect(wrapped.length).toBe(512);
  });

  it('rejects KEK shorter than 32 bytes', async () => {
    const { publicKey } = await generateKeyPair();
    const shortKek = Buffer.alloc(16);

    expect(() => wrapKek(shortKek, publicKey)).toThrow(KekManagerError);
    expect(() => wrapKek(shortKek, publicKey)).toThrow(/KEK must be exactly 32 bytes/);
  });

  it('rejects KEK longer than 32 bytes', async () => {
    const { publicKey } = await generateKeyPair();
    const longKek = Buffer.alloc(64);

    expect(() => wrapKek(longKek, publicKey)).toThrow(KekManagerError);
  });

  it('fails to unwrap with wrong private key', async () => {
    const keyPair1 = await generateKeyPair();
    const keyPair2 = await generateKeyPair();
    const kek = generateKek();

    const wrapped = wrapKek(kek, keyPair1.publicKey);
    expect(() => unwrapKek(wrapped, keyPair2.privateKey)).toThrow();
  });
});

describe('KekManager', () => {
  describe('getOrCreate', () => {
    it('generates and stores a KEK on first call', async () => {
      const mgr = new KekManager(db, keyManager);
      const kek = await mgr.getOrCreate('user-1');

      expect(Buffer.isBuffer(kek)).toBe(true);
      expect(kek.length).toBe(32);

      const row = db.prepare('SELECT * FROM user_keks WHERE user_id = ?').get('user-1') as Record<
        string,
        unknown
      >;
      expect(row).toBeDefined();
    });

    it('stores wrapped_kek as 512-byte blob', async () => {
      const mgr = new KekManager(db, keyManager);
      await mgr.getOrCreate('user-1');

      const row = db
        .prepare('SELECT wrapped_kek FROM user_keks WHERE user_id = ?')
        .get('user-1') as { wrapped_kek: Buffer };
      expect(row.wrapped_kek.length).toBe(512);
    });

    it('stores key_id matching RSA fingerprint format', async () => {
      const mgr = new KekManager(db, keyManager);
      await mgr.getOrCreate('user-1');

      const row = db.prepare('SELECT key_id FROM user_keks WHERE user_id = ?').get('user-1') as {
        key_id: string;
      };
      expect(row.key_id).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('stores algorithm as rsa-oaep-256', async () => {
      const mgr = new KekManager(db, keyManager);
      await mgr.getOrCreate('user-1');

      const row = db.prepare('SELECT algorithm FROM user_keks WHERE user_id = ?').get('user-1') as {
        algorithm: string;
      };
      expect(row.algorithm).toBe('rsa-oaep-256');
    });

    it('returns same KEK on second call (cache hit)', async () => {
      const mgr = new KekManager(db, keyManager);
      const kek1 = await mgr.getOrCreate('user-1');
      const kek2 = await mgr.getOrCreate('user-1');

      expect(kek1 === kek2).toBe(true);
    });

    it('retrieves from DB after cache clear', async () => {
      const mgr = new KekManager(db, keyManager);
      const kek1 = await mgr.getOrCreate('user-1');

      mgr.clearCache('user-1');
      const kek2 = await mgr.getOrCreate('user-1');

      expect(kek1.equals(kek2)).toBe(true);
      expect(kek1 === kek2).toBe(false);
    });
  });

  describe('cache behavior', () => {
    it('clearCache(userId) forces DB lookup on next call', async () => {
      const mgr = new KekManager(db, keyManager);
      await mgr.getOrCreate('user-1');
      await mgr.getOrCreate('user-2');

      mgr.clearCache('user-1');
      const kek1 = await mgr.getOrCreate('user-1');
      const kek2 = await mgr.getOrCreate('user-2');

      expect(kek1.length).toBe(32);
      expect(kek2 === (await mgr.getOrCreate('user-2'))).toBe(true);
    });

    it('clearCache() without args clears all users', async () => {
      const mgr = new KekManager(db, keyManager);
      const kek1a = await mgr.getOrCreate('user-1');
      const kek2a = await mgr.getOrCreate('user-2');

      mgr.clearCache();
      const kek1b = await mgr.getOrCreate('user-1');
      const kek2b = await mgr.getOrCreate('user-2');

      expect(kek1a.equals(kek1b)).toBe(true);
      expect(kek1a === kek1b).toBe(false);
      expect(kek2a.equals(kek2b)).toBe(true);
      expect(kek2a === kek2b).toBe(false);
    });
  });

  describe('multi-user isolation', () => {
    it('different users get different KEKs', async () => {
      const mgr = new KekManager(db, keyManager);
      const kek1 = await mgr.getOrCreate('alice');
      const kek2 = await mgr.getOrCreate('bob');

      expect(kek1.equals(kek2)).toBe(false);
    });

    it('clearing one user cache does not affect another', async () => {
      const mgr = new KekManager(db, keyManager);
      await mgr.getOrCreate('alice');
      const kekBob = await mgr.getOrCreate('bob');

      mgr.clearCache('alice');

      const kekBob2 = await mgr.getOrCreate('bob');
      expect(kekBob === kekBob2).toBe(true);
    });
  });

  describe('DB persistence across KekManager instances', () => {
    it('new KekManager instance retrieves existing KEK from DB', async () => {
      const mgr1 = new KekManager(db, keyManager);
      const kek1 = await mgr1.getOrCreate('user-1');

      const mgr2 = new KekManager(db, keyManager);
      const kek2 = await mgr2.getOrCreate('user-1');

      expect(kek1.equals(kek2)).toBe(true);
    });
  });
});
