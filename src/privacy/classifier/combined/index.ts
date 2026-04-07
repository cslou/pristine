import type { LlmClient, SensitivityClassifier } from '../../../core/interfaces.js';
import type {
  DetectedEntity,
  LlmFailureMode,
  SensitivityReport,
  LlmClassifierConfig,
} from '../../../core/types.js';
import { LlmClassificationError } from '../../../core/errors.js';
import { createLlmClassifier } from '../llm/index.js';
import {
  createDeterministicClassifier,
  type DeterministicClassifierConfig,
} from '../deterministic/index.js';

export interface CombinedClassifierConfig {
  readonly deterministic?: DeterministicClassifierConfig;
  readonly llm?: LlmClassifierConfig;
  readonly onLlmFailure?: LlmFailureMode;
}

export const mergeReports = (
  deterministicReport: SensitivityReport,
  llmReport: SensitivityReport,
): SensitivityReport => {
  // Deduplicate overlapping entities — prefer wider span, then higher confidence.
  const all = [...deterministicReport.entities, ...llmReport.entities].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || b.confidence - a.confidence,
  );

  const kept: DetectedEntity[] = [];
  for (const entity of all) {
    const overlaps = kept.some((e) => entity.start < e.end && entity.end > e.start);
    if (!overlaps) {
      kept.push(entity);
    }
  }

  const warnings = [
    ...(deterministicReport.warnings ?? []),
    ...(llmReport.warnings ?? []),
  ];

  return {
    entities: kept,
    hasSensitiveContent: kept.length > 0,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
};

class CombinedClassifier implements SensitivityClassifier {
  private readonly deterministic: SensitivityClassifier;
  private readonly llm: ReturnType<typeof createLlmClassifier>;
  private readonly onLlmFailure: LlmFailureMode;

  public constructor(client: LlmClient, config: CombinedClassifierConfig = {}) {
    this.deterministic = createDeterministicClassifier(config.deterministic);
    this.llm = createLlmClassifier(client, config.llm);
    this.onLlmFailure = config.onLlmFailure ?? 'block';
  }

  public async classify(text: string): Promise<SensitivityReport> {
    // Run both classifiers on the FULL text in parallel.
    // No span splitting — LLM sees full context so it catches complete
    // addresses, compound PII, etc. Deterministic results merge on top.
    const [deterministicReport, llmReport] = await Promise.all([
      this.deterministic.classify(text),
      this.classifyWithLlm(text),
    ]);

    return mergeReports(deterministicReport, llmReport);
  }

  private async classifyWithLlm(text: string): Promise<SensitivityReport> {
    try {
      return await this.llm.classify(text);
    } catch (error: unknown) {
      if (this.onLlmFailure === 'degrade') {
        const message =
          error instanceof LlmClassificationError
            ? error.message
            : `LLM classification degraded: ${error instanceof Error ? error.message : 'unknown error'}`;
        return {
          entities: [],
          hasSensitiveContent: false,
          warnings: [message],
        };
      }

      if (error instanceof LlmClassificationError) {
        throw error;
      }
      throw new LlmClassificationError(
        `Classification blocked: unexpected error in LLM classifier. Ingestion cannot proceed. ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

export const createCombinedClassifier = (
  client: LlmClient,
  config: CombinedClassifierConfig = {},
): SensitivityClassifier => new CombinedClassifier(client, config);
