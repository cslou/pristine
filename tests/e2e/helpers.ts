import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OllamaClient } from '../../src/engine/ollama/index.js';

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
  const client = new OllamaClient({ model: 'llama3.2:latest' });
  return client.isReachable();
}
