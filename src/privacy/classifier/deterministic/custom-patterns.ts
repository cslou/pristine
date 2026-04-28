import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DeterministicPatternRule } from './rules.js';

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

export interface PatternLoadResult {
  readonly rules: readonly DeterministicPatternRule[];
  readonly warnings: readonly string[];
}

const ALLOWED_CUSTOM_TYPES = new Set<string>(['api_key', 'auth_token', 'private_key', 'secret']);
const ALLOWED_CUSTOM_FLAGS = new Set<string>(['i', 'm', 's']);
const MAX_CUSTOM_PATTERN_CONFIG_BYTES = 64 * 1024;
const MAX_CUSTOM_PATTERN_SOURCE_LENGTH = 512;

export const getDefaultCustomPatternsPath = (): string =>
  join(homedir(), '.pristine', 'redaction.json');

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

const validateSafeRegexSource = (pattern: string, description: string): string | null => {
  if (pattern.length > MAX_CUSTOM_PATTERN_SOURCE_LENGTH) {
    return `Skipped ${description}: pattern must be ${MAX_CUSTOM_PATTERN_SOURCE_LENGTH} characters or fewer.`;
  }

  if (/\\[1-9]/.test(pattern)) {
    return `Skipped ${description}: backreferences are not supported in custom patterns.`;
  }

  if (/\(\?<?[=!]/.test(pattern)) {
    return `Skipped ${description}: lookahead and lookbehind are not supported in custom patterns.`;
  }

  if (/(?:\.\*|\.\+|\[\\s\\S\][*+]|\[\^][*+])/.test(pattern)) {
    return `Skipped ${description}: unbounded wildcard repetition is not supported in custom patterns.`;
  }

  if (/\((?:[^()\\]|\\.)*[+*{](?:[^()\\]|\\.)*\)(?:[+*?]|\{\d)/.test(pattern)) {
    return `Skipped ${description}: nested quantifiers are not supported in custom patterns.`;
  }

  if (/\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)(?:[+*?]|\{\d)/.test(pattern)) {
    return `Skipped ${description}: quantified alternation groups are not supported in custom patterns.`;
  }

  return null;
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

  const safeRegexWarning = validateSafeRegexSource(value.pattern, description);
  if (safeRegexWarning) {
    return { warning: safeRegexWarning };
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
  let stats;
  try {
    stats = statSync(path);
  } catch (error: unknown) {
    void error;
    return { patterns: [] };
  }

  if (!stats.isFile()) {
    return {
      patterns: [],
      warning: `Skipped custom redaction config ${path}: expected a regular file.`,
    };
  }

  if (stats.size > MAX_CUSTOM_PATTERN_CONFIG_BYTES) {
    return {
      patterns: [],
      warning: `Skipped custom redaction config ${path}: file must be ${MAX_CUSTOM_PATTERN_CONFIG_BYTES} bytes or smaller.`,
    };
  }

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
  customPatternsPath: string = getDefaultCustomPatternsPath(),
): PatternLoadResult => {
  const warnings: string[] = [];
  const rawPatterns: unknown[] = [];

  const parsed = parseCustomPatternsFile(customPatternsPath);
  rawPatterns.push(...parsed.patterns);
  if (parsed.warning) warnings.push(parsed.warning);

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
