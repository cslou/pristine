import type { DetectedEntity } from '../core/types.js';

export const PLACEHOLDER_RE = /\[SENSITIVE:[^\]]+\]/g;

interface SafetyRule {
  readonly type: string;
  readonly pattern: RegExp;
  readonly confidence: number;
  readonly validate?: (match: string) => boolean;
}

const CREDIT_CARD_RE = /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7})\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const PHONE_RE = /(?<!\d)(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const SECRET_RE =
  /\b(?:api[_ -]?key|access[_ -]?token|auth[_ -]?token|secret|password)\b\s*[:=]\s*[^\s,;]+/gi;

const isLuhnValid = (digits: string): boolean => {
  const nums = digits.replace(/\D/g, '');
  if (nums.length < 13 || nums.length > 19) {
    return false;
  }

  let sum = 0;
  let alternate = false;
  for (let i = nums.length - 1; i >= 0; i--) {
    let value = Number.parseInt(nums[i] ?? '', 10);
    if (alternate) {
      value *= 2;
      if (value > 9) {
        value -= 9;
      }
    }
    sum += value;
    alternate = !alternate;
  }

  return sum % 10 === 0;
};

const SAFETY_RULES: readonly SafetyRule[] = [
  { type: 'credit_card', pattern: CREDIT_CARD_RE, confidence: 0.99, validate: isLuhnValid },
  { type: 'email_address', pattern: EMAIL_RE, confidence: 0.99 },
  { type: 'identity_number', pattern: SSN_RE, confidence: 0.99 },
  { type: 'phone_number', pattern: PHONE_RE, confidence: 0.95 },
  { type: 'secret', pattern: SECRET_RE, confidence: 0.99 },
];

const sortAndDedupeViolations = (entities: DetectedEntity[]): DetectedEntity[] => {
  const sorted = [...entities].sort((a, b) => a.start - b.start || a.end - b.end);
  const deduped: DetectedEntity[] = [];

  for (const entity of sorted) {
    const duplicate = deduped.some(
      (existing) =>
        existing.start === entity.start && existing.end === entity.end && existing.type === entity.type,
    );
    if (!duplicate) {
      deduped.push(entity);
    }
  }

  return deduped;
};

export const replacePlaceholdersWithWhitespace = (text: string): string => {
  return text.replace(PLACEHOLDER_RE, (match) => ' '.repeat(match.length));
};

export const stripSensitivePlaceholders = (text: string): string => text.replace(PLACEHOLDER_RE, '');

export const findSafetyViolations = (text: string): readonly DetectedEntity[] => {
  const scanText = replacePlaceholdersWithWhitespace(text);
  const entities: DetectedEntity[] = [];

  for (const rule of SAFETY_RULES) {
    const matcher = new RegExp(rule.pattern.source, rule.pattern.flags);

    for (const match of scanText.matchAll(matcher)) {
      const matchText = match[0];
      const start = match.index;

      if (start === undefined) {
        continue;
      }

      if (rule.validate && !rule.validate(matchText)) {
        continue;
      }

      entities.push({
        type: rule.type,
        source: 'deterministic',
        confidence: rule.confidence,
        start,
        end: start + matchText.length,
        text: text.slice(start, start + matchText.length),
      });
    }
  }

  return sortAndDedupeViolations(entities);
};

export const scrubStructuredSensitivePatterns = (text: string): string => {
  let scrubbed = text;

  for (const rule of SAFETY_RULES) {
    const matcher = new RegExp(rule.pattern.source, rule.pattern.flags);
    scrubbed = scrubbed.replace(matcher, (match) => {
      if (rule.validate && !rule.validate(match)) {
        return match;
      }
      return '';
    });
  }

  return scrubbed;
};
