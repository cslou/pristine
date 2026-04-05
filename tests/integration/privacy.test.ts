import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { secureAndRedact, reveal, scrubOutput } from '../../src/privacy/index.js';
import { SqliteVaultStore } from '../../src/vault/sqlite/index.js';
import { generateKeyPair } from '../../src/vault/asymmetric-crypto.js';
import { clearResolvedStringRegistry } from '../../src/sanitizer/index.js';
import type { LlmClient } from '../../src/core/interfaces.js';

let db: Database.Database;
let vaultStore: SqliteVaultStore;
let publicKey: string;
let privateKey: string;

beforeAll(async () => {
  db = new Database(':memory:');
  vaultStore = new SqliteVaultStore(db);

  const keyPair = await generateKeyPair();
  publicKey = keyPair.publicKey;
  privateKey = keyPair.privateKey;
});

afterAll(() => {
  db.close();
});

const createMockLlmClient = (findings: unknown[]): LlmClient => ({
  generate: vi.fn().mockResolvedValue({ findings }),
});

describe('privacy pipeline end-to-end', () => {
  it('secureAndRedact -> reveal round-trip recovers original PII', async () => {
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

    const result = await secureAndRedact(text, {
      client: mockClient,
      vaultStore,
      publicKeyPem: publicKey,
      userId: 'user-e2e-1',
    });

    expect(result.redactedText).not.toContain('alice@example.com');
    expect(result.redactedText).not.toContain('555-867-5309');
    expect(result.redactedText).toMatch(/\[SENSITIVE:email_address:[0-9a-f-]+\]/);
    expect(result.redactedText).toMatch(/\[SENSITIVE:phone_number:[0-9a-f-]+\]/);
    expect(result.placeholderIds).toHaveLength(2);

    const revealed = await reveal(result.redactedText, {
      vaultStore,
      privateKeyPem: privateKey,
      userId: 'user-e2e-1',
    });

    expect(revealed).toContain('alice@example.com');
    expect(revealed).toContain('555-867-5309');
    expect(revealed).not.toContain('[SENSITIVE:');
  });

  it('secureAndRedact returns text unchanged when no PII detected', async () => {
    const text = 'The weather is beautiful today and I enjoy coding.';

    const mockClient = createMockLlmClient([]);

    const result = await secureAndRedact(text, {
      client: mockClient,
      vaultStore,
      publicKeyPem: publicKey,
      userId: 'user-e2e-2',
    });

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

    const result = await secureAndRedact(text, {
      client: mockClient,
      vaultStore,
      publicKeyPem: publicKey,
      userId: 'user-e2e-3',
    });

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
      privateKeyPem: privateKey,
      userId: 'user-e2e-4',
    });

    expect(revealed).toBe(text);
  });

  it('scrubOutput removes all SENSITIVE placeholders', () => {
    const text =
      'Contact [SENSITIVE:email_address:abc-123] or [SENSITIVE:phone_number:def-456] for info.';

    const scrubbed = scrubOutput(text);

    expect(scrubbed).toBe('Contact  or  for info.');
    expect(scrubbed).not.toContain('[SENSITIVE:');
  });

  it('scrubOutput returns text unchanged when no placeholders', () => {
    const text = 'No sensitive content here.';
    expect(scrubOutput(text)).toBe(text);
  });

  it('handles unicode PII in round-trip', async () => {
    clearResolvedStringRegistry();

    const text = 'Name is \u5c71\u7530\u592a\u90ce and email taro@example.jp';

    const mockClient = createMockLlmClient([
      {
        type: 'identity_number',
        confidence: 0.9,
        reasoning: 'Japanese name detected',
        text: '\u5c71\u7530\u592a\u90ce',
      },
      {
        type: 'email_address',
        confidence: 0.95,
        reasoning: 'Email detected',
        text: 'taro@example.jp',
      },
    ]);

    const result = await secureAndRedact(text, {
      client: mockClient,
      vaultStore,
      publicKeyPem: publicKey,
      userId: 'user-e2e-5',
    });

    expect(result.redactedText).not.toContain('\u5c71\u7530\u592a\u90ce');
    expect(result.redactedText).not.toContain('taro@example.jp');

    const revealed = await reveal(result.redactedText, {
      vaultStore,
      privateKeyPem: privateKey,
      userId: 'user-e2e-5',
    });

    expect(revealed).toContain('\u5c71\u7530\u592a\u90ce');
    expect(revealed).toContain('taro@example.jp');
  });
});
