import { InvalidArgumentError } from '../../core/errors.js';
import type { DetectCandidate, SourceSpan } from '../../core/types.js';

export const markerForCandidate = (candidateId: string): string => `[CANDIDATE:${candidateId}]`;

const getContextBounds = (
  textLength: number,
  candidates: readonly DetectCandidate[],
  contextWindow: number | undefined,
): SourceSpan => {
  if (contextWindow === undefined) return { start: 0, end: textLength };
  const firstStart = Math.min(...candidates.map((candidate) => candidate.sourceSpan.start));
  const lastEnd = Math.max(...candidates.map((candidate) => candidate.sourceSpan.end));
  return {
    start: Math.max(0, firstStart - contextWindow),
    end: Math.min(textLength, lastEnd + contextWindow),
  };
};

export const buildSanitizedContext = (
  text: string,
  candidates: readonly DetectCandidate[],
  contextWindow: number | undefined,
): string => {
  const ordered = [...candidates].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start);
  const bounds = getContextBounds(text.length, ordered, contextWindow);
  let cursor = bounds.start;
  const parts: string[] = [];

  for (const candidate of ordered) {
    if (candidate.sourceSpan.start < cursor && candidate.sourceSpan.start >= bounds.start) {
      throw new InvalidArgumentError('classify: candidate sourceSpans must not overlap');
    }
    if (candidate.sourceSpan.end <= bounds.start || candidate.sourceSpan.start >= bounds.end) {
      continue;
    }
    parts.push(text.slice(cursor, candidate.sourceSpan.start));
    parts.push(markerForCandidate(candidate.candidateId));
    cursor = candidate.sourceSpan.end;
  }

  parts.push(text.slice(cursor, bounds.end));
  return parts.join('');
};
