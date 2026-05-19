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
  SourceSurface,
} from '../../core/types.js';

const SAFE_PROVIDER_HINTS = new Set(['anthropic', 'aws', 'github', 'openai', 'sendgrid']);
const SAFE_PREFIX_FAMILY_HINTS = new Set(['AKIA', 'ghp_', 'sk-ant', 'sk-proj', 'SG.']);
const SAFE_SUGGESTED_TYPES = new Set([
  'api_key',
  'auth_token',
  'password',
  'private_key',
  'recovery_phrase',
  'secret',
]);
const SAFE_SIGNALS = new Set([
  'auth_header_context',
  'cloud_credential_block',
  'cookie_context',
  'credential_url_context',
  'detector_confidence_high',
  'known_provider_prefix',
  'looks_like_commit_sha',
  'looks_like_hash',
  'looks_like_package_version',
  'looks_like_placeholder',
  'looks_like_public_id',
  'looks_like_uuid',
  'opaque_generated_value',
  'private_key_block',
  'query_secret_param',
  'recovery_phrase_context',
  'sensitive_key_name',
  'structured_token',
]);
const SAFE_FEATURE_STRINGS = new Set(['authorization', 'high', 'jwt', 'low', 'medium', 'paseto']);
const SAFE_NEARBY_NAME = /^[A-Z][A-Z0-9_]{0,63}$/u;
const SAFE_SOURCE_SURFACE_KIND = /^[a-z][a-z0-9_-]{0,63}$/u;
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

const isRawDerived = (value: string, rawValue: string): boolean =>
  value.length === 0 || value === rawValue || value.includes(rawValue) || rawValue.includes(value);

const safeAllowlistedString = (
  value: string | undefined,
  _rawValue: string,
  allowlist: ReadonlySet<string>,
): string | undefined => {
  if (!value || value.length === 0) return undefined;
  return allowlist.has(value) ? value : undefined;
};

const safeNearbyName = (value: string | undefined, rawValue: string): string | undefined => {
  if (!value || isRawDerived(value, rawValue)) return undefined;
  return SAFE_NEARBY_NAME.test(value) ? value : undefined;
};

const safeSignalArray = (values: readonly string[] | undefined): readonly string[] | undefined => {
  if (!values) return undefined;
  const safeValues = values.filter((value) => SAFE_SIGNALS.has(value));
  return safeValues.length > 0 ? safeValues : undefined;
};

const safeFeatureValue = (value: PrivacyHintFeatureValue): PrivacyHintFeatureValue | undefined => {
  if (typeof value === 'string') return SAFE_FEATURE_STRINGS.has(value) ? value : undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value.every((item): item is string => typeof item === 'string')) {
    const safeValues = value.filter((item) => SAFE_FEATURE_STRINGS.has(item));
    return safeValues.length > 0 ? safeValues : undefined;
  }
  return value.length > 0 ? value : undefined;
};

const sanitizeHint = (hint: DetectHint | undefined, rawValue: string): DetectHint => {
  const safeHint = hint ?? {};
  const features = safeHint.features
    ? Object.fromEntries(
        Object.entries(safeHint.features)
          .map(([key, value]) => [key, safeFeatureValue(value)] as const)
          .filter(
            (entry): entry is readonly [string, PrivacyHintFeatureValue] => entry[1] !== undefined,
          ),
      )
    : undefined;

  return {
    suggestedType: safeAllowlistedString(safeHint.suggestedType, rawValue, SAFE_SUGGESTED_TYPES),
    provider: safeAllowlistedString(safeHint.provider, rawValue, SAFE_PROVIDER_HINTS),
    prefixFamily: safeAllowlistedString(safeHint.prefixFamily, rawValue, SAFE_PREFIX_FAMILY_HINTS),
    nearbyName: safeNearbyName(safeHint.nearbyName, rawValue),
    signals: safeSignalArray(safeHint.signals),
    positiveSignals: safeSignalArray(safeHint.positiveSignals),
    negativeSignals: safeSignalArray(safeHint.negativeSignals),
    features: features && Object.keys(features).length > 0 ? features : undefined,
  };
};

const sanitizeSourceSurface = (
  sourceSurface: SourceSurface | undefined,
): SourceSurface | undefined => {
  if (!sourceSurface) return undefined;
  return {
    kind:
      sourceSurface.kind && SAFE_SOURCE_SURFACE_KIND.test(sourceSurface.kind)
        ? sourceSurface.kind
        : undefined,
    lineNumber: sourceSurface.lineNumber,
  };
};

const getContextBounds = (
  textLength: number,
  candidates: readonly DetectCandidate[],
  contextWindow: number | undefined,
): SourceSpan => {
  if (contextWindow === undefined) return { start: 0, end: textLength };
  const firstStart = Math.min(...candidates.map((candidate) => candidate.sourceSpan.start));
  const lastEnd = Math.max(...candidates.map((candidate) => candidate.sourceSpan.end));
  return {
    start: Math.max(0, firstStart - contextWindow),
    end: Math.min(textLength, lastEnd + contextWindow),
  };
};

const buildSanitizedContext = (
  text: string,
  candidates: readonly DetectCandidate[],
  contextWindow: number | undefined,
): string => {
  const ordered = [...candidates].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start);
  const bounds = getContextBounds(text.length, ordered, contextWindow);
  let cursor = bounds.start;
  const parts: string[] = [];

  for (const candidate of ordered) {
    if (candidate.sourceSpan.start < cursor && candidate.sourceSpan.start >= bounds.start) {
      throw new InvalidArgumentError('classify: candidate sourceSpans must not overlap');
    }
    if (candidate.sourceSpan.end <= bounds.start || candidate.sourceSpan.start >= bounds.end) {
      continue;
    }
    parts.push(text.slice(cursor, candidate.sourceSpan.start));
    parts.push(markerForCandidate(candidate.candidateId));
    cursor = candidate.sourceSpan.end;
  }

  parts.push(text.slice(cursor, bounds.end));
  return parts.join('');
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
      hint: sanitizeHint((candidate as { readonly hint?: DetectHint }).hint, rawValue),
    });
  }

  return {
    requestId: options.requestId ?? randomUUID(),
    sourceSurface: sanitizeSourceSurface(options.sourceSurface),
    sanitizedContext: buildSanitizedContext(text, candidates, options.contextWindow),
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

  if (candidates.length === 0) return { decisions: [] };

  const request = buildRequest(text, candidates, options);
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const result: ClassifierCallbackResult = await classifierCallback(request);
  return validateCallbackResult(result, candidatesById);
};
