import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeterministicClassifier } from '../../src/privacy/classifier/deterministic/index.js';

const missingCustomPatternsPath = join(tmpdir(), 'pristine-missing-redaction.json');
const validJwt =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

let tempDirs: string[] = [];

const createClassifier = (config = {}) =>
  createDeterministicClassifier({ customPatternsPath: missingCustomPatternsPath, ...config });

const createTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'pristine-redaction-test-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('deterministic classifier', () => {
  describe('built-in secret detection', () => {
    it('detects provider API keys', async () => {
      const classifier = createClassifier();
      const report = await classifier.classify(
        'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ.',
      );

      expect(report.hasSensitiveContent).toBe(true);
      expect(report.entities.map((entity) => entity.type)).toEqual(['api_key', 'api_key']);
      expect(report.entities[0]!.text).toContain('sk-ant-');
      expect(report.entities[1]!.text).toContain('ghp_');
    });

    it('detects full PEM private key blocks', async () => {
      const classifier = createClassifier();
      const privateKey = [
        '-----BEGIN PRIVATE KEY-----',
        'abc123',
        'def456',
        '-----END PRIVATE KEY-----',
      ].join('\n');

      const report = await classifier.classify(`key:\n${privateKey}\n`);

      expect(report.entities).toHaveLength(1);
      expect(report.entities[0]).toMatchObject({
        type: 'private_key',
        source: 'deterministic',
        text: privateKey,
      });
    });

    it('detects JWTs only when header and payload decode to JSON', async () => {
      const classifier = createClassifier();
      const report = await classifier.classify(`Authorization: Bearer ${validJwt}`);
      const invalid = await classifier.classify('Not a JWT: eyJabc.eyJdef.not-json');

      expect(report.entities).toHaveLength(1);
      expect(report.entities[0]).toMatchObject({ type: 'auth_token', text: validJwt });
      expect(invalid.entities).toHaveLength(0);
    });

    it('detects context-bound EVM private keys', async () => {
      const classifier = createClassifier();
      const key = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const report = await classifier.classify(`DEPLOYER_PRIVATE_KEY="${key}"`);

      expect(report.entities).toHaveLength(1);
      expect(report.entities[0]).toMatchObject({
        type: 'private_key',
        text: `DEPLOYER_PRIVATE_KEY="${key}"`,
      });
    });

    it('does not detect naked EVM-like transaction hashes', async () => {
      const classifier = createClassifier();
      const hash = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const report = await classifier.classify(`Transaction hash: ${hash}`);

      expect(report.hasSensitiveContent).toBe(false);
      expect(report.entities).toHaveLength(0);
    });
  });

  describe('custom pattern support', () => {
    it('loads custom patterns passed directly in config', async () => {
      const classifier = createClassifier({
        customPatterns: [
          {
            id: 'acme',
            type: 'api_key',
            pattern: '\\bacme_tk_[A-Za-z0-9]{8}\\b',
            confidence: 0.95,
          },
        ],
      });

      const report = await classifier.classify('Token acme_tk_ABC12345');

      expect(report.entities).toHaveLength(1);
      expect(report.entities[0]).toMatchObject({ type: 'api_key', text: 'acme_tk_ABC12345' });
    });

    it('loads custom patterns from redaction.json', async () => {
      const dir = createTempDir();
      const path = join(dir, 'redaction.json');
      writeFileSync(
        path,
        JSON.stringify({
          patterns: [
            {
              id: 'session',
              type: 'auth_token',
              pattern: '\\bsess_[A-Za-z0-9]{10}\\b',
              confidence: 0.91,
            },
          ],
        }),
      );

      const classifier = createDeterministicClassifier({ customPatternsPath: path });
      const report = await classifier.classify('Session sess_ABC123def4');

      expect(report.entities).toHaveLength(1);
      expect(report.entities[0]).toMatchObject({ type: 'auth_token', text: 'sess_ABC123def4' });
    });

    it('ignores disabled custom patterns', async () => {
      const classifier = createClassifier({
        customPatterns: [
          {
            type: 'api_key',
            pattern: '\\bdisabled_[A-Za-z0-9]+\\b',
            enabled: false,
          },
        ],
      });

      const report = await classifier.classify('disabled_ABC123');

      expect(report.entities).toHaveLength(0);
    });

    it('skips invalid custom patterns and reports warnings', async () => {
      const classifier = createClassifier({
        customPatterns: [
          { type: 'api_key', pattern: '[', name: 'Bad Regex' },
          { type: 'api_key', pattern: '\\bok_[A-Z]+\\b', flags: 'u' },
          { type: 'api_key', pattern: '/literal/g' },
          { type: 'api_key', pattern: '\\btoo_low\\b', confidence: 0 },
        ],
      });

      const report = await classifier.classify('ok_ABC');

      expect(report.entities).toHaveLength(0);
      expect(report.warnings).toHaveLength(4);
      expect(report.warnings?.join('\n')).toContain('Bad Regex');
      expect(report.warnings?.join('\n')).toContain('flags may only include');
      expect(report.warnings?.join('\n')).toContain('literal syntax');
      expect(report.warnings?.join('\n')).toContain('confidence');
    });

    it('skips malformed config files and reports a warning', async () => {
      const dir = createTempDir();
      const path = join(dir, 'redaction.json');
      writeFileSync(path, '{not json');

      const classifier = createDeterministicClassifier({ customPatternsPath: path });
      const report = await classifier.classify('ordinary text');

      expect(report.entities).toHaveLength(0);
      expect(report.warnings).toHaveLength(1);
      expect(report.warnings?.[0]).toContain('Skipped custom redaction config');
    });

    it('deduplicates overlapping matches by keeping the longest span', async () => {
      const classifier = createClassifier({
        customPatterns: [
          {
            type: 'secret',
            pattern: 'secret_token_[A-Za-z0-9]+',
            confidence: 0.8,
          },
          {
            type: 'secret',
            pattern: 'secret_token_[A-Za-z0-9]+_extended',
            confidence: 0.7,
          },
        ],
      });

      const report = await classifier.classify('secret_token_ABC_extended');

      expect(report.entities).toHaveLength(1);
      expect(report.entities[0]!.text).toBe('secret_token_ABC_extended');
    });
  });

  describe('clean text', () => {
    it('returns no entities for non-sensitive text', async () => {
      const classifier = createClassifier();
      const report = await classifier.classify('The weather is beautiful today.');

      expect(report.hasSensitiveContent).toBe(false);
      expect(report.entities).toHaveLength(0);
    });

    it('returns empty report for empty text', async () => {
      const classifier = createClassifier();
      const report = await classifier.classify('');

      expect(report.hasSensitiveContent).toBe(false);
      expect(report.entities).toHaveLength(0);
    });
  });

  describe('entity spans', () => {
    it('provides correct start/end offsets', async () => {
      const classifier = createClassifier();
      const text = 'Token: sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 ok';
      const report = await classifier.classify(text);

      const entity = report.entities[0]!;
      expect(text.slice(entity.start, entity.end)).toBe(
        'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
      );
    });
  });
});
