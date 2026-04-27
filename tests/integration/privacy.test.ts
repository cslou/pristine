import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { secureAndRedact, reveal, scrubOutput } from '../../src/privacy/index.js';
import { SqliteVaultStore } from '../../src/privacy/vault/sqlite/index.js';
import { clearResolvedStringRegistry } from '../../src/privacy/sanitizer/index.js';
import type { KeyManager, PrivacyPipeline } from '../../src/core/interfaces.js';
import type { ClassificationPipelineResult, SecureAndRedactResult } from '../../src/core/types.js';
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
  it('secureAndRedact -> reveal -> scrubOutput round-trip recovers then scrubs secrets', async () => {
    clearResolvedStringRegistry();

    const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
    const privateKey =
      'DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const text = `Use ${apiKey} and ${privateKey} for deployment.`;

    const result = expectSuccess(
      await secureAndRedact(text, {
        vaultStore,
        keyManager,
        kekManager,
        userId: 'user-e2e-1',
      }),
    );

    expect(result.redactedText).not.toContain(apiKey);
    expect(result.redactedText).not.toContain(privateKey);
    expect(result.redactedText).toMatch(/\[SENSITIVE:api_key:[0-9a-f-]+\]/);
    expect(result.redactedText).toMatch(/\[SENSITIVE:private_key:[0-9a-f-]+\]/);
    expect(result.placeholderIds).toHaveLength(2);

    const revealed = await reveal(result.redactedText, {
      vaultStore,
      keyManager,
      kekManager,
      userId: 'user-e2e-1',
    });

    expect(revealed.text).toContain(apiKey);
    expect(revealed.text).toContain(privateKey);
    expect(revealed.text).not.toContain('[SENSITIVE:');
    expect(revealed.revealedValues).toEqual([apiKey, privateKey]);

    const scrubbed = scrubOutput(
      `Echoed: ${revealed.text} and ${result.redactedText}`,
      revealed.revealedValues,
    );

    expect(scrubbed).not.toContain(apiKey);
    expect(scrubbed).not.toContain(privateKey);
    expect(scrubbed).not.toContain('[SENSITIVE:');
  });

  it('secureAndRedact returns text unchanged when no secret is detected', async () => {
    const text = 'The weather is beautiful today and I enjoy coding.';

    const result = expectSuccess(
      await secureAndRedact(text, {
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

    const text = 'API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';

    const result = expectSuccess(
      await secureAndRedact(text, {
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
    expect(entries[0]!.sensitiveType).toBe('api_key');
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

  it('scrubOutput removes revealed values, placeholders, and structured secret leftovers', () => {
    const text =
      'Contact alice@example.com or [SENSITIVE:phone_number:def-456] and sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456.';

    const scrubbed = scrubOutput(text, ['alice@example.com']);

    expect(scrubbed).not.toContain('alice@example.com');
    expect(scrubbed).not.toContain('[SENSITIVE:');
    expect(scrubbed).not.toContain('sk-ant-api03');
  });

  it('round-trips custom regex matches through the vault', async () => {
    clearResolvedStringRegistry();

    const text = 'Use acme_tk_ABC12345 for the sandbox.';

    const result = expectSuccess(
      await secureAndRedact(text, {
        vaultStore,
        keyManager,
        kekManager,
        userId: 'user-custom-regex',
        classifier: {
          customPatternsPath: '/tmp/pristine-missing-redaction.json',
          customPatterns: [
            {
              id: 'acme',
              type: 'api_key',
              pattern: '\\bacme_tk_[A-Za-z0-9]{8}\\b',
              confidence: 0.95,
            },
          ],
        },
      }),
    );

    expect(result.redactedText).not.toContain('acme_tk_ABC12345');
    expect(result.redactedText).toMatch(/\[SENSITIVE:api_key:[0-9a-f-]+\]/);

    const revealed = await reveal(result.redactedText, {
      vaultStore,
      keyManager,
      kekManager,
      userId: 'user-custom-regex',
    });

    expect(revealed.text).toContain('acme_tk_ABC12345');
    expect(revealed.revealedValues).toEqual(['acme_tk_ABC12345']);
  });

  it('scrubOutput returns text unchanged when there is nothing sensitive to remove', () => {
    const text = 'No sensitive content here.';
    expect(scrubOutput(text, [])).toBe(text);
  });

  it('fails closed when post-redaction safety scan finds survivors', async () => {
    const text = 'Reach me at alice@example.com';
    const pipeline: PrivacyPipeline = {
      classifyAndRedact: vi.fn<PrivacyPipeline['classifyAndRedact']>().mockResolvedValue({
        report: { entities: [], hasSensitiveContent: false },
        redaction: null,
        safetyViolations: [
          {
            type: 'email_address',
            source: 'deterministic',
            confidence: 0.99,
            start: 12,
            end: 29,
            text: 'alice@example.com',
          },
        ],
      } satisfies ClassificationPipelineResult),
    };

    const result = await secureAndRedact(text, {
      vaultStore,
      keyManager,
      kekManager,
      userId: 'user-e2e-unsafe',
      pipeline,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected safety scan to block vault writes');
    }
    expect(result.redactedText).toContain('alice@example.com');
    expect(result.safetyViolations).toHaveLength(1);
    expect(result.safetyViolations[0]!.type).toBe('email_address');
  });

  it('handles unicode context around a secret in round-trip', async () => {
    clearResolvedStringRegistry();

    const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
    const text = `Name is 山田太郎 and token ${apiKey}`;

    const result = expectSuccess(
      await secureAndRedact(text, {
        vaultStore,
        keyManager,
        kekManager,
        userId: 'user-e2e-5',
      }),
    );

    expect(result.redactedText).toContain('山田太郎');
    expect(result.redactedText).not.toContain(apiKey);

    const revealed = await reveal(result.redactedText, {
      vaultStore,
      keyManager,
      kekManager,
      userId: 'user-e2e-5',
    });

    expect(revealed.text).toContain('山田太郎');
    expect(revealed.text).toContain(apiKey);
    expect(revealed.revealedValues).toEqual([apiKey]);
  });
});
