import type { LlmClient, SensitivityClassifier } from '../../core/interfaces.js';
import type { DetectedEntity, SensitivityReport, LlmClassifierConfig } from '../../core/types.js';
import { LlmClassificationError } from '../../core/errors.js';
import { createLlmClassifier } from '../llm/index.js';
import {
  createDeterministicClassifier,
  type DeterministicClassifierConfig,
} from '../deterministic/index.js';

export interface CombinedClassifierConfig {
  readonly deterministic?: DeterministicClassifierConfig;
  readonly llm?: LlmClassifierConfig;
}

interface CleanSpan {
  readonly text: string;
  /** Start offset in the original text */
  readonly originalStart: number;
}

export const extractCleanSpans = (
  text: string,
  entities: readonly DetectedEntity[],
): CleanSpan[] => {
  if (entities.length === 0) {
    return [{ text, originalStart: 0 }];
  }

  const sorted = [...entities].sort((a, b) => a.start - b.start);
  const spans: CleanSpan[] = [];
  let cursor = 0;

  for (const entity of sorted) {
    if (entity.start > cursor) {
      const raw = text.slice(cursor, entity.start);
      const trimStart = raw.length - raw.trimStart().length;
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        spans.push({ text: trimmed, originalStart: cursor + trimStart });
      }
    }
    cursor = Math.max(cursor, entity.end);
  }

  if (cursor < text.length) {
    const raw = text.slice(cursor);
    const trimStart = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      spans.push({ text: trimmed, originalStart: cursor + trimStart });
    }
  }

  return spans;
};

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

  return {
    entities: kept,
    hasSensitiveContent: kept.length > 0,
  };
};

class CombinedClassifier implements SensitivityClassifier {
  private readonly deterministic: SensitivityClassifier;
  private readonly llm: ReturnType<typeof createLlmClassifier>;

  public constructor(client: LlmClient, config: CombinedClassifierConfig = {}) {
    this.deterministic = createDeterministicClassifier(config.deterministic);
    this.llm = createLlmClassifier(client, config.llm);
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
      if (error instanceof LlmClassificationError) {
        throw new LlmClassificationError(
          `Classification blocked: LLM classifier failed. Ingestion cannot proceed. ${error.message}`,
        );
      }
      throw error;
    }
  }
}

export const createCombinedClassifier = (
  client: LlmClient,
  config: CombinedClassifierConfig = {},
): SensitivityClassifier => new CombinedClassifier(client, config);
