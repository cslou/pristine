import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initPristine, DEFAULT_MODEL_CONFIG } from '../../src/core/init.js';
import { createLlmClients } from '../../src/engine/index.js';
import { FileSystemKeyManager } from '../../src/privacy/keys/filesystem.js';
import { KeyManagerError } from '../../src/core/errors.js';
import { cleanupDirs, makeTmpDir } from './helpers.js';

afterEach(() => {
  cleanupDirs();
});

describe('e2e: initialization and configuration', () => {
  it('initPristine creates full directory tree with correct permissions', () => {
    const baseDir = join(makeTmpDir('init'), 'pristine');
    const result = initPristine(baseDir);

    expect(existsSync(baseDir)).toBe(true);
    expect(existsSync(join(baseDir, 'keys'))).toBe(true);
    expect(existsSync(join(baseDir, 'data'))).toBe(true);
    expect(existsSync(join(baseDir, 'models'))).toBe(true);
    expect(existsSync(result.configPath)).toBe(true);
    expect(existsSync(result.databasePath)).toBe(true);

    if (process.platform !== 'win32') {
      expect(statSync(baseDir).mode & 0o777).toBe(0o700);
      expect(statSync(join(baseDir, 'keys')).mode & 0o777).toBe(0o700);
      expect(statSync(join(baseDir, 'data')).mode & 0o777).toBe(0o700);
    }
  });

  it('default models.json has Ollama llama3.2:latest for both pipelines', () => {
    const baseDir = join(makeTmpDir('config'), 'pristine');
    initPristine(baseDir);

    const config = JSON.parse(readFileSync(join(baseDir, 'models.json'), 'utf-8'));
    expect(config).toEqual(DEFAULT_MODEL_CONFIG);
  });

  it('createLlmClients returns OllamaClient, same instance for matching configs', () => {
    const baseDir = join(makeTmpDir('clients'), 'pristine');
    initPristine(baseDir);

    const { privacyClient, memoryClient } = createLlmClients(baseDir);
    expect(privacyClient.constructor.name).toBe('OllamaClient');
    expect(privacyClient).toBe(memoryClient);
  });

  it('editing models.json to llamacpp switches engine', () => {
    const baseDir = join(makeTmpDir('switch'), 'pristine');
    initPristine(baseDir);

    const ggufPath = join(baseDir, 'models', 'fake.gguf');
    writeFileSync(ggufPath, '');
    writeFileSync(
      join(baseDir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'llamacpp', path: ggufPath },
        memory: { engine: 'llamacpp', path: ggufPath },
      }),
    );

    const { privacyClient } = createLlmClients(baseDir);
    expect(privacyClient.constructor.name).toBe('LlamaCppClient');
  });

  it('initPristine is idempotent', () => {
    const baseDir = join(makeTmpDir('idem'), 'pristine');
    const r1 = initPristine(baseDir);
    const r2 = initPristine(baseDir);

    expect(r1.config).toEqual(r2.config);
    expect(r1.baseDir).toBe(r2.baseDir);
  });

  it('rejects keys directory with wrong permissions', async () => {
    if (process.platform === 'win32') return;

    const baseDir = join(makeTmpDir('perms-dir'), 'pristine');
    initPristine(baseDir);

    const keysDir = join(baseDir, 'keys');
    const km = new FileSystemKeyManager({ keysDir });
    await km.getOrCreateKeyPair('test-user');
    (km as unknown as { cache: Map<string, unknown> }).cache.clear();

    chmodSync(keysDir, 0o755);

    try {
      await expect(km.getOrCreateKeyPair('test-user')).rejects.toThrow(KeyManagerError);
      await expect(km.getOrCreateKeyPair('test-user')).rejects.toThrow(/too open/);
      await expect(km.getOrCreateKeyPair('test-user')).rejects.toThrow(/chmod 700/);
    } finally {
      chmodSync(keysDir, 0o700);
    }
  }, 15000);

  it('rejects private key file with wrong permissions', async () => {
    if (process.platform === 'win32') return;

    const baseDir = join(makeTmpDir('perms-file'), 'pristine');
    initPristine(baseDir);

    const keysDir = join(baseDir, 'keys');
    const km = new FileSystemKeyManager({ keysDir });
    await km.getOrCreateKeyPair('test-user');
    (km as unknown as { cache: Map<string, unknown> }).cache.clear();

    chmodSync(join(keysDir, 'test-user-private.pem'), 0o644);

    await expect(km.getOrCreateKeyPair('test-user')).rejects.toThrow(KeyManagerError);
    await expect(km.getOrCreateKeyPair('test-user')).rejects.toThrow(/too open/);
    await expect(km.getOrCreateKeyPair('test-user')).rejects.toThrow(/chmod 600/);
  });
});
