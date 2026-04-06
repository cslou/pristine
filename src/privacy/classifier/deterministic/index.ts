import type { DetectedEntity, SensitivityReport, SensitivityType } from '../../../core/types.js';
import type { SensitivityClassifier } from '../../../core/interfaces.js';

export interface DeterministicClassifierConfig {
  readonly confidenceThreshold?: number;
}

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

// --- Pattern definitions ---

interface PatternRule {
  readonly type: SensitivityType;
  readonly pattern: RegExp;
  readonly confidence: number;
  readonly validate?: (match: string) => boolean;
}

/**
 * Luhn algorithm for credit card validation.
 * Returns true if the digit string passes the Luhn checksum.
 */
const isLuhnValid = (digits: string): boolean => {
  const nums = digits.replace(/\D/g, '');
  if (nums.length < 13 || nums.length > 19) return false;

  let sum = 0;
  let alternate = false;
  for (let i = nums.length - 1; i >= 0; i--) {
    let n = parseInt(nums[i]!, 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
};

const PATTERNS: readonly PatternRule[] = [
  // Credit card: 13-19 digits with optional separators, Luhn-validated
  {
    type: 'credit_card',
    pattern: /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7})\b/g,
    confidence: 0.95,
    validate: isLuhnValid,
  },
  // Email: RFC 5322 simplified
  {
    type: 'email_address',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    confidence: 0.95,
  },
  // US SSN: XXX-XX-XXXX (with dashes required to reduce false positives)
  {
    type: 'identity_number',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.95,
  },
  // Phone: E.164 and common formats (+1-234-567-8901, (234) 567-8901, etc.)
  {
    type: 'phone_number',
    pattern: /(?<!\d)(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    confidence: 0.85,
  },
];

export class DeterministicClassifier implements SensitivityClassifier {
  private readonly confidenceThreshold: number;

  public constructor(config: DeterministicClassifierConfig = {}) {
    this.confidenceThreshold = config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  }

  public async classify(text: string): Promise<SensitivityReport> {
    if (text.trim().length === 0) {
      return { entities: [], hasSensitiveContent: false };
    }

    const entities: DetectedEntity[] = [];

    for (const rule of PATTERNS) {
      const matcher = new RegExp(rule.pattern.source, rule.pattern.flags);

      for (const match of text.matchAll(matcher)) {
        const matchText = match[0];
        const start = match.index;

        if (rule.validate && !rule.validate(matchText)) {
          continue;
        }

        if (rule.confidence < this.confidenceThreshold) {
          continue;
        }

        entities.push({
          type: rule.type,
          source: 'deterministic',
          confidence: rule.confidence,
          start,
          end: start + matchText.length,
          text: matchText,
        });
      }
    }

    return {
      entities,
      hasSensitiveContent: entities.length > 0,
    };
  }
}

export const createDeterministicClassifier = (
  config: DeterministicClassifierConfig = {},
): DeterministicClassifier => new DeterministicClassifier(config);
