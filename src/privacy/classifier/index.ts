import { randomUUID } from 'node:crypto';
import { InvalidArgumentError } from '../../core/errors.js';
import type {
  ClassifierCallback,
  ClassifierCallbackDecision,
  ClassifierCallbackResult,
  ClassifierRequest,
  ClassifierRequestCandidate,
  ClassifyDecision,
  ClassifyOptions,
  ClassifyResult,
  DetectCandidate,
  DetectHint,
  PrivacyHintFeatureValue,
  SourceSpan,
} from '../../core/types.js';

const SAFE_PROVIDER_HINTS = new Set(['anthropic', 'aws', 'github', 'openai', 'sendgrid']);
const SAFE_PREFIX_FAMILY_HINTS = new Set(['AKIA', 'ghp_', 'sk-ant', 'sk-proj', 'SG.']);
const ALLOWED_VERDICTS = new Set(['secret', 'not_secret', 'uncertain']);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const markerForCandidate = (candidateId: string): string => `[CANDIDATE:${candidateId}]`;

const assertValidSpan = (span: SourceSpan, textLength: number, label: string): void => {
  if (
    !Number.isInteger(span.start) ||
    !Number.isInteger(span.end) ||
    span.start < 0 ||
    span.end < span.start ||
    span.end > textLength
  ) {
    throw new InvalidArgumentError(`classify: ${label} has an invalid sourceSpan`);
  }
};

const safeHintString = (value: string, rawValue: string): string | undefined => {
  if (value.length === 0) return undefined;
  if (value === rawValue || value.includes(rawValue) || rawValue.includes(value)) return undefined;
  return value;
};

const safeProvider = (value: string | undefined, rawValue: string): string | undefined => {
  if (!value) return undefined;
  return SAFE_PROVIDER_HINTS.has(value) ? value : safeHintString(value, rawValue);
};

const safePrefixFamily = (value: string | undefined, rawValue: string): string | undefined => {
  if (!value) return undefined;
  return SAFE_PREFIX_FAMILY_HINTS.has(value) ? value : safeHintString(value, rawValue);
};

const safeHintStringArray = (
  values: readonly string[],
  rawValue: string,
): readonly string[] | undefined => {
  const safeValues = values
    .map((value) => safeHintString(value, rawValue))
    .filter((value): value is string => value !== undefined);
  return safeValues.length > 0 ? safeValues : undefined;
};

const safeFeatureValue = (
  value: PrivacyHintFeatureValue,
  rawValue: string,
): PrivacyHintFeatureValue | undefined => {
  if (typeof value === 'string') return safeHintString(value, rawValue);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value.every((item): item is string => typeof item === 'string')) {
    return safeHintStringArray(value, rawValue);
  }
  return value.length > 0 ? value : undefined;
};

const sanitizeHint = (hint: DetectHint, rawValue: string): DetectHint => {
  const features = hint.features
    ? Object.fromEntries(
        Object.entries(hint.features)
          .map(([key, value]) => [key, safeFeatureValue(value, rawValue)] as const)
          .filter(
            (entry): entry is readonly [string, PrivacyHintFeatureValue] => entry[1] !== undefined,
          ),
      )
    : undefined;

  return {
    suggestedType: hint.suggestedType ? safeHintString(hint.suggestedType, rawValue) : undefined,
    provider: safeProvider(hint.provider, rawValue),
    prefixFamily: safePrefixFamily(hint.prefixFamily, rawValue),
    nearbyName: hint.nearbyName ? safeHintString(hint.nearbyName, rawValue) : undefined,
    signals: hint.signals ? safeHintStringArray(hint.signals, rawValue) : undefined,
    positiveSignals: hint.positiveSignals
      ? safeHintStringArray(hint.positiveSignals, rawValue)
      : undefined,
    negativeSignals: hint.negativeSignals
      ? safeHintStringArray(hint.negativeSignals, rawValue)
      : undefined,
    features: features && Object.keys(features).length > 0 ? features : undefined,
  };
};

const buildSanitizedContext = (text: string, candidates: readonly DetectCandidate[]): string => {
  const ordered = [...candidates].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start);
  let cursor = 0;
  let context = '';

  for (const candidate of ordered) {
    if (candidate.sourceSpan.start < cursor) {
      throw new InvalidArgumentError('classify: candidate sourceSpans must not overlap');
    }
    context += text.slice(cursor, candidate.sourceSpan.start);
    context += markerForCandidate(candidate.candidateId);
    cursor = candidate.sourceSpan.end;
  }

  return context + text.slice(cursor);
};

const buildRequest = (
  text: string,
  candidates: readonly DetectCandidate[],
  options: ClassifyOptions,
): ClassifierRequest => {
  const ids = new Set<string>();
  const requestCandidates: ClassifierRequestCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.candidateId.length === 0) {
      throw new InvalidArgumentError('classify: candidateId must be non-empty');
    }
    if (ids.has(candidate.candidateId)) {
      throw new InvalidArgumentError(`classify: duplicate candidateId ${candidate.candidateId}`);
    }
    ids.add(candidate.candidateId);
    assertValidSpan(candidate.sourceSpan, text.length, `candidate ${candidate.candidateId}`);
    const rawValue = text.slice(candidate.sourceSpan.start, candidate.sourceSpan.end);
    requestCandidates.push({
      candidateId: candidate.candidateId,
      marker: markerForCandidate(candidate.candidateId),
      kind: candidate.kind,
      ruleId: candidate.ruleId,
      sourceSpan: candidate.sourceSpan,
      valueLength: candidate.valueLength,
      location: candidate.location,
      hint: sanitizeHint(candidate.hint, rawValue),
    });
  }

  return {
    requestId: options.requestId ?? randomUUID(),
    sourceSurface: options.sourceSurface,
    sanitizedContext: buildSanitizedContext(text, candidates),
    candidates: requestCandidates,
  };
};

const assertSafeOptionalString = (value: unknown, fieldName: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidArgumentError(`classify: decision ${fieldName} must be a non-empty string`);
  }
  return value;
};

const normalizeDecision = (
  decision: ClassifierCallbackDecision,
  candidate: DetectCandidate,
): ClassifyDecision => {
  const label = assertSafeOptionalString(decision.label, 'label');
  const rationale = assertSafeOptionalString(decision.rationale, 'rationale');
  if (
    decision.confidence !== undefined &&
    (typeof decision.confidence !== 'number' ||
      !Number.isFinite(decision.confidence) ||
      decision.confidence < 0 ||
      decision.confidence > 1)
  ) {
    throw new InvalidArgumentError('classify: decision confidence must be between 0 and 1');
  }

  const metadata = {
    candidateId: decision.candidateId,
    sourceSpan: candidate.sourceSpan,
    label,
    confidence: decision.confidence,
    rationale,
  };

  if (decision.verdict === 'secret') {
    if (typeof decision.type !== 'string' || decision.type.length === 0) {
      throw new InvalidArgumentError('classify: secret decisions must include a non-empty type');
    }
    return { ...metadata, verdict: 'secret', type: decision.type };
  }

  const type = assertSafeOptionalString(decision.type, 'type');
  return { ...metadata, verdict: decision.verdict, type };
};

const validateCallbackResult = (
  result: unknown,
  candidatesById: ReadonlyMap<string, DetectCandidate>,
): ClassifyResult => {
  if (!isRecord(result) || !Array.isArray(result.decisions)) {
    throw new InvalidArgumentError('classify: classifier callback must return a decisions array');
  }

  const seen = new Set<string>();
  const decisions: ClassifyDecision[] = [];

  for (const rawDecision of result.decisions) {
    if (!isRecord(rawDecision)) {
      throw new InvalidArgumentError('classify: classifier decision must be an object');
    }
    if (typeof rawDecision.candidateId !== 'string' || rawDecision.candidateId.length === 0) {
      throw new InvalidArgumentError('classify: classifier decision candidateId must be non-empty');
    }
    if (seen.has(rawDecision.candidateId)) {
      throw new InvalidArgumentError(`classify: duplicate decision for ${rawDecision.candidateId}`);
    }
    const candidate = candidatesById.get(rawDecision.candidateId);
    if (!candidate) {
      throw new InvalidArgumentError(
        `classify: unknown decision candidateId ${rawDecision.candidateId}`,
      );
    }
    if (typeof rawDecision.verdict !== 'string' || !ALLOWED_VERDICTS.has(rawDecision.verdict)) {
      throw new InvalidArgumentError('classify: classifier decision verdict is invalid');
    }
    seen.add(rawDecision.candidateId);
    decisions.push(
      normalizeDecision(rawDecision as unknown as ClassifierCallbackDecision, candidate),
    );
  }

  for (const candidateId of candidatesById.keys()) {
    if (!seen.has(candidateId)) {
      throw new InvalidArgumentError(`classify: missing decision for ${candidateId}`);
    }
  }

  return { decisions };
};

export const classify = async (
  text: string,
  candidates: readonly DetectCandidate[],
  classifierCallback: ClassifierCallback,
  options: ClassifyOptions = {},
): Promise<ClassifyResult> => {
  if (typeof text !== 'string') throw new InvalidArgumentError('classify: text must be a string');
  if (!Array.isArray(candidates)) {
    throw new InvalidArgumentError('classify: candidates must be an array');
  }
  if (typeof classifierCallback !== 'function') {
    throw new InvalidArgumentError('classify: classifierCallback must be a function');
  }
  if (
    options.contextWindow !== undefined &&
    (!Number.isInteger(options.contextWindow) || options.contextWindow < 0)
  ) {
    throw new InvalidArgumentError('classify: contextWindow must be a non-negative integer');
  }

  const request = buildRequest(text, candidates, options);
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const result: ClassifierCallbackResult = await classifierCallback(request);
  return validateCallbackResult(result, candidatesById);
};
