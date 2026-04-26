import type { DetectedEntity, SensitivityReport } from '../../../core/types.js';
import type { SensitivityClassifier } from '../../../core/interfaces.js';
import {
  BUILT_IN_SECRET_PATTERN_RULES,
  buildCustomPatternRules,
  type CustomPatternConfig,
  type DeterministicPatternRule,
} from './rules.js';

export interface DeterministicClassifierConfig {
  readonly confidenceThreshold?: number;
  readonly customPatternsPath?: string;
  readonly customPatterns?: readonly CustomPatternConfig[];
}

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

const sortAndDedupeEntities = (entities: readonly DetectedEntity[]): DetectedEntity[] => {
  const sorted = [...entities].sort(
    (a, b) =>
      b.end - b.start - (a.end - a.start) ||
      b.confidence - a.confidence ||
      a.start - b.start ||
      a.end - b.end,
  );

  const kept: DetectedEntity[] = [];
  for (const entity of sorted) {
    const overlaps = kept.some(
      (existing) => entity.start < existing.end && entity.end > existing.start,
    );
    if (!overlaps) {
      kept.push(entity);
    }
  }

  return kept.sort((a, b) => a.start - b.start || a.end - b.end);
};

export class DeterministicClassifier implements SensitivityClassifier {
  private readonly confidenceThreshold: number;
  private readonly patternRules: readonly DeterministicPatternRule[];
  private readonly warnings: readonly string[];

  public constructor(config: DeterministicClassifierConfig = {}) {
    this.confidenceThreshold = config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    const customPatterns = buildCustomPatternRules(
      config.customPatterns,
      config.customPatternsPath,
    );
    this.patternRules = [...BUILT_IN_SECRET_PATTERN_RULES, ...customPatterns.rules];
    this.warnings = customPatterns.warnings;
  }

  public async classify(text: string): Promise<SensitivityReport> {
    if (text.trim().length === 0) {
      return {
        entities: [],
        hasSensitiveContent: false,
        ...(this.warnings.length > 0 ? { warnings: this.warnings } : {}),
      };
    }

    const entities: DetectedEntity[] = [];

    for (const rule of this.patternRules) {
      const matcher = new RegExp(rule.pattern.source, rule.pattern.flags);

      for (const match of text.matchAll(matcher)) {
        const matchText = match[0];
        const start = match.index;

        if (rule.validate && !rule.validate(matchText)) {
          continue;
        }

        if (rule.confidence < this.confidenceThreshold) {
          continue;
        }

        entities.push({
          type: rule.type,
          source: 'deterministic',
          confidence: rule.confidence,
          start,
          end: start + matchText.length,
          text: matchText,
        });
      }
    }

    const deduped = sortAndDedupeEntities(entities);

    return {
      entities: deduped,
      hasSensitiveContent: deduped.length > 0,
      ...(this.warnings.length > 0 ? { warnings: this.warnings } : {}),
    };
  }
}

export const createDeterministicClassifier = (
  config: DeterministicClassifierConfig = {},
): DeterministicClassifier => new DeterministicClassifier(config);
