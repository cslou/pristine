/**
 * `npm run eval:embedder` entry point.
 *
 * Usage:
 *   npx tsx tests/integration/embedder-eval/cli.ts \
 *     --candidate <name> [--baseline nomic-v1.5] [--reports-dir <path>]
 *
 * Runs the harness against the candidate + baseline embedders in both
 * retrieval modes (dense-only, hybrid), computes paired-bootstrap deltas,
 * writes a markdown report under the reports directory.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pairedBootstrapAllMetrics } from './bootstrap.js';
import { candidateConfig } from './candidates.js';
import { confineReportsDir, parseArgs } from './cli-args.js';
import { renderEvalReport } from './report.js';
import { runEval } from './run-eval.js';
import type { EvalResult, PairedDelta, PerQueryMetric } from './types.js';

const sanitizeFilenameComponent = (s: string): string => s.replace(/[^a-zA-Z0-9._-]+/g, '-');

const isoNow = (): string => {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, '-');
};

/**
 * Project the per-query records into the per-metric arrays needed by
 * `pairedBootstrapAllMetrics`. Done once per `EvalResult` to avoid the
 * 5 × 2 = 10 redundant `.map(...)` allocations the previous CLI made.
 */
const perMetricArrays = (
  perQuery: readonly PerQueryMetric[],
): {
  readonly ndcg10: readonly number[];
  readonly recall5: readonly number[];
  readonly recall10: readonly number[];
  readonly recall20: readonly number[];
  readonly mrr: readonly number[];
} => ({
  ndcg10: perQuery.map((m) => m.ndcg10),
  recall5: perQuery.map((m) => m.recall5),
  recall10: perQuery.map((m) => m.recall10),
  recall20: perQuery.map((m) => m.recall20),
  mrr: perQuery.map((m) => m.mrr),
});

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const reportsDir = confineReportsDir(args.reportsDir);
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

  const baselineDenseMetrics = perMetricArrays(baselineDense.perQuery);
  const candidateDenseMetrics = perMetricArrays(candidateDense.perQuery);
  const baselineHybridMetrics = perMetricArrays(baselineHybrid.perQuery);
  const candidateHybridMetrics = perMetricArrays(candidateHybrid.perQuery);

  const denseDeltas: readonly PairedDelta[] = pairedBootstrapAllMetrics(
    {
      ndcg10: { a: baselineDenseMetrics.ndcg10, b: candidateDenseMetrics.ndcg10 },
      recall5: { a: baselineDenseMetrics.recall5, b: candidateDenseMetrics.recall5 },
      recall10: { a: baselineDenseMetrics.recall10, b: candidateDenseMetrics.recall10 },
      recall20: { a: baselineDenseMetrics.recall20, b: candidateDenseMetrics.recall20 },
      mrr: { a: baselineDenseMetrics.mrr, b: candidateDenseMetrics.mrr },
    },
    { resamples: bootstrapResamples, seed },
  );

  const hybridDeltas: readonly PairedDelta[] = pairedBootstrapAllMetrics(
    {
      ndcg10: { a: baselineHybridMetrics.ndcg10, b: candidateHybridMetrics.ndcg10 },
      recall5: { a: baselineHybridMetrics.recall5, b: candidateHybridMetrics.recall5 },
      recall10: { a: baselineHybridMetrics.recall10, b: candidateHybridMetrics.recall10 },
      recall20: { a: baselineHybridMetrics.recall20, b: candidateHybridMetrics.recall20 },
      mrr: { a: baselineHybridMetrics.mrr, b: candidateHybridMetrics.mrr },
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

  mkdirSync(reportsDir, { recursive: true });
  const filename = `${isoNow()}-${sanitizeFilenameComponent(args.candidate)}-vs-${sanitizeFilenameComponent(args.baseline)}.md`;
  const outPath = join(reportsDir, filename);
  writeFileSync(outPath, md);
  // eslint-disable-next-line no-console
  console.log(`[eval] Wrote report: ${outPath}`);
};

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[eval] Failed:', err);
  process.exit(1);
});
