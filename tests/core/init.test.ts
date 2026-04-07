import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/core/errors.js';
import { DEFAULT_MODEL_CONFIG, initPristine, loadModelConfig } from '../../src/core/init.js';
import { createDefaultDatabase } from '../../src/core/database.js';

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

// ---------------------------------------------------------------------------
// loadModelConfig
// ---------------------------------------------------------------------------

describe('loadModelConfig', () => {
  it('loads valid Ollama config', () => {
    const dir = makeTmpDir('cfg-ollama');
    const config = {
      privacy: { engine: 'ollama', model: 'llama3.2:latest' },
      memory: { engine: 'ollama', model: 'llama3.2:latest' },
    };
    writeFileSync(join(dir, 'models.json'), JSON.stringify(config));

    const result = loadModelConfig(dir);

    expect(result.privacy.engine).toBe('ollama');
    expect(result.memory.engine).toBe('ollama');
    if (result.privacy.engine === 'ollama') {
      expect(result.privacy.model).toBe('llama3.2:latest');
    }
  });

  it('loads valid llamacpp config', () => {
    const dir = makeTmpDir('cfg-llamacpp');
    const ggufPath = join(dir, 'fake.gguf');
    writeFileSync(ggufPath, '');
    const config = {
      privacy: { engine: 'llamacpp', path: ggufPath },
      memory: { engine: 'llamacpp', path: ggufPath },
    };
    writeFileSync(join(dir, 'models.json'), JSON.stringify(config));

    const result = loadModelConfig(dir);

    expect(result.privacy.engine).toBe('llamacpp');
    if (result.privacy.engine === 'llamacpp') {
      expect(result.privacy.path).toBe(ggufPath);
    }
  });

  it('loads mixed config (ollama privacy, llamacpp memory)', () => {
    const dir = makeTmpDir('cfg-mixed');
    const ggufPath = join(dir, 'fake.gguf');
    writeFileSync(ggufPath, '');
    const config = {
      privacy: { engine: 'ollama', model: 'llama3.2:latest' },
      memory: { engine: 'llamacpp', path: ggufPath },
    };
    writeFileSync(join(dir, 'models.json'), JSON.stringify(config));

    const result = loadModelConfig(dir);

    expect(result.privacy.engine).toBe('ollama');
    expect(result.memory.engine).toBe('llamacpp');
  });

  it('throws ConfigError when file does not exist', () => {
    const dir = makeTmpDir('cfg-missing');

    expect(() => loadModelConfig(dir)).toThrow(ConfigError);
    expect(() => loadModelConfig(dir)).toThrow(/Model config not found/);
  });

  it('throws ConfigError for malformed JSON', () => {
    const dir = makeTmpDir('cfg-malformed');
    writeFileSync(join(dir, 'models.json'), '{not valid json}');

    expect(() => loadModelConfig(dir)).toThrow(ConfigError);
    expect(() => loadModelConfig(dir)).toThrow(/Invalid JSON/);
  });

  it('throws ConfigError when privacy section missing', () => {
    const dir = makeTmpDir('cfg-no-privacy');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({ memory: { engine: 'ollama', model: 'x' } }),
    );

    expect(() => loadModelConfig(dir)).toThrow(ConfigError);
    expect(() => loadModelConfig(dir)).toThrow(/missing required "privacy"/);
  });

  it('throws ConfigError when memory section missing', () => {
    const dir = makeTmpDir('cfg-no-memory');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({ privacy: { engine: 'ollama', model: 'x' } }),
    );

    expect(() => loadModelConfig(dir)).toThrow(ConfigError);
    expect(() => loadModelConfig(dir)).toThrow(/missing required "memory"/);
  });

  it('throws ConfigError for unknown engine', () => {
    const dir = makeTmpDir('cfg-bad-engine');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'pytorch', model: 'x' },
        memory: { engine: 'ollama', model: 'x' },
      }),
    );

    expect(() => loadModelConfig(dir)).toThrow(ConfigError);
    expect(() => loadModelConfig(dir)).toThrow(/Unknown engine "pytorch"/);
  });

  it('throws ConfigError when ollama config missing model', () => {
    const dir = makeTmpDir('cfg-no-model');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'ollama' },
        memory: { engine: 'ollama', model: 'x' },
      }),
    );

    expect(() => loadModelConfig(dir)).toThrow(ConfigError);
    expect(() => loadModelConfig(dir)).toThrow(/requires a non-empty "model"/);
  });

  it('throws ConfigError when llamacpp config missing path', () => {
    const dir = makeTmpDir('cfg-no-path');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'llamacpp' },
        memory: { engine: 'ollama', model: 'x' },
      }),
    );

    expect(() => loadModelConfig(dir)).toThrow(ConfigError);
    expect(() => loadModelConfig(dir)).toThrow(/requires a non-empty "path"/);
  });

  it('throws ConfigError when llamacpp path does not exist', () => {
    const dir = makeTmpDir('cfg-bad-path');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'llamacpp', path: '/nonexistent/model.gguf' },
        memory: { engine: 'ollama', model: 'x' },
      }),
    );

    expect(() => loadModelConfig(dir)).toThrow(ConfigError);
    expect(() => loadModelConfig(dir)).toThrow(/GGUF file not found/);
  });

  it('accepts optional host in ollama config', () => {
    const dir = makeTmpDir('cfg-host');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'ollama', model: 'x', host: 'http://custom:1234' },
        memory: { engine: 'ollama', model: 'x' },
      }),
    );

    const result = loadModelConfig(dir);

    if (result.privacy.engine === 'ollama') {
      expect(result.privacy.host).toBe('http://custom:1234');
    }
  });

  it('throws ConfigError for invalid gpu value in llamacpp config', () => {
    const dir = makeTmpDir('cfg-bad-gpu');
    const ggufPath = join(dir, 'fake.gguf');
    writeFileSync(ggufPath, '');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'llamacpp', path: ggufPath, gpu: 'rocm' },
        memory: { engine: 'ollama', model: 'x' },
      }),
    );

    expect(() => loadModelConfig(dir)).toThrow(ConfigError);
    expect(() => loadModelConfig(dir)).toThrow(/Invalid gpu value "rocm"/);
  });

  it('accepts optional gpu in llamacpp config', () => {
    const dir = makeTmpDir('cfg-gpu');
    const ggufPath = join(dir, 'fake.gguf');
    writeFileSync(ggufPath, '');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'llamacpp', path: ggufPath, gpu: 'metal' },
        memory: { engine: 'ollama', model: 'x' },
      }),
    );

    const result = loadModelConfig(dir);

    if (result.privacy.engine === 'llamacpp') {
      expect(result.privacy.gpu).toBe('metal');
    }
  });
});

// ---------------------------------------------------------------------------
// createDefaultDatabase
// ---------------------------------------------------------------------------

describe('createDefaultDatabase', () => {
  it('creates database at pristine.db in provided dataDir', () => {
    const dir = makeTmpDir('db-default');
    const dataDir = join(dir, 'data');

    const db = createDefaultDatabase(dataDir);
    try {
      expect(existsSync(join(dataDir, 'pristine.db'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('creates parent directories if they do not exist', () => {
    const dir = makeTmpDir('db-nested');
    const dataDir = join(dir, 'deep', 'nested', 'data');

    const db = createDefaultDatabase(dataDir);
    try {
      expect(existsSync(join(dataDir, 'pristine.db'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('returns functional Database with WAL enabled', () => {
    const dir = makeTmpDir('db-wal');
    const dataDir = join(dir, 'data');

    const db = createDefaultDatabase(dataDir);
    try {
      const result = db.pragma('journal_mode') as { journal_mode: string }[];
      expect(result[0]?.journal_mode).toBe('wal');
    } finally {
      db.close();
    }
  });

  it('is idempotent -- opening existing database succeeds', () => {
    const dir = makeTmpDir('db-idem');
    const dataDir = join(dir, 'data');

    const db1 = createDefaultDatabase(dataDir);
    db1.close();

    const db2 = createDefaultDatabase(dataDir);
    try {
      const result = db2.pragma('integrity_check') as { integrity_check: string }[];
      expect(result[0]?.integrity_check).toBe('ok');
    } finally {
      db2.close();
    }
  });
});

// ---------------------------------------------------------------------------
// initPristine
// ---------------------------------------------------------------------------

describe('initPristine', () => {
  it('creates full directory tree', () => {
    const dir = makeTmpDir('init-tree');
    const baseDir = join(dir, 'pristine');

    initPristine(baseDir);

    expect(existsSync(baseDir)).toBe(true);
    expect(existsSync(join(baseDir, 'keys'))).toBe(true);
    expect(existsSync(join(baseDir, 'data'))).toBe(true);
    expect(existsSync(join(baseDir, 'models'))).toBe(true);
  });

  it('writes default models.json with Ollama defaults', () => {
    const dir = makeTmpDir('init-config');
    const baseDir = join(dir, 'pristine');

    initPristine(baseDir);

    const raw = JSON.parse(readFileSync(join(baseDir, 'models.json'), 'utf-8')) as unknown;
    expect(raw).toEqual(DEFAULT_MODEL_CONFIG);
  });

  it('does not overwrite existing models.json', () => {
    const dir = makeTmpDir('init-no-overwrite');
    const baseDir = join(dir, 'pristine');
    mkdirSync(baseDir, { recursive: true });

    const customConfig = {
      privacy: { engine: 'ollama', model: 'custom-model' },
      memory: { engine: 'ollama', model: 'custom-model' },
    };
    writeFileSync(join(baseDir, 'models.json'), JSON.stringify(customConfig, null, 2));

    initPristine(baseDir);

    const raw = JSON.parse(readFileSync(join(baseDir, 'models.json'), 'utf-8')) as unknown;
    expect(raw).toEqual(customConfig);
  });

  it('creates pristine.db in data/', () => {
    const dir = makeTmpDir('init-db');
    const baseDir = join(dir, 'pristine');

    initPristine(baseDir);

    expect(existsSync(join(baseDir, 'data', 'pristine.db'))).toBe(true);
  });

  it('is idempotent on second run', () => {
    const dir = makeTmpDir('init-idem');
    const baseDir = join(dir, 'pristine');

    const result1 = initPristine(baseDir);
    const result2 = initPristine(baseDir);

    expect(result1.config).toEqual(result2.config);
    expect(result1.baseDir).toBe(result2.baseDir);
  });

  it('returns correct paths and loaded config', () => {
    const dir = makeTmpDir('init-result');
    const baseDir = join(dir, 'pristine');

    const result = initPristine(baseDir);

    expect(result.baseDir).toBe(baseDir);
    expect(result.configPath).toBe(join(baseDir, 'models.json'));
    expect(result.databasePath).toBe(join(baseDir, 'data', 'pristine.db'));
    expect(result.config).toEqual(DEFAULT_MODEL_CONFIG);
  });

  it('sets 0o700 on baseDir, keys/, data/ (Unix only)', () => {
    if (process.platform === 'win32') return;

    const dir = makeTmpDir('init-perms');
    const baseDir = join(dir, 'pristine');

    initPristine(baseDir);

    expect(statSync(baseDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(baseDir, 'keys')).mode & 0o777).toBe(0o700);
    expect(statSync(join(baseDir, 'data')).mode & 0o777).toBe(0o700);
  });

  it('uses custom baseDir when provided', () => {
    const dir = makeTmpDir('init-custom');
    const customBase = join(dir, 'my-custom-pristine');

    const result = initPristine(customBase);

    expect(result.baseDir).toBe(customBase);
    expect(existsSync(join(customBase, 'models.json'))).toBe(true);
    expect(existsSync(join(customBase, 'data', 'pristine.db'))).toBe(true);
  });
});
