import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDatabase,
  PristineLocal,
  type Embedder,
  type Searcher,
  type WindowHit,
  type MessageHit,
  type SessionHit,
  type HybridHit,
} from '../../../src/index.js';
// `createEmbedder` and `EmbedderConfig` are not exposed by the public
// barrel — the maintainer-only harness pulls them from the embedder
// sub-barrel. Promoting these to the public surface would change the
// SDK's exported API and is out of scope for the eval harness.
import { createEmbedder, type EmbedderConfig } from '../../../src/embedder/index.js';
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
 * Read a JSON-Lines file into a list of typed records. Skips empty lines
 * and `#`-prefixed lines so data files can carry a doc-block header.
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
 * DB and a `PristineLocal` client (the same composition any consumer
 * would use), ingests the corpus, optionally builds session vectors,
 * and returns a searcher whose hit `conversationId` field is translated
 * back to the corpus's external `conversationId` (so eval metrics can
 * compare against the labelled set's `relevantDocIds` directly).
 *
 * The harness uses only `PristineLocal.create({ db, embedder })` and the
 * client's public methods (`storeAsync`, `drainEmbedQueue`,
 * `buildSessionVector`) — no reach into SDK-internal modules.
 */
interface EvalPipeline {
  readonly searcher: Searcher;
  readonly close: () => Promise<void>;
  readonly dimUsed: number;
}

const buildPipeline = async (
  embedder: Embedder,
  corpus: readonly EvalDoc[],
  needsSessionVectors: boolean,
): Promise<EvalPipeline> => {
  const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });

  let client: PristineLocal | null = null;
  try {
    client = await PristineLocal.create({ db, embedder });

    // Group corpus by conversationId. Each corpus row is a single message;
    // multiple rows sharing a conversationId become a multi-message
    // conversation. The corpus's `conversationId` is an opaque external
    // key; the SDK assigns its own UUID per conversation, so we maintain
    // a translation map for retrieval-time hit normalisation. The eval
    // metric scorer compares against the corpus's external IDs (matching
    // the labelled set's `relevantDocIds`).
    const byConversation = new Map<string, EvalDoc[]>();
    for (const doc of corpus) {
      const list = byConversation.get(doc.conversationId);
      if (list) list.push(doc);
      else byConversation.set(doc.conversationId, [doc]);
    }

    const sdkIdToCorpusId = new Map<string, string>();
    for (const [origConvId, docs] of byConversation) {
      const projectId = docs[0]!.projectId;
      const messages = docs.map((d) => ({ role: d.role, content: d.content }) as const);
      const sdkConvId = client.storeAsync(messages, `eval-${origConvId}`, projectId);
      sdkIdToCorpusId.set(sdkConvId, origConvId);
    }

    await client.drainEmbedQueue();

    if (needsSessionVectors) {
      for (const sdkConvId of sdkIdToCorpusId.keys()) {
        await client.buildSessionVector(sdkConvId);
      }
    }

    const baseSearcher = client.searcher;

    // Translate hits' SDK conversationId → corpus conversationId. A
    // missing entry means a hit surfaced for a conversation the harness
    // didn't ingest — that's a harness invariant violation, fail loud
    // rather than silently mis-attributing the hit.
    const translateConvId = (sdkConvId: string): string => {
      const corpusId = sdkIdToCorpusId.get(sdkConvId);
      if (corpusId === undefined) {
        throw new Error(
          `eval: searcher hit referenced unknown conversationId ${sdkConvId} — harness invariant violated (was the corpus re-ingested out-of-band?)`,
        );
      }
      return corpusId;
    };

    const translateWindowHit = (h: WindowHit): WindowHit => ({
      ...h,
      conversationId: translateConvId(h.conversationId),
    });
    const translateMessageHit = (h: MessageHit): MessageHit => ({
      ...h,
      conversationId: translateConvId(h.conversationId),
    });
    const translateSessionHit = (h: SessionHit): SessionHit => ({
      ...h,
      conversationId: translateConvId(h.conversationId),
    });
    const translateHybridHit = (h: HybridHit): HybridHit => ({
      ...h,
      conversationId: translateConvId(h.conversationId),
    });

    const searcher: Searcher = {
      vectorSearch: async (q, f, l) => {
        const hits = await baseSearcher.vectorSearch(q, f, l);
        return hits.map(translateWindowHit);
      },
      ftsSearch: async (q, f, l) => {
        const hits = await baseSearcher.ftsSearch(q, f, l);
        return hits.map(translateMessageHit);
      },
      sessionVectorSearch: async (q, f, l) => {
        const hits = await baseSearcher.sessionVectorSearch(q, f, l);
        return hits.map(translateSessionHit);
      },
      hybridSearch: async (q, f, l) => {
        const hits = await baseSearcher.hybridSearch(q, f, l);
        return hits.map(translateHybridHit);
      },
      sql: baseSearcher.sql,
    };

    const ownedClient = client;
    return {
      searcher,
      close: async () => {
        await ownedClient.dispose();
      },
      dimUsed: embedder.dim,
    };
  } catch (err) {
    // Partial-construction cleanup. If we got far enough to build a
    // client, `dispose()` closes the DB and drains in-flight tasks.
    // Otherwise close the raw DB directly so the in-memory handle is
    // released (otherwise a pipeline-construction failure would leak
    // the handle until process exit — fine for a one-shot CLI but a
    // problem for a test that builds many pipelines).
    if (client !== null) {
      await client.dispose();
    } else {
      db.close();
    }
    throw err;
  }
};

/**
 * Run a single query against the configured retrieval mode. Returns
 * the ordered list of corpus conversationIds (de-duplicated, since
 * hybrid can surface the same conversation from multiple sources) +
 * the wall-clock time spent inside the retrieval call. The latency
 * here is `searcher.{vectorSearch,hybridSearch}` round-trip — embed
 * call + KNN/FTS lookup + filter-set query + dedup. It is intentionally
 * NOT just the `embed()` call, because the harness measures end-to-end
 * retrieval time as the consumer-facing SLO.
 */
const runQuery = async (
  searcher: Searcher,
  query: EvalQuery,
  configKind: EvalConfigKind,
  projectId: string,
  topK: number,
): Promise<{ readonly rankedIds: readonly string[]; readonly retrievalLatencyMs: number }> => {
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

  const retrievalLatencyMs = performance.now() - start;
  return { rankedIds: ranked, retrievalLatencyMs };
};

const scoreQuery = (
  query: EvalQuery,
  rankedIds: readonly string[],
  retrievalLatencyMs: number,
): PerQueryMetric => ({
  queryId: query.id,
  ndcg10: ndcgAtK(rankedIds, query.relevantDocIds, 10),
  recall5: recallAtK(rankedIds, query.relevantDocIds, 5),
  recall10: recallAtK(rankedIds, query.relevantDocIds, 10),
  recall20: recallAtK(rankedIds, query.relevantDocIds, 20),
  mrr: reciprocalRank(rankedIds, query.relevantDocIds),
  retrievalLatencyMs,
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
  const embedder = options.embedderOverride ?? createEmbedder(embedderConfig);
  const pipeline = await buildPipeline(embedder, corpus, needsSessionVectors);

  try {
    const perQuery: PerQueryMetric[] = [];
    for (const query of queries) {
      const { rankedIds, retrievalLatencyMs } = await runQuery(
        pipeline.searcher,
        query,
        options.config,
        projectId,
        topK,
      );
      perQuery.push(scoreQuery(query, rankedIds, retrievalLatencyMs));
    }

    const bootstrapOpts = {
      resamples: options.bootstrapResamples ?? 1000,
      seed: options.seed ?? 0xc0ffee,
    };

    // Extract per-metric arrays once; each is reused below for bootstrap
    // CI computation (replaces 6 repeated `.map(...)` passes).
    const ndcg10Values = perQuery.map((m) => m.ndcg10);
    const recall5Values = perQuery.map((m) => m.recall5);
    const recall10Values = perQuery.map((m) => m.recall10);
    const recall20Values = perQuery.map((m) => m.recall20);
    const mrrValues = perQuery.map((m) => m.mrr);
    const latencies = perQuery.map((m) => m.retrievalLatencyMs);

    return {
      config: options.config,
      candidateName,
      dimUsed: pipeline.dimUsed,
      perQuery,
      ndcg10: bootstrapMeanCI(ndcg10Values, bootstrapOpts),
      recall5: bootstrapMeanCI(recall5Values, bootstrapOpts),
      recall10: bootstrapMeanCI(recall10Values, bootstrapOpts),
      recall20: bootstrapMeanCI(recall20Values, bootstrapOpts),
      mrr: bootstrapMeanCI(mrrValues, bootstrapOpts),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
    };
  } finally {
    await pipeline.close();
  }
};
