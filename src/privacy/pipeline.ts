import type { LlmClient, PrivacyPipeline, SensitivityClassifier } from '../core/interfaces.js';
import type { ClassificationPipelineResult } from '../core/types.js';
import { UngroundableLlmFindingError } from '../core/errors.js';
import { createCombinedClassifier, type CombinedClassifierConfig } from './classifier/combined/index.js';
import { findSafetyViolations } from './safety-scan.js';
import { redactText } from './vault/redaction.js';

interface PrivacyPipelineConfig {
  readonly classifier?: CombinedClassifierConfig;
}

class DefaultPrivacyPipeline implements PrivacyPipeline {
  private readonly classifier: SensitivityClassifier;

  public constructor(client: LlmClient, config: PrivacyPipelineConfig = {}) {
    this.classifier = createCombinedClassifier(client, config.classifier);
  }

  public async classifyAndRedact(text: string): Promise<ClassificationPipelineResult> {
    let report;
    try {
      report = await this.classifier.classify(text);
    } catch (error: unknown) {
      if (error instanceof UngroundableLlmFindingError) {
        return {
          report: {
            entities: [],
            hasSensitiveContent: false,
            warnings: [error.message],
          },
          redaction: null,
          safetyViolations: [],
          blockedReason: 'ungroundable_llm_finding',
          blockedWarnings: [error.message],
        };
      }
      throw error;
    }
    const redaction = report.entities.length > 0 ? redactText(text, report) : null;
    const redactedText = redaction?.redactedText ?? text;
    const safetyViolations = findSafetyViolations(redactedText);

    return {
      report,
      redaction,
      safetyViolations,
      ...(safetyViolations.length > 0 ? { blockedReason: 'safety_scan' as const } : {}),
    };
  }
}

export const createPrivacyPipeline = (
  client: LlmClient,
  config: PrivacyPipelineConfig = {},
): PrivacyPipeline => new DefaultPrivacyPipeline(client, config);
