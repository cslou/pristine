import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OllamaClient } from '../../src/engine/ollama/index.js';

const OLLAMA_MODEL = 'llama3.2:latest';

let dirs: string[] = [];

export function makeTmpDir(suffix: string): string {
  const dir = join(
    tmpdir(),
    `pristine-e2e-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

export function cleanupDirs(): void {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs = [];
}

export async function isOllamaAvailable(): Promise<boolean> {
  const client = new OllamaClient({ model: OLLAMA_MODEL });
  if (!(await client.isReachable())) {
    return false;
  }

  const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(`${host}/api/tags`, { signal: controller.signal });
    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as {
      readonly models?: ReadonlyArray<{ readonly name?: string; readonly model?: string }>;
    };

    return (payload.models ?? []).some(
      (model) => model.name === OLLAMA_MODEL || model.model === OLLAMA_MODEL,
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
