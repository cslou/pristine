import { randomUUID } from 'node:crypto';
import type { SensitivityReport } from '../../core/types.js';

export interface RedactionResult {
  readonly redactedText: string;
  readonly placeholders: readonly RedactionPlaceholder[];
}

export interface RedactionPlaceholder {
  readonly id: string;
  readonly type: string;
  readonly label?: string;
  readonly originalText: string;
  readonly start: number;
  readonly end: number;
}

const buildPlaceholder = (type: string, id: string): string => `[SENSITIVE:${type}:${id}]`;

/**
 * Normalize entity type to snake_case for placeholder compatibility.
 * PLACEHOLDER_REGEX requires [a-z_]+ — LLMs may return types with spaces,
 * dashes, or mixed case (e.g., "contact info - phone number").
 */
const normalizeType = (type: string): string => {
  const normalized = type
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return normalized.length > 0 ? normalized : 'other';
};

const DIGITS_RE = /\D+/g;

const digitsOnly = (value: string): string => value.replace(DIGITS_RE, '');

const lastFourLabel = (prefix: string, value: string): string => {
  const digits = digitsOnly(value);
  if (digits.length >= 4) {
    return `${prefix}-${digits.slice(-4)}`;
  }
  return `${prefix}-saved`;
};

const detectCardNetwork = (value: string): string => {
  const digits = digitsOnly(value);
  if (/^4\d{12}(\d{3}){0,2}$/.test(digits)) return 'visa';
  if (/^(5[1-5]\d{14}|2(2[2-9]\d{12}|[3-6]\d{13}|7([01]\d{12}|20\d{12})))$/.test(digits))
    return 'mastercard';
  if (/^3[47]\d{13}$/.test(digits)) return 'amex';
  if (/^(6011\d{12}|65\d{14}|64[4-9]\d{13})$/.test(digits)) return 'discover';
  return 'card';
};

const buildPlaceholderLabel = (type: string, originalText: string): string => {
  const normalized = originalText.trim();

  switch (type) {
    case 'credit_card': {
      const network = detectCardNetwork(normalized);
      return lastFourLabel(network, normalized);
    }
    case 'bank_account':
      return lastFourLabel('account', normalized);
    case 'phone_number':
      return lastFourLabel('phone', normalized);
    case 'identity_number':
      return lastFourLabel('id', normalized);
    case 'passport':
      return lastFourLabel('passport', normalized);
    case 'ssn':
      return lastFourLabel('ssn', normalized);
    case 'email_address': {
      const m = /^([^@\s]+)@([^@\s]+)$/i.exec(normalized);
      if (!m || !m[1] || !m[2]) {
        return 'email-saved';
      }
      const local = m[1];
      const domain = m[2].toLowerCase();
      const localPrefix = (local[0] ?? 'x').toLowerCase();
      return `${localPrefix}***@${domain}`;
    }
    case 'physical_address':
      return 'address-saved';
    default:
      return `${type}-saved`;
  }
};

export const redactText = (text: string, report: SensitivityReport): RedactionResult => {
  if (!report.hasSensitiveContent || report.entities.length === 0) {
    return { redactedText: text, placeholders: [] };
  }

  const sorted = [...report.entities].sort((a, b) => a.start - b.start);
  const placeholders: RedactionPlaceholder[] = [];
  let result = '';
  let cursor = 0;

  for (const entity of sorted) {
    if (entity.start < cursor) {
      continue;
    }

    result += text.slice(cursor, entity.start);

    const id = randomUUID();
    const safeType = normalizeType(entity.type);
    const placeholder = buildPlaceholder(safeType, id);
    result += placeholder;

    placeholders.push({
      id,
      type: safeType,
      label: buildPlaceholderLabel(safeType, entity.text),
      originalText: entity.text,
      start: entity.start,
      end: entity.end,
    });

    cursor = entity.end;
  }

  result += text.slice(cursor);

  return { redactedText: result, placeholders };
};
