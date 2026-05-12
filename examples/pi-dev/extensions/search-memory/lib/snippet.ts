import { createPrivacyPipeline } from '../../../../../src/privacy/index.js';

const MAX_RETURNED_SNIPPET_LENGTH = 800;
const TRUNCATED_SNIPPET_SUFFIX = '…';
const TRUNCATED_SNIPPET_SUFFIX_LENGTH = Array.from(TRUNCATED_SNIPPET_SUFFIX).length;
const SAFETY_SCAN_REDACTED_SNIPPET =
  '[snippet redacted after safety scan; inspect sourcePointer with search-session-history]';

const recallSnippetPrivacyPipeline = createPrivacyPipeline({
  classifier: {
    customPatterns: [
      {
        id: 'email-address',
        type: 'secret',
        pattern: '\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b',
        flags: 'gi',
        confidence: 0.95,
      },
      {
        id: 'opaque-bearer-token',
        type: 'auth_token',
        pattern: '\\b(?:Bearer|Basic)\\s+[A-Za-z0-9._~+/=-]{20,}\\b',
        flags: 'g',
        confidence: 0.95,
      },
    ],
  },
});

const boundSnippet = (snippet: string): string => {
  let characterCount = 0;
  let bounded = '';
  for (const character of snippet) {
    if (characterCount >= MAX_RETURNED_SNIPPET_LENGTH) break;
    bounded += character;
    characterCount += 1;
  }

  if (characterCount < MAX_RETURNED_SNIPPET_LENGTH) return snippet;

  const iterator = snippet[Symbol.iterator]();
  let hasMoreCharacters = false;
  for (let index = 0; index < MAX_RETURNED_SNIPPET_LENGTH; index++) {
    const next = iterator.next();
    if (next.done) return snippet;
  }
  hasMoreCharacters = !iterator.next().done;

  if (!hasMoreCharacters) return snippet;

  return `${Array.from(bounded)
    .slice(0, MAX_RETURNED_SNIPPET_LENGTH - TRUNCATED_SNIPPET_SUFFIX_LENGTH)
    .join('')}${TRUNCATED_SNIPPET_SUFFIX}`;
};

export const formatRecallSnippet = async (snippet: string): Promise<string> => {
  const result = await recallSnippetPrivacyPipeline.classifyAndRedact(snippet);
  if (result.safetyViolations.length > 0) return SAFETY_SCAN_REDACTED_SNIPPET;
  return boundSnippet(result.redaction?.redactedText ?? snippet);
};
