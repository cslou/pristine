import { InvalidArgumentError } from '../../core/errors.js';
import type {
  DetectCandidate,
  DetectHint,
  DetectOptions,
  DetectResult,
  DetectorRule,
  DetectorRuleContext,
  DetectorRuleMatch,
  PrivacyHintFeatureValue,
  SourceSpan,
} from '../../core/types.js';
import { BUILT_IN_RULES } from './rules.js';
import {
  enabledBuiltInRules,
  locationForOffset,
  type BuiltInRule,
  type CandidateDraft,
} from './rule-helpers.js';

const candidateQuality = (candidate: CandidateDraft): number => {
  const positive = candidate.hint.positiveSignals?.length ?? 0;
  const negative = candidate.hint.negativeSignals?.length ?? 0;
  return candidate.priority * 100 + positive * 10 - negative * 20 + candidate.valueLength / 1000;
};

const overlaps = (a: SourceSpan, b: SourceSpan): boolean => a.start < b.end && b.start < a.end;

const betterCandidate = (candidate: CandidateDraft, current: CandidateDraft): CandidateDraft => {
  const candidateQualityScore = candidateQuality(candidate);
  const currentQualityScore = candidateQuality(current);
  if (candidateQualityScore !== currentQualityScore) {
    return candidateQualityScore > currentQualityScore ? candidate : current;
  }
  if (candidate.valueLength !== current.valueLength) {
    return candidate.valueLength > current.valueLength ? candidate : current;
  }
  if (candidate.sourceSpan.start !== current.sourceSpan.start) {
    return candidate.sourceSpan.start < current.sourceSpan.start ? candidate : current;
  }
  return candidate.sourceSpan.end <= current.sourceSpan.end ? candidate : current;
};

const normalizeCandidates = (candidates: readonly CandidateDraft[]): CandidateDraft[] => {
  const sorted = [...candidates].sort(
    (a, b) => a.sourceSpan.start - b.sourceSpan.start || a.sourceSpan.end - b.sourceSpan.end,
  );
  const kept: CandidateDraft[] = [];

  for (const candidate of sorted) {
    const last = kept[kept.length - 1];
    if (!last || !overlaps(candidate.sourceSpan, last.sourceSpan)) {
      kept.push(candidate);
      continue;
    }
    kept[kept.length - 1] = betterCandidate(candidate, last);
  }

  return kept;
};

const assertValidText = (text: string): void => {
  if (typeof text !== 'string') {
    throw new InvalidArgumentError('detect: text must be a string');
  }
};

const assertValidSpan = (span: SourceSpan, textLength: number, ruleId: string): void => {
  if (
    !Number.isInteger(span.start) ||
    !Number.isInteger(span.end) ||
    span.start < 0 ||
    span.end <= span.start ||
    span.end > textLength
  ) {
    throw new InvalidArgumentError(
      `detect: detector rule ${ruleId} returned an invalid sourceSpan`,
    );
  }
};

const SAFE_PROVIDER_HINTS = new Set(['anthropic', 'aws', 'github', 'openai', 'sendgrid']);
const SAFE_PREFIX_FAMILY_HINTS = new Set(['AKIA', 'ghp_', 'sk-ant', 'sk-proj', 'SG.']);

const safeHintString = (value: string, rawValue: string): string | undefined => {
  if (value.length === 0) return undefined;
  if (value === rawValue || value.includes(rawValue) || rawValue.includes(value)) return undefined;
  return value;
};

const safeProvider = (value: string | undefined, rawValue: string): string | undefined => {
  if (!value) return undefined;
  return SAFE_PROVIDER_HINTS.has(value) ? value : safeHintString(value, rawValue);
};

const safePrefixFamily = (value: string | undefined, rawValue: string): string | undefined => {
  if (!value) return undefined;
  return SAFE_PREFIX_FAMILY_HINTS.has(value) ? value : safeHintString(value, rawValue);
};

const safeHintStringArray = (
  values: readonly string[],
  rawValue: string,
): readonly string[] | undefined => {
  const safeValues = values
    .map((value) => safeHintString(value, rawValue))
    .filter((value): value is string => value !== undefined);
  return safeValues.length > 0 ? safeValues : undefined;
};

const safeFeatureKey = (key: string, rawValue: string): string | undefined => {
  const safeKey = safeHintString(key, rawValue);
  return safeKey && /^[A-Za-z0-9_.:-]{1,80}$/.test(safeKey) ? safeKey : undefined;
};

const safeFeatureValue = (
  value: PrivacyHintFeatureValue,
  rawValue: string,
): PrivacyHintFeatureValue | undefined => {
  if (typeof value === 'string') return safeHintString(value, rawValue);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (!Array.isArray(value)) return undefined;
  if (value.every((item): item is string => typeof item === 'string')) {
    return safeHintStringArray(value, rawValue);
  }
  return undefined;
};

const sanitizeHint = (hint: DetectHint | undefined, rawValue: string): DetectHint => {
  if (!hint) return {};
  const features = hint.features
    ? Object.fromEntries(
        Object.entries(hint.features)
          .map(
            ([key, value]) =>
              [safeFeatureKey(key, rawValue), safeFeatureValue(value, rawValue)] as const,
          )
          .filter(
            (entry): entry is readonly [string, PrivacyHintFeatureValue] =>
              entry[0] !== undefined && entry[1] !== undefined,
          ),
      )
    : undefined;

  return {
    suggestedType: hint.suggestedType ? safeHintString(hint.suggestedType, rawValue) : undefined,
    provider: safeProvider(hint.provider, rawValue),
    prefixFamily: safePrefixFamily(hint.prefixFamily, rawValue),
    nearbyName: hint.nearbyName ? safeHintString(hint.nearbyName, rawValue) : undefined,
    signals: hint.signals ? safeHintStringArray(hint.signals, rawValue) : undefined,
    positiveSignals: hint.positiveSignals
      ? safeHintStringArray(hint.positiveSignals, rawValue)
      : undefined,
    negativeSignals: hint.negativeSignals
      ? safeHintStringArray(hint.negativeSignals, rawValue)
      : undefined,
    features: features && Object.keys(features).length > 0 ? features : undefined,
  };
};

const sanitizeLocation = (
  location: DetectorRuleMatch['location'] | undefined,
  text: string,
  sourceSpan: SourceSpan,
): DetectorRuleMatch['location'] => {
  if (
    location !== undefined &&
    Number.isInteger(location.line) &&
    Number.isInteger(location.column) &&
    location.line > 0 &&
    location.column > 0
  ) {
    return { line: location.line, column: location.column };
  }
  return locationForOffset(text, sourceSpan.start);
};

const toCandidateDrafts = (
  text: string,
  rule: DetectorRule,
  matches: readonly DetectorRuleMatch[],
  priority: number,
): CandidateDraft[] =>
  matches.map((match) => {
    assertValidSpan(match.sourceSpan, text.length, rule.ruleId);
    const valueLength =
      match.valueLength > 0 ? match.valueLength : match.sourceSpan.end - match.sourceSpan.start;
    return {
      candidateId: '',
      kind: rule.kind,
      ruleId: rule.ruleId,
      sourceSpan: match.sourceSpan,
      valueLength,
      location: sanitizeLocation(match.location, text, match.sourceSpan),
      hint: sanitizeHint(match.hint, text.slice(match.sourceSpan.start, match.sourceSpan.end)),
      priority,
    };
  });

const stripPriorityAndAssignIds = (candidates: readonly CandidateDraft[]): DetectCandidate[] =>
  candidates.map((candidate, index) => ({
    candidateId: `candidate-${String(index + 1).padStart(4, '0')}`,
    kind: candidate.kind,
    ruleId: candidate.ruleId,
    sourceSpan: candidate.sourceSpan,
    valueLength: candidate.valueLength,
    location: candidate.location,
    hint: candidate.hint,
  }));

const addRuleCandidates = (
  text: string,
  context: DetectorRuleContext,
  drafts: CandidateDraft[],
  rule: DetectorRule,
  priority: number,
): void => {
  drafts.push(...toCandidateDrafts(text, rule, rule.findCandidates(text, context), priority));
};

const customRuleEnabled = (
  rule: DetectorRule,
  enabledIds: ReadonlySet<string> | null,
  disabledIds: ReadonlySet<string>,
): boolean => !disabledIds.has(rule.ruleId) && (!enabledIds || enabledIds.has(rule.ruleId));

export function detect(text: string, options: DetectOptions = {}): DetectResult {
  assertValidText(text);
  const context: DetectorRuleContext = {
    sourceSurface: options.sourceSurface,
    sensitivity: options.sensitivity ?? 'balanced',
  };
  const drafts: CandidateDraft[] = [];
  const disabledIds = new Set(options.disabledRuleIds ?? []);
  const enabledIds = options.enabledRuleIds ? new Set(options.enabledRuleIds) : null;

  for (const rule of enabledBuiltInRules(BUILT_IN_RULES, options)) {
    addRuleCandidates(text, context, drafts, rule, (rule as BuiltInRule).priority);
  }

  for (const rule of options.customRules ?? []) {
    if (customRuleEnabled(rule, enabledIds, disabledIds)) {
      addRuleCandidates(text, context, drafts, rule, 2);
    }
  }

  const candidates = stripPriorityAndAssignIds(normalizeCandidates(drafts));
  return options.sourceSurface
    ? { sourceSurface: options.sourceSurface, candidates }
    : { candidates };
}
