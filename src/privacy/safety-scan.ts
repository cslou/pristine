import type { DetectedEntity } from '../core/types.js';
import { DETERMINISTIC_PATTERN_RULES } from './classifier/deterministic/rules.js';

export const PLACEHOLDER_RE = /\[SENSITIVE:[^\]]+\]/g;

const sortAndDedupeViolations = (entities: DetectedEntity[]): DetectedEntity[] => {
  const sorted = [...entities].sort((a, b) => a.start - b.start || a.end - b.end);
  const deduped: DetectedEntity[] = [];

  for (const entity of sorted) {
    const duplicate = deduped.some(
      (existing) =>
        existing.start === entity.start && existing.end === entity.end && existing.type === entity.type,
    );
    if (!duplicate) {
      deduped.push(entity);
    }
  }

  return deduped;
};

export const replacePlaceholdersWithWhitespace = (text: string): string => {
  return text.replace(PLACEHOLDER_RE, (match) => ' '.repeat(match.length));
};

export const stripSensitivePlaceholders = (text: string): string => text.replace(PLACEHOLDER_RE, '');

export const findSafetyViolations = (text: string): readonly DetectedEntity[] => {
  const scanText = replacePlaceholdersWithWhitespace(text);
  const entities: DetectedEntity[] = [];

  for (const rule of DETERMINISTIC_PATTERN_RULES) {
    const matcher = new RegExp(rule.pattern.source, rule.pattern.flags);

    for (const match of scanText.matchAll(matcher)) {
      const matchText = match[0];
      const start = match.index;

      if (start === undefined) {
        continue;
      }

      if (rule.validate && !rule.validate(matchText)) {
        continue;
      }

      entities.push({
        type: rule.type,
        source: 'deterministic',
        confidence: rule.confidence,
        start,
        end: start + matchText.length,
        text: text.slice(start, start + matchText.length),
      });
    }
  }

  return sortAndDedupeViolations(entities);
};

export const scrubStructuredSensitivePatterns = (text: string): string => {
  let scrubbed = stripSensitivePlaceholders(text);

  for (const rule of DETERMINISTIC_PATTERN_RULES) {
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
