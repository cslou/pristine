import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLlmClients } from '../../src/engine/index.js';
import { OllamaClient } from '../../src/engine/ollama/index.js';
import { LlamaCppClient } from '../../src/engine/llamacpp/index.js';
import { ConfigError } from '../../src/core/errors.js';

let cleanupDirs: string[] = [];

function makeTmpDir(suffix: string): string {
  const dir = join(
    tmpdir(),
    `pristine-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  cleanupDirs = [];
});

describe('createLlmClients', () => {
  it('returns OllamaClient instances when config specifies ollama', () => {
    const dir = makeTmpDir('clients-ollama');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'ollama', model: 'llama3.2:latest' },
        memory: { engine: 'ollama', model: 'llama3.2:latest' },
      }),
    );

    const { privacyClient, memoryClient } = createLlmClients(dir);

    expect(privacyClient).toBeInstanceOf(OllamaClient);
    expect(memoryClient).toBeInstanceOf(OllamaClient);
  });

  it('returns same instance when both pipelines have identical config', () => {
    const dir = makeTmpDir('clients-same');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'ollama', model: 'llama3.2:latest' },
        memory: { engine: 'ollama', model: 'llama3.2:latest' },
      }),
    );

    const { privacyClient, memoryClient } = createLlmClients(dir);

    expect(privacyClient).toBe(memoryClient);
  });

  it('returns different instances when pipelines have different models', () => {
    const dir = makeTmpDir('clients-diff-model');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'ollama', model: 'llama3.2:latest' },
        memory: { engine: 'ollama', model: 'llama3.2:1b' },
      }),
    );

    const { privacyClient, memoryClient } = createLlmClients(dir);

    expect(privacyClient).not.toBe(memoryClient);
    expect(privacyClient).toBeInstanceOf(OllamaClient);
    expect(memoryClient).toBeInstanceOf(OllamaClient);
  });

  it('returns different instances when pipelines have different engines', () => {
    const dir = makeTmpDir('clients-diff-engine');
    const ggufPath = join(dir, 'fake.gguf');
    writeFileSync(ggufPath, '');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'ollama', model: 'llama3.2:latest' },
        memory: { engine: 'llamacpp', path: ggufPath },
      }),
    );

    const { privacyClient, memoryClient } = createLlmClients(dir);

    expect(privacyClient).toBeInstanceOf(OllamaClient);
    expect(memoryClient).toBeInstanceOf(LlamaCppClient);
    expect(privacyClient).not.toBe(memoryClient);
  });

  it('returns same instance when both llamacpp entries point to same path', () => {
    const dir = makeTmpDir('clients-same-llamacpp');
    const ggufPath = join(dir, 'model.gguf');
    writeFileSync(ggufPath, '');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'llamacpp', path: ggufPath },
        memory: { engine: 'llamacpp', path: ggufPath },
      }),
    );

    const { privacyClient, memoryClient } = createLlmClients(dir);

    expect(privacyClient).toBe(memoryClient);
  });

  it('throws ConfigError when models.json does not exist', () => {
    const dir = makeTmpDir('clients-missing');

    expect(() => createLlmClients(dir)).toThrow(ConfigError);
  });

  it('returns different instances when ollama hosts differ', () => {
    const dir = makeTmpDir('clients-diff-host');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'ollama', model: 'llama3.2:latest', host: 'http://host-a:11434' },
        memory: { engine: 'ollama', model: 'llama3.2:latest', host: 'http://host-b:11434' },
      }),
    );

    const { privacyClient, memoryClient } = createLlmClients(dir);

    expect(privacyClient).not.toBe(memoryClient);
  });
});

describe('direct client construction (SDK escape hatch)', () => {
  it('OllamaClient can be constructed directly', () => {
    const client = new OllamaClient({ model: 'test-model' });
    expect(client).toBeInstanceOf(OllamaClient);
  });

  it('LlamaCppClient can be constructed directly', () => {
    const client = new LlamaCppClient({ modelPath: '/some/path.gguf' });
    expect(client).toBeInstanceOf(LlamaCppClient);
  });
});
