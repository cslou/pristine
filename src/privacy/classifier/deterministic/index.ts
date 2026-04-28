import type { SensitivityReport } from '../../../core/types.js';
import type { SensitivityClassifier } from '../../../core/interfaces.js';
import { BUILT_IN_SECRET_PATTERN_RULES, type DeterministicPatternRule } from './rules.js';
import { buildCustomPatternRules, type CustomPatternConfig } from './custom-patterns.js';
import { scanTextWithRules } from './scanner.js';

export interface DeterministicClassifierConfig {
  readonly confidenceThreshold?: number;
  readonly customPatternsPath?: string;
  readonly customPatterns?: readonly CustomPatternConfig[];
}

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

export const createDeterministicPatternRuleSet = (
  config: DeterministicClassifierConfig = {},
): {
  readonly rules: readonly DeterministicPatternRule[];
  readonly warnings: readonly string[];
} => {
  const customPatterns = buildCustomPatternRules(config.customPatterns, config.customPatternsPath);
  return {
    rules: [...BUILT_IN_SECRET_PATTERN_RULES, ...customPatterns.rules],
    warnings: customPatterns.warnings,
  };
};

export class DeterministicClassifier implements SensitivityClassifier {
  private readonly confidenceThreshold: number;
  private readonly patternRules: readonly DeterministicPatternRule[];
  private readonly warnings: readonly string[];

  public constructor(config: DeterministicClassifierConfig = {}) {
    this.confidenceThreshold = config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    const ruleSet = createDeterministicPatternRuleSet(config);
    this.patternRules = ruleSet.rules;
    this.warnings = ruleSet.warnings;
  }

  public getPatternRules(): readonly DeterministicPatternRule[] {
    return this.patternRules;
  }

  public async classify(text: string): Promise<SensitivityReport> {
    if (text.trim().length === 0) {
      return {
        entities: [],
        hasSensitiveContent: false,
        ...(this.warnings.length > 0 ? { warnings: this.warnings } : {}),
      };
    }

    const entities = scanTextWithRules(text, this.patternRules, {
      confidenceThreshold: this.confidenceThreshold,
    });

    return {
      entities,
      hasSensitiveContent: entities.length > 0,
      ...(this.warnings.length > 0 ? { warnings: this.warnings } : {}),
    };
  }
}

export const createDeterministicClassifier = (
  config: DeterministicClassifierConfig = {},
): DeterministicClassifier => new DeterministicClassifier(config);
