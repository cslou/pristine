/**
 * `npm run eval:embedder` entry point.
 *
 * Usage:
 *   npx tsx tests/integration/embedder-eval/cli.ts \
 *     --candidate <name> [--baseline nomic-v1.5] [--reports-dir <path>]
 *
 * Runs the harness against the candidate + baseline embedders in both
 * retrieval modes (dense-only, hybrid), computes paired-bootstrap deltas,
 * writes a markdown report to `docs/research/embedder-eval-runs/`.
 *
 * Candidate naming follows the sprint-017 candidate-trio: `nomic-v1.5`
 * (baseline + sanity), `gte-modernbert-base` (in-process), `embeddinggemma`
 * (Ollama), `qwen3-embedding` (Ollama).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EmbedderConfig } from '../../../src/embedder/index.js';
import { pairedBootstrapAllMetrics } from './bootstrap.js';
import { renderEvalReport } from './report.js';
import { runEval } from './run-eval.js';
import type { EvalResult, PairedDelta } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const DEFAULT_REPORTS_DIR = join(REPO_ROOT, 'docs', 'research', 'embedder-eval-runs');

interface ParsedArgs {
  readonly candidate: string;
  readonly baseline: string;
  readonly reportsDir: string;
}

const parseArgs = (argv: readonly string[]): ParsedArgs => {
  let candidate: string | undefined;
  let baseline = 'nomic-v1.5';
  let reportsDir = DEFAULT_REPORTS_DIR;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--candidate') candidate = argv[++i];
    else if (a === '--baseline') baseline = argv[++i] ?? baseline;
    else if (a === '--reports-dir') reportsDir = argv[++i] ?? reportsDir;
  }

  if (candidate === undefined) {
    throw new Error(
      'Usage: npx tsx tests/integration/embedder-eval/cli.ts --candidate <name> [--baseline nomic-v1.5] [--reports-dir <path>]',
    );
  }
  return { candidate, baseline, reportsDir };
};

/**
 * Map a sprint-017 candidate name to an EmbedderConfig. Centralised so
 * the CLI doesn't repeat the model+engine triplet at every call site.
 * Adding a new candidate is one entry here.
 */
const candidateConfig = (name: string): EmbedderConfig => {
  switch (name) {
    case 'nomic-v1.5':
      return { engine: 'local', model: 'nomic-ai/nomic-embed-text-v1.5', dim: 768 };
    case 'gte-modernbert-base':
      return { engine: 'local', model: 'Alibaba-NLP/gte-modernbert-base', dim: 768 };
    case 'embeddinggemma':
      return { engine: 'ollama', model: 'embeddinggemma:300m', dim: 768 };
    case 'qwen3-embedding':
      // Qwen3 is native 1024-d; Story 2 truncation path locks dim=768
      // via a wrapper-side slice + L2 renorm (see Story 2 Tech notes).
      // For the harness this candidate is wired with dim=768; the
      // Ollama call returns 1024-d but the truncation wrapper handles
      // the slice. Wrapper lives in Story 3's verify-engine-integration
      // commit; until then this candidate will fail strict-validate
      // against a 1024-d response and the harness reports the failure.
      return { engine: 'ollama', model: 'qwen3-embedding:0.6b', dim: 768 };
    default:
      throw new Error(
        `Unknown candidate: ${name}. Known: nomic-v1.5, gte-modernbert-base, embeddinggemma, qwen3-embedding`,
      );
  }
};

const sanitizeFilenameComponent = (s: string): string => s.replace(/[^a-zA-Z0-9._-]+/g, '-');

const isoNow = (): string => {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, '-');
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const candidateCfg = candidateConfig(args.candidate);
  const baselineCfg = candidateConfig(args.baseline);

  const seed = 0xc0ffee;
  const bootstrapResamples = 1000;

  // eslint-disable-next-line no-console
  console.log(`[eval] Running ${args.candidate} (dense-only)…`);
  const candidateDense: EvalResult = await runEval(candidateCfg, {
    config: 'dense-only',
    candidateName: args.candidate,
    seed,
    bootstrapResamples,
  });
  // eslint-disable-next-line no-console
  console.log(`[eval] Running ${args.candidate} (hybrid)…`);
  const candidateHybrid: EvalResult = await runEval(candidateCfg, {
    config: 'hybrid',
    candidateName: args.candidate,
    seed,
    bootstrapResamples,
  });
  // eslint-disable-next-line no-console
  console.log(`[eval] Running ${args.baseline} (dense-only)…`);
  const baselineDense: EvalResult = await runEval(baselineCfg, {
    config: 'dense-only',
    candidateName: args.baseline,
    seed,
    bootstrapResamples,
  });
  // eslint-disable-next-line no-console
  console.log(`[eval] Running ${args.baseline} (hybrid)…`);
  const baselineHybrid: EvalResult = await runEval(baselineCfg, {
    config: 'hybrid',
    candidateName: args.baseline,
    seed,
    bootstrapResamples,
  });

  const denseDeltas: readonly PairedDelta[] = pairedBootstrapAllMetrics(
    {
      ndcg10: {
        a: baselineDense.perQuery.map((m) => m.ndcg10),
        b: candidateDense.perQuery.map((m) => m.ndcg10),
      },
      recall5: {
        a: baselineDense.perQuery.map((m) => m.recall5),
        b: candidateDense.perQuery.map((m) => m.recall5),
      },
      recall10: {
        a: baselineDense.perQuery.map((m) => m.recall10),
        b: candidateDense.perQuery.map((m) => m.recall10),
      },
      recall20: {
        a: baselineDense.perQuery.map((m) => m.recall20),
        b: candidateDense.perQuery.map((m) => m.recall20),
      },
      mrr: {
        a: baselineDense.perQuery.map((m) => m.mrr),
        b: candidateDense.perQuery.map((m) => m.mrr),
      },
    },
    { resamples: bootstrapResamples, seed },
  );

  const hybridDeltas: readonly PairedDelta[] = pairedBootstrapAllMetrics(
    {
      ndcg10: {
        a: baselineHybrid.perQuery.map((m) => m.ndcg10),
        b: candidateHybrid.perQuery.map((m) => m.ndcg10),
      },
      recall5: {
        a: baselineHybrid.perQuery.map((m) => m.recall5),
        b: candidateHybrid.perQuery.map((m) => m.recall5),
      },
      recall10: {
        a: baselineHybrid.perQuery.map((m) => m.recall10),
        b: candidateHybrid.perQuery.map((m) => m.recall10),
      },
      recall20: {
        a: baselineHybrid.perQuery.map((m) => m.recall20),
        b: candidateHybrid.perQuery.map((m) => m.recall20),
      },
      mrr: {
        a: baselineHybrid.perQuery.map((m) => m.mrr),
        b: candidateHybrid.perQuery.map((m) => m.mrr),
      },
    },
    { resamples: bootstrapResamples, seed },
  );

  const md = renderEvalReport({
    candidate: { denseOnly: candidateDense, hybrid: candidateHybrid },
    baseline: { denseOnly: baselineDense, hybrid: baselineHybrid },
    deltas: { denseOnly: denseDeltas, hybrid: hybridDeltas },
    meta: {
      timestamp: new Date().toISOString(),
      bootstrapResamples,
      seed,
      numQueries: candidateDense.perQuery.length,
    },
  });

  mkdirSync(args.reportsDir, { recursive: true });
  const filename = `${isoNow()}-${sanitizeFilenameComponent(args.candidate)}-vs-${sanitizeFilenameComponent(args.baseline)}.md`;
  const outPath = join(args.reportsDir, filename);
  writeFileSync(outPath, md);
  // eslint-disable-next-line no-console
  console.log(`[eval] Wrote report: ${outPath}`);
};

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[eval] Failed:', err);
  process.exit(1);
});
