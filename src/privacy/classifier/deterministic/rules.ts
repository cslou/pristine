import type { SensitivityType } from '../../../core/types.js';

export interface DeterministicPatternRule {
  readonly type: SensitivityType;
  readonly pattern: RegExp;
  readonly confidence: number;
  readonly validate?: (match: string) => boolean;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonObjectBase64Url = (value: string): boolean => {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    return isObjectRecord(parsed);
  } catch (error: unknown) {
    void error;
    return false;
  }
};

const isJwt = (value: string): boolean => {
  const parts = value.split('.');
  return parts.length === 3 && isJsonObjectBase64Url(parts[0]!) && isJsonObjectBase64Url(parts[1]!);
};

export const BUILT_IN_SECRET_PATTERN_RULES: readonly DeterministicPatternRule[] = [
  { type: 'api_key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, confidence: 0.99 },
  { type: 'api_key', pattern: /\bghp_[A-Za-z0-9]{36}\b/g, confidence: 0.99 },
  { type: 'api_key', pattern: /\bgho_[A-Za-z0-9]{36}\b/g, confidence: 0.99 },
  { type: 'api_key', pattern: /\bghs_[A-Za-z0-9]{36}\b/g, confidence: 0.99 },
  { type: 'api_key', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, confidence: 0.99 },
  { type: 'api_key', pattern: /\bsk-(?!ant-|proj-)[A-Za-z0-9]{29,}\b/g, confidence: 0.95 },
  { type: 'api_key', pattern: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, confidence: 0.99 },
  { type: 'api_key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, confidence: 0.99 },
  { type: 'api_key', pattern: /\bsk_(live|test)_[A-Za-z0-9]{24,}\b/g, confidence: 0.99 },
  { type: 'api_key', pattern: /\brk_(live|test)_[A-Za-z0-9]{24,}\b/g, confidence: 0.99 },
  { type: 'api_key', pattern: /\bxoxb-[A-Za-z0-9-]{20,}\b/g, confidence: 0.99 },
  { type: 'api_key', pattern: /\bxoxp-[A-Za-z0-9-]{20,}\b/g, confidence: 0.99 },
  { type: 'api_key', pattern: /\bxapp-[A-Za-z0-9-]{20,}\b/g, confidence: 0.99 },
  { type: 'api_key', pattern: /\bSK[0-9a-fA-F]{32}\b/g, confidence: 0.9 },
  { type: 'api_key', pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g, confidence: 0.99 },
  {
    type: 'private_key',
    pattern:
      /-----BEGIN (?:RSA |EC |ED25519 |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |ED25519 |OPENSSH |DSA )?PRIVATE KEY-----/g,
    confidence: 0.99,
  },
  {
    type: 'private_key',
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g,
    confidence: 0.99,
  },
  {
    type: 'private_key',
    pattern:
      /\b(?:PRIVATE_KEY|WALLET_PRIVATE_KEY|EVM_PRIVATE_KEY|ETH_PRIVATE_KEY|DEPLOYER_PRIVATE_KEY)\s*[:=]\s*['"]?(?:0x)?[0-9a-fA-F]{64}['"]?/g,
    confidence: 0.98,
  },
  {
    type: 'auth_token',
    pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.+/=-]*\b/g,
    confidence: 0.9,
    validate: isJwt,
  },
  {
    type: 'secret',
    pattern:
      /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\b\s*[:=]\s*['"]?[A-Za-z0-9][A-Za-z0-9._~+/=-]{7,}['"]?/gi,
    confidence: 0.9,
  },
];

export const DETERMINISTIC_PATTERN_RULES = BUILT_IN_SECRET_PATTERN_RULES;
