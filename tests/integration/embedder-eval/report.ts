import type { BootstrapCI, EvalResult, PairedDelta } from './types.js';

/**
 * Markdown report writer for `npm run eval:embedder`. Pure function —
 * takes EvalResults + paired deltas, returns the markdown string. The
 * CLI is responsible for filesystem writes.
 */

type MetricKey = 'ndcg10' | 'recall5' | 'recall10' | 'recall20' | 'mrr';

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

/**
 * Index an EvalResult's BootstrapCI fields by `MetricKey`. Replaces a
 * 5-deep nested ternary that silently fell through to MRR for any
 * unrecognised key. With the keyed table, an unknown key is a TS
 * error rather than a hidden wrong number.
 */
const metricCI = (r: EvalResult, key: MetricKey): BootstrapCI => {
  switch (key) {
    case 'ndcg10':
      return r.ndcg10;
    case 'recall5':
      return r.recall5;
    case 'recall10':
      return r.recall10;
    case 'recall20':
      return r.recall20;
    case 'mrr':
      return r.mrr;
  }
};

/**
 * Find a metric's PairedDelta in a deltas array. Throws a descriptive
 * error if the metric is missing — replaces a bare non-null assertion
 * that would otherwise produce an opaque TypeError on a future filtered
 * deltas array.
 */
const findMetric = (deltas: readonly PairedDelta[], key: MetricKey): PairedDelta => {
  const found = deltas.find((d) => d.metric === key);
  if (!found) {
    throw new Error(`renderEvalReport: deltas array is missing the '${key}' metric`);
  }
  return found;
};

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
    const baseCI = metricCI(baseline, m.metric);
    const candCI = metricCI(candidate, m.metric);
    const sigMark = isSignificant(m.delta) ? ' **\\***' : '';
    rows.push(
      `| ${m.metric} | ${fmtCI(baseCI)} | ${fmtCI(candCI)} | ${fmtDelta(m.delta)}${sigMark} |`,
    );
  }
  rows.push('');
  rows.push(`Latency (retrieval round-trip wall time):`);
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
  const denseN = findMetric(deltas.denseOnly, 'ndcg10').delta;
  const hybridN = findMetric(deltas.hybrid, 'ndcg10').delta;
  const denseSig = isSignificant(denseN);
  const hybridSig = isSignificant(hybridN);

  if (denseSig && denseN.point > 0 && hybridSig && hybridN.point > 0) {
    return `**Verdict:** ${candidateName} beats ${baselineName} on NDCG@10 in both retrieval modes (95% CI excludes zero); recommend re-evaluating the default embedder configuration.`;
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
