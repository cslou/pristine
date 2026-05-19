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

export interface PrivacyInputClassifierRequestLike {
  readonly sanitizedContext: string;
  readonly candidates: readonly { readonly candidateId: string; readonly marker: string }[];
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

const confirmedFromDecisions = (
  decisions: readonly PrivacyInputClassifyDecisionLike[],
): readonly PrivacyInputConfirmedSecretLike[] =>
  decisions
    .filter(
      (decision): decision is PrivacyInputClassifyDecisionLike & { readonly type: string } =>
        decision.verdict === 'secret' &&
        typeof decision.type === 'string' &&
        decision.type.length > 0,
    )
    .map((decision) => ({
      candidateId: decision.candidateId,
      sourceSpan: decision.sourceSpan,
      type: decision.type,
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

  public constructor(config: PrivacyInputRuntimeConfig) {
    this.detect = config.detect;
    this.classify = config.classify;
    this.classifierCallback = config.classifierCallback;
    this.redact = config.redact;
    this.policy = config.policy ?? { uncertainPolicy: 'block' };
    this.userId = config.userId;
    this.notifications = config.notifications;
  }

  public async handleInput(event: PrivacyInputEventLike): Promise<PrivacyInputAction> {
    if (event.source === 'extension') return { action: 'continue' };

    const detected = await this.detect(event.text);
    if (detected.candidates.length === 0) return { action: 'continue' };

    const classified = await this.classify(
      event.text,
      detected.candidates,
      this.classifierCallback,
    );
    const confirmed = confirmedFromDecisions(classified.decisions);
    if (confirmed.length === 0) {
      return { action: 'continue', details: toSafeDetails(classified.decisions, []) };
    }

    const userId = await resolveUserId(this.userId);
    void this.policy;
    const redacted = await this.redact(event.text, confirmed, userId);
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
