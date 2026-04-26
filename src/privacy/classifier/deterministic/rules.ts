import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SensitivityType } from '../../../core/types.js';

export type SecretSensitivityType = 'api_key' | 'auth_token' | 'private_key' | 'secret';

export interface CustomPatternConfig {
  readonly id?: string;
  readonly name?: string;
  readonly type: SecretSensitivityType;
  readonly pattern: string;
  readonly flags?: string;
  readonly confidence?: number;
  readonly enabled?: boolean;
}

export interface DeterministicPatternRule {
  readonly type: SensitivityType;
  readonly pattern: RegExp;
  readonly confidence: number;
  readonly validate?: (match: string) => boolean;
}

export interface PatternLoadResult {
  readonly rules: readonly DeterministicPatternRule[];
  readonly warnings: readonly string[];
}

const ALLOWED_CUSTOM_TYPES = new Set<string>(['api_key', 'auth_token', 'private_key', 'secret']);
const ALLOWED_CUSTOM_FLAGS = new Set<string>(['i', 'm', 's']);

export const DEFAULT_CUSTOM_PATTERNS_PATH = join(homedir(), '.pristine', 'redaction.json');

const safeJsonDescription = (value: unknown): string => {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return 'unnamed custom pattern';
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isValidConfidence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;

const normalizeCustomFlags = (flags: unknown): string | null => {
  if (flags === undefined) return 'g';
  if (typeof flags !== 'string') return null;

  const deduped = new Set<string>();
  for (const flag of flags) {
    if (flag === 'g') continue;
    if (!ALLOWED_CUSTOM_FLAGS.has(flag)) {
      return null;
    }
    deduped.add(flag);
  }

  return [...deduped, 'g'].sort().join('');
};

const compileCustomPattern = (
  value: unknown,
  index: number,
): { readonly rule?: DeterministicPatternRule; readonly warning?: string } => {
  if (!isObjectRecord(value)) {
    return { warning: `Skipped custom pattern at index ${index}: entry must be an object.` };
  }

  if (value.enabled === false) {
    return {};
  }

  const description = safeJsonDescription(value.name ?? value.id);
  if (typeof value.type !== 'string' || !ALLOWED_CUSTOM_TYPES.has(value.type)) {
    return {
      warning: `Skipped ${description}: type must be api_key, auth_token, private_key, or secret.`,
    };
  }

  if (typeof value.pattern !== 'string' || value.pattern.trim().length === 0) {
    return { warning: `Skipped ${description}: pattern must be a non-empty regex source string.` };
  }

  if (/^\/.*\/[a-z]*$/i.test(value.pattern.trim())) {
    return { warning: `Skipped ${description}: pattern must not use /.../ literal syntax.` };
  }

  const flags = normalizeCustomFlags(value.flags);
  if (flags === null) {
    return { warning: `Skipped ${description}: flags may only include i, m, and s.` };
  }

  const confidence = value.confidence === undefined ? 0.9 : value.confidence;
  if (!isValidConfidence(confidence)) {
    return {
      warning: `Skipped ${description}: confidence must be greater than 0 and less than or equal to 1.`,
    };
  }

  try {
    return {
      rule: {
        type: value.type,
        pattern: new RegExp(value.pattern, flags),
        confidence,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'invalid regex';
    return { warning: `Skipped ${description}: ${message}` };
  }
};

const parseCustomPatternsFile = (
  path: string,
): { readonly patterns: readonly unknown[]; readonly warning?: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'invalid JSON';
    return { patterns: [], warning: `Skipped custom redaction config ${path}: ${message}` };
  }

  if (!isObjectRecord(parsed) || !Array.isArray(parsed.patterns)) {
    return {
      patterns: [],
      warning: `Skipped custom redaction config ${path}: expected a patterns array.`,
    };
  }

  return { patterns: parsed.patterns };
};

export const buildCustomPatternRules = (
  customPatterns?: readonly CustomPatternConfig[],
  customPatternsPath: string = DEFAULT_CUSTOM_PATTERNS_PATH,
): PatternLoadResult => {
  const warnings: string[] = [];
  const rawPatterns: unknown[] = [];

  if (existsSync(customPatternsPath)) {
    const parsed = parseCustomPatternsFile(customPatternsPath);
    rawPatterns.push(...parsed.patterns);
    if (parsed.warning) warnings.push(parsed.warning);
  }

  if (customPatterns) {
    rawPatterns.push(...customPatterns);
  }

  const rules: DeterministicPatternRule[] = [];
  rawPatterns.forEach((pattern, index) => {
    const compiled = compileCustomPattern(pattern, index);
    if (compiled.rule) rules.push(compiled.rule);
    if (compiled.warning) warnings.push(compiled.warning);
  });

  return { rules, warnings };
};

const isJsonObjectBase64Url = (value: string): boolean => {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    return isObjectRecord(parsed);
  } catch {
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
];

export const DETERMINISTIC_PATTERN_RULES = BUILT_IN_SECRET_PATTERN_RULES;
