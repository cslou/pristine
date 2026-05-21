import type { PrivacyInputClassifierFailureDetail } from './classifier-diagnostics.js';

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

export type PrivacyInputResolveSensitiveLike = (
  sensitiveRef: string,
  userId: string,
) => string | Promise<string>;

export interface PrivacyInputTextContentLike {
  readonly type: 'text';
  readonly text: string;
  readonly [key: string]: unknown;
}

export interface PrivacyInputImageContentLike {
  readonly type: 'image';
  readonly [key: string]: unknown;
}

export type PrivacyInputToolContentLike =
  | PrivacyInputTextContentLike
  | PrivacyInputImageContentLike
  | Readonly<Record<string, unknown>>;

export interface PrivacyInputToolCallEventLike {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
}

export interface PrivacyInputToolResultEventLike {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly content: readonly PrivacyInputToolContentLike[];
  readonly details?: unknown;
  readonly isError: boolean;
}

export interface PrivacyInputToolCallResultLike {
  readonly block?: true;
  readonly reason?: string;
}

export interface PrivacyInputToolResultPatchLike {
  readonly content?: readonly PrivacyInputToolContentLike[];
  readonly details?: unknown;
  readonly isError?: boolean;
}

export interface PrivacyInputToolRevealPolicyConfig {
  readonly enabled?: boolean;
  readonly revealBashCommand?: boolean;
}

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
  readonly resolveSensitive?: PrivacyInputResolveSensitiveLike;
  readonly policy?: PrivacyInputPolicyConfig;
  readonly userId: string | (() => string | Promise<string>);
  readonly notifications?: PrivacyInputNotificationSink;
  readonly classifierTimeoutMs?: number;
  readonly toolReveal?: PrivacyInputToolRevealPolicyConfig;
}

export interface PrivacyInputRuntimeLike {
  handleInput(event: PrivacyInputEventLike): Promise<PrivacyInputAction>;
  handleToolCall?(event: PrivacyInputToolCallEventLike): Promise<PrivacyInputToolCallResultLike | undefined>;
  handleToolResult?(
    event: PrivacyInputToolResultEventLike,
  ): Promise<PrivacyInputToolResultPatchLike | undefined>;
  close(): void;
}
