import type {
  DetectHint,
  DetectOptions,
  DetectorRule,
  DetectorRuleContext,
  DetectorRuleMatch,
  SourceLocation,
  SourceSpan,
} from '../../core/types.js';

export type SensitivityRank = 0 | 1 | 2;

export type BuiltInRule = DetectorRule & {
  readonly minSensitivity: SensitivityRank;
  readonly priority: number;
};

interface RegexRuleConfig {
  readonly ruleId: string;
  readonly kind: BuiltInRule['kind'];
  readonly pattern: RegExp;
  readonly valueGroup?: number;
  readonly minSensitivity?: SensitivityRank;
  readonly priority?: number;
  readonly suggestedType?: string;
  readonly provider?: string;
  readonly prefixFamily?: string;
  readonly positiveSignals?: readonly string[];
  readonly negativeSignals?: readonly string[];
  readonly features?: DetectHint['features'];
  readonly nearbyNameGroup?: number;
  readonly validate?: (value: string) => boolean;
}

export interface CandidateDraft {
  readonly candidateId: string;
  readonly kind: BuiltInRule['kind'];
  readonly ruleId: string;
  readonly sourceSpan: SourceSpan;
  readonly valueLength: number;
  readonly location?: SourceLocation;
  readonly hint: DetectHint;
  readonly priority: number;
}

const cloneRegExp = (pattern: RegExp): RegExp => {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonObjectBase64Url = (value: string): boolean => {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    return isObjectRecord(JSON.parse(decoded) as unknown);
  } catch (error: unknown) {
    void error;
    return false;
  }
};

export const isJwt = (value: string): boolean => {
  const parts = value.split('.');
  return parts.length === 3 && isJsonObjectBase64Url(parts[0]!) && isJsonObjectBase64Url(parts[1]!);
};

const isPlaceholderLike = (value: string): boolean =>
  /(?:example|placeholder|changeme|replace[_-]?me|your[_-]?|xxxx|dummy|sample)/i.test(value);

const isCommitShaLike = (value: string): boolean => /^[0-9a-f]{40}$/i.test(value);

const isHexHashLike = (value: string): boolean => /^[0-9a-f]{32,128}$/i.test(value);

const isUuidLike = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isPackageVersionLike = (value: string): boolean =>
  /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);

const isPublicIdLike = (value: string): boolean =>
  /^(?:pub|public|pk)_[A-Za-z0-9_-]{8,}$/i.test(value) || /^sha256:[0-9a-f]{32,}$/i.test(value);

export const locationForOffset = (text: string, offset: number): SourceLocation => {
  let line = 1;
  let column = 1;

  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
};

const appendUnique = (target: string[], values: readonly string[] = []): void => {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
};

const contextWindow = (text: string, start: number, end: number): string =>
  `${text.slice(Math.max(0, start - 80), start)} ${text.slice(end, Math.min(text.length, end + 80))}`;

const inferContextSignals = (text: string, span: SourceSpan, value: string) => {
  const context = contextWindow(text, span.start, span.end);
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];

  if (/authorization\s*:\s*bearer/i.test(context)) positiveSignals.push('auth_header_context');
  if (/[?&](?:token|access_token|api_key|key|secret|signature|sig)=/i.test(context)) {
    positiveSignals.push('query_secret_param');
  }
  if (/[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:/i.test(context)) {
    positiveSignals.push('credential_url_context');
  }
  if (
    /(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|private[_-]?key)/i.test(context)
  ) {
    positiveSignals.push('sensitive_key_name');
  }

  if (isPlaceholderLike(value)) negativeSignals.push('looks_like_placeholder');
  if (isCommitShaLike(value)) negativeSignals.push('looks_like_commit_sha');
  if (isHexHashLike(value)) negativeSignals.push('looks_like_hash');
  if (isUuidLike(value)) negativeSignals.push('looks_like_uuid');
  if (isPackageVersionLike(value)) negativeSignals.push('looks_like_package_version');
  if (isPublicIdLike(value)) negativeSignals.push('looks_like_public_id');

  return { positiveSignals, negativeSignals };
};

const suggestedTypeForName = (
  name: string | undefined,
  fallback: string | undefined,
): string | undefined => {
  if (!name) return fallback;
  if (/private[_-]?key/i.test(name)) return 'private_key';
  if (/(?:api[_-]?key|access[_-]?key)/i.test(name)) return 'api_key';
  if (/(?:auth[_-]?token|access[_-]?token|token|session)/i.test(name)) return 'auth_token';
  if (/password/i.test(name)) return 'password';
  return fallback;
};

export const createRegexRule = (config: RegexRuleConfig): BuiltInRule => ({
  ruleId: config.ruleId,
  kind: config.kind,
  minSensitivity: config.minSensitivity ?? 1,
  priority: config.priority ?? 1,
  findCandidates(text: string, _context: DetectorRuleContext): readonly DetectorRuleMatch[] {
    const matches: DetectorRuleMatch[] = [];
    const regex = cloneRegExp(config.pattern);
    const valueGroup = config.valueGroup ?? 0;

    for (const match of text.matchAll(regex)) {
      const fullMatch = match[0];
      const value = match[valueGroup];
      const matchIndex = match.index;
      if (value === undefined || matchIndex === undefined || value.length === 0) continue;
      if (config.validate && !config.validate(value)) continue;

      const valueOffset = valueGroup === 0 ? 0 : fullMatch.indexOf(value);
      if (valueOffset < 0) continue;

      const sourceSpan = {
        start: matchIndex + valueOffset,
        end: matchIndex + valueOffset + value.length,
      };
      const nearbyName = config.nearbyNameGroup ? match[config.nearbyNameGroup] : undefined;
      const inferred = inferContextSignals(text, sourceSpan, value);
      const positiveSignals: string[] = [];
      const negativeSignals: string[] = [];
      appendUnique(positiveSignals, config.positiveSignals);
      appendUnique(positiveSignals, inferred.positiveSignals);
      appendUnique(negativeSignals, config.negativeSignals);
      appendUnique(negativeSignals, inferred.negativeSignals);
      if ((config.priority ?? 1) >= 3) appendUnique(positiveSignals, ['detector_confidence_high']);

      matches.push({
        sourceSpan,
        valueLength: value.length,
        location: locationForOffset(text, sourceSpan.start),
        hint: {
          suggestedType: suggestedTypeForName(nearbyName, config.suggestedType),
          provider: config.provider,
          prefixFamily: config.prefixFamily,
          nearbyName,
          signals: positiveSignals,
          positiveSignals,
          negativeSignals,
          features: config.features,
        },
      });
    }

    return matches;
  },
});

export const enabledBuiltInRules = (
  rules: readonly BuiltInRule[],
  options: DetectOptions,
): readonly BuiltInRule[] => {
  const sensitivity = options.sensitivity ?? 'balanced';
  const enabledIds = options.enabledRuleIds ? new Set(options.enabledRuleIds) : null;
  const disabledIds = new Set(options.disabledRuleIds ?? []);

  return rules.filter((rule) => {
    if (rule.ruleId === 'opaque.generated-looking-value' && sensitivity !== 'broad') return false;
    if (sensitivity === 'strict' && rule.kind === 'key_value_assignment') return false;
    if (sensitivity === 'strict' && rule.kind === 'cookie_or_session') return false;
    if (enabledIds && !enabledIds.has(rule.ruleId)) return false;
    return !disabledIds.has(rule.ruleId);
  });
};
