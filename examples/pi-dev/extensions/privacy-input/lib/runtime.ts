export type PrivacyInputAction =
  | { readonly action: 'continue' }
  | { readonly action: 'transform'; readonly text: string }
  | { readonly action: 'handled' };

export interface PrivacyInputEventLike {
  readonly text: string;
  readonly source?: 'interactive' | 'rpc' | 'extension' | string;
}

export interface PrivacyInputCandidateLike {
  readonly candidateId: string;
  readonly sourceSpan: { readonly start: number; readonly end: number };
  readonly kind?: string;
  readonly ruleId?: string;
  readonly valueLength?: number;
  readonly hint?: unknown;
}

export interface PrivacyInputDetectResultLike {
  readonly candidates: readonly PrivacyInputCandidateLike[];
}

export interface PrivacyInputClassifierLike {
  classify(text: string, candidates: readonly PrivacyInputCandidateLike[]): Promise<unknown>;
}

export interface PrivacyInputRedactorLike {
  redact(text: string, confirmed: readonly unknown[], userId: string): Promise<unknown>;
}

export interface PrivacyInputNotificationSink {
  notify(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void;
}

export interface PrivacyInputPolicyConfig {
  readonly uncertainPolicy?: 'block' | 'redact' | 'allow';
}

export interface PrivacyInputRuntimeConfig {
  readonly detect: (
    text: string,
  ) => PrivacyInputDetectResultLike | Promise<PrivacyInputDetectResultLike>;
  readonly classifier: PrivacyInputClassifierLike;
  readonly redactor: PrivacyInputRedactorLike;
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

export class PrivacyInputRuntime implements PrivacyInputRuntimeLike {
  private readonly detect: PrivacyInputRuntimeConfig['detect'];
  private readonly classifier: PrivacyInputClassifierLike;
  private readonly redactor: PrivacyInputRedactorLike;
  private readonly policy: PrivacyInputPolicyConfig;
  private readonly userId: PrivacyInputRuntimeConfig['userId'];
  private readonly notifications?: PrivacyInputNotificationSink;

  public constructor(config: PrivacyInputRuntimeConfig) {
    this.detect = config.detect;
    this.classifier = config.classifier;
    this.redactor = config.redactor;
    this.policy = config.policy ?? { uncertainPolicy: 'block' };
    this.userId = config.userId;
    this.notifications = config.notifications;
  }

  public async handleInput(event: PrivacyInputEventLike): Promise<PrivacyInputAction> {
    if (event.source === 'extension') return { action: 'continue' };

    const detected = await this.detect(event.text);
    if (detected.candidates.length === 0) return { action: 'continue' };

    await resolveUserId(this.userId);
    void this.classifier;
    void this.redactor;
    void this.policy;
    this.notifications?.notify(
      'Pristine privacy input blocked this message before model context because sensitive candidates were detected but redaction is not configured yet.',
      'warning',
    );
    return { action: 'handled' };
  }

  public close(): void {
    // Runtime dependencies are injected and owned by the host.
  }
}

export const createPrivacyInputRuntime = (config: PrivacyInputRuntimeConfig): PrivacyInputRuntime =>
  new PrivacyInputRuntime(config);
