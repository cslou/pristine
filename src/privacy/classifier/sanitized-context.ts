import { InvalidArgumentError } from '../../core/errors.js';
import type { DetectCandidate, SourceSpan } from '../../core/types.js';

export const markerForCandidate = (candidateId: string): string => `[CANDIDATE:${candidateId}]`;

const DEFAULT_CONTEXT_WINDOW = 80;

const scrubContextSlice = (value: string): string =>
  value
    .replace(/\bsk-(?:proj|ant)[A-Za-z0-9._-]{12,}\b/gu, '[REDACTED_SECRET]')
    .replace(/\bghp_[A-Za-z0-9_]{12,}\b/gu, '[REDACTED_SECRET]')
    .replace(/\bSG\.[A-Za-z0-9._-]{12,}\b/gu, '[REDACTED_SECRET]')
    .replace(/\bAKIA[0-9A-Z]{12,}\b/gu, '[REDACTED_SECRET]')
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
      '[REDACTED_SECRET]',
    )
    .replace(/:\/\/([^:\s/@]+):([^@\s]+)@/gu, '://$1:[REDACTED_SECRET]@')
    .replace(
      /([?&][^=\s]*(?:token|key|secret|signature|password)[^=\s]*=)[^&\s]+/giu,
      '$1[REDACTED_SECRET]',
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[REDACTED_EMAIL]');

const getContextBounds = (
  textLength: number,
  candidates: readonly DetectCandidate[],
  contextWindow: number | undefined,
): SourceSpan => {
  const effectiveContextWindow = contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const firstStart = Math.min(...candidates.map((candidate) => candidate.sourceSpan.start));
  const lastEnd = Math.max(...candidates.map((candidate) => candidate.sourceSpan.end));
  return {
    start: Math.max(0, firstStart - effectiveContextWindow),
    end: Math.min(textLength, lastEnd + effectiveContextWindow),
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
    parts.push(scrubContextSlice(text.slice(cursor, candidate.sourceSpan.start)));
    parts.push(markerForCandidate(candidate.candidateId));
    cursor = candidate.sourceSpan.end;
  }

  parts.push(scrubContextSlice(text.slice(cursor, bounds.end)));
  return parts.join('');
};
