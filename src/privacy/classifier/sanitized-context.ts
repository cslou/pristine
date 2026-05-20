import { InvalidArgumentError } from '../../core/errors.js';
import type { DetectCandidate, SourceSpan } from '../../core/types.js';

export const markerForCandidate = (candidateId: string): string => `[CANDIDATE:${candidateId}]`;

const DEFAULT_CONTEXT_WINDOW = 80;
const ELISION_MARKER = '\n[...]\n';

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

const assertNonOverlapping = (ordered: readonly DetectCandidate[]): void => {
  let previousEnd = -1;
  for (const candidate of ordered) {
    if (candidate.sourceSpan.start < previousEnd) {
      throw new InvalidArgumentError('classify: candidate sourceSpans must not overlap');
    }
    previousEnd = candidate.sourceSpan.end;
  }
};

const candidateWindow = (
  textLength: number,
  candidate: DetectCandidate,
  contextWindow: number,
): SourceSpan => ({
  start: Math.max(0, candidate.sourceSpan.start - contextWindow),
  end: Math.min(textLength, candidate.sourceSpan.end + contextWindow),
});

const mergeWindows = (
  windows: readonly SourceSpan[],
): readonly { readonly start: number; readonly end: number }[] => {
  const merged: Array<{ start: number; end: number }> = [];
  for (const window of windows) {
    const previous = merged.at(-1);
    if (previous === undefined || window.start > previous.end) {
      merged.push({ ...window });
      continue;
    }
    previous.end = Math.max(previous.end, window.end);
  }
  return merged;
};

const buildWindowContext = (
  text: string,
  ordered: readonly DetectCandidate[],
  window: SourceSpan,
): string => {
  const parts: string[] = [];
  let cursor = window.start;

  for (const candidate of ordered) {
    if (candidate.sourceSpan.end <= window.start) continue;
    if (candidate.sourceSpan.start >= window.end) break;
    parts.push(scrubContextSlice(text.slice(cursor, candidate.sourceSpan.start)));
    parts.push(markerForCandidate(candidate.candidateId));
    cursor = candidate.sourceSpan.end;
  }

  parts.push(scrubContextSlice(text.slice(cursor, window.end)));
  return parts.join('');
};

export const buildSanitizedContext = (
  text: string,
  candidates: readonly DetectCandidate[],
  contextWindow: number | undefined,
): string => {
  const ordered = [...candidates].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start);
  assertNonOverlapping(ordered);
  const effectiveContextWindow = contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const windows = mergeWindows(
    ordered.map((candidate) => candidateWindow(text.length, candidate, effectiveContextWindow)),
  );
  return windows.map((window) => buildWindowContext(text, ordered, window)).join(ELISION_MARKER);
};
