export type PrivacyInputClassifierFailureReasonCode =
  | 'model_unavailable'
  | 'auth_unavailable'
  | 'timeout'
  | 'aborted'
  | 'malformed_json'
  | 'empty_response'
  | 'truncated_response'
  | 'missing_decision'
  | 'unknown_candidate_id'
  | 'duplicate_candidate_id'
  | 'invalid_response'
  | 'transport_error';

export interface PrivacyInputClassifierFailureDetail {
  readonly reasonCode: PrivacyInputClassifierFailureReasonCode;
}

export class PrivacyInputClassifierError extends Error {
  public readonly reasonCode: PrivacyInputClassifierFailureReasonCode;

  public constructor(reasonCode: PrivacyInputClassifierFailureReasonCode, message?: string) {
    super(`privacy-input classifier: ${message ?? reasonCode}`);
    this.name = 'PrivacyInputClassifierError';
    this.reasonCode = reasonCode;
  }
}

export const classifierFailureDetailFromError = (
  error: unknown,
): PrivacyInputClassifierFailureDetail => ({
  reasonCode: error instanceof PrivacyInputClassifierError ? error.reasonCode : 'transport_error',
});
