import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PristineLocal } from '../src/client.js';
import { createDatabase } from '../src/core/database.js';
import type { Embedder } from '../src/core/interfaces.js';

const vector = (first: number, second = 0): number[] => [
  first,
  second,
  ...Array.from({ length: 766 }, () => 0),
];

const createMockEmbedder = (): Embedder & { dispose: ReturnType<typeof vi.fn> } => ({
  dim: 768,
  embed: vi.fn(async () => vector(1)),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => vector(Math.random()))),
  dispose: vi.fn(async () => undefined),
});

const createTestDeps = (): {
  db: Database.Database;
  embedder: Embedder & { dispose: ReturnType<typeof vi.fn> };
} => ({
  db: createDatabase(':memory:'),
  embedder: createMockEmbedder(),
});

describe('PristineLocal', () => {
  let deps: ReturnType<typeof createTestDeps>;

  beforeEach(() => {
    deps = createTestDeps();
  });

  afterEach(() => {
    deps.db.close();
  });

  it('creates a client with DI overrides and no raw conversation APIs', async () => {
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    expect(client).toBeInstanceOf(PristineLocal);
    expect('storeAsync' in client).toBe(false);
    expect('getConversation' in client).toBe(false);
    expect('drainEmbedQueue' in client).toBe(false);
    expect('buildSessionVector' in client).toBe(false);
    expect('searcher' in client).toBe(false);
  });

  it('privacy APIs remain available', async () => {
    const keysDir = mkdtempSync(join(tmpdir(), 'pristine-client-keys-'));
    try {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
        keysDir,
        privacy: { customPatternsPath: '/tmp/pristine-client-missing-redaction.json' },
      });

      const secured = await client.secureAndRedact(
        'Token sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
        'user-a',
      );
      expect(secured.redactedText).toContain('[SENSITIVE:api_key:');
      expect(client.scrubOutput('Tool leaked sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456')).toBe(
        'Tool leaked ',
      );
    } finally {
      rmSync(keysDir, { force: true, recursive: true });
    }
  });

  it('dispose does not dispose DI-provided resources', async () => {
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });
    await client.dispose();

    expect(deps.embedder.dispose).not.toHaveBeenCalled();
    expect(deps.db.open).toBe(true);
  });
});
