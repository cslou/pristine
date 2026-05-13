const MAX_RETURNED_SNIPPET_LENGTH = 800;
const TRUNCATED_SNIPPET_SUFFIX = '…';
const TRUNCATED_SNIPPET_SUFFIX_LENGTH = Array.from(TRUNCATED_SNIPPET_SUFFIX).length;
const REDACTED_TEXT_TOKEN = '[TEXT]';

export const REDACTED_RECALL_SNIPPET =
  '[snippet withheld by default; inspect sourcePointer with search-session-history]';

interface SensitiveSnippetPattern {
  readonly type: 'api_key' | 'auth_token' | 'private_key' | 'secret';
  readonly pattern: RegExp;
}

const SENSITIVE_SNIPPET_PATTERNS: readonly SensitiveSnippetPattern[] = [
  { type: 'api_key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'api_key', pattern: /\bghp_[A-Za-z0-9]{36}\b/g },
  { type: 'api_key', pattern: /\bgho_[A-Za-z0-9]{36}\b/g },
  { type: 'api_key', pattern: /\bghs_[A-Za-z0-9]{36}\b/g },
  { type: 'api_key', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { type: 'api_key', pattern: /\bsk-(?!ant-|proj-)[A-Za-z0-9]{29,}\b/g },
  { type: 'api_key', pattern: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g },
  { type: 'api_key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { type: 'api_key', pattern: /\bsk_(live|test)_[A-Za-z0-9]{24,}\b/g },
  { type: 'api_key', pattern: /\brk_(live|test)_[A-Za-z0-9]{24,}\b/g },
  { type: 'api_key', pattern: /\b(?:xoxb|xoxp|xapp)-[A-Za-z0-9-]{20,}\b/g },
  { type: 'api_key', pattern: /\bSK[0-9a-fA-F]{32}\b/g },
  { type: 'api_key', pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  {
    type: 'private_key',
    pattern:
      /-----BEGIN (?:RSA |EC |ED25519 |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |ED25519 |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
  {
    type: 'private_key',
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g,
  },
  {
    type: 'private_key',
    pattern:
      /\b(?:PRIVATE_KEY|WALLET_PRIVATE_KEY|EVM_PRIVATE_KEY|ETH_PRIVATE_KEY|DEPLOYER_PRIVATE_KEY)\s*[:=]\s*['"]?(?:0x)?[0-9a-fA-F]{64}['"]?/g,
  },
  {
    type: 'auth_token',
    pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.+/=-]*\b/g,
  },
  {
    type: 'auth_token',
    pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{20,}\b/g,
  },
  {
    type: 'secret',
    pattern:
      /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\b\s*[:=]\s*['"]?[A-Za-z0-9][A-Za-z0-9._~+/=-]{7,}['"]?/gi,
  },
  {
    type: 'secret',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
];

const SAFE_CONTEXT_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'without',
  'remain',
  'remains',
  'relevant',
  'token',
  'tokens',
  'key',
  'keys',
  'note',
  'contact',
  'project',
  'sprint',
  'phrase',
  'bridge',
  'known',
  'here',
  'belongs',
]);

const SENSITIVE_PLACEHOLDER_PATTERN = /(\[SENSITIVE:[a-z_]+\])/g;
const TOKEN_PATTERN = /[\p{L}\p{N}_-]+|[^\p{L}\p{N}_-]+/gu;
const WORD_PATTERN = /^[\p{L}\p{N}_-]+$/u;
const SAFE_SEPARATOR_PATTERN = /^[\s.,;:!?()[\]{}<>/\\'"`|+=*&^%$#@~-]+$/u;

const sanitizeSnippet = (snippet: string): string =>
  SENSITIVE_SNIPPET_PATTERNS.reduce(
    (sanitized, rule) => sanitized.replace(rule.pattern, `[SENSITIVE:${rule.type}]`),
    snippet,
  );

const minimizeSnippetText = (snippet: string): string =>
  snippet
    .split(SENSITIVE_PLACEHOLDER_PATTERN)
    .map((part) => {
      if (part.startsWith('[SENSITIVE:')) return part;
      TOKEN_PATTERN.lastIndex = 0;
      return Array.from(part.matchAll(TOKEN_PATTERN), ([token]) => {
        if (WORD_PATTERN.test(token)) {
          const normalized = token.toLocaleLowerCase();
          return SAFE_CONTEXT_WORDS.has(normalized) ? token : REDACTED_TEXT_TOKEN;
        }
        return SAFE_SEPARATOR_PATTERN.test(token) ? token : REDACTED_TEXT_TOKEN;
      }).join('');
    })
    .join('')
    .replace(/(?:\[TEXT\][\s.,;:!?-]*){2,}/g, `${REDACTED_TEXT_TOKEN} `)
    .trim();

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
  for (let index = 0; index < MAX_RETURNED_SNIPPET_LENGTH; index++) {
    const next = iterator.next();
    if (next.done) return snippet;
  }
  if (iterator.next().done) return snippet;

  return `${Array.from(bounded)
    .slice(0, MAX_RETURNED_SNIPPET_LENGTH - TRUNCATED_SNIPPET_SUFFIX_LENGTH)
    .join('')}${TRUNCATED_SNIPPET_SUFFIX}`;
};

export interface FormatRecallSnippetOptions {
  readonly includeSnippetText?: boolean;
}

export const formatRecallSnippet = (
  snippet: string,
  options: FormatRecallSnippetOptions = {},
): string => {
  if (options.includeSnippetText !== true) return REDACTED_RECALL_SNIPPET;
  return boundSnippet(minimizeSnippetText(sanitizeSnippet(snippet)));
};
