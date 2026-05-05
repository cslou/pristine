import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError, ConfigError } from '../../src/core/errors.js';
import { DEFAULT_PRISTINE_CONFIG, initPristine, loadPristineConfig } from '../../src/core/init.js';
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
// loadPristineConfig
// ---------------------------------------------------------------------------

describe('loadPristineConfig', () => {
  it('throws ConfigError when file does not exist', () => {
    const dir = makeTmpDir('cfg-missing');

    expect(() => loadPristineConfig(dir)).toThrow(ConfigError);
    expect(() => loadPristineConfig(dir)).toThrow(/Model config not found/);
  });

  it('throws ConfigError for malformed JSON', () => {
    const dir = makeTmpDir('cfg-malformed');
    writeFileSync(join(dir, 'models.json'), '{not valid json}');

    expect(() => loadPristineConfig(dir)).toThrow(ConfigError);
    expect(() => loadPristineConfig(dir)).toThrow(/Invalid JSON/);
  });

  it('throws ConfigError when root is not a JSON object', () => {
    const dir = makeTmpDir('cfg-non-object');
    writeFileSync(join(dir, 'models.json'), JSON.stringify(['array', 'not object']));

    expect(() => loadPristineConfig(dir)).toThrow(ConfigError);
    expect(() => loadPristineConfig(dir)).toThrow(/must be a JSON object/);
  });

  it('returns empty config when models.json is `{}`', () => {
    const dir = makeTmpDir('cfg-empty');
    writeFileSync(join(dir, 'models.json'), '{}');

    const result = loadPristineConfig(dir);

    expect(result).toEqual({});
  });

  it('silently ignores legacy privacy / memory fields (backward compatible)', () => {
    // Existing installs may have an older models.json with privacy and
    // memory engine sections. Those fields are no longer consumed; the
    // loader passes them through unread.
    const dir = makeTmpDir('cfg-legacy');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        privacy: { engine: 'ollama', model: 'llama3.2:latest' },
        memory: { engine: 'ollama', model: 'llama3.2:latest' },
        embedder: { engine: 'local' },
      }),
    );

    const result = loadPristineConfig(dir);

    expect(result.embedder?.engine).toBe('local');
  });

  // -------------------------------------------------------------------------
  // Embedder config
  // -------------------------------------------------------------------------

  it('loads embedder config with engine "ollama"', () => {
    const dir = makeTmpDir('cfg-embedder-ollama');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        embedder: { engine: 'ollama', model: 'nomic-embed-text' },
      }),
    );

    const result = loadPristineConfig(dir);

    expect(result.embedder).toBeDefined();
    expect(result.embedder?.engine).toBe('ollama');
    if (result.embedder?.engine === 'ollama') {
      expect(result.embedder.model).toBe('nomic-embed-text');
    }
  });

  it('loads embedder config with engine "local"', () => {
    const dir = makeTmpDir('cfg-embedder-local');
    writeFileSync(join(dir, 'models.json'), JSON.stringify({ embedder: { engine: 'local' } }));

    const result = loadPristineConfig(dir);

    expect(result.embedder?.engine).toBe('local');
  });

  it('returns undefined embedder when section is missing', () => {
    const dir = makeTmpDir('cfg-no-embedder');
    writeFileSync(join(dir, 'models.json'), JSON.stringify({}));

    const result = loadPristineConfig(dir);

    expect(result.embedder).toBeUndefined();
  });

  it('preserves valid dim in local embedder config', () => {
    const dir = makeTmpDir('cfg-embedder-local-dim');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({ embedder: { engine: 'local', dim: 1024 } }),
    );

    const result = loadPristineConfig(dir);

    expect(result.embedder).toEqual({ engine: 'local', dim: 1024 });
  });

  it('preserves valid dim in ollama embedder config', () => {
    const dir = makeTmpDir('cfg-embedder-ollama-dim');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({ embedder: { engine: 'ollama', model: 'qwen3', dim: 1024 } }),
    );

    const result = loadPristineConfig(dir);

    expect(result.embedder).toEqual({ engine: 'ollama', model: 'qwen3', dim: 1024 });
  });

  it('wraps invalid embedder dim as ConfigError', () => {
    const dir = makeTmpDir('cfg-embedder-bad-dim');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({ embedder: { engine: 'local', dim: 32 } }),
    );

    expect(() => loadPristineConfig(dir)).toThrow(ConfigError);
    expect(() => loadPristineConfig(dir)).toThrow(/"embedder.dim" rejected/);
  });

  it('accepts optional host in ollama embedder config', () => {
    const dir = makeTmpDir('cfg-embedder-host');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({ embedder: { engine: 'ollama', host: 'http://remote:9999' } }),
    );

    const result = loadPristineConfig(dir);

    if (result.embedder?.engine === 'ollama') {
      expect(result.embedder.host).toBe('http://remote:9999');
    }
  });

  it('throws ConfigError for unknown embedder engine', () => {
    const dir = makeTmpDir('cfg-embedder-bad-engine');
    writeFileSync(join(dir, 'models.json'), JSON.stringify({ embedder: { engine: 'llamacpp' } }));

    expect(() => loadPristineConfig(dir)).toThrow(ConfigError);
    expect(() => loadPristineConfig(dir)).toThrow(/Unknown embedder engine "llamacpp"/);
  });

  it('throws ConfigError for non-object embedder section', () => {
    const dir = makeTmpDir('cfg-embedder-non-obj');
    writeFileSync(join(dir, 'models.json'), JSON.stringify({ embedder: 'ollama' }));

    expect(() => loadPristineConfig(dir)).toThrow(ConfigError);
    expect(() => loadPristineConfig(dir)).toThrow(/"embedder" in models.json must be an object/);
  });

  it('throws ConfigError for empty embedder model string', () => {
    const dir = makeTmpDir('cfg-embedder-empty-model');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({ embedder: { engine: 'ollama', model: '' } }),
    );

    expect(() => loadPristineConfig(dir)).toThrow(ConfigError);
    expect(() => loadPristineConfig(dir)).toThrow(/must be a non-empty string/);
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

  it('rejects data directory with group/other access (Unix only)', () => {
    if (process.platform === 'win32') return;

    const dir = makeTmpDir('db-perms');
    const dataDir = join(dir, 'data');
    mkdirSync(dataDir, { recursive: true });
    chmodSync(dataDir, 0o755);

    expect(() => createDefaultDatabase(dataDir)).toThrow(AppError);
    expect(() => createDefaultDatabase(dataDir)).toThrow(/too open/);
    expect(() => createDefaultDatabase(dataDir)).toThrow(/chmod 700/);
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
  });

  it('writes default models.json with embedder-only shape', () => {
    const dir = makeTmpDir('init-config');
    const baseDir = join(dir, 'pristine');

    initPristine(baseDir);

    const raw = JSON.parse(readFileSync(join(baseDir, 'models.json'), 'utf-8')) as unknown;
    expect(raw).toEqual(DEFAULT_PRISTINE_CONFIG);
  });

  it('does not overwrite existing models.json', () => {
    const dir = makeTmpDir('init-no-overwrite');
    const baseDir = join(dir, 'pristine');
    mkdirSync(baseDir, { recursive: true });

    const customConfig = { embedder: { engine: 'ollama', model: 'mxbai-embed-large' } };
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
    expect(result.config).toEqual(DEFAULT_PRISTINE_CONFIG);
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
