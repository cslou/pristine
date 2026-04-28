import type { DetectedEntity } from '../core/types.js';
import { DETERMINISTIC_PATTERN_RULES } from './classifier/deterministic/rules.js';
import type { DeterministicPatternRule } from './classifier/deterministic/rules.js';
import { scanTextWithRules } from './classifier/deterministic/scanner.js';

export const PLACEHOLDER_RE = /\[SENSITIVE:[^\]]+\]/g;

export const replacePlaceholdersWithWhitespace = (text: string): string => {
  return text.replace(PLACEHOLDER_RE, (match) => ' '.repeat(match.length));
};

export const stripSensitivePlaceholders = (text: string): string =>
  text.replace(PLACEHOLDER_RE, '');

export const findSafetyViolations = (
  text: string,
  rules: readonly DeterministicPatternRule[] = DETERMINISTIC_PATTERN_RULES,
): readonly DetectedEntity[] => {
  const scanText = replacePlaceholdersWithWhitespace(text);
  return scanTextWithRules(scanText, rules, { sourceText: text });
};

export const scrubStructuredSensitivePatterns = (
  text: string,
  rules: readonly DeterministicPatternRule[] = DETERMINISTIC_PATTERN_RULES,
): string => {
  let scrubbed = stripSensitivePlaceholders(text);

  for (const rule of rules) {
    const matcher = new RegExp(rule.pattern.source, rule.pattern.flags);
    scrubbed = scrubbed.replace(matcher, (match) => {
      if (rule.validate && !rule.validate(match)) {
        return match;
      }
      return '';
    });
  }

  return scrubbed;
};
