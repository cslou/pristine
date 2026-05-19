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
  SourceSpan,
} from '../../core/types.js';
import { buildSanitizedContext, markerForCandidate } from './sanitized-context.js';
import { sanitizeHint, sanitizeSourceSurface } from './sanitization.js';

const ALLOWED_VERDICTS = new Set(['secret', 'not_secret', 'uncertain']);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const assertValidSpan = (span: SourceSpan, textLength: number, label: string): void => {
  if (
    !Number.isInteger(span.start) ||
    !Number.isInteger(span.end) ||
    span.start < 0 ||
    span.end <= span.start ||
    span.end > textLength
  ) {
    throw new InvalidArgumentError(`classify: ${label} has an invalid sourceSpan`);
  }
};

const candidateHint = (candidate: DetectCandidate): DetectHint | undefined =>
  (candidate as { readonly hint?: DetectHint }).hint;

const buildRequest = (
  text: string,
  candidates: readonly DetectCandidate[],
  options: ClassifyOptions,
): {
  readonly request: ClassifierRequest;
  readonly candidatesByRequestId: ReadonlyMap<string, DetectCandidate>;
} => {
  const ids = new Set<string>();
  const requestCandidates: ClassifierRequestCandidate[] = [];
  const candidatesByRequestId = new Map<string, DetectCandidate>();

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
    const requestCandidateId = `request-candidate-${String(requestCandidates.length + 1).padStart(4, '0')}`;
    candidatesByRequestId.set(requestCandidateId, candidate);
    requestCandidates.push({
      candidateId: requestCandidateId,
      marker: markerForCandidate(requestCandidateId),
      kind: candidate.kind,
      ruleId: candidate.ruleId,
      sourceSpan: candidate.sourceSpan,
      valueLength: candidate.valueLength,
      location: candidate.location,
      hint: sanitizeHint(candidateHint(candidate), rawValue),
    });
  }

  const request = {
    requestId: options.requestId ?? randomUUID(),
    sourceSurface: sanitizeSourceSurface(options.sourceSurface),
    sanitizedContext: buildSanitizedContext(
      text,
      requestCandidates.map((requestCandidate, index) => ({
        ...candidates[index]!,
        candidateId: requestCandidate.candidateId,
      })),
      options.contextWindow,
    ),
    candidates: requestCandidates,
  };

  return { request, candidatesByRequestId };
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
    candidateId: candidate.candidateId,
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

  const { request, candidatesByRequestId } = buildRequest(text, candidates, options);
  const result: ClassifierCallbackResult = await classifierCallback(request);
  return validateCallbackResult(result, candidatesByRequestId);
};
