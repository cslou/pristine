import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigError } from './errors.js';
import { createDefaultDatabase } from './database.js';
import type { EmbedderConfig } from '../embedder/index.js';

// ---------------------------------------------------------------------------
// ModelConfig types (discriminated union on 'engine')
// ---------------------------------------------------------------------------

export interface OllamaModelEntry {
  readonly engine: 'ollama';
  readonly model: string;
  readonly host?: string;
}

export interface LlamaCppModelEntry {
  readonly engine: 'llamacpp';
  readonly path: string;
  readonly gpu?: 'auto' | 'metal' | 'cuda' | 'vulkan' | false;
}

export type ModelEntry = OllamaModelEntry | LlamaCppModelEntry;

export interface ModelConfig {
  readonly privacy: ModelEntry;
  readonly memory: ModelEntry;
  readonly embedder?: EmbedderConfig;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  privacy: { engine: 'ollama', model: 'llama3.2:latest' },
  memory: { engine: 'ollama', model: 'llama3.2:latest' },
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_ENGINES = new Set(['ollama', 'llamacpp']);
const VALID_GPU_VALUES = new Set<unknown>(['auto', 'metal', 'cuda', 'vulkan', false]);

const EXAMPLE_CONFIG = JSON.stringify(DEFAULT_MODEL_CONFIG, null, 2);

function validateModelEntry(value: unknown, section: string): ModelEntry {
  if (typeof value !== 'object' || value === null) {
    throw new ConfigError(
      `"${section}" in models.json must be an object. Example:\n${EXAMPLE_CONFIG}`,
    );
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.engine !== 'string' || !VALID_ENGINES.has(obj.engine)) {
    throw new ConfigError(
      `Unknown engine "${String(obj.engine)}" in "${section}". Valid engines: ollama, llamacpp`,
    );
  }

  if (obj.engine === 'ollama') {
    if (typeof obj.model !== 'string' || obj.model.length === 0) {
      throw new ConfigError(`"${section}" with engine "ollama" requires a non-empty "model" field`);
    }
    if (obj.host !== undefined && (typeof obj.host !== 'string' || obj.host.length === 0)) {
      throw new ConfigError(`"${section}.host" must be a non-empty string if provided`);
    }
    return {
      engine: 'ollama',
      model: obj.model,
      ...(obj.host !== undefined ? { host: obj.host as string } : {}),
    };
  }

  // engine === 'llamacpp'
  if (typeof obj.path !== 'string' || obj.path.length === 0) {
    throw new ConfigError(`"${section}" with engine "llamacpp" requires a non-empty "path" field`);
  }
  if (!existsSync(obj.path)) {
    throw new ConfigError(
      `GGUF file not found: ${obj.path} (configured in "${section}").\n` +
        `Update the path in ~/.pristine/models.json:\n\n` +
        `  { "${section}": { "engine": "llamacpp", "path": "/absolute/path/to/model.gguf" } }`,
    );
  }
  if (obj.gpu !== undefined && !VALID_GPU_VALUES.has(obj.gpu)) {
    throw new ConfigError(
      `Invalid gpu value "${String(obj.gpu)}" in "${section}". ` +
        `Valid values: auto, metal, cuda, vulkan, false`,
    );
  }
  return {
    engine: 'llamacpp',
    path: obj.path,
    ...(obj.gpu !== undefined ? { gpu: obj.gpu as LlamaCppModelEntry['gpu'] } : {}),
  };
}

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
    };
  }

  // engine === 'local'
  if (obj.model !== undefined && (typeof obj.model !== 'string' || obj.model.length === 0)) {
    throw new ConfigError(`"embedder.model" must be a non-empty string if provided`);
  }
  return {
    engine: 'local',
    ...(obj.model !== undefined ? { model: obj.model as string } : {}),
  };
}

// ---------------------------------------------------------------------------
// loadModelConfig
// ---------------------------------------------------------------------------

export function loadModelConfig(configDir?: string): ModelConfig {
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
      `Invalid JSON in ${filePath}: ${msg}\n\nExpected format:\n${EXAMPLE_CONFIG}`,
    );
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new ConfigError(`models.json must be a JSON object. Expected format:\n${EXAMPLE_CONFIG}`);
  }

  const obj = raw as Record<string, unknown>;

  if (!('privacy' in obj)) {
    throw new ConfigError(
      `models.json is missing required "privacy" section. Expected format:\n${EXAMPLE_CONFIG}`,
    );
  }
  if (!('memory' in obj)) {
    throw new ConfigError(
      `models.json is missing required "memory" section. Expected format:\n${EXAMPLE_CONFIG}`,
    );
  }

  const privacy = validateModelEntry(obj.privacy, 'privacy');
  const memory = validateModelEntry(obj.memory, 'memory');
  const embedder = 'embedder' in obj ? validateEmbedderEntry(obj.embedder) : undefined;

  return { privacy, memory, ...(embedder ? { embedder } : {}) };
}

// ---------------------------------------------------------------------------
// initPristine
// ---------------------------------------------------------------------------

export interface InitPristineResult {
  readonly baseDir: string;
  readonly configPath: string;
  readonly databasePath: string;
  readonly config: ModelConfig;
}

export function initPristine(baseDir?: string): InitPristineResult {
  const dir = baseDir ?? join(homedir(), '.pristine');
  const configPath = join(dir, 'models.json');
  const dataDir = join(dir, 'data');
  const databasePath = join(dataDir, 'pristine.db');

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, 'keys'), { recursive: true, mode: 0o700 });
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, 'models'), { recursive: true });

  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_MODEL_CONFIG, null, 2) + '\n');
  }

  const config = loadModelConfig(dir);

  const db = createDefaultDatabase(dataDir);
  db.close();

  return { baseDir: dir, configPath, databasePath, config };
}
