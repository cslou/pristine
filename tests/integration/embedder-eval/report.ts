import type { BootstrapCI, EvalResult, PairedDelta } from './types.js';

/**
 * Markdown report writer for `npm run eval:embedder`. Produces the
 * canonical Story 4 deliverable: a single markdown file at
 * `docs/research/embedder-eval-runs/<timestamp>-<candidate>-vs-<baseline>.md`
 * with both retrieval configurations' numbers, deltas with CIs, and a
 * one-paragraph summary.
 *
 * Pure function — takes EvalResults + paired deltas, returns the
 * markdown string. The CLI is responsible for filesystem writes.
 */

const fmt = (n: number, decimals = 4): string => n.toFixed(decimals);

const fmtCI = (ci: BootstrapCI, decimals = 4): string =>
  `${fmt(ci.point, decimals)} [${fmt(ci.lower, decimals)}, ${fmt(ci.upper, decimals)}]`;

const fmtDelta = (delta: BootstrapCI, decimals = 4): string => {
  const sign = delta.point >= 0 ? '+' : '';
  return `${sign}${fmt(delta.point, decimals)} [${fmt(delta.lower, decimals)}, ${fmt(delta.upper, decimals)}]`;
};

/**
 * Whether a paired-bootstrap delta CI excludes zero. Used to mark
 * "significant" rows in the report. CI brackets zero → result is
 * inconclusive at the 95% level.
 */
const isSignificant = (delta: BootstrapCI): boolean => delta.lower > 0 || delta.upper < 0;

interface RenderInput {
  readonly candidate: { readonly denseOnly: EvalResult; readonly hybrid: EvalResult };
  readonly baseline: { readonly denseOnly: EvalResult; readonly hybrid: EvalResult };
  readonly deltas: {
    readonly denseOnly: readonly PairedDelta[];
    readonly hybrid: readonly PairedDelta[];
  };
  readonly meta: {
    readonly timestamp: string;
    readonly bootstrapResamples: number;
    readonly seed: number;
    readonly numQueries: number;
  };
}

const renderConfigSection = (
  configKind: 'dense-only' | 'hybrid',
  candidate: EvalResult,
  baseline: EvalResult,
  deltas: readonly PairedDelta[],
): string => {
  const rows: string[] = [];
  rows.push(`### ${configKind} retrieval`);
  rows.push('');
  rows.push(
    `| Metric | Baseline (${baseline.candidateName}, dim=${baseline.dimUsed}) | Candidate (${candidate.candidateName}, dim=${candidate.dimUsed}) | Δ (paired bootstrap 95% CI) |`,
  );
  rows.push(`|---|---|---|---|`);
  for (const m of deltas) {
    const baseCI =
      m.metric === 'ndcg10'
        ? baseline.ndcg10
        : m.metric === 'recall5'
          ? baseline.recall5
          : m.metric === 'recall10'
            ? baseline.recall10
            : m.metric === 'recall20'
              ? baseline.recall20
              : baseline.mrr;
    const candCI =
      m.metric === 'ndcg10'
        ? candidate.ndcg10
        : m.metric === 'recall5'
          ? candidate.recall5
          : m.metric === 'recall10'
            ? candidate.recall10
            : m.metric === 'recall20'
              ? candidate.recall20
              : candidate.mrr;
    const sigMark = isSignificant(m.delta) ? ' **\\***' : '';
    rows.push(
      `| ${m.metric} | ${fmtCI(baseCI)} | ${fmtCI(candCI)} | ${fmtDelta(m.delta)}${sigMark} |`,
    );
  }
  rows.push('');
  rows.push(`Latency (embed-call wall time):`);
  rows.push(
    `- Baseline: p50 ${fmt(baseline.p50LatencyMs, 1)}ms, p95 ${fmt(baseline.p95LatencyMs, 1)}ms`,
  );
  rows.push(
    `- Candidate: p50 ${fmt(candidate.p50LatencyMs, 1)}ms, p95 ${fmt(candidate.p95LatencyMs, 1)}ms`,
  );
  rows.push('');
  return rows.join('\n');
};

const summaryParagraph = (
  candidateName: string,
  baselineName: string,
  deltas: { readonly denseOnly: readonly PairedDelta[]; readonly hybrid: readonly PairedDelta[] },
): string => {
  const denseN = deltas.denseOnly.find((d) => d.metric === 'ndcg10')!.delta;
  const hybridN = deltas.hybrid.find((d) => d.metric === 'ndcg10')!.delta;
  const denseSig = isSignificant(denseN);
  const hybridSig = isSignificant(hybridN);

  if (denseSig && denseN.point > 0 && hybridSig && hybridN.point > 0) {
    return `**Verdict:** ${candidateName} beats ${baselineName} on NDCG@10 in both retrieval modes (95% CI excludes zero); recommend a follow-up Story 5 default-config swap.`;
  }
  if ((denseSig && denseN.point < 0) || (hybridSig && hybridN.point < 0)) {
    return `**Verdict:** ${candidateName} underperforms ${baselineName} on NDCG@10 in at least one retrieval mode (95% CI excludes zero, sign negative); keep ${baselineName} as the default.`;
  }
  return `**Verdict:** Inconclusive — Δ NDCG@10 CI brackets zero in at least one retrieval mode. Either expand the labelled set (≥200 queries) or accept that the candidates are within bootstrap noise of each other.`;
};

export const renderEvalReport = (input: RenderInput): string => {
  const lines: string[] = [];
  lines.push(
    `# Embedder eval — ${input.candidate.denseOnly.candidateName} vs ${input.baseline.denseOnly.candidateName}`,
  );
  lines.push('');
  lines.push(`- **Timestamp:** ${input.meta.timestamp}`);
  lines.push(`- **Queries:** ${input.meta.numQueries}`);
  lines.push(
    `- **Bootstrap resamples:** ${input.meta.bootstrapResamples} (seed: ${input.meta.seed})`,
  );
  lines.push(`- **Significance marker (\\*):** paired-bootstrap 95% CI excludes zero.`);
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push(
    renderConfigSection(
      'dense-only',
      input.candidate.denseOnly,
      input.baseline.denseOnly,
      input.deltas.denseOnly,
    ),
  );
  lines.push(
    renderConfigSection(
      'hybrid',
      input.candidate.hybrid,
      input.baseline.hybrid,
      input.deltas.hybrid,
    ),
  );
  lines.push('## Summary');
  lines.push('');
  lines.push(
    summaryParagraph(
      input.candidate.denseOnly.candidateName,
      input.baseline.denseOnly.candidateName,
      input.deltas,
    ),
  );
  lines.push('');
  return lines.join('\n');
};
