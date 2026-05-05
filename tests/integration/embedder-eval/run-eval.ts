import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConversationStore } from '../../../src/conversations/store.js';
import { createDatabase } from '../../../src/core/database.js';
import { createEmbedder, type EmbedderConfig } from '../../../src/embedder/index.js';
import {
  createEmbedTaskHandler,
  runEmbedWorker,
} from '../../../src/memory/indexer/embed-worker.js';
import { createIndexer } from '../../../src/memory/indexer/index.js';
import { createWindowWriter } from '../../../src/memory/indexer/windows.js';
import { createSearcher, type Searcher } from '../../../src/memory/searcher/index.js';
import { IngestQueue } from '../../../src/queue/ingest-queue.js';
import { bootstrapMeanCI } from './bootstrap.js';
import { ndcgAtK, percentile, recallAtK, reciprocalRank } from './metrics.js';
import type {
  EvalConfigKind,
  EvalDoc,
  EvalQuery,
  EvalResult,
  PerQueryMetric,
  RunEvalOptions,
} from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_QUERIES_PATH = join(HERE, 'queries.jsonl');
const DEFAULT_CORPUS_PATH = join(HERE, 'corpus.jsonl');

const DEFAULT_TOP_K = 20;

/**
 * Read a JSON-Lines file into a list of typed records. Skips empty
 * lines + lines starting with `#` so the data files can carry a
 * doc-block header.
 */
const readJsonl = <T>(path: string): readonly T[] => {
  const raw = readFileSync(path, 'utf-8');
  const out: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    out.push(JSON.parse(trimmed) as T);
  }
  return out;
};

/**
 * Pipeline wiring for the eval. Builds an in-memory SQLite + sqlite-vec
 * DB, an indexer, and a searcher — same composition as
 * `PristineLocal.create` but bypassing `initPristine` (no filesystem
 * keys / config dir) since the eval is read-only against a synthetic
 * corpus.
 */
interface EvalPipeline {
  readonly searcher: Searcher;
  readonly close: () => void;
  readonly dimUsed: number;
}

const buildPipeline = async (
  config: EmbedderConfig,
  corpus: readonly EvalDoc[],
  needsSessionVectors: boolean,
): Promise<EvalPipeline> => {
  const embedder = createEmbedder(config);
  const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
  const store = new ConversationStore(db, embedder.dim);
  const windowWriter = createWindowWriter(db);
  const indexerConfig = { windowSize: 3, windowOverlap: 1 };

  const queue = new IngestQueue({
    db,
    embedTaskHandler: createEmbedTaskHandler({
      db,
      embedder,
      windowWriter,
      config: indexerConfig,
    }),
  });

  const indexer = createIndexer({
    db,
    conversationStore: store,
    ingestQueue: queue,
    embedder,
    config: indexerConfig,
  });

  // Group corpus by conversationId. Each corpus row is a single
  // message; multiple rows sharing a conversationId become a
  // multi-message conversation. The corpus-supplied `conversationId`
  // is an opaque external key — the SDK assigns its own UUID per
  // conversation, so we maintain a translation map for retrieval-time
  // hit normalisation.
  const byConversation = new Map<string, EvalDoc[]>();
  for (const doc of corpus) {
    const list = byConversation.get(doc.conversationId);
    if (list) list.push(doc);
    else byConversation.set(doc.conversationId, [doc]);
  }

  const corpusIdToConversationId = new Map<string, string>();
  for (const [origConvId, docs] of byConversation) {
    const projectId = docs[0]!.projectId;
    const messages = docs.map((d) => ({ role: d.role, content: d.content }));
    const sdkConvId = store.addEmptyConversation(`eval-${origConvId}`, messages, projectId);
    corpusIdToConversationId.set(origConvId, sdkConvId);
    indexer.ingest(messages, { projectId, conversationId: sdkConvId });
  }

  await runEmbedWorker(queue);

  if (needsSessionVectors) {
    for (const sdkConvId of corpusIdToConversationId.values()) {
      await indexer.buildSessionVector(sdkConvId);
    }
  }

  // Cache the original-id ↔ sdk-id mapping on the pipeline so the
  // caller can translate retrieval hits back to corpus IDs. We attach
  // it to the searcher closure indirectly by exposing translateHit.
  const sdkIdToCorpusId = new Map<string, string>();
  for (const [corpusId, sdkId] of corpusIdToConversationId) sdkIdToCorpusId.set(sdkId, corpusId);

  const baseSearcher = createSearcher({ db, embedder });

  // Wrap the searcher so callers see corpus IDs (matching the EvalDoc.id
  // field) rather than the SDK's UUID-shaped conversationIds. Eval
  // metrics are computed against corpus IDs.
  const searcher: Searcher = {
    vectorSearch: async (q, f, l) => {
      const hits = await baseSearcher.vectorSearch(q, f, l);
      return hits.map((h) => ({
        ...h,
        conversationId: sdkIdToCorpusId.get(h.conversationId) ?? h.conversationId,
      }));
    },
    ftsSearch: async (q, f, l) => {
      const hits = await baseSearcher.ftsSearch(q, f, l);
      return hits.map((h) => ({
        ...h,
        conversationId: sdkIdToCorpusId.get(h.conversationId) ?? h.conversationId,
      }));
    },
    sessionVectorSearch: async (q, f, l) => {
      const hits = await baseSearcher.sessionVectorSearch(q, f, l);
      return hits.map((h) => ({
        ...h,
        conversationId: sdkIdToCorpusId.get(h.conversationId) ?? h.conversationId,
      }));
    },
    hybridSearch: async (q, f, l) => {
      const hits = await baseSearcher.hybridSearch(q, f, l);
      return hits.map((h) => ({
        ...h,
        conversationId: sdkIdToCorpusId.get(h.conversationId) ?? h.conversationId,
      }));
    },
    sql: baseSearcher.sql,
  };

  return {
    searcher,
    close: () => {
      db.close();
    },
    dimUsed: embedder.dim,
  };
};

/**
 * Run a single query against the configured retrieval mode. Returns
 * the ordered list of corpus IDs (de-duplicated, since hybrid can
 * surface the same conversation from multiple sources).
 */
const runQuery = async (
  searcher: Searcher,
  query: EvalQuery,
  configKind: EvalConfigKind,
  projectId: string,
  topK: number,
): Promise<{ readonly rankedIds: readonly string[]; readonly latencyMs: number }> => {
  const start = performance.now();
  const seen = new Set<string>();
  const ranked: string[] = [];

  if (configKind === 'dense-only') {
    const hits = await searcher.vectorSearch(query.query, { projectId }, topK);
    for (const h of hits) {
      if (!seen.has(h.conversationId)) {
        seen.add(h.conversationId);
        ranked.push(h.conversationId);
      }
    }
  } else {
    const hits = await searcher.hybridSearch(query.query, { projectId }, topK);
    for (const h of hits) {
      if (!seen.has(h.conversationId)) {
        seen.add(h.conversationId);
        ranked.push(h.conversationId);
      }
    }
  }

  const latencyMs = performance.now() - start;
  return { rankedIds: ranked, latencyMs };
};

/**
 * Score a single query: compute NDCG@10, Recall@K (5,10,20), MRR.
 */
const scoreQuery = (
  query: EvalQuery,
  rankedIds: readonly string[],
  embedLatencyMs: number,
): PerQueryMetric => ({
  queryId: query.id,
  ndcg10: ndcgAtK(rankedIds, query.relevantDocIds, 10),
  recall5: recallAtK(rankedIds, query.relevantDocIds, 5),
  recall10: recallAtK(rankedIds, query.relevantDocIds, 10),
  recall20: recallAtK(rankedIds, query.relevantDocIds, 20),
  mrr: reciprocalRank(rankedIds, query.relevantDocIds),
  embedLatencyMs,
});

/**
 * Run the eval against a single embedder + retrieval-config combination.
 * Loads corpus and queries from JSONL files (defaults to the sibling
 * `queries.jsonl` / `corpus.jsonl`), indexes the corpus, runs each
 * query, computes per-query metrics + bootstrap CIs.
 */
export const runEval = async (
  embedderConfig: EmbedderConfig,
  options: RunEvalOptions & {
    readonly queriesPath?: string;
    readonly corpusPath?: string;
    readonly candidateName?: string;
    readonly topK?: number;
    readonly projectId?: string;
  },
): Promise<EvalResult> => {
  const queriesPath = options.queriesPath ?? DEFAULT_QUERIES_PATH;
  const corpusPath = options.corpusPath ?? DEFAULT_CORPUS_PATH;
  const topK = options.topK ?? DEFAULT_TOP_K;
  const projectId = options.projectId ?? 'eval';
  const candidateName =
    options.candidateName ??
    (embedderConfig.engine === 'local'
      ? (embedderConfig.model ?? 'local-default')
      : (embedderConfig.model ?? 'ollama-default'));

  const corpus = readJsonl<EvalDoc>(corpusPath);
  const allQueries = readJsonl<EvalQuery>(queriesPath);
  const queries = options.queryIdAllowlist
    ? allQueries.filter((q) => options.queryIdAllowlist!.has(q.id))
    : allQueries;

  const needsSessionVectors = options.config === 'hybrid';
  const pipeline = await buildPipeline(embedderConfig, corpus, needsSessionVectors);

  try {
    const perQuery: PerQueryMetric[] = [];
    for (const query of queries) {
      const { rankedIds, latencyMs } = await runQuery(
        pipeline.searcher,
        query,
        options.config,
        projectId,
        topK,
      );
      perQuery.push(scoreQuery(query, rankedIds, latencyMs));
    }

    const bootstrapOpts = {
      resamples: options.bootstrapResamples ?? 1000,
      seed: options.seed ?? 0xc0ffee,
    };

    const ndcg10 = bootstrapMeanCI(
      perQuery.map((m) => m.ndcg10),
      bootstrapOpts,
    );
    const recall5 = bootstrapMeanCI(
      perQuery.map((m) => m.recall5),
      bootstrapOpts,
    );
    const recall10 = bootstrapMeanCI(
      perQuery.map((m) => m.recall10),
      bootstrapOpts,
    );
    const recall20 = bootstrapMeanCI(
      perQuery.map((m) => m.recall20),
      bootstrapOpts,
    );
    const mrr = bootstrapMeanCI(
      perQuery.map((m) => m.mrr),
      bootstrapOpts,
    );

    const latencies = perQuery.map((m) => m.embedLatencyMs);
    const p50LatencyMs = percentile(latencies, 50);
    const p95LatencyMs = percentile(latencies, 95);

    return {
      config: options.config,
      candidateName,
      dimUsed: pipeline.dimUsed,
      perQuery,
      ndcg10,
      recall5,
      recall10,
      recall20,
      mrr,
      p50LatencyMs,
      p95LatencyMs,
    };
  } finally {
    pipeline.close();
  }
};
