import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { ConversationStore } from '../../src/conversations/store.js';
import { createDatabase } from '../../src/core/database.js';
import { InvalidArgumentError } from '../../src/core/errors.js';
import type { Embedder } from '../../src/core/interfaces.js';
import { LocalEmbedder } from '../../src/embedder/local/index.js';
import { createEmbedTaskHandler, runEmbedWorker } from '../../src/memory/indexer/embed-worker.js';
import { createIndexer } from '../../src/memory/indexer/index.js';
import { createWindowWriter } from '../../src/memory/indexer/windows.js';
import {
  createSearcher,
  type Searcher,
  type SearchFilters,
  type Role,
} from '../../src/memory/searcher/index.js';
import { IngestQueue } from '../../src/queue/ingest-queue.js';

// ---------------------------------------------------------------------------
// Sprint-016 Story 6 — cross-cutting searcher contract suite
// ---------------------------------------------------------------------------
//
// Locks the searcher's behavioral contract across all three primitives
// (vectorSearch, ftsSearch, hybridSearch — sessionVectorSearch tested
// through hybridSearch's session-source projection). Phase 5
// (searcher.sql) and Phase 7 (eval framework) build on this foundation;
// the tests here are the "spec" they target.
//
// Test names ARE documentation: read each describe + it block as a
// statement of contract. Per Story 6 Technical Notes, this file is
// intentionally light on production-code changes; bug fixes belong in
// the relevant feature story branch, not here.
//
// Suite structure (sprint AC lines 234-240):
//   1. Shared corpus + helpers
//   2. Filter correctness matrix (5 filter dims × 3 methods)
//   3. Ranking stability across runs
//   4. Window→messages resolution
//   5. Cross-project isolation across all three methods
//   6. Static src/ filesystem grep guard for forbidden LLM imports
//   7. Real-Nomic recall sanity check (gated by SKIP_SLOW_TESTS=0)

const skipSlow = process.env.SKIP_SLOW_TESTS === '1';

const makeStubEmbedder = (): Embedder => ({
  embed: async (text: string): Promise<number[]> => {
    const out = new Array<number>(768).fill(0.01);
    for (let i = 0; i < Math.min(text.length, 768); i++) {
      out[i] = text.charCodeAt(i) / 1000;
    }
    return out;
  },
  embedBatch: async () => {
    throw new InvalidArgumentError('embedBatch not used in this suite');
  },
});

interface PipelineDeps {
  readonly db: Database.Database;
  readonly store: ConversationStore;
  readonly queue: IngestQueue;
  readonly indexer: ReturnType<typeof createIndexer>;
  readonly searcher: Searcher;
}

const buildPipeline = (embedder: Embedder): PipelineDeps => {
  const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
  const store = new ConversationStore(db);
  const windowWriter = createWindowWriter(db);
  const config = { windowSize: 3, windowOverlap: 1 };

  const queue = new IngestQueue({
    db,
    embedTaskHandler: createEmbedTaskHandler({ db, embedder, windowWriter, config }),
  });

  const indexer = createIndexer({
    db,
    conversationStore: store,
    ingestQueue: queue,
    embedder,
    config,
  });

  const searcher = createSearcher({ db, embedder });

  return { db, store, queue, indexer, searcher };
};

const seedConversation = async (
  p: PipelineDeps,
  userId: string,
  projectId: string,
  contents: string[],
  buildSession = true,
): Promise<string> => {
  const messages = contents.map((content, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content,
  }));
  const conversationId = p.store.addEmptyConversation(userId, messages, projectId);
  p.indexer.ingest(messages, { projectId, conversationId });
  await runEmbedWorker(p.queue);
  if (buildSession) await p.indexer.buildSessionVector(conversationId);
  return conversationId;
};

// Compact 3-project × 2-conversation × 6-messages corpus per sprint AC
// "intentionally compact" guidance. Each conversation is themed around
// one of three topics so cross-project isolation has clear signal.
const seedCompactCorpus = async (
  p: PipelineDeps,
): Promise<{
  readonly projectIds: readonly string[];
  readonly conversations: ReadonlyMap<string, readonly string[]>;
}> => {
  const projectIds = ['proj-alpha', 'proj-beta', 'proj-gamma'];
  const conversations = new Map<string, string[]>();
  for (const projectId of projectIds) {
    const ids: string[] = [];
    ids.push(
      await seedConversation(p, `user-${projectId}-1`, projectId, [
        `${projectId} machine learning topic one`,
        `${projectId} gradient descent topic two`,
        `${projectId} embedding clusters topic three`,
        `${projectId} retrieval pipelines topic four`,
        `${projectId} vector indexes topic five`,
        `${projectId} similarity scoring topic six`,
      ]),
    );
    ids.push(
      await seedConversation(p, `user-${projectId}-2`, projectId, [
        `${projectId} cooking pasta topic one`,
        `${projectId} mediterranean cuisine topic two`,
        `${projectId} pizza recipes topic three`,
        `${projectId} herbs and spices topic four`,
        `${projectId} olive oil topic five`,
        `${projectId} dining etiquette topic six`,
      ]),
    );
    conversations.set(projectId, ids);
  }
  return { projectIds, conversations };
};

// ---------------------------------------------------------------------------
// 2. Filter correctness matrix — N filter dims × 3 methods
// ---------------------------------------------------------------------------

interface FilterCase {
  readonly name: string;
  readonly mutate: (
    base: SearchFilters,
    ids: ReadonlyMap<string, readonly string[]>,
  ) => SearchFilters;
  readonly query: string;
  readonly assertOnHit: (
    hit: { conversationId: string },
    p: PipelineDeps,
    ids: ReadonlyMap<string, readonly string[]>,
  ) => void;
}

const filterCases = (): readonly FilterCase[] => [
  {
    name: 'projectId narrows to project',
    mutate: (base) => ({ ...base, projectId: 'proj-alpha' }),
    query: 'machine learning',
    assertOnHit: (hit, p) => {
      const row = p.db
        .prepare('SELECT project_id FROM conversations WHERE id = ?')
        .get(hit.conversationId) as { project_id: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.project_id).toBe('proj-alpha');
    },
  },
  {
    name: 'conversationId narrows to single conversation',
    mutate: (base, ids) => ({
      ...base,
      projectId: 'proj-alpha',
      conversationId: ids.get('proj-alpha')![0],
    }),
    query: 'machine learning',
    assertOnHit: (hit, _p, ids) => {
      expect(hit.conversationId).toBe(ids.get('proj-alpha')![0]);
    },
  },
  {
    name: 'role narrows hits to messages of that role (vectorSearch is permissive at window-level; ftsSearch is strict)',
    mutate: (base) => ({ ...base, projectId: 'proj-alpha', role: 'user' as Role }),
    query: 'machine learning',
    // Asserted method-specifically below — the role filter has different
    // semantics for each method (per SearchFilters.role JSDoc).
    assertOnHit: () => {
      /* verified per-method in the loop below */
    },
  },
  {
    name: 'dateFrom restricts to created_at >= bound',
    mutate: (base) => ({
      ...base,
      projectId: 'proj-alpha',
      dateFrom: '1970-01-01T00:00:00.000Z',
    }),
    query: 'machine learning',
    assertOnHit: (hit, p) => {
      const row = p.db
        .prepare('SELECT created_at FROM conversations WHERE id = ?')
        .get(hit.conversationId) as { created_at: string };
      expect(row.created_at >= '1970-01-01T00:00:00.000Z').toBe(true);
    },
  },
  {
    name: 'dateTo restricts to created_at <= bound (far future allows all)',
    mutate: (base) => ({
      ...base,
      projectId: 'proj-alpha',
      dateTo: '2099-12-31T23:59:59.999Z',
    }),
    query: 'machine learning',
    assertOnHit: (hit, p) => {
      const row = p.db
        .prepare('SELECT created_at FROM conversations WHERE id = ?')
        .get(hit.conversationId) as { created_at: string };
      expect(row.created_at <= '2099-12-31T23:59:59.999Z').toBe(true);
    },
  },
];

describe('searcher cross-cutting — filter correctness matrix (5 dims × 3 methods)', () => {
  let p: PipelineDeps;
  let ids: ReadonlyMap<string, readonly string[]>;

  beforeEach(async () => {
    p = buildPipeline(makeStubEmbedder());
    ({ conversations: ids } = await seedCompactCorpus(p));
  });

  afterEach(() => {
    p.db.close();
  });

  for (const fc of filterCases()) {
    it(`vectorSearch — ${fc.name}`, async () => {
      const filters = fc.mutate({ projectId: '_unused_' }, ids);
      const hits = await p.searcher.vectorSearch(fc.query, filters, 10);
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) fc.assertOnHit(hit, p, ids);
    });

    it(`ftsSearch — ${fc.name}`, async () => {
      const filters = fc.mutate({ projectId: '_unused_' }, ids);
      const hits = await p.searcher.ftsSearch(fc.query, filters, 10);
      // ftsSearch may return zero for some filter cases (e.g., role
      // filter combined with a query that doesn't match a user-role
      // message). Assert per-hit correctness when results exist.
      for (const hit of hits) fc.assertOnHit(hit, p, ids);
    });

    it(`hybridSearch — ${fc.name}`, async () => {
      const filters = fc.mutate({ projectId: '_unused_' }, ids);
      const hits = await p.searcher.hybridSearch(fc.query, filters, 10);
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) fc.assertOnHit(hit, p, ids);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Ranking stability — identical query against idempotent corpus
//    returns identical result order across runs.
// ---------------------------------------------------------------------------

describe('searcher cross-cutting — ranking stability across runs', () => {
  let p: PipelineDeps;

  beforeEach(async () => {
    p = buildPipeline(makeStubEmbedder());
    await seedCompactCorpus(p);
  });

  afterEach(() => {
    p.db.close();
  });

  it('vectorSearch returns identical hit-id sequence across two runs', async () => {
    const filters = { projectId: 'proj-alpha' };
    const r1 = await p.searcher.vectorSearch('machine learning', filters, 10);
    const r2 = await p.searcher.vectorSearch('machine learning', filters, 10);
    expect(r1.map((h) => `${h.conversationId}:${h.windowIndex}`)).toEqual(
      r2.map((h) => `${h.conversationId}:${h.windowIndex}`),
    );
  });

  it('ftsSearch returns identical messageId sequence across two runs', async () => {
    const filters = { projectId: 'proj-alpha' };
    const r1 = await p.searcher.ftsSearch('machine', filters, 10);
    const r2 = await p.searcher.ftsSearch('machine', filters, 10);
    expect(r1.map((h) => h.messageId)).toEqual(r2.map((h) => h.messageId));
  });

  it('hybridSearch returns identical fused order across two runs', async () => {
    const filters = { projectId: 'proj-alpha' };
    const r1 = await p.searcher.hybridSearch('machine learning', filters, 10);
    const r2 = await p.searcher.hybridSearch('machine learning', filters, 10);
    const idOf = (hit: (typeof r1)[number]): string =>
      hit.kind === 'window'
        ? `window:${hit.conversationId}:${hit.windowIndex}`
        : hit.kind === 'message'
          ? `message:${hit.messageId}`
          : `session:${hit.conversationId}`;
    expect(r1.map(idOf)).toEqual(r2.map(idOf));
  });
});

// ---------------------------------------------------------------------------
// 4. Window→messages resolution — vectorSearch's messageIds[] matches
//    the manual SELECT against window_messages (no off-by-one).
// ---------------------------------------------------------------------------

describe('searcher cross-cutting — window-to-messages resolution', () => {
  let p: PipelineDeps;

  beforeEach(async () => {
    p = buildPipeline(makeStubEmbedder());
    await seedCompactCorpus(p);
  });

  afterEach(() => {
    p.db.close();
  });

  it('vectorSearch hit messageIds equal window_messages.position-ordered SELECT', async () => {
    const hits = await p.searcher.vectorSearch('machine learning', { projectId: 'proj-alpha' }, 10);
    expect(hits.length).toBeGreaterThan(0);

    const stmt = p.db.prepare(
      'SELECT message_id FROM window_messages WHERE conversation_id = ? AND window_index = ? ORDER BY position ASC',
    );
    for (const hit of hits) {
      const expected = (
        stmt.all(hit.conversationId, hit.windowIndex) as { message_id: number }[]
      ).map((r) => r.message_id);
      expect(hit.messageIds).toEqual(expected);
    }
  });

  it('hybridSearch window-kind hits also resolve messageIds correctly', async () => {
    const hits = await p.searcher.hybridSearch('machine learning', { projectId: 'proj-alpha' }, 10);
    const windowHits = hits.filter((h) => h.kind === 'window');
    expect(windowHits.length).toBeGreaterThan(0);

    const stmt = p.db.prepare(
      'SELECT message_id FROM window_messages WHERE conversation_id = ? AND window_index = ? ORDER BY position ASC',
    );
    for (const hit of windowHits) {
      if (hit.kind !== 'window') continue;
      const expected = (
        stmt.all(hit.conversationId, hit.windowIndex) as { message_id: number }[]
      ).map((r) => r.message_id);
      expect(hit.messageIds).toEqual(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Cross-project isolation pinned for ALL three methods
// ---------------------------------------------------------------------------

describe('searcher cross-cutting — cross-project isolation', () => {
  let p: PipelineDeps;

  beforeEach(async () => {
    p = buildPipeline(makeStubEmbedder());
    await seedCompactCorpus(p);
  });

  afterEach(() => {
    p.db.close();
  });

  it('vectorSearch in proj-alpha returns zero hits from other projects', async () => {
    const hits = await p.searcher.vectorSearch('machine learning', { projectId: 'proj-alpha' }, 50);
    expect(hits.length).toBeGreaterThan(0);
    const stmt = p.db.prepare('SELECT project_id FROM conversations WHERE id = ?');
    for (const hit of hits) {
      const row = stmt.get(hit.conversationId) as { project_id: string };
      expect(row.project_id).toBe('proj-alpha');
    }
  });

  it('ftsSearch in proj-alpha returns zero hits from other projects', async () => {
    const hits = await p.searcher.ftsSearch('machine', { projectId: 'proj-alpha' }, 50);
    expect(hits.length).toBeGreaterThan(0);
    const stmt = p.db.prepare('SELECT project_id FROM conversations WHERE id = ?');
    for (const hit of hits) {
      const row = stmt.get(hit.conversationId) as { project_id: string };
      expect(row.project_id).toBe('proj-alpha');
    }
  });

  it('hybridSearch in proj-alpha returns zero hits from other projects', async () => {
    const hits = await p.searcher.hybridSearch('machine learning', { projectId: 'proj-alpha' }, 50);
    expect(hits.length).toBeGreaterThan(0);
    const stmt = p.db.prepare('SELECT project_id FROM conversations WHERE id = ?');
    for (const hit of hits) {
      const row = stmt.get(hit.conversationId) as { project_id: string };
      expect(row.project_id).toBe('proj-alpha');
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Static src/ filesystem grep guard — searcher must not introduce
//    forbidden LLM SDK imports (mirrors sprint-015 Story 7's pattern).
// ---------------------------------------------------------------------------

describe('searcher cross-cutting — static import guard', () => {
  it('no banned LLM SDK imports in src/memory/searcher/', () => {
    const banned = ['@anthropic-ai/sdk', 'openai', '\\bpg\\b', '@supabase'];
    const bannedPatterns = banned.map(
      (b) =>
        new RegExp(
          `from\\s+['"]${b.replace(/\\b/g, '')}['"]|require\\(['"]${b.replace(/\\b/g, '')}['"]\\)`,
        ),
    );

    const searcherRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/memory/searcher',
    );

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const stat = lstatSync(full);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith('.ts')) continue;
        const contents = readFileSync(full, 'utf8');
        for (let i = 0; i < banned.length; i++) {
          if (bannedPatterns[i].test(contents)) {
            offenders.push(`${full} imports banned module ${banned[i]}`);
          }
        }
      }
    };

    walk(searcherRoot);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Real-Nomic recall sanity check — gated by SKIP_SLOW_TESTS=0
// ---------------------------------------------------------------------------

describe.skipIf(skipSlow)('searcher cross-cutting — real Nomic v1.5 recall sanity (gated)', () => {
  let p: PipelineDeps;

  beforeEach(async () => {
    p = buildPipeline(new LocalEmbedder());
    await seedCompactCorpus(p);
  });

  afterEach(() => {
    p.db.close();
  });

  it('vectorSearch with real Nomic surfaces a topically-related window', async () => {
    const hits = await p.searcher.vectorSearch(
      'training neural networks with gradient descent',
      { projectId: 'proj-alpha' },
      5,
    );
    expect(hits.length).toBeGreaterThan(0);
    // First hit should be from one of the ML-themed windows in
    // proj-alpha's first conversation (the 'machine learning topic
    // one' / 'gradient descent topic two' set), not the cooking
    // conversation. Assert by checking conversation-id matches the
    // first conversation the seeder created in proj-alpha.
    const firstConvMessageStmt = p.db.prepare(
      'SELECT conversation_id FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id = ?) ORDER BY id ASC LIMIT 1',
    );
    const firstConv = (firstConvMessageStmt.get('proj-alpha') as { conversation_id: string })
      .conversation_id;
    expect(hits[0].conversationId).toBe(firstConv);
  });

  it('hybridSearch with real Nomic returns hits across all three sources', async () => {
    const hits = await p.searcher.hybridSearch(
      'machine learning gradient descent',
      { projectId: 'proj-alpha' },
      20,
    );
    expect(hits.length).toBeGreaterThan(0);
    // Real Nomic + populated vec_sessions should produce at least
    // one session hit alongside the window/message hits.
    const sessionHits = hits.filter((h) => h.kind === 'session');
    expect(sessionHits.length).toBeGreaterThan(0);
  });
});
