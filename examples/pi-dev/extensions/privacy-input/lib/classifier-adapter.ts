import type {
  PrivacyInputClassifierCallbackDecisionLike,
  PrivacyInputClassifierCallbackResultLike,
  PrivacyInputClassifierRequestLike,
  PrivacyInputClassifierVerdict,
} from './runtime.js';

export class PrivacyInputClassifierError extends Error {
  public constructor(message: string) {
    super(`privacy-input classifier: ${message}`);
    this.name = 'PrivacyInputClassifierError';
  }
}

export interface PrivacyInputClassifierTask {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly allowedCandidateIds: readonly string[];
}

const ALLOWED_VERDICTS = new Set<PrivacyInputClassifierVerdict>([
  'secret',
  'not_secret',
  'uncertain',
]);

const SAFE_LABEL = /^[A-Za-z0-9 _./:-]{1,80}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeString = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : undefined;

const safeSignalArray = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const safeValues = value.filter(
    (item): item is string => typeof item === 'string' && /^[a-z0-9_:-]{1,80}$/.test(item),
  );
  return safeValues.length > 0 ? safeValues : undefined;
};

const sanitizeLocation = (
  location: unknown,
): { readonly line: number; readonly column: number } | undefined => {
  if (!isRecord(location)) return undefined;
  return typeof location.line === 'number' && typeof location.column === 'number'
    ? { line: location.line, column: location.column }
    : undefined;
};

const sanitizeHint = (hint: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(hint)) return undefined;
  const sanitized = {
    suggestedType: safeString(hint.suggestedType),
    provider: safeString(hint.provider),
    prefixFamily: safeString(hint.prefixFamily),
    nearbyName: safeString(hint.nearbyName),
    signals: safeSignalArray(hint.signals),
    positiveSignals: safeSignalArray(hint.positiveSignals),
    negativeSignals: safeSignalArray(hint.negativeSignals),
  };
  return Object.fromEntries(Object.entries(sanitized).filter((entry) => entry[1] !== undefined));
};

export const sanitizeClassifierLabel = (label: string | undefined): string | undefined => {
  if (label === undefined) return undefined;
  if (/\p{C}/u.test(label)) {
    throw new PrivacyInputClassifierError('classifier label contains unsafe characters');
  }
  const normalized = label.trim().replace(/\s+/g, ' ');
  if (!SAFE_LABEL.test(normalized)) {
    throw new PrivacyInputClassifierError('classifier label contains unsafe characters');
  }
  return normalized;
};

export const buildPrivacyInputClassifierTask = (
  request: PrivacyInputClassifierRequestLike,
): PrivacyInputClassifierTask => {
  const payload = {
    sanitizedContext: request.sanitizedContext,
    candidates: request.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      marker: candidate.marker,
      kind: candidate.kind,
      ruleId: candidate.ruleId,
      sourceSpan: candidate.sourceSpan,
      valueLength: candidate.valueLength,
      location: sanitizeLocation(candidate.location),
      hint: sanitizeHint(candidate.hint),
    })),
  };

  return {
    systemPrompt:
      'Classify Pristine privacy candidates. You receive sanitized context only. Return strict JSON with decisions: candidateId, verdict, type for secret verdicts, optional label, confidence, and rationale. Do not ask for or infer raw secret values.',
    userPrompt: JSON.stringify(payload, null, 2),
    allowedCandidateIds: request.candidates.map((candidate) => candidate.candidateId),
  };
};

const parseJsonObject = (responseText: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(responseText) as unknown;
    if (!isRecord(parsed)) throw new PrivacyInputClassifierError('response must be a JSON object');
    return parsed;
  } catch (error: unknown) {
    if (error instanceof PrivacyInputClassifierError) throw error;
    throw new PrivacyInputClassifierError('response is not valid JSON');
  }
};

export const parsePrivacyInputClassifierResponse = (
  responseText: string,
  allowedCandidateIds: readonly string[],
): PrivacyInputClassifierCallbackResultLike => {
  const response = parseJsonObject(responseText);
  const rawDecisions = response.decisions;
  if (!Array.isArray(rawDecisions)) {
    throw new PrivacyInputClassifierError('response.decisions must be an array');
  }

  const allowedIds = new Set(allowedCandidateIds);
  const seenIds = new Set<string>();
  const decisions: PrivacyInputClassifierCallbackDecisionLike[] = rawDecisions.map((raw) => {
    if (!isRecord(raw)) throw new PrivacyInputClassifierError('decision must be an object');
    const candidateId = raw.candidateId;
    if (typeof candidateId !== 'string' || candidateId.length === 0) {
      throw new PrivacyInputClassifierError('decision candidateId must be a non-empty string');
    }
    if (!allowedIds.has(candidateId)) {
      throw new PrivacyInputClassifierError(`unknown candidateId ${candidateId}`);
    }
    if (seenIds.has(candidateId)) {
      throw new PrivacyInputClassifierError(`duplicate candidateId ${candidateId}`);
    }
    seenIds.add(candidateId);

    const verdict = raw.verdict;
    if (
      typeof verdict !== 'string' ||
      !ALLOWED_VERDICTS.has(verdict as PrivacyInputClassifierVerdict)
    ) {
      throw new PrivacyInputClassifierError('decision verdict is invalid');
    }

    const type =
      typeof raw.type === 'string' && raw.type.trim().length > 0 ? raw.type.trim() : undefined;
    if (verdict === 'secret' && type === undefined) {
      throw new PrivacyInputClassifierError('secret decision requires type');
    }

    const confidence = raw.confidence;
    if (
      confidence !== undefined &&
      (typeof confidence !== 'number' || confidence < 0 || confidence > 1)
    ) {
      throw new PrivacyInputClassifierError('decision confidence must be between 0 and 1');
    }

    if (raw.label !== undefined && typeof raw.label !== 'string') {
      throw new PrivacyInputClassifierError('decision label must be a string');
    }
    const label = sanitizeClassifierLabel(raw.label);
    const rationale = typeof raw.rationale === 'string' ? raw.rationale : undefined;
    return {
      candidateId,
      verdict: verdict as PrivacyInputClassifierVerdict,
      type,
      label,
      confidence,
      rationale,
    };
  });

  if (seenIds.size !== allowedIds.size) {
    throw new PrivacyInputClassifierError('response is missing candidate decisions');
  }

  return { decisions };
};

export interface PrivacyInputClassifierTransport {
  classify(task: PrivacyInputClassifierTask): Promise<string>;
}

export const createPrivacyInputClassifierCallback =
  (transport: PrivacyInputClassifierTransport) =>
  async (
    request: PrivacyInputClassifierRequestLike,
  ): Promise<PrivacyInputClassifierCallbackResultLike> => {
    const task = buildPrivacyInputClassifierTask(request);
    const responseText = await transport.classify(task);
    return parsePrivacyInputClassifierResponse(responseText, task.allowedCandidateIds);
  };
