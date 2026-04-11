import type { LlmClient } from '../../../core/interfaces.js';
import type {
  DetectedEntity,
  SensitivityReport,
  LlmSensitivityFinding,
  LlmClassifierConfig,
} from '../../../core/types.js';
import type { SensitivityClassifier } from '../../../core/interfaces.js';
import { LlmClassificationError, UngroundableLlmFindingError } from '../../../core/errors.js';
import { assertNoLlmReentry } from '../../sanitizer/index.js';
import { buildClassificationPrompt } from './prompts.js';
import { CLASSIFY_SENSITIVITY_SCHEMA } from './schema.js';

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

interface ClassifySensitivityInput {
  readonly findings: readonly LlmSensitivityFinding[];
}

interface GroundedFinding {
  readonly entity: DetectedEntity | null;
  readonly warning?: string;
}

const groundFinding = (finding: LlmSensitivityFinding, sourceText: string): GroundedFinding => {
  const idx = sourceText.indexOf(finding.text);
  const ciIdx = idx >= 0 ? idx : sourceText.toLowerCase().indexOf(finding.text.toLowerCase());

  if (ciIdx < 0) {
    return {
      entity: null,
      warning: `Ungroundable LLM finding for type "${finding.type}" with text "${finding.text}" (text not found in source).`,
    };
  }

  return {
    entity: {
      type: finding.type,
      source: 'llm',
      confidence: finding.confidence,
      start: ciIdx,
      end: ciIdx + finding.text.length,
      text: finding.text,
    },
  };
};

export class LlmClassifier implements SensitivityClassifier {
  private readonly client: LlmClient;
  private readonly maxTokens: number;
  private readonly confidenceThreshold: number;
  private readonly systemPrompt: string;

  public constructor(client: LlmClient, config: LlmClassifierConfig = {}) {
    this.client = client;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.confidenceThreshold = config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.systemPrompt = config.systemPrompt ?? buildClassificationPrompt();
  }

  public async classify(text: string): Promise<SensitivityReport> {
    assertNoLlmReentry(text, 'classifier text');

    if (text.trim().length === 0) {
      return { entities: [], hasSensitiveContent: false };
    }

    let result: ClassifySensitivityInput;
    try {
      result = await this.client.generate<ClassifySensitivityInput>({
        systemPrompt: this.systemPrompt,
        userPrompt: `Classify the following text for sensitive content:\n\n${text}`,
        schema: CLASSIFY_SENSITIVITY_SCHEMA,
        maxTokens: this.maxTokens,
      });
    } catch (error: unknown) {
      throw new LlmClassificationError(
        `Classification blocked: LLM classifier failed. Ingestion cannot proceed without sensitivity classification. ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    // Defensive validation — schema constrains structure, but guard against buggy clients
    if (!result || !Array.isArray(result.findings)) {
      throw new LlmClassificationError(
        'Classification blocked: LLM returned invalid structure. Ingestion cannot proceed.',
      );
    }

    const groundedFindings = result.findings
      .filter(
        (f): f is LlmSensitivityFinding =>
          typeof f.type === 'string' &&
          typeof f.confidence === 'number' &&
          typeof f.text === 'string' &&
          f.text.trim().length > 0 &&
          f.confidence >= this.confidenceThreshold,
      )
      .map((f) => groundFinding(f, text));

    const ungroundableWarnings = groundedFindings
      .map((finding) => finding.warning)
      .filter((warning): warning is string => typeof warning === 'string');

    if (ungroundableWarnings.length > 0) {
      throw new UngroundableLlmFindingError(
        `Classification blocked: ${ungroundableWarnings[0] ?? 'LLM returned an ungroundable finding.'}`,
      );
    }

    const entities = groundedFindings
      .map((finding) => finding.entity)
      .filter((entity): entity is DetectedEntity => entity !== null);

    return {
      entities,
      hasSensitiveContent: entities.length > 0,
    };
  }
}

export const createLlmClassifier = (
  client: LlmClient,
  config: LlmClassifierConfig = {},
): LlmClassifier => new LlmClassifier(client, config);
