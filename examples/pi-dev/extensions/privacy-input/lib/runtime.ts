import {
  classifierFailureDetailFromError,
  PrivacyInputClassifierError,
  type PrivacyInputClassifierFailureDetail,
} from './classifier-diagnostics.js';

export type PrivacyInputAction =
  | { readonly action: 'continue'; readonly details?: PrivacyInputSafeDetails }
  | {
      readonly action: 'transform';
      readonly text: string;
      readonly details?: PrivacyInputSafeDetails;
    }
  | { readonly action: 'handled'; readonly details?: PrivacyInputSafeDetails };

export interface PrivacyInputEventLike {
  readonly text: string;
  readonly source?: 'interactive' | 'rpc' | 'extension' | string;
}

export interface PrivacyInputSpanLike {
  readonly start: number;
  readonly end: number;
}

export interface PrivacyInputCandidateLike {
  readonly candidateId: string;
  readonly sourceSpan: PrivacyInputSpanLike;
  readonly kind?: string;
  readonly ruleId?: string;
  readonly valueLength?: number;
  readonly hint?: unknown;
}

export interface PrivacyInputDetectResultLike {
  readonly sourceSurface?: unknown;
  readonly candidates: readonly PrivacyInputCandidateLike[];
}

export interface PrivacyInputClassifierRequestCandidateLike {
  readonly candidateId: string;
  readonly marker: string;
  readonly kind?: string;
  readonly ruleId?: string;
  readonly sourceSpan?: PrivacyInputSpanLike;
  readonly valueLength?: number;
  readonly location?: unknown;
  readonly hint?: unknown;
}

export interface PrivacyInputClassifierRequestLike {
  readonly sanitizedContext: string;
  readonly candidates: readonly PrivacyInputClassifierRequestCandidateLike[];
}

export type PrivacyInputClassifierVerdict = 'secret' | 'not_secret' | 'uncertain';

export interface PrivacyInputClassifierCallbackResultLike {
  readonly decisions: readonly PrivacyInputClassifierCallbackDecisionLike[];
}

export interface PrivacyInputClassifierCallbackDecisionLike {
  readonly candidateId: string;
  readonly verdict: PrivacyInputClassifierVerdict;
  readonly type?: string;
  readonly label?: string;
  readonly confidence?: number;
  readonly rationale?: string;
}

export type PrivacyInputClassifierCallbackLike = (
  request: PrivacyInputClassifierRequestLike,
) => PrivacyInputClassifierCallbackResultLike | Promise<PrivacyInputClassifierCallbackResultLike>;

export interface PrivacyInputClassifyDecisionLike {
  readonly candidateId: string;
  readonly verdict: PrivacyInputClassifierVerdict;
  readonly sourceSpan: PrivacyInputSpanLike;
  readonly type?: string;
  readonly label?: string;
  readonly confidence?: number;
  readonly rationale?: string;
}

export interface PrivacyInputClassifyResultLike {
  readonly decisions: readonly PrivacyInputClassifyDecisionLike[];
}

export interface PrivacyInputConfirmedSecretLike {
  readonly candidateId?: string;
  readonly sourceSpan: PrivacyInputSpanLike;
  readonly type: string;
  readonly label?: string;
}

export interface PrivacyInputRedactionLike {
  readonly candidateId?: string;
  readonly sensitiveRef: string;
  readonly placeholder: string;
  readonly type: string;
  readonly label?: string;
  readonly redactedSpan: PrivacyInputSpanLike;
}

export interface PrivacyInputRedactResultLike {
  readonly text: string;
  readonly redactions: readonly PrivacyInputRedactionLike[];
}

export type PrivacyInputDetectLike = (
  text: string,
) => PrivacyInputDetectResultLike | Promise<PrivacyInputDetectResultLike>;

export type PrivacyInputClassifyLike = (
  text: string,
  candidates: readonly PrivacyInputCandidateLike[],
  classifierCallback: PrivacyInputClassifierCallbackLike,
) => Promise<PrivacyInputClassifyResultLike>;

export type PrivacyInputRedactLike = (
  text: string,
  confirmed: readonly PrivacyInputConfirmedSecretLike[],
  userId: string,
) => Promise<PrivacyInputRedactResultLike>;

export interface PrivacyInputNotificationSink {
  notify(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void;
}

export interface PrivacyInputPolicyConfig {
  readonly uncertainPolicy?: 'block' | 'redact' | 'allow';
}

export interface PrivacyInputSafeDecisionDetail {
  readonly candidateId: string;
  readonly verdict: PrivacyInputClassifierVerdict;
  readonly type?: string;
  readonly label?: string;
}

export interface PrivacyInputSafeRedactionDetail {
  readonly candidateId?: string;
  readonly sensitiveRef: string;
  readonly placeholder: string;
  readonly type: string;
  readonly label?: string;
  readonly redactedSpan: PrivacyInputSpanLike;
}

export interface PrivacyInputSafeDetails {
  readonly decisions: readonly PrivacyInputSafeDecisionDetail[];
  readonly redactions: readonly PrivacyInputSafeRedactionDetail[];
  readonly classifierFailure?: PrivacyInputClassifierFailureDetail;
}

export interface PrivacyInputRuntimeConfig {
  readonly detect: PrivacyInputDetectLike;
  readonly classify: PrivacyInputClassifyLike;
  readonly classifierCallback: PrivacyInputClassifierCallbackLike;
  readonly redact: PrivacyInputRedactLike;
  readonly policy?: PrivacyInputPolicyConfig;
  readonly userId: string | (() => string | Promise<string>);
  readonly notifications?: PrivacyInputNotificationSink;
  readonly classifierTimeoutMs?: number;
}

export interface PrivacyInputRuntimeLike {
  handleInput(event: PrivacyInputEventLike): Promise<PrivacyInputAction>;
  close(): void;
}

const resolveUserId = async (userId: PrivacyInputRuntimeConfig['userId']): Promise<string> =>
  typeof userId === 'function' ? userId() : userId;

const SAFE_DETAIL_LABEL = /^[A-Za-z0-9 _./:-]{1,80}$/u;

const safeDecisionLabel = (
  decision: PrivacyInputClassifyDecisionLike,
  sourceText: string,
): string | undefined => {
  if (decision.label === undefined) return undefined;
  const label = decision.label.trim().replace(/\s+/gu, ' ');
  if (!SAFE_DETAIL_LABEL.test(label)) return undefined;
  const rawValue = sourceText.slice(decision.sourceSpan.start, decision.sourceSpan.end);
  if (rawValue.length > 0 && (label.includes(rawValue) || rawValue.includes(label))) {
    return undefined;
  }
  return label;
};

const toSafeDetails = (
  decisions: readonly PrivacyInputClassifyDecisionLike[],
  redactions: readonly PrivacyInputRedactionLike[],
  sourceText: string,
): PrivacyInputSafeDetails => ({
  decisions: decisions.map((decision) => ({
    candidateId: decision.candidateId,
    verdict: decision.verdict,
    type: decision.type,
    label: safeDecisionLabel(decision, sourceText),
  })),
  redactions: redactions.map((redaction) => ({
    candidateId: redaction.candidateId,
    sensitiveRef: redaction.sensitiveRef,
    placeholder: redaction.placeholder,
    type: redaction.type,
    label: redaction.label,
    redactedSpan: redaction.redactedSpan,
  })),
});

const isRecordLike = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const isSpanLike = (value: unknown): value is PrivacyInputSpanLike =>
  typeof value === 'object' &&
  value !== null &&
  Number.isInteger((value as { readonly start?: unknown }).start) &&
  Number.isInteger((value as { readonly end?: unknown }).end);

const isCandidateLike = (value: unknown): value is PrivacyInputCandidateLike =>
  isRecordLike(value) &&
  typeof value.candidateId === 'string' &&
  isSpanLike(value.sourceSpan);

const isDetectResultLike = (value: unknown): value is PrivacyInputDetectResultLike =>
  isRecordLike(value) &&
  Array.isArray(value.candidates) &&
  value.candidates.every((candidate) => isCandidateLike(candidate));

const isClassifyResultLike = (value: unknown): value is PrivacyInputClassifyResultLike =>
  isRecordLike(value) && Array.isArray(value.decisions);

const isRedactResultLike = (value: unknown): value is PrivacyInputRedactResultLike =>
  isRecordLike(value) && typeof value.text === 'string' && Array.isArray(value.redactions);

const RUNTIME_CLASSIFIER_VERDICTS = new Set<PrivacyInputClassifierVerdict>([
  'secret',
  'not_secret',
  'uncertain',
]);

const hasSameSpan = (left: PrivacyInputSpanLike, right: PrivacyInputSpanLike): boolean =>
  left.start === right.start && left.end === right.end;

const includesKnownProviderPrefixSignal = (signals: unknown): boolean =>
  Array.isArray(signals) && signals.some((signal) => signal === 'known_provider_prefix');

const hintForCandidate = (candidate: PrivacyInputCandidateLike): Record<string, unknown> | undefined =>
  typeof candidate.hint === 'object' && candidate.hint !== null
    ? (candidate.hint as Record<string, unknown>)
    : undefined;

const isStrongProviderPrefixCandidate = (candidate: PrivacyInputCandidateLike): boolean => {
  const hint = hintForCandidate(candidate);
  return (
    candidate.kind === 'known_provider_prefix' ||
    includesKnownProviderPrefixSignal(hint?.signals) ||
    includesKnownProviderPrefixSignal(hint?.positiveSignals)
  );
};

const applyRuntimeProviderPrefixPolicy = (
  decision: PrivacyInputClassifyDecisionLike,
  candidate: PrivacyInputCandidateLike,
): PrivacyInputClassifyDecisionLike => {
  if (decision.verdict !== 'not_secret' || !isStrongProviderPrefixCandidate(candidate)) {
    return decision;
  }
  return {
    candidateId: decision.candidateId,
    verdict: 'uncertain',
    sourceSpan: decision.sourceSpan,
    type: decision.type ?? suggestedTypeFor([candidate], decision.candidateId),
    label: decision.label,
    confidence: decision.confidence,
    rationale: 'known provider prefix requires conservative handling',
  };
};

const validateAndNormalizeClassifiedDecisions = (
  decisions: readonly PrivacyInputClassifyDecisionLike[],
  candidates: readonly PrivacyInputCandidateLike[],
): readonly PrivacyInputClassifyDecisionLike[] | undefined => {
  const candidatesById = new Map<string, PrivacyInputCandidateLike>();
  for (const candidate of candidates) {
    if (candidatesById.has(candidate.candidateId)) return undefined;
    candidatesById.set(candidate.candidateId, candidate);
  }
  const seen = new Set<string>();
  const normalized: PrivacyInputClassifyDecisionLike[] = [];

  for (const rawDecision of decisions as readonly unknown[]) {
    if (typeof rawDecision !== 'object' || rawDecision === null) return undefined;
    const decision = rawDecision as Partial<PrivacyInputClassifyDecisionLike>;
    if (
      typeof decision.candidateId !== 'string' ||
      seen.has(decision.candidateId) ||
      !RUNTIME_CLASSIFIER_VERDICTS.has(decision.verdict as PrivacyInputClassifierVerdict)
    ) {
      return undefined;
    }
    const candidate = candidatesById.get(decision.candidateId);
    if (
      candidate === undefined ||
      !isSpanLike(decision.sourceSpan) ||
      !hasSameSpan(decision.sourceSpan, candidate.sourceSpan)
    ) {
      return undefined;
    }
    const validDecision: PrivacyInputClassifyDecisionLike = {
      candidateId: decision.candidateId,
      verdict: decision.verdict as PrivacyInputClassifierVerdict,
      sourceSpan: decision.sourceSpan,
      type: decision.type,
      label: decision.label,
      confidence: decision.confidence,
      rationale: decision.rationale,
    };
    seen.add(decision.candidateId);
    normalized.push(applyRuntimeProviderPrefixPolicy(validDecision, candidate));
  }

  return seen.size === candidatesById.size ? normalized : undefined;
};

const hasMalformedSecretDecision = (
  decisions: readonly PrivacyInputClassifyDecisionLike[],
): boolean =>
  decisions.some(
    (decision) =>
      decision.verdict === 'secret' &&
      (typeof decision.type !== 'string' || decision.type.length === 0),
  );

const suggestedTypeFor = (
  candidates: readonly PrivacyInputCandidateLike[],
  candidateId: string,
): string | undefined => {
  const hint = candidates.find((candidate) => candidate.candidateId === candidateId)?.hint;
  if (typeof hint !== 'object' || hint === null || !('suggestedType' in hint)) return undefined;
  const suggestedType = (hint as { readonly suggestedType?: unknown }).suggestedType;
  return typeof suggestedType === 'string' && suggestedType.length > 0 ? suggestedType : undefined;
};

const confirmedFromDecisions = (
  decisions: readonly PrivacyInputClassifyDecisionLike[],
  candidates: readonly PrivacyInputCandidateLike[],
  policy: PrivacyInputPolicyConfig,
): readonly PrivacyInputConfirmedSecretLike[] =>
  decisions
    .filter((decision) => {
      if (decision.verdict === 'secret') return true;
      return decision.verdict === 'uncertain' && policy.uncertainPolicy === 'redact';
    })
    .map((decision) => ({
      candidateId: decision.candidateId,
      sourceSpan: decision.sourceSpan,
      type: decision.type ?? suggestedTypeFor(candidates, decision.candidateId) ?? 'sensitive',
      label: decision.label,
    }));

export class PrivacyInputRuntime implements PrivacyInputRuntimeLike {
  private readonly detect: PrivacyInputDetectLike;
  private readonly classify: PrivacyInputClassifyLike;
  private readonly classifierCallback: PrivacyInputClassifierCallbackLike;
  private readonly redact: PrivacyInputRedactLike;
  private readonly policy: PrivacyInputPolicyConfig;
  private readonly userId: PrivacyInputRuntimeConfig['userId'];
  private readonly notifications?: PrivacyInputNotificationSink;
  private readonly classifierTimeoutMs: number | undefined;

  public constructor(config: PrivacyInputRuntimeConfig) {
    this.detect = config.detect;
    this.classify = config.classify;
    this.classifierCallback = config.classifierCallback;
    this.redact = config.redact;
    this.policy = { uncertainPolicy: config.policy?.uncertainPolicy ?? 'block' };
    this.userId = config.userId;
    this.notifications = config.notifications;
    this.classifierTimeoutMs = config.classifierTimeoutMs;
  }

  public async handleInput(event: PrivacyInputEventLike): Promise<PrivacyInputAction> {
    if (event.source === 'extension') return { action: 'continue' };

    let detected: PrivacyInputDetectResultLike;
    try {
      const detectResult = await this.detect(event.text);
      if (!isDetectResultLike(detectResult)) throw new Error('invalid detector result');
      detected = detectResult;
    } catch (error: unknown) {
      void error;
      this.notifications?.notify(
        'Pristine privacy input blocked this message because detection could not complete safely.',
        'error',
      );
      return { action: 'handled' };
    }
    if (detected.candidates.length === 0) return { action: 'continue' };

    let classified: PrivacyInputClassifyResultLike;
    try {
      const classifyPromise = this.classify(
        event.text,
        detected.candidates,
        this.classifierCallback,
      );
      if (this.classifierTimeoutMs === undefined) {
        const classifyResult = await classifyPromise;
        if (!isClassifyResultLike(classifyResult)) {
          throw new PrivacyInputClassifierError('invalid_response', 'invalid classifier result');
        }
        classified = classifyResult;
      } else {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const classifyResult = await Promise.race([
            classifyPromise,
            new Promise<PrivacyInputClassifyResultLike>((_resolve, reject) => {
              timeout = setTimeout(
                () => reject(new PrivacyInputClassifierError('timeout', 'classifier timed out')),
                this.classifierTimeoutMs,
              );
            }),
          ]);
          if (!isClassifyResultLike(classifyResult)) {
            throw new PrivacyInputClassifierError('invalid_response', 'invalid classifier result');
          }
          classified = classifyResult;
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
      }
    } catch (error: unknown) {
      const classifierFailure = classifierFailureDetailFromError(error);
      this.notifications?.notify(
        `Pristine privacy input blocked this message because classification could not complete safely (reason: ${classifierFailure.reasonCode}).`,
        'error',
      );
      return { action: 'handled', details: { decisions: [], redactions: [], classifierFailure } };
    }
    const normalizedDecisions = Array.isArray(classified.decisions)
      ? validateAndNormalizeClassifiedDecisions(classified.decisions, detected.candidates)
      : undefined;
    if (normalizedDecisions === undefined) {
      this.notifications?.notify(
        'Pristine privacy input blocked this message because classifier output did not match detected candidates safely.',
        'error',
      );
      return { action: 'handled', details: { decisions: [], redactions: [] } };
    }

    const detailsWithoutRedactions = toSafeDetails(normalizedDecisions, [], event.text);
    if (hasMalformedSecretDecision(normalizedDecisions)) {
      this.notifications?.notify(
        'Pristine privacy input blocked this message because classifier output for a confirmed value was incomplete.',
        'error',
      );
      return { action: 'handled', details: detailsWithoutRedactions };
    }

    if (
      normalizedDecisions.some((decision) => decision.verdict === 'uncertain') &&
      this.policy.uncertainPolicy === 'block'
    ) {
      this.notifications?.notify(
        'Pristine privacy input blocked this message because one or more sensitive candidates were uncertain.',
        'warning',
      );
      return { action: 'handled', details: detailsWithoutRedactions };
    }

    const confirmed = confirmedFromDecisions(
      normalizedDecisions,
      detected.candidates,
      this.policy,
    );
    if (confirmed.length === 0) {
      return { action: 'continue', details: detailsWithoutRedactions };
    }

    let redacted: PrivacyInputRedactResultLike;
    try {
      const userId = await resolveUserId(this.userId);
      const redactResult = await this.redact(event.text, confirmed, userId);
      if (!isRedactResultLike(redactResult)) throw new Error('invalid redactor result');
      redacted = redactResult;
    } catch (error: unknown) {
      void error;
      this.notifications?.notify(
        'Pristine privacy input blocked this message because local redaction could not complete.',
        'error',
      );
      return { action: 'handled', details: detailsWithoutRedactions };
    }
    const details = toSafeDetails(normalizedDecisions, redacted.redactions, event.text);
    this.notifications?.notify(
      `Pristine privacy input redacted ${redacted.redactions.length} confirmed value(s).`,
      'success',
    );
    return { action: 'transform', text: redacted.text, details };
  }

  public close(): void {
    // Runtime dependencies are injected and owned by the host.
  }
}

export const createPrivacyInputRuntime = (config: PrivacyInputRuntimeConfig): PrivacyInputRuntime =>
  new PrivacyInputRuntime(config);
