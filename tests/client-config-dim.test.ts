import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockPipeline = vi.hoisted(() => vi.fn());

vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args: unknown[]) => mockPipeline(...args),
}));

const createExtractor = (dim: number): ReturnType<typeof vi.fn> =>
  vi.fn().mockResolvedValue({ data: new Float32Array(dim).fill(0.1) });

describe('PristineLocal baseDir embedder config', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of cleanupDirs) {
      rmSync(dir, { force: true, recursive: true });
    }
    cleanupDirs.length = 0;
  });

  it('routes models.json local embedder dimension into source-index DDL and search', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'pristine-client-config-dim-'));
    cleanupDirs.push(baseDir);
    writeFileSync(
      join(baseDir, 'models.json'),
      JSON.stringify({ embedder: { engine: 'local', model: 'test/local-64', dim: 64 } }),
    );
    mockPipeline.mockResolvedValue(createExtractor(64));
    const { PristineLocal } = await import('../src/client.js');

    const client = await PristineLocal.create({ baseDir });
    try {
      await client.store([{ text: 'configured dimension chunk', chunkId: 'dim-64' }], {
        projectId: 'project-a',
      });
      await expect(
        client.recall('configured dimension', { projectId: 'project-a', limit: 1 }),
      ).resolves.toHaveLength(1);
      expect(mockPipeline).toHaveBeenCalledWith('feature-extraction', 'test/local-64');
    } finally {
      await client.dispose();
    }

    const db = new Database(join(baseDir, 'data', 'pristine.db'), { readonly: true });
    try {
      const row = db
        .prepare('SELECT sql FROM sqlite_master WHERE name = ?')
        .get('vec_source_chunks') as { sql: string } | undefined;
      expect(row?.sql).toContain('embedding float[64]');
    } finally {
      db.close();
    }
  });
});
