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
const TEMPORAL_TYPE_RE =
  /\b(date|time|datetime|timestamp|schedule|itinerary|travel|check_?in|check_?out)\b/i;
const DOB_TYPE_RE = /\b(dob|date_of_birth|birth(?:day|date)?)\b/i;
const DOB_CONTEXT_RE = /\b(dob|date of birth|birth(?:day|date)?|born on)\b/i;
const DATE_VALUE_RE =
  /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?)\b/i;
const TEMPORAL_WORD_RE =
  /\b(today|tomorrow|yesterday|next|this|last|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|checkin|checkout)\b/i;
const TRAVEL_SCHEDULING_RE =
  /\b(depart|departure|arrive|arrival|return|itinerary|trip|travel|flight|hotel|check[\s_-]?in|check[\s_-]?out)\b/i;
const STREET_TOKEN_RE =
  /\b(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way|highway|hwy|block|blk|unit|apt|suite|floor|flr|postal|postcode|zip)\b/i;
const HOUSE_NUMBER_RE = /\b\d{1,6}[a-z]?\b/i;
const ZIPISH_RE = /\b\d{5}(?:-\d{4})?\b/;
const ADDRESS_CONTEXT_RE = /\b(address|live at|reside(?:s|d)? at|located at|ship to|mail to)\b/i;
const EMAIL_RE = /\b[^@\s]+@[^@\s]+\.[^@\s]+\b/;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/;
const LONG_DIGIT_RE = /\b\d{8,}\b/;
const CARDISH_RE = /\b(?:\d[ -]?){13,19}\b/;
const GOVT_ID_RE = /\b[A-Z]\d{6,}\b/i;
const ISO_DATE_ONLY_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;

const digitsOnly = (value: string): string => value.replace(DIGITS_RE, '');

const isPhoneLike = (value: string): boolean => {
  const normalized = value.trim();
  if (ISO_DATE_ONLY_RE.test(normalized)) {
    return false;
  }
  if (!PHONE_RE.test(normalized)) {
    return false;
  }
  return digitsOnly(normalized).length >= 10;
};

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

const isLikelyNonSensitiveTemporalText = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 220) {
    return false;
  }
  const hasTemporalSignal =
    DATE_VALUE_RE.test(normalized) ||
    TEMPORAL_WORD_RE.test(normalized) ||
    TRAVEL_SCHEDULING_RE.test(normalized);
  if (!hasTemporalSignal) {
    return false;
  }

  const hasStrongSensitiveCue =
    EMAIL_RE.test(normalized) ||
    isPhoneLike(normalized) ||
    LONG_DIGIT_RE.test(normalized) ||
    CARDISH_RE.test(normalized) ||
    GOVT_ID_RE.test(normalized);

  return !hasStrongSensitiveCue;
};

const isLikelyFullAddress = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const hasStreetToken = STREET_TOKEN_RE.test(normalized);
  const hasNumber = HOUSE_NUMBER_RE.test(normalized);
  const hasZip = ZIPISH_RE.test(normalized);
  const hasComma = normalized.includes(',');

  if ((hasStreetToken && hasNumber) || hasZip) {
    return true;
  }

  if (hasComma && tokens.length >= 4 && (hasStreetToken || hasNumber)) {
    return true;
  }

  return false;
};

const shouldRedactEntity = (
  entityType: string,
  entityText: string,
  sourceText: string,
  entityStart: number,
  entityEnd: number,
): boolean => {
  const normalizedType = entityType.trim().toLowerCase();

  if (DOB_TYPE_RE.test(normalizedType)) {
    return true;
  }

  const context = sourceText
    .slice(Math.max(0, entityStart - 24), Math.min(sourceText.length, entityEnd + 24))
    .toLowerCase();
  if (DOB_CONTEXT_RE.test(context)) {
    return true;
  }

  if (normalizedType === 'physical_address') {
    const addressLike = isLikelyFullAddress(entityText);
    if (!addressLike && !ADDRESS_CONTEXT_RE.test(context)) {
      return false;
    }
  }

  if (
    (normalizedType === 'other' || TEMPORAL_TYPE_RE.test(normalizedType)) &&
    isLikelyNonSensitiveTemporalText(entityText)
  ) {
    return false;
  }

  return true;
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

    if (!shouldRedactEntity(entity.type, entity.text, text, entity.start, entity.end)) {
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
