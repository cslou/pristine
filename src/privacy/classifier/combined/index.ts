import type { LlmClient, SensitivityClassifier } from '../../../core/interfaces.js';
import type {
  DetectedEntity,
  LlmFailureMode,
  SensitivityReport,
  LlmClassifierConfig,
} from '../../../core/types.js';
import { LlmClassificationError, UngroundableLlmFindingError } from '../../../core/errors.js';
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

const LEADING_CONTEXT_CHARS = 200;
const TRAILING_CONTEXT_CHARS = 80;

const TEMPORAL_TYPE_RE =
  /\b(date|time|datetime|timestamp|schedule|itinerary|travel|check_?in|check_?out)\b/i;
const DOB_TYPE_RE = /\b(dob|date_of_birth|birth(?:day|date)?)\b/i;
const DOB_CONTEXT_RE = /\b(dob|date of birth|birth(?:day|date)?|born on)\b/i;
const HEALTH_TYPE_RE = /\b(health|medical|diagnos|treatment|therapy|condition|prescription)\b/i;
const DATE_VALUE_RE =
  /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?)\b/i;
const TEMPORAL_WORD_RE =
  /\b(today|tomorrow|yesterday|next|this|last|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|checkin|checkout)\b/i;
const TRAVEL_SCHEDULING_RE =
  /\b(depart|departure|arrive|arrival|return|itinerary|trip|travel|flight|hotel|check[\s_-]?in|check[\s_-]?out)\b/i;
const STREET_TOKEN_RE =
  /\b(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way|highway|hwy|block|blk|unit|apt|suite|floor|flr|postal|postcode|zip)\b/i;
const HOUSE_NUMBER_RE = /\b\d{1,6}[a-z]?\b/i;
const ZIPISH_RE = /\b\d{5}(?:-\d{4})?\b/;
const ADDRESS_CONTEXT_RE = /\b(address|live at|reside(?:s|d)? at|located at|ship to|mail to)\b/i;
const EMAIL_RE = /\b[^@\s]+@[^@\s]+\.[^@\s]+\b/;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/;
const LONG_DIGIT_RE = /\b\d{8,}\b/;
const CARDISH_RE = /\b(?:\d[ -]?){13,19}\b/;
const GOVT_ID_RE = /\b[A-Z]\d{6,}\b/i;
const ISO_DATE_ONLY_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;

const digitsOnly = (value: string): string => value.replace(/\D+/g, '');

const isPhoneLike = (value: string): boolean => {
  const normalized = value.trim();
  if (ISO_DATE_ONLY_RE.test(normalized)) {
    return false;
  }
  if (!PHONE_RE.test(normalized)) {
    return false;
  }
  return digitsOnly(normalized).length >= 10;
};

const isLikelyNonSensitiveTemporalText = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 220) {
    return false;
  }

  const hasTemporalSignal =
    DATE_VALUE_RE.test(normalized) ||
    TEMPORAL_WORD_RE.test(normalized) ||
    TRAVEL_SCHEDULING_RE.test(normalized);
  if (!hasTemporalSignal) {
    return false;
  }

  const hasStrongSensitiveCue =
    EMAIL_RE.test(normalized) ||
    isPhoneLike(normalized) ||
    LONG_DIGIT_RE.test(normalized) ||
    CARDISH_RE.test(normalized) ||
    GOVT_ID_RE.test(normalized);

  return !hasStrongSensitiveCue;
};

const isLikelyFullAddress = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const hasStreetToken = STREET_TOKEN_RE.test(normalized);
  const hasNumber = HOUSE_NUMBER_RE.test(normalized);
  const hasZip = ZIPISH_RE.test(normalized);
  const hasComma = normalized.includes(',');

  if ((hasStreetToken && hasNumber) || hasZip) {
    return true;
  }

  return hasComma && tokens.length >= 4 && (hasStreetToken || hasNumber);
};

const shouldKeepEntity = (entity: DetectedEntity, sourceText: string): boolean => {
  const normalizedType = entity.type.trim().toLowerCase().replace(/[_-]+/g, ' ');
  const context = sourceText
    .slice(
      Math.max(0, entity.start - LEADING_CONTEXT_CHARS),
      Math.min(sourceText.length, entity.end + TRAILING_CONTEXT_CHARS),
    )
    .toLowerCase();

  if (DOB_TYPE_RE.test(normalizedType) || DOB_CONTEXT_RE.test(context)) {
    return true;
  }

  if (HEALTH_TYPE_RE.test(normalizedType)) {
    return true;
  }

  if (normalizedType === 'physical address') {
    const addressLike = isLikelyFullAddress(entity.text);
    if (!addressLike && !ADDRESS_CONTEXT_RE.test(context)) {
      return false;
    }
  }

  if (
    (normalizedType === 'other' || TEMPORAL_TYPE_RE.test(normalizedType)) &&
    isLikelyNonSensitiveTemporalText(entity.text)
  ) {
    return false;
  }

  return true;
};

const resolveMergedReport = (text: string, report: SensitivityReport): SensitivityReport => {
  const entities = report.entities.filter((entity) => shouldKeepEntity(entity, text));
  const warnings = report.warnings?.filter((warning) => warning.trim().length > 0);

  return {
    entities,
    hasSensitiveContent: entities.length > 0,
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
  };
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

    return resolveMergedReport(text, mergeReports(deterministicReport, llmReport));
  }

  private async classifyWithLlm(text: string): Promise<SensitivityReport> {
    try {
      return await this.llm.classify(text);
    } catch (error: unknown) {
      if (error instanceof UngroundableLlmFindingError) {
        throw error;
      }

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
