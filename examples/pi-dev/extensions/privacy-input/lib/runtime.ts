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

const toSafeDetails = (
  decisions: readonly PrivacyInputClassifyDecisionLike[],
  redactions: readonly PrivacyInputRedactionLike[],
): PrivacyInputSafeDetails => ({
  decisions: decisions.map((decision) => ({
    candidateId: decision.candidateId,
    verdict: decision.verdict,
    type: decision.type,
    label: decision.label,
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

    const detected = await this.detect(event.text);
    if (detected.candidates.length === 0) return { action: 'continue' };

    let classified: PrivacyInputClassifyResultLike;
    try {
      const classifyPromise = this.classify(
        event.text,
        detected.candidates,
        this.classifierCallback,
      );
      if (this.classifierTimeoutMs === undefined) {
        classified = await classifyPromise;
      } else {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          classified = await Promise.race([
            classifyPromise,
            new Promise<PrivacyInputClassifyResultLike>((_resolve, reject) => {
              timeout = setTimeout(
                () => reject(new Error('classifier timed out')),
                this.classifierTimeoutMs,
              );
            }),
          ]);
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
      }
    } catch (error: unknown) {
      void error;
      this.notifications?.notify(
        'Pristine privacy input blocked this message because classification could not complete safely.',
        'error',
      );
      return { action: 'handled' };
    }
    const detailsWithoutRedactions = toSafeDetails(classified.decisions, []);
    if (hasMalformedSecretDecision(classified.decisions)) {
      this.notifications?.notify(
        'Pristine privacy input blocked this message because classifier output for a confirmed value was incomplete.',
        'error',
      );
      return { action: 'handled', details: detailsWithoutRedactions };
    }

    if (
      classified.decisions.some((decision) => decision.verdict === 'uncertain') &&
      this.policy.uncertainPolicy === 'block'
    ) {
      this.notifications?.notify(
        'Pristine privacy input blocked this message because one or more sensitive candidates were uncertain.',
        'warning',
      );
      return { action: 'handled', details: detailsWithoutRedactions };
    }

    const confirmed = confirmedFromDecisions(
      classified.decisions,
      detected.candidates,
      this.policy,
    );
    if (confirmed.length === 0) {
      return { action: 'continue', details: detailsWithoutRedactions };
    }

    let redacted: PrivacyInputRedactResultLike;
    try {
      const userId = await resolveUserId(this.userId);
      redacted = await this.redact(event.text, confirmed, userId);
    } catch (error: unknown) {
      void error;
      this.notifications?.notify(
        'Pristine privacy input blocked this message because local redaction could not complete.',
        'error',
      );
      return { action: 'handled', details: detailsWithoutRedactions };
    }
    const details = toSafeDetails(classified.decisions, redacted.redactions);
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
