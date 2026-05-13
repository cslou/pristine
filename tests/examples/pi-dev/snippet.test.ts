import { describe, expect, it } from 'vitest';
import {
  formatRecallSnippet,
  REDACTED_RECALL_SNIPPET,
} from '../../../examples/pi-dev/extensions/search-memory/lib/snippet.js';

const validJwt =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('formatRecallSnippet', () => {
  it('withholds snippets by default', () => {
    expect(formatRecallSnippet('Sapphire context')).toBe(REDACTED_RECALL_SNIPPET);
  });

  it('minimizes opt-in previews to query terms, safe context words, and placeholders', () => {
    const formatted = formatRecallSnippet('Sapphire Alice custom-secret-value-12345 token', {
      includeSnippetText: true,
      query: 'sapphire token',
    });

    expect(formatted).toBe('Sapphire [TEXT] token');
    expect(formatted).not.toContain('Alice');
    expect(formatted).not.toContain('custom-secret-value-12345');
  });

  it.each([
    ['AWS access key', 'Sapphire AKIAABCDEFGHIJKLMNOP token', 'AKIAABCDEFGHIJKLMNOP', 'api_key'],
    [
      'GitHub ghp token',
      'Sapphire ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ token',
      'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
      'api_key',
    ],
    [
      'GitHub gho token',
      'Sapphire gho_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ token',
      'gho_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
      'api_key',
    ],
    [
      'GitHub ghs token',
      'Sapphire ghs_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ token',
      'ghs_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
      'api_key',
    ],
    [
      'GitHub fine-grained PAT',
      'Sapphire github_pat_abcdefghijklmnopqrstuvwxyz token',
      'github_pat_abcdefghijklmnopqrstuvwxyz',
      'api_key',
    ],
    [
      'OpenAI key',
      'Sapphire sk-abcdefghijklmnopqrstuvwxyz123456789 key',
      'sk-abcdefghijklmnopqrstuvwxyz123456789',
      'api_key',
    ],
    [
      'OpenAI project key',
      'Sapphire sk-proj-abcdefghijklmnopqrstuvwxyz key',
      'sk-proj-abcdefghijklmnopqrstuvwxyz',
      'api_key',
    ],
    [
      'Anthropic key',
      'Sapphire sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 key',
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
      'api_key',
    ],
    [
      'Stripe secret key',
      'Sapphire sk_live_abcdefghijklmnopqrstuvwxyz key',
      'sk_live_abcdefghijklmnopqrstuvwxyz',
      'api_key',
    ],
    [
      'Stripe restricted key',
      'Sapphire rk_test_abcdefghijklmnopqrstuvwxyz key',
      'rk_test_abcdefghijklmnopqrstuvwxyz',
      'api_key',
    ],
    [
      'Slack bot token',
      'Sapphire xoxb-abcdefghijklmnopqrstuvwxyz token',
      'xoxb-abcdefghijklmnopqrstuvwxyz',
      'api_key',
    ],
    [
      'Slack user token',
      'Sapphire xoxp-abcdefghijklmnopqrstuvwxyz token',
      'xoxp-abcdefghijklmnopqrstuvwxyz',
      'api_key',
    ],
    [
      'Slack app token',
      'Sapphire xapp-abcdefghijklmnopqrstuvwxyz token',
      'xapp-abcdefghijklmnopqrstuvwxyz',
      'api_key',
    ],
    [
      'Twilio-style key',
      'Sapphire SK0123456789abcdef0123456789abcdef key',
      'SK0123456789abcdef0123456789abcdef',
      'api_key',
    ],
    [
      'SendGrid key',
      `Sapphire SG.${'A'.repeat(22)}.${'B'.repeat(43)} key`,
      `SG.${'A'.repeat(22)}.${'B'.repeat(43)}`,
      'api_key',
    ],
    ['JWT auth token', `Sapphire ${validJwt} token`, validJwt, 'auth_token'],
    [
      'opaque bearer token',
      'Sapphire Bearer abcdefghijklmnopqrstuvwxyz012345 token',
      'Bearer abcdefghijklmnopqrstuvwxyz012345',
      'auth_token',
    ],
    [
      'opaque basic token',
      'Sapphire Basic abcdefghijklmnopqrstuvwxyz012345 token',
      'Basic abcdefghijklmnopqrstuvwxyz012345',
      'auth_token',
    ],
    [
      'generic secret assignment',
      'Sapphire password=correct-horse-battery note',
      'password=correct-horse-battery',
      'secret',
    ],
    ['email address', 'Sapphire dev@example.com contact', 'dev@example.com', 'secret'],
    [
      'private key block',
      ['Sapphire key:', '-----BEGIN PRIVATE KEY-----', 'abc123', '-----END PRIVATE KEY-----'].join(
        '\n',
      ),
      '-----BEGIN PRIVATE KEY-----',
      'private_key',
    ],
    [
      'PGP private key block',
      [
        'Sapphire key:',
        '-----BEGIN PGP PRIVATE KEY BLOCK-----',
        'abc123',
        '-----END PGP PRIVATE KEY BLOCK-----',
      ].join('\n'),
      '-----BEGIN PGP PRIVATE KEY BLOCK-----',
      'private_key',
    ],
    [
      'private key assignment',
      `Sapphire DEPLOYER_PRIVATE_KEY="0x${'a'.repeat(64)}" key`,
      `DEPLOYER_PRIVATE_KEY="0x${'a'.repeat(64)}"`,
      'private_key',
    ],
  ])('sanitizes supported snippet pattern: %s', (_name, snippet, sensitiveValue, type) => {
    const formatted = formatRecallSnippet(snippet, {
      includeSnippetText: true,
      query: 'sapphire token',
    });

    expect(formatted).toContain(`SENSITIVE:${type}`);
    expect(formatted).not.toContain(sensitiveValue);
  });
});
