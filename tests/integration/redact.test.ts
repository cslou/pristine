import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../../src/core/errors.js';
import { redact } from '../../src/privacy/redactor/index.js';
import { reveal, resolveSensitive, getSensitive, listSensitive } from '../../src/privacy/index.js';
import { KekManager } from '../../src/privacy/kek/kek-manager.js';
import { SqliteVaultStore } from '../../src/privacy/vault/sqlite/index.js';
import { InMemoryKeyManager } from '../helpers/in-memory-key-manager.js';
import type { KeyManager } from '../../src/core/interfaces.js';

let db: Database.Database;
let vaultStore: SqliteVaultStore;
let keyManager: KeyManager;
let kekManager: KekManager;

const config = () => ({ vaultStore, keyManager, kekManager });

beforeEach(() => {
  db = new Database(':memory:');
  vaultStore = new SqliteVaultStore(db);
  keyManager = new InMemoryKeyManager();
  kekManager = new KekManager(db, keyManager);
});

afterEach(() => {
  db.close();
});

describe('redact privacy primitive', () => {
  it('stores confirmed spans in the vault and returns placeholder metadata', async () => {
    const apiKey = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
    const password = 'verySecret123';
    const text = `Use ${apiKey} and password ${password}.`;
    const apiStart = text.indexOf(apiKey);
    const passwordStart = text.indexOf(password);

    const result = await redact(
      text,
      [
        {
          candidateId: 'candidate-api',
          sourceSpan: { start: apiStart, end: apiStart + apiKey.length },
          type: 'api_key',
          label: 'primary api key',
        },
        {
          candidateId: 'candidate-password',
          sourceSpan: { start: passwordStart, end: passwordStart + password.length },
          type: 'password',
        },
      ],
      'redact-user-1',
      config(),
    );

    expect(result.text).not.toContain(apiKey);
    expect(result.text).not.toContain(password);
    expect(result.text).toMatch(/\[SENSITIVE:api_key:[0-9a-f-]+\]/);
    expect(result.text).toMatch(/\[SENSITIVE:password:[0-9a-f-]+\]/);
    expect(result.redactions).toHaveLength(2);
    expect(result.redactions[0]).toMatchObject({
      candidateId: 'candidate-api',
      type: 'api_key',
      label: 'primary api key',
      alias: 'primary api key',
      sourceSpan: { start: apiStart, end: apiStart + apiKey.length },
    });
    expect(result.redactions[0]!.redactedSpan).toEqual({
      start: text.indexOf(apiKey),
      end: text.indexOf(apiKey) + result.redactions[0]!.placeholder.length,
    });

    const entries = await vaultStore.getEntriesByPlaceholderIds(
      'redact-user-1',
      result.redactions.map((redaction) => redaction.sensitiveRef),
    );
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.sensitiveType).sort()).toEqual(['api_key', 'password']);
  });

  it('round-trips through reveal, resolveSensitive, and sensitive aliases', async () => {
    const value = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
    const text = `token=${value}`;
    const start = text.indexOf(value);

    const result = await redact(
      text,
      [
        {
          sourceSpan: { start, end: start + value.length },
          type: 'api_key',
          label: 'deploy key',
        },
      ],
      'redact-user-2',
      config(),
    );
    const sensitiveRef = result.redactions[0]!.sensitiveRef;

    await expect(reveal(result.text, { ...config(), userId: 'redact-user-2' })).resolves.toEqual({
      text,
      revealedValues: [value],
    });
    await expect(
      resolveSensitive(sensitiveRef, { ...config(), userId: 'redact-user-2' }),
    ).resolves.toBe(value);

    await expect(
      getSensitive(sensitiveRef, { vaultStore, userId: 'redact-user-2' }),
    ).resolves.toMatchObject({ sensitiveRef, alias: 'deploy key' });
    await expect(listSensitive({ vaultStore, userId: 'redact-user-2' })).resolves.toHaveLength(1);
  });

  it('rejects invalid spans without writing partial vault entries', async () => {
    const text = 'token=secret-one and secret-two';
    const first = text.indexOf('secret-one');
    const second = text.indexOf('secret-two');

    await expect(
      redact(
        text,
        [
          { sourceSpan: { start: first, end: first + 12 }, type: 'api_key' },
          { sourceSpan: { start: first + 3, end: second + 10 }, type: 'password' },
        ],
        'redact-user-3',
        config(),
      ),
    ).rejects.toBeInstanceOf(InvalidArgumentError);

    await expect(listSensitive({ vaultStore, userId: 'redact-user-3' })).resolves.toHaveLength(0);
    for (const badSecret of [
      { sourceSpan: { start: -1, end: 3 }, type: 'api_key' },
      { sourceSpan: { start: 0, end: 0 }, type: 'api_key' },
      { sourceSpan: { start: 8, end: 3 }, type: 'api_key' },
      { sourceSpan: { start: 0, end: text.length + 1 }, type: 'api_key' },
      { type: 'api_key' },
    ]) {
      await expect(
        redact(
          text,
          [badSecret] as unknown as Parameters<typeof redact>[1],
          'redact-user-3',
          config(),
        ),
      ).rejects.toBeInstanceOf(InvalidArgumentError);
    }
    await expect(listSensitive({ vaultStore, userId: 'redact-user-3' })).resolves.toHaveLength(0);
  });

  it('preserves classifier type metadata while using placeholder-safe type text', async () => {
    const value = 'oauth-secret-value-123';
    const text = `token ${value}`;
    const start = text.indexOf(value);

    const result = await redact(
      text,
      [{ sourceSpan: { start, end: start + value.length }, type: 'oauth2_token' }],
      'redact-user-custom-type',
      config(),
    );

    expect(result.text).toMatch(/\[SENSITIVE:oauth_token:[0-9a-f-]+\]/);
    expect(result.redactions[0]).toMatchObject({ type: 'oauth2_token' });
    const entries = await vaultStore.getEntriesByPlaceholderIds('redact-user-custom-type', [
      result.redactions[0]!.sensitiveRef,
    ]);
    expect(entries[0]?.sensitiveType).toBe('oauth2_token');
  });

  it('does not return or persist labels that contain raw secret values', async () => {
    const value = 'raw-secret-value-123';
    const text = `token ${value}`;
    const start = text.indexOf(value);

    const result = await redact(
      text,
      [
        {
          sourceSpan: { start, end: start + value.length },
          type: 'secret',
          label: value,
        },
      ],
      'redact-user-4',
      config(),
    );

    expect(result.redactions[0]!.label).toBeUndefined();
    expect(result.redactions[0]!.alias).toBeUndefined();
    const summary = await getSensitive(result.redactions[0]!.sensitiveRef, {
      vaultStore,
      userId: 'redact-user-4',
    });
    expect(summary?.alias).toBeUndefined();
  });
});
