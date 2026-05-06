import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { registerJsonlIndexExtension } from '../../../examples/pi-dev/jsonl-index/index.js';
import { resolvePiPristineDbPath } from '../../../examples/pi-dev/jsonl-index/src/db-path.js';
import {
  createPiJsonlIndexRuntime,
  type PiExtensionContextLike,
} from '../../../examples/pi-dev/jsonl-index/src/extension-runtime.js';
import type { PiJsonlParsedMessage } from '../../../examples/pi-dev/jsonl-index/src/pi-jsonl-parser.js';
import {
  openPiJsonlIndexDatabase,
  SqlitePiJsonlSourceIndexer,
  type PiJsonlSourceIndexer,
} from '../../../examples/pi-dev/jsonl-index/src/source-index.js';

const fixturePath = 'tests/fixtures/pi-jsonl/mixed-session.jsonl';

class StubEmbedder {
  public readonly texts: string[] = [];

  public async embed(text: string): Promise<readonly number[]> {
    const results = await this.embedBatch([text]);
    const first = results[0];
    if (first === undefined) throw new Error('missing test embedding');
    return first;
  }

  public async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    this.texts.push(...texts);
    return texts.map((text) => [
      text.length,
      text.includes('sapphire') ? 1 : 0,
      text.includes('amber') ? 1 : 0,
    ]);
  }
}

class CapturingIndexer implements PiJsonlSourceIndexer {
  public readonly batches: readonly PiJsonlParsedMessage[][] = [];
  private readonly fail: boolean;

  public constructor(options: { readonly fail?: boolean } = {}) {
    this.fail = options.fail ?? false;
  }

  public async indexMessages(messages: readonly PiJsonlParsedMessage[]) {
    if (this.fail) throw new Error('mock embed failure');
    (this.batches as PiJsonlParsedMessage[][]).push([...messages]);
    return { indexed: messages.length, skippedDuplicate: 0, chunks: [] };
  }

  public reconcileActiveEntries(): void {
    // Test double only needs to prove the runtime calls this before indexing.
  }
}

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'pristine-pi-jsonl-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

const makeCtx = (params: {
  readonly sessionFile?: string;
  readonly branchIds?: readonly string[];
  readonly notifications?: string[];
}): PiExtensionContextLike => {
  const notifications = params.notifications;
  return {
    sessionManager: {
      getSessionFile: () => params.sessionFile,
      getBranch: () => params.branchIds?.map((id) => ({ id })) ?? [],
    },
    ui: {
      notify: (message, level) => notifications?.push(`${level ?? 'info'}:${message}`),
    },
  };
};

describe('Pi JSONL index extension reference', () => {
  it('resolves DB path using explicit config, env override, then default', () => {
    expect(
      resolvePiPristineDbPath({
        explicitPath: '/explicit/pristine.db',
        env: { PRISTINE_DB_PATH: '/env/pristine.db' },
        homeDir: '/home/test',
      }),
    ).toBe('/explicit/pristine.db');

    expect(
      resolvePiPristineDbPath({
        env: { PRISTINE_DB_PATH: '/env/pristine.db' },
        homeDir: '/home/test',
      }),
    ).toBe('/env/pristine.db');

    expect(resolvePiPristineDbPath({ env: {}, homeDir: '/home/test' })).toBe(
      '/home/test/.pi/pristine/pristine.db',
    );
  });

  it('indexes Pi JSONL snippets with source pointers and vector rows in a temporary DB', async () => {
    const db = new Database(join(await makeTempDir(), 'pristine.db'));
    const embedder = new StubEmbedder();
    const indexer = new SqlitePiJsonlSourceIndexer({ db, embedder });
    const runtime = createPiJsonlIndexRuntime({ indexer });
    const notifications: string[] = [];

    const result = await runtime.indexAfterAgentEnd(
      makeCtx({
        sessionFile: fixturePath,
        branchIds: ['u0000001', 'a0000002', 'u0000004'],
        notifications,
      }),
    );

    expect(result).toEqual({ ok: true, sessionFile: fixturePath, indexed: 3, skippedDuplicate: 0 });
    const rows = db
      .prepare(
        'SELECT source_uri, entry_id, line_number, snippet, metadata_json FROM pi_jsonl_chunks ORDER BY line_number',
      )
      .all() as {
      source_uri: string;
      entry_id: string;
      line_number: number;
      snippet: string;
      metadata_json: string;
    }[];
    expect(rows.map((row) => row.entry_id)).toEqual(['u0000001', 'a0000002', 'u0000004']);
    expect(rows[0]?.source_uri).toBe(fixturePath);
    expect(rows[0]?.snippet).toContain('sapphire migration note');
    expect(JSON.parse(rows[0]?.metadata_json ?? '{}')).toMatchObject({
      role: 'user',
      sourcePointer: { sourceKind: 'pi-jsonl', entryId: 'u0000001' },
    });
    expect(db.prepare('SELECT count(*) AS count FROM vec_pi_jsonl_chunks').get()).toEqual({
      count: 3,
    });
    expect(embedder.texts).toHaveLength(3);
    expect(notifications.at(-1)).toContain('success:Pristine indexed 3 Pi JSONL entries');
  });

  it('removes stale active-branch rows and deduplicates reprocessing by stable source pointer', async () => {
    const db = new Database(join(await makeTempDir(), 'pristine.db'));
    const indexer = new SqlitePiJsonlSourceIndexer({ db, embedder: new StubEmbedder() });
    const runtime = createPiJsonlIndexRuntime({ indexer });
    const ctx = makeCtx({ sessionFile: fixturePath, branchIds: ['u0000001', 'a0000002'] });

    expect(await runtime.indexAfterAgentEnd(ctx)).toMatchObject({
      indexed: 2,
      skippedDuplicate: 0,
    });
    expect(await runtime.indexAfterAgentEnd(ctx)).toMatchObject({
      indexed: 0,
      skippedDuplicate: 2,
    });
    expect(db.prepare('SELECT count(*) AS count FROM pi_jsonl_chunks').get()).toEqual({ count: 2 });

    await runtime.reconcileOnSessionStart(
      makeCtx({ sessionFile: fixturePath, branchIds: ['u0000001'] }),
      'resume',
    );
    expect(db.prepare('SELECT entry_id FROM pi_jsonl_chunks ORDER BY entry_id').all()).toEqual([
      { entry_id: 'u0000001' },
    ]);
    expect(db.prepare('SELECT count(*) AS count FROM vec_pi_jsonl_chunks').get()).toEqual({
      count: 1,
    });
  });

  it('does not treat an empty branch list as permission to delete or index all session rows', async () => {
    const db = new Database(join(await makeTempDir(), 'pristine.db'));
    const indexer = new SqlitePiJsonlSourceIndexer({ db, embedder: new StubEmbedder() });
    const runtime = createPiJsonlIndexRuntime({ indexer });

    await runtime.indexAfterAgentEnd(
      makeCtx({ sessionFile: fixturePath, branchIds: ['u0000001', 'a0000002'] }),
    );
    await runtime.reconcileOnSessionStart(
      makeCtx({ sessionFile: fixturePath, branchIds: [] }),
      'reload',
    );

    expect(db.prepare('SELECT count(*) AS count FROM pi_jsonl_chunks').get()).toEqual({ count: 2 });
  });

  it('uses agent_end to index completed active-branch user/assistant entries and skip ignored roles', async () => {
    const indexer = new CapturingIndexer();
    const runtime = createPiJsonlIndexRuntime({ indexer });

    await runtime.indexAfterAgentEnd(
      makeCtx({ sessionFile: fixturePath, branchIds: ['u0000001', 'a0000002', 't0000003'] }),
    );

    expect(indexer.batches).toHaveLength(1);
    expect(indexer.batches[0]?.map((message) => message.pointer.entryId)).toEqual([
      'u0000001',
      'a0000002',
    ]);
  });

  it('reconciles only the active session on session_start reload and resume', async () => {
    const indexer = new CapturingIndexer();
    const runtime = createPiJsonlIndexRuntime({ indexer });
    const notifications: string[] = [];
    const ctx = makeCtx({ sessionFile: fixturePath, branchIds: ['u0000004'], notifications });

    await runtime.reconcileOnSessionStart(ctx, 'reload');
    await runtime.reconcileOnSessionStart(ctx, 'resume');

    expect(indexer.batches).toHaveLength(2);
    expect(indexer.batches[0]?.map((message) => message.pointer.entryId)).toEqual(['u0000004']);
    expect(indexer.batches[1]?.map((message) => message.pointer.entryId)).toEqual(['u0000004']);
    expect(notifications.every((message) => message.includes('Pristine indexed 1'))).toBe(true);
  });

  it('registers Pi extension lifecycle handlers and lazily forwards valid contexts', async () => {
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void> | void>();
    const calls: string[] = [];
    registerJsonlIndexExtension(
      {
        on: (event, handler) => handlers.set(event, handler),
      },
      () => ({
        indexAfterAgentEnd: async () => {
          calls.push('agent_end');
          return { ok: true, indexed: 0, skippedDuplicate: 0 };
        },
        reconcileOnSessionStart: async (_ctx, reason) => {
          calls.push(`session_start:${reason}`);
          return { ok: true, indexed: 0, skippedDuplicate: 0 };
        },
        close: () => calls.push('session_shutdown'),
      }),
    );

    const ctx = makeCtx({ sessionFile: fixturePath, branchIds: [] });
    await handlers.get('agent_end')?.({}, ctx);
    await handlers.get('session_start')?.({ reason: 'reload' }, ctx);
    handlers.get('session_shutdown')?.({}, ctx);

    expect(calls).toEqual(['agent_end', 'session_start:reload', 'session_shutdown']);
  });

  it('surfaces lazy initialization failures through Pi notifications', async () => {
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void> | void>();
    const notifications: string[] = [];
    registerJsonlIndexExtension(
      {
        on: (event, handler) => handlers.set(event, handler),
      },
      () => {
        throw new Error('db init failed');
      },
    );

    await handlers.get('agent_end')?.({}, makeCtx({ sessionFile: fixturePath, notifications }));

    expect(notifications).toEqual([
      'error:Pristine Pi JSONL index failed to initialize: db init failed',
    ]);
  });

  it('creates the index database with owner-only permissions on Unix', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'secure.db');
    const db = openPiJsonlIndexDatabase(dbPath);
    db.close();

    if (process.platform !== 'win32') {
      const mode = (await stat(dbPath)).mode & 0o777;
      expect(mode & 0o077).toBe(0);
    }
  });

  it('rejects insecure existing index directories on Unix', async () => {
    if (process.platform === 'win32') return;
    const dir = await makeTempDir();
    await chmod(dir, 0o755);
    expect(() => new Database(join(dir, 'insecure.db'))).not.toThrow();
    await rm(join(dir, 'insecure.db'), { force: true });
    expect(() => openPiJsonlIndexDatabase(join(dir, 'insecure.db'))).toThrow(/must be private/);
  });

  it('surfaces deterministic Pi-facing errors and does not report success on failure', async () => {
    const indexer = new CapturingIndexer({ fail: true });
    const runtime = createPiJsonlIndexRuntime({ indexer });
    const notifications: string[] = [];

    const result = await runtime.indexAfterAgentEnd(
      makeCtx({ sessionFile: fixturePath, branchIds: ['u0000001'], notifications }),
    );

    expect(result).toEqual({
      ok: false,
      sessionFile: fixturePath,
      indexed: 0,
      skippedDuplicate: 0,
      error: 'mock embed failure',
    });
    expect(notifications).toEqual([
      'error:Pristine Pi JSONL index failed (agent_end): mock embed failure',
    ]);
  });
});
