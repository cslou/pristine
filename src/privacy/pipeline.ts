import type { PrivacyPipeline, SensitivityClassifier } from '../core/interfaces.js';
import type { ClassificationPipelineResult } from '../core/types.js';
import {
  createDeterministicClassifier,
  type DeterministicClassifierConfig,
} from './classifier/deterministic/index.js';
import { findSafetyViolations } from './safety-scan.js';
import { redactText } from './vault/redaction.js';

interface PrivacyPipelineConfig {
  readonly classifier?: DeterministicClassifierConfig;
}

class DefaultPrivacyPipeline implements PrivacyPipeline {
  private readonly classifier: SensitivityClassifier;

  public constructor(config: PrivacyPipelineConfig = {}) {
    this.classifier = createDeterministicClassifier(config.classifier);
  }

  public async classifyAndRedact(text: string): Promise<ClassificationPipelineResult> {
    const report = await this.classifier.classify(text);
    const redaction = report.entities.length > 0 ? redactText(text, report) : null;
    const redactedText = redaction?.redactedText ?? text;
    const safetyViolations = findSafetyViolations(redactedText);

    return {
      report,
      redaction,
      safetyViolations,
    };
  }
}

export const createPrivacyPipeline = (config: PrivacyPipelineConfig = {}): PrivacyPipeline =>
  new DefaultPrivacyPipeline(config);
