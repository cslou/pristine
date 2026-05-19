import { InvalidArgumentError } from '../../core/errors.js';
import type {
  DetectCandidate,
  DetectOptions,
  DetectResult,
  DetectorRule,
  DetectorRuleContext,
  DetectorRuleMatch,
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
      location: match.location ?? locationForOffset(text, match.sourceSpan.start),
      hint: match.hint ?? {},
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

const customRuleEnabled = (rule: DetectorRule, options: DetectOptions): boolean => {
  const disabledIds = new Set(options.disabledRuleIds ?? []);
  const enabledIds = options.enabledRuleIds ? new Set(options.enabledRuleIds) : null;
  return !disabledIds.has(rule.ruleId) && (!enabledIds || enabledIds.has(rule.ruleId));
};

export function detect(text: string, options: DetectOptions = {}): DetectResult {
  assertValidText(text);
  const context: DetectorRuleContext = {
    sourceSurface: options.sourceSurface,
    sensitivity: options.sensitivity ?? 'balanced',
  };
  const drafts: CandidateDraft[] = [];

  for (const rule of enabledBuiltInRules(BUILT_IN_RULES, options)) {
    addRuleCandidates(text, context, drafts, rule, (rule as BuiltInRule).priority);
  }

  for (const rule of options.customRules ?? []) {
    if (customRuleEnabled(rule, options)) addRuleCandidates(text, context, drafts, rule, 2);
  }

  const candidates = stripPriorityAndAssignIds(normalizeCandidates(drafts));
  return options.sourceSurface
    ? { sourceSurface: options.sourceSurface, candidates }
    : { candidates };
}
