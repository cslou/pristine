import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigError } from './errors.js';
import { createDefaultDatabase } from './database.js';
import { assertValidDim } from './vector-dim.js';
import type { EmbedderConfig } from '../embedder/index.js';

// ---------------------------------------------------------------------------
// PristineConfig — init-time SDK config (currently embedder-only)
// ---------------------------------------------------------------------------

export interface PristineConfig {
  readonly embedder?: EmbedderConfig;
}

// `dim` is intentionally omitted from the default-config template. The
// canonical SDK default lives in `src/client.ts`; persisting `dim` here
// would create a second default site and lock consumers onto whatever
// value shipped at the time `models.json` was first written.
export const DEFAULT_PRISTINE_CONFIG: PristineConfig = {
  embedder: { engine: 'local' },
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const EXAMPLE_EMBEDDER_CONFIG = JSON.stringify(DEFAULT_PRISTINE_CONFIG, null, 2);

const VALID_EMBEDDER_ENGINES = new Set(['ollama', 'local']);

function validateEmbedderEntry(value: unknown): EmbedderConfig {
  if (typeof value !== 'object' || value === null) {
    throw new ConfigError(
      `"embedder" in models.json must be an object. Example: { "engine": "ollama", "model": "nomic-embed-text" }`,
    );
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.engine !== 'string' || !VALID_EMBEDDER_ENGINES.has(obj.engine)) {
    throw new ConfigError(
      `Unknown embedder engine "${String(obj.engine)}" in "embedder". Valid engines: ollama, local`,
    );
  }

  if (obj.dim !== undefined) {
    try {
      assertValidDim(obj.dim);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      throw new ConfigError(`"embedder.dim" rejected: ${msg}`);
    }
  }

  if (obj.engine === 'ollama') {
    if (obj.model !== undefined && (typeof obj.model !== 'string' || obj.model.length === 0)) {
      throw new ConfigError(`"embedder.model" must be a non-empty string if provided`);
    }
    if (obj.host !== undefined && (typeof obj.host !== 'string' || obj.host.length === 0)) {
      throw new ConfigError(`"embedder.host" must be a non-empty string if provided`);
    }
    return {
      engine: 'ollama',
      ...(obj.model !== undefined ? { model: obj.model as string } : {}),
      ...(obj.host !== undefined ? { host: obj.host as string } : {}),
      ...(obj.dim !== undefined ? { dim: obj.dim as number } : {}),
    };
  }

  // engine === 'local'
  if (obj.model !== undefined && (typeof obj.model !== 'string' || obj.model.length === 0)) {
    throw new ConfigError(`"embedder.model" must be a non-empty string if provided`);
  }
  return {
    engine: 'local',
    ...(obj.model !== undefined ? { model: obj.model as string } : {}),
    ...(obj.dim !== undefined ? { dim: obj.dim as number } : {}),
  };
}

// ---------------------------------------------------------------------------
// loadPristineConfig
// ---------------------------------------------------------------------------

export function loadPristineConfig(configDir?: string): PristineConfig {
  const dir = configDir ?? join(homedir(), '.pristine');
  const filePath = join(dir, 'models.json');

  if (!existsSync(filePath)) {
    throw new ConfigError(
      `Model config not found: ${filePath}. Run initPristine() to create default config.`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw new ConfigError(
      `Invalid JSON in ${filePath}: ${msg}\n\nExpected format:\n${EXAMPLE_EMBEDDER_CONFIG}`,
    );
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError(
      `models.json must be a JSON object. Expected format:\n${EXAMPLE_EMBEDDER_CONFIG}`,
    );
  }

  const obj = raw as Record<string, unknown>;
  const embedder = 'embedder' in obj ? validateEmbedderEntry(obj.embedder) : undefined;

  return embedder ? { embedder } : {};
}

// ---------------------------------------------------------------------------
// initPristine
// ---------------------------------------------------------------------------

export interface InitPristineResult {
  readonly baseDir: string;
  readonly configPath: string;
  readonly databasePath: string;
  readonly config: PristineConfig;
}

export function initPristine(baseDir?: string): InitPristineResult {
  const dir = baseDir ?? join(homedir(), '.pristine');
  const configPath = join(dir, 'models.json');
  const dataDir = join(dir, 'data');
  const databasePath = join(dataDir, 'pristine.db');

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, 'keys'), { recursive: true, mode: 0o700 });
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_PRISTINE_CONFIG, null, 2) + '\n');
  }

  const config = loadPristineConfig(dir);

  const db = createDefaultDatabase(dataDir);
  db.close();

  return { baseDir: dir, configPath, databasePath, config };
}
