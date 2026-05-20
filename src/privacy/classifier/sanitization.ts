import type {
  DetectHint,
  PrivacyHintFeatureValue,
  SourceLocation,
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
const SAFE_FEATURE_KEYS = new Set([
  'entropyBucket',
  'hasAssignmentContext',
  'headerName',
  'tokenFormat',
]);
const SAFE_FEATURE_STRINGS = new Set(['authorization', 'high', 'jwt', 'low', 'medium', 'paseto']);
const SAFE_NEARBY_NAMES = new Set(['API_KEY', 'AUTHORIZATION', 'PASSWORD', 'SECRET', 'TOKEN']);
const SAFE_SOURCE_SURFACE_KIND = /^[a-z][a-z0-9_-]{0,63}$/u;
const SAFE_CANDIDATE_KINDS = new Set([
  'auth_header',
  'cloud_credential_block',
  'cookie_or_session',
  'credential_url',
  'key_value_assignment',
  'known_provider_prefix',
  'opaque_generated_value',
  'private_key_block',
  'recovery_or_seed_phrase',
  'signed_url_or_query_secret',
  'structured_token',
]);
const SAFE_RULE_IDS = new Set([
  'assignment.secret',
  'assignment.sensitive-key',
  'cloud.aws-secret-access-key',
  'cookie.session-token',
  'header.authorization-bearer',
  'opaque.generated-looking-value',
  'private-key.pem-block',
  'private-key.pgp-block',
  'provider.anthropic-key',
  'provider.aws-access-key-id',
  'provider.github-token',
  'provider.openai-project-key',
  'provider.sendgrid-key',
  'query.signed-url-secret',
  'seed.recovery-phrase',
  'structured.jwt',
  'structured.paseto',
  'url.credential-password',
]);

const isRawDerived = (value: string, rawValue: string): boolean =>
  value.length === 0 || value === rawValue || value.includes(rawValue) || rawValue.includes(value);

const safeAllowlistedString = (
  value: string | undefined,
  allowlist: ReadonlySet<string>,
): string | undefined => {
  if (!value || value.length === 0) return undefined;
  return allowlist.has(value) ? value : undefined;
};

const safeNearbyName = (value: string | undefined, rawValue: string): string | undefined => {
  if (!value || isRawDerived(value, rawValue)) return undefined;
  return SAFE_NEARBY_NAMES.has(value) ? value : undefined;
};

const safeSignalArray = (values: readonly string[] | undefined): readonly string[] | undefined => {
  if (!values) return undefined;
  const safeValues = values.filter((value) => SAFE_SIGNALS.has(value));
  return safeValues.length > 0 ? safeValues : undefined;
};

const safeFeatureValue = (
  key: string,
  value: PrivacyHintFeatureValue,
): PrivacyHintFeatureValue | undefined => {
  switch (key) {
    case 'hasAssignmentContext':
      return typeof value === 'boolean' ? value : undefined;
    case 'entropyBucket':
      return typeof value === 'string' && ['low', 'medium', 'high'].includes(value)
        ? value
        : undefined;
    case 'headerName':
      return value === 'authorization' ? value : undefined;
    case 'tokenFormat':
      return typeof value === 'string' && SAFE_FEATURE_STRINGS.has(value) ? value : undefined;
    default:
      return undefined;
  }
};

export const sanitizeHint = (hint: DetectHint | undefined, rawValue: string): DetectHint => {
  const safeHint = hint ?? {};
  const features = safeHint.features
    ? Object.fromEntries(
        Object.entries(safeHint.features)
          .filter(([key]) => SAFE_FEATURE_KEYS.has(key))
          .map(([key, value]) => [key, safeFeatureValue(key, value)] as const)
          .filter(
            (entry): entry is readonly [string, PrivacyHintFeatureValue] => entry[1] !== undefined,
          ),
      )
    : undefined;

  return {
    suggestedType: safeAllowlistedString(safeHint.suggestedType, SAFE_SUGGESTED_TYPES),
    provider: safeAllowlistedString(safeHint.provider, SAFE_PROVIDER_HINTS),
    prefixFamily: safeAllowlistedString(safeHint.prefixFamily, SAFE_PREFIX_FAMILY_HINTS),
    nearbyName: safeNearbyName(safeHint.nearbyName, rawValue),
    signals: safeSignalArray(safeHint.signals),
    positiveSignals: safeSignalArray(safeHint.positiveSignals),
    negativeSignals: safeSignalArray(safeHint.negativeSignals),
    features: features && Object.keys(features).length > 0 ? features : undefined,
  };
};

export const sanitizeCandidateKind = (
  kind: string | undefined,
  _rawValue: string,
): string | undefined => (kind !== undefined && SAFE_CANDIDATE_KINDS.has(kind) ? kind : undefined);

export const sanitizeCandidateRuleId = (
  ruleId: string | undefined,
  _rawValue: string,
): string | undefined => (ruleId !== undefined && SAFE_RULE_IDS.has(ruleId) ? ruleId : undefined);

export const sanitizeCandidateLocation = (
  location: SourceLocation | undefined,
): SourceLocation | undefined => {
  if (!location) return undefined;
  return Number.isInteger(location.line) &&
    Number.isInteger(location.column) &&
    location.line > 0 &&
    location.column > 0
    ? { line: location.line, column: location.column }
    : undefined;
};

export const sanitizeSourceSurface = (
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
