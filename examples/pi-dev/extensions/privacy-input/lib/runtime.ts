import {
  classifierFailureDetailFromError,
  PrivacyInputClassifierError,
} from './classifier-diagnostics.js';
import { PrivacyInputToolBoundaryController } from './tool-boundary.js';

import type {
  PrivacyInputAction,
  PrivacyInputCandidateLike,
  PrivacyInputClassifierCallbackLike,
  PrivacyInputClassifierVerdict,
  PrivacyInputClassifyDecisionLike,
  PrivacyInputClassifyLike,
  PrivacyInputClassifyResultLike,
  PrivacyInputConfirmedSecretLike,
  PrivacyInputDetectLike,
  PrivacyInputDetectResultLike,
  PrivacyInputEventLike,
  PrivacyInputNotificationSink,
  PrivacyInputPolicyConfig,
  PrivacyInputRedactLike,
  PrivacyInputRedactResultLike,
  PrivacyInputRedactionLike,
  PrivacyInputRuntimeConfig,
  PrivacyInputRuntimeLike,
  PrivacyInputSafeDetails,
  PrivacyInputSpanLike,
  PrivacyInputToolCallEventLike,
  PrivacyInputToolCallResultLike,
  PrivacyInputToolResultEventLike,
  PrivacyInputToolResultPatchLike,
} from './types.js';

export type {
  PrivacyInputAction,
  PrivacyInputCandidateLike,
  PrivacyInputClassifierCallbackDecisionLike,
  PrivacyInputClassifierCallbackLike,
  PrivacyInputClassifierCallbackResultLike,
  PrivacyInputClassifierRequestCandidateLike,
  PrivacyInputClassifierRequestLike,
  PrivacyInputClassifierVerdict,
  PrivacyInputClassifyDecisionLike,
  PrivacyInputClassifyLike,
  PrivacyInputClassifyResultLike,
  PrivacyInputConfirmedSecretLike,
  PrivacyInputDetectLike,
  PrivacyInputDetectResultLike,
  PrivacyInputEventLike,
  PrivacyInputNotificationSink,
  PrivacyInputPolicyConfig,
  PrivacyInputRedactLike,
  PrivacyInputRedactResultLike,
  PrivacyInputRedactionLike,
  PrivacyInputResolveSensitiveLike,
  PrivacyInputRuntimeConfig,
  PrivacyInputRuntimeLike,
  PrivacyInputSafeDecisionDetail,
  PrivacyInputSafeDetails,
  PrivacyInputSafeRedactionDetail,
  PrivacyInputSpanLike,
  PrivacyInputToolCallEventLike,
  PrivacyInputToolCallResultLike,
  PrivacyInputToolContentLike,
  PrivacyInputToolResultEventLike,
  PrivacyInputToolResultPatchLike,
  PrivacyInputToolRevealPolicyConfig,
} from './types.js';

const resolveUserId = async (userId: PrivacyInputRuntimeConfig['userId']): Promise<string> =>
  typeof userId === 'function' ? userId() : userId;

const PRIVACY_STATUS_KEY = 'pristine-privacy-input';

const SAFE_DETAIL_LABEL = /^[A-Za-z0-9 _./:-]{1,80}$/u;

const safeDecisionLabel = (
  decision: PrivacyInputClassifyDecisionLike,
  sourceText: string,
): string | undefined => {
  if (typeof decision.label !== 'string') return undefined;
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

const isRedactionLike = (value: unknown): value is PrivacyInputRedactionLike =>
  isRecordLike(value) &&
  (value.candidateId === undefined || typeof value.candidateId === 'string') &&
  typeof value.sensitiveRef === 'string' &&
  typeof value.placeholder === 'string' &&
  typeof value.type === 'string' &&
  (value.label === undefined || typeof value.label === 'string') &&
  isSpanLike(value.redactedSpan);

const isRedactResultLike = (value: unknown): value is PrivacyInputRedactResultLike =>
  isRecordLike(value) &&
  typeof value.text === 'string' &&
  Array.isArray(value.redactions) &&
  value.redactions.every((redaction) => isRedactionLike(redaction));

const coversConfirmedRedactions = (
  text: string,
  confirmed: readonly PrivacyInputConfirmedSecretLike[],
  redacted: PrivacyInputRedactResultLike,
): boolean => {
  if (redacted.redactions.length !== confirmed.length) return false;
  const redactionsByCandidateId = new Map(
    redacted.redactions
      .filter((redaction) => redaction.candidateId !== undefined)
      .map((redaction) => [redaction.candidateId, redaction]),
  );
  for (const secret of confirmed) {
    const rawValue = text.slice(secret.sourceSpan.start, secret.sourceSpan.end);
    if (rawValue.length > 0 && redacted.text.includes(rawValue)) return false;
    if (secret.candidateId !== undefined && !redactionsByCandidateId.has(secret.candidateId)) {
      return false;
    }
  }
  return true;
};

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
  private readonly toolBoundary: PrivacyInputToolBoundaryController;

  public constructor(config: PrivacyInputRuntimeConfig) {
    this.detect = config.detect;
    this.classify = config.classify;
    this.classifierCallback = config.classifierCallback;
    this.redact = config.redact;
    this.policy = { uncertainPolicy: config.policy?.uncertainPolicy ?? 'block' };
    this.userId = config.userId;
    this.notifications = config.notifications;
    this.classifierTimeoutMs = config.classifierTimeoutMs;
    this.toolBoundary = new PrivacyInputToolBoundaryController({
      resolveSensitive: config.resolveSensitive,
      policy: config.toolReveal,
      resolveUserId: () => resolveUserId(this.userId),
    });
  }

  public async handleInput(event: PrivacyInputEventLike): Promise<PrivacyInputAction> {
    if (event.source === 'extension') return { action: 'continue' };

    this.setStatus('Pristine: scanning input…');
    try {
      return await this.handleInputWithStatus(event);
    } finally {
      this.setStatus(undefined);
    }
  }

  private async handleInputWithStatus(event: PrivacyInputEventLike): Promise<PrivacyInputAction> {
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

    this.setStatus('Pristine: checking sensitive input…');
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

    this.setStatus('Pristine: redacting locally…');
    let redacted: PrivacyInputRedactResultLike;
    try {
      const userId = await resolveUserId(this.userId);
      const redactResult = await this.redact(event.text, confirmed, userId);
      if (!isRedactResultLike(redactResult) || !coversConfirmedRedactions(event.text, confirmed, redactResult)) {
        throw new Error('invalid redactor result');
      }
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

  private setStatus(text: string | undefined): void {
    try {
      this.notifications?.setStatus?.(PRIVACY_STATUS_KEY, text);
    } catch (error: unknown) {
      void error;
    }
  }

  public async handleToolCall(
    event: PrivacyInputToolCallEventLike,
  ): Promise<PrivacyInputToolCallResultLike | undefined> {
    return this.toolBoundary.handleToolCall(event);
  }

  public async handleToolResult(
    event: PrivacyInputToolResultEventLike,
  ): Promise<PrivacyInputToolResultPatchLike | undefined> {
    return this.toolBoundary.handleToolResult(event);
  }

  public close(): void {
    this.toolBoundary.close();
    // Runtime dependencies are injected and owned by the host.
  }
}

export const createPrivacyInputRuntime = (config: PrivacyInputRuntimeConfig): PrivacyInputRuntime =>
  new PrivacyInputRuntime(config);
