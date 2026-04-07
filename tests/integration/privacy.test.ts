import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { secureAndRedact, reveal, scrubOutput } from '../../src/privacy/index.js';
import { SqliteVaultStore } from '../../src/privacy/vault/sqlite/index.js';
import { clearResolvedStringRegistry } from '../../src/privacy/sanitizer/index.js';
import type { KeyManager, LlmClient } from '../../src/core/interfaces.js';
import type { SecureAndRedactResult } from '../../src/core/types.js';
import { InMemoryKeyManager } from '../helpers/in-memory-key-manager.js';
import { KekManager } from '../../src/privacy/kek/kek-manager.js';

let db: Database.Database;
let vaultStore: SqliteVaultStore;
let keyManager: KeyManager;
let kekManager: KekManager;

beforeAll(async () => {
  db = new Database(':memory:');
  vaultStore = new SqliteVaultStore(db);
  keyManager = new InMemoryKeyManager();
  kekManager = new KekManager(db, keyManager);
});

afterAll(() => {
  db.close();
});

const createMockLlmClient = (findings: unknown[]): LlmClient => ({
  generate: vi.fn().mockResolvedValue({ findings }),
});

const expectSuccess = (
  result: SecureAndRedactResult,
): Extract<SecureAndRedactResult, { ok: true }> => {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected privacy pipeline success but got violations: ${result.redactedText}`);
  }
  return result;
};

describe('privacy pipeline end-to-end', () => {
  it('secureAndRedact -> reveal -> scrubOutput round-trip recovers then scrubs PII', async () => {
    clearResolvedStringRegistry();

    const text = 'Contact alice@example.com or call 555-867-5309 for details.';

    const mockClient = createMockLlmClient([
      {
        type: 'email_address',
        confidence: 0.95,
        reasoning: 'Email address detected',
        text: 'alice@example.com',
      },
      {
        type: 'phone_number',
        confidence: 0.9,
        reasoning: 'Phone number detected',
        text: '555-867-5309',
      },
    ]);

    const result = expectSuccess(
      await secureAndRedact(text, {
        client: mockClient,
        vaultStore,
        keyManager,
        kekManager,
        userId: 'user-e2e-1',
      }),
    );

    expect(result.redactedText).not.toContain('alice@example.com');
    expect(result.redactedText).not.toContain('555-867-5309');
    expect(result.redactedText).toMatch(/\[SENSITIVE:email_address:[0-9a-f-]+\]/);
    expect(result.redactedText).toMatch(/\[SENSITIVE:phone_number:[0-9a-f-]+\]/);
    expect(result.placeholderIds).toHaveLength(2);

    const revealed = await reveal(result.redactedText, {
      vaultStore,
      keyManager,
      kekManager,
      userId: 'user-e2e-1',
    });

    expect(revealed.text).toContain('alice@example.com');
    expect(revealed.text).toContain('555-867-5309');
    expect(revealed.text).not.toContain('[SENSITIVE:');
    expect(revealed.revealedValues).toEqual(['alice@example.com', '555-867-5309']);

    const scrubbed = scrubOutput(
      `Echoed: ${revealed.text} and ${result.redactedText}`,
      revealed.revealedValues,
    );

    expect(scrubbed).not.toContain('alice@example.com');
    expect(scrubbed).not.toContain('555-867-5309');
    expect(scrubbed).not.toContain('[SENSITIVE:');
  });

  it('secureAndRedact returns text unchanged when no PII detected', async () => {
    const text = 'The weather is beautiful today and I enjoy coding.';

    const mockClient = createMockLlmClient([]);

    const result = expectSuccess(
      await secureAndRedact(text, {
        client: mockClient,
        vaultStore,
        keyManager,
        kekManager,
        userId: 'user-e2e-2',
      }),
    );

    expect(result.redactedText).toBe(text);
    expect(result.placeholderIds).toHaveLength(0);
  });

  it('secureAndRedact stores encrypted entries in vault', async () => {
    clearResolvedStringRegistry();

    const text = 'My SSN is 123-45-6789';

    const mockClient = createMockLlmClient([
      {
        type: 'identity_number',
        confidence: 0.95,
        reasoning: 'SSN detected',
        text: '123-45-6789',
      },
    ]);

    const result = expectSuccess(
      await secureAndRedact(text, {
        client: mockClient,
        vaultStore,
        keyManager,
        kekManager,
        userId: 'user-e2e-3',
      }),
    );

    expect(result.placeholderIds).toHaveLength(1);

    const entries = await vaultStore.getEntriesByPlaceholderIds(
      'user-e2e-3',
      result.placeholderIds as string[],
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.sensitiveType).toBe('identity_number');
    expect(entries[0]!.encryptionMode).toBe('client_v2');
  });

  it('reveal returns text unchanged when no placeholders present', async () => {
    const text = 'No placeholders here.';

    const revealed = await reveal(text, {
      vaultStore,
      keyManager,
      kekManager,
      userId: 'user-e2e-4',
    });

    expect(revealed).toEqual({ text, revealedValues: [] });
  });

  it('scrubOutput removes revealed values, placeholders, and structured leftovers', () => {
    const text =
      'Contact alice@example.com or [SENSITIVE:phone_number:def-456] and password=supersecret.';

    const scrubbed = scrubOutput(text, ['alice@example.com']);

    expect(scrubbed).not.toContain('alice@example.com');
    expect(scrubbed).not.toContain('[SENSITIVE:');
    expect(scrubbed).not.toContain('password=supersecret');
  });

  it('scrubOutput returns text unchanged when there is nothing sensitive to remove', () => {
    const text = 'No sensitive content here.';
    expect(scrubOutput(text, [])).toBe(text);
  });

  it('fails closed when post-redaction safety scan finds survivors', async () => {
    const text = 'Local config api_key=super-secret-value';
    const mockClient = createMockLlmClient([]);

    const result = await secureAndRedact(text, {
      client: mockClient,
      vaultStore,
      keyManager,
      kekManager,
      userId: 'user-e2e-unsafe',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected safety scan to block vault writes');
    }
    expect(result.redactedText).toContain('api_key=super-secret-value');
    expect(result.safetyViolations).toHaveLength(1);
    expect(result.safetyViolations[0]!.type).toBe('secret');
  });

  it('handles unicode PII in round-trip', async () => {
    clearResolvedStringRegistry();

    const text = 'Name is 山田太郎 and email taro@example.jp';

    const mockClient = createMockLlmClient([
      {
        type: 'identity_number',
        confidence: 0.9,
        reasoning: 'Japanese name detected',
        text: '山田太郎',
      },
      {
        type: 'email_address',
        confidence: 0.95,
        reasoning: 'Email detected',
        text: 'taro@example.jp',
      },
    ]);

    const result = expectSuccess(
      await secureAndRedact(text, {
        client: mockClient,
        vaultStore,
        keyManager,
        kekManager,
        userId: 'user-e2e-5',
      }),
    );

    expect(result.redactedText).not.toContain('山田太郎');
    expect(result.redactedText).not.toContain('taro@example.jp');

    const revealed = await reveal(result.redactedText, {
      vaultStore,
      keyManager,
      kekManager,
      userId: 'user-e2e-5',
    });

    expect(revealed.text).toContain('山田太郎');
    expect(revealed.text).toContain('taro@example.jp');
    expect(revealed.revealedValues).toEqual(['山田太郎', 'taro@example.jp']);
  });
});
