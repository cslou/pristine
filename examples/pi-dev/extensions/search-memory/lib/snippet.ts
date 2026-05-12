const MAX_RETURNED_SNIPPET_LENGTH = 800;
const TRUNCATED_SNIPPET_SUFFIX = '…';

interface SensitiveSnippetPattern {
  readonly pattern: RegExp;
  readonly replacement: string;
}

const SENSITIVE_SNIPPET_PATTERNS: readonly SensitiveSnippetPattern[] = [
  {
    pattern:
      /-----BEGIN (?:RSA |EC |ED25519 |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |ED25519 |OPENSSH |DSA )?PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    pattern: /\b(?:ghp|gho|ghs)_[A-Za-z0-9]{36}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern: /\b(?:xoxb|xoxp|xapp)-[A-Za-z0-9-]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{20,}\b/g,
    replacement: '[REDACTED_AUTH_TOKEN]',
  },
  {
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    pattern:
      /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\b\s*[:=]\s*['"]?[A-Za-z0-9][A-Za-z0-9._~+/=-]{7,}['"]?/gi,
    replacement: '[REDACTED_SECRET]',
  },
];

const sanitizeSnippet = (snippet: string): string =>
  SENSITIVE_SNIPPET_PATTERNS.reduce(
    (sanitized, rule) => sanitized.replace(rule.pattern, rule.replacement),
    snippet,
  );

const boundSnippet = (snippet: string): string => {
  const characters = Array.from(snippet);
  if (characters.length <= MAX_RETURNED_SNIPPET_LENGTH) return snippet;
  return `${characters
    .slice(0, MAX_RETURNED_SNIPPET_LENGTH - Array.from(TRUNCATED_SNIPPET_SUFFIX).length)
    .join('')}${TRUNCATED_SNIPPET_SUFFIX}`;
};

export const formatRecallSnippet = (snippet: string): string => boundSnippet(sanitizeSnippet(snippet));
