import type { DetectedEntity } from '../../../core/types.js';
import type { DeterministicPatternRule } from './rules.js';

const isBetterEntity = (candidate: DetectedEntity, current: DetectedEntity): boolean => {
  const candidateLength = candidate.end - candidate.start;
  const currentLength = current.end - current.start;

  return (
    candidateLength > currentLength ||
    (candidateLength === currentLength && candidate.confidence > current.confidence) ||
    (candidateLength === currentLength &&
      candidate.confidence === current.confidence &&
      candidate.start < current.start) ||
    (candidateLength === currentLength &&
      candidate.confidence === current.confidence &&
      candidate.start === current.start &&
      candidate.end < current.end)
  );
};

export const sortAndDedupeEntities = (entities: readonly DetectedEntity[]): DetectedEntity[] => {
  const sorted = [...entities].sort((a, b) => a.start - b.start || a.end - b.end);
  const kept: DetectedEntity[] = [];

  for (const entity of sorted) {
    const last = kept[kept.length - 1];
    if (!last || entity.start >= last.end) {
      kept.push(entity);
      continue;
    }

    if (isBetterEntity(entity, last)) {
      kept[kept.length - 1] = entity;
    }
  }

  return kept;
};

export const scanTextWithRules = (
  text: string,
  rules: readonly DeterministicPatternRule[],
  options: {
    readonly confidenceThreshold?: number;
    readonly sourceText?: string;
  } = {},
): DetectedEntity[] => {
  const entities: DetectedEntity[] = [];
  const sourceText = options.sourceText ?? text;

  for (const rule of rules) {
    const matcher = new RegExp(rule.pattern.source, rule.pattern.flags);

    for (const match of text.matchAll(matcher)) {
      const matchText = match[0];
      const start = match.index;

      if (start === undefined) {
        continue;
      }

      if (rule.validate && !rule.validate(matchText)) {
        continue;
      }

      if (
        options.confidenceThreshold !== undefined &&
        rule.confidence < options.confidenceThreshold
      ) {
        continue;
      }

      entities.push({
        type: rule.type,
        source: 'deterministic',
        confidence: rule.confidence,
        start,
        end: start + matchText.length,
        text: sourceText.slice(start, start + matchText.length),
      });
    }
  }

  return sortAndDedupeEntities(entities);
};
