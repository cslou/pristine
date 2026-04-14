import type { SensitivityType } from '../../../core/types.js';

export interface DeterministicPatternRule {
  readonly type: SensitivityType;
  readonly pattern: RegExp;
  readonly confidence: number;
  readonly validate?: (match: string) => boolean;
}

/**
 * Luhn algorithm for credit card validation.
 * Returns true if the digit string passes the Luhn checksum.
 */
export const isLuhnValid = (digits: string): boolean => {
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

export const DETERMINISTIC_PATTERN_RULES: readonly DeterministicPatternRule[] = [
  {
    type: 'credit_card',
    pattern: /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7})\b/g,
    confidence: 0.95,
    validate: isLuhnValid,
  },
  {
    type: 'email_address',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    confidence: 0.95,
  },
  {
    type: 'identity_number',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.95,
  },
  {
    type: 'phone_number',
    pattern: /(?<!\d)(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    confidence: 0.85,
  },
  {
    type: 'secret',
    pattern:
      /\b(?:api[_ -]?key|access[_ -]?token|auth[_ -]?token|secret|password)\b\s*[:=]\s*[^\s,;]+/gi,
    confidence: 0.95,
  },
];
