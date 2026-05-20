import { InvalidArgumentError } from '../../core/errors.js';
import type { DetectCandidate, SourceSpan } from '../../core/types.js';

export const markerForCandidate = (candidateId: string): string => `[CANDIDATE:${candidateId}]`;

const DEFAULT_CONTEXT_WINDOW = 80;
const ELISION_MARKER = '\n[...]\n';

const contextSummary = (value: string): string => {
  if (value.length === 0) return '';
  const lineBreaks = [...value].filter((character) => character === '\n').length;
  return `[CONTEXT chars=${value.length} lines=${lineBreaks + 1}]`;
};

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
    parts.push(contextSummary(text.slice(cursor, candidate.sourceSpan.start)));
    parts.push(markerForCandidate(candidate.candidateId));
    cursor = candidate.sourceSpan.end;
  }

  parts.push(contextSummary(text.slice(cursor, window.end)));
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
