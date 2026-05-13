const MAX_RETURNED_SNIPPET_LENGTH = 800;
const TRUNCATED_SNIPPET_SUFFIX = '…';
const TRUNCATED_SNIPPET_SUFFIX_LENGTH = Array.from(TRUNCATED_SNIPPET_SUFFIX).length;

export const formatRecallSnippet = (snippet: string): string => {
  let characterCount = 0;
  let bounded = '';
  for (const character of snippet) {
    if (characterCount >= MAX_RETURNED_SNIPPET_LENGTH) break;
    bounded += character;
    characterCount += 1;
  }

  if (characterCount < MAX_RETURNED_SNIPPET_LENGTH) return snippet;

  const iterator = snippet[Symbol.iterator]();
  for (let index = 0; index < MAX_RETURNED_SNIPPET_LENGTH; index++) {
    const next = iterator.next();
    if (next.done) return snippet;
  }
  if (iterator.next().done) return snippet;

  return `${Array.from(bounded)
    .slice(0, MAX_RETURNED_SNIPPET_LENGTH - TRUNCATED_SNIPPET_SUFFIX_LENGTH)
    .join('')}${TRUNCATED_SNIPPET_SUFFIX}`;
};
