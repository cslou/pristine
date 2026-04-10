import type { DetectedEntity, SensitivityReport } from '../../../core/types.js';
import type { SensitivityClassifier } from '../../../core/interfaces.js';
import { DETERMINISTIC_PATTERN_RULES } from './rules.js';

export interface DeterministicClassifierConfig {
  readonly confidenceThreshold?: number;
}

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

export class DeterministicClassifier implements SensitivityClassifier {
  private readonly confidenceThreshold: number;

  public constructor(config: DeterministicClassifierConfig = {}) {
    this.confidenceThreshold = config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  }

  public async classify(text: string): Promise<SensitivityReport> {
    if (text.trim().length === 0) {
      return { entities: [], hasSensitiveContent: false };
    }

    const entities: DetectedEntity[] = [];

    for (const rule of DETERMINISTIC_PATTERN_RULES) {
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

    return {
      entities,
      hasSensitiveContent: entities.length > 0,
    };
  }
}

export const createDeterministicClassifier = (
  config: DeterministicClassifierConfig = {},
): DeterministicClassifier => new DeterministicClassifier(config);
