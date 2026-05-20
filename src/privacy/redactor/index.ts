import { randomUUID } from 'node:crypto';
import { InvalidArgumentError } from '../../core/errors.js';
import type {
  RedactConfirmedSecret,
  RedactOptions,
  RedactResult,
  RedactResultRedaction,
  SourceSpan,
} from '../../core/types.js';
import { persistRedactions, type PendingRedactionWrite } from './vault-writer.js';

const buildPlaceholder = (type: string, id: string): string => `[SENSITIVE:${type}:${id}]`;

const normalizePlaceholderType = (type: string): string => {
  const normalized = type
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return normalized.length > 0 ? normalized : 'other';
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const assertNonEmptyString = (value: unknown, fieldName: string): void => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidArgumentError(`redact: ${fieldName} must be a non-empty string`);
  }
};

const assertValidSpan = (span: SourceSpan, textLength: number, label: string): void => {
  if (
    !Number.isInteger(span.start) ||
    !Number.isInteger(span.end) ||
    span.start < 0 ||
    span.end <= span.start ||
    span.end > textLength
  ) {
    throw new InvalidArgumentError(`redact: ${label} has an invalid sourceSpan`);
  }
};

const safeLabel = (label: string | undefined, rawValue: string): string | undefined => {
  if (!label || label.trim().length === 0) return undefined;
  const trimmed = label.trim();
  if (trimmed === rawValue || trimmed.includes(rawValue) || rawValue.includes(trimmed)) {
    return undefined;
  }
  return trimmed;
};

const assertConfirmedShape: (
  value: unknown,
  index: number,
) => asserts value is RedactConfirmedSecret = (value, index) => {
  if (!isRecord(value) || !isRecord(value.sourceSpan)) {
    throw new InvalidArgumentError(`redact: confirmed[${index}] must include a sourceSpan`);
  }
};

const validateConfirmedSecrets = (
  text: string,
  confirmed: readonly RedactConfirmedSecret[],
): readonly RedactConfirmedSecret[] => {
  if (!Array.isArray(confirmed)) {
    throw new InvalidArgumentError('redact: confirmed must be an array');
  }

  for (const [index, secret] of confirmed.entries()) {
    assertConfirmedShape(secret, index);
    assertValidSpan(secret.sourceSpan, text.length, `confirmed[${index}]`);
    assertNonEmptyString(secret.type, `confirmed[${index}].type`);
    if (secret.candidateId !== undefined) {
      assertNonEmptyString(secret.candidateId, `confirmed[${index}].candidateId`);
    }
    if (secret.label !== undefined && typeof secret.label !== 'string') {
      throw new InvalidArgumentError(`redact: confirmed[${index}].label must be a string`);
    }
  }

  const sorted = [...confirmed].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start);
  let cursor = 0;
  for (const secret of sorted) {
    if (secret.sourceSpan.start < cursor) {
      throw new InvalidArgumentError('redact: confirmed sourceSpans must not overlap');
    }
    cursor = secret.sourceSpan.end;
  }

  return sorted;
};

const buildRedactionWrites = (
  text: string,
  confirmed: readonly RedactConfirmedSecret[],
): { readonly text: string; readonly pending: readonly PendingRedactionWrite[] } => {
  let redactedText = '';
  let sourceCursor = 0;
  const pending: PendingRedactionWrite[] = [];

  for (const secret of confirmed) {
    const rawValue = text.slice(secret.sourceSpan.start, secret.sourceSpan.end);
    const placeholderType = normalizePlaceholderType(secret.type);
    const placeholderId = randomUUID();
    const placeholder = buildPlaceholder(placeholderType, placeholderId);

    redactedText += text.slice(sourceCursor, secret.sourceSpan.start);
    const redactedStart = redactedText.length;
    redactedText += placeholder;
    const redactedEnd = redactedText.length;
    sourceCursor = secret.sourceSpan.end;

    const label = safeLabel(secret.label, rawValue);
    const redaction: RedactResultRedaction = {
      candidateId: secret.candidateId,
      sensitiveRef: placeholderId,
      placeholder,
      type: secret.type,
      label,
      sourceSpan: secret.sourceSpan,
      redactedSpan: { start: redactedStart, end: redactedEnd },
    };
    pending.push({ rawValue, placeholderId, vaultType: secret.type, redaction });
  }

  return { text: redactedText + text.slice(sourceCursor), pending };
};

export const redact = async (
  text: string,
  confirmed: readonly RedactConfirmedSecret[],
  userId: string,
  options: RedactOptions,
): Promise<RedactResult> => {
  if (typeof text !== 'string') throw new InvalidArgumentError('redact: text must be a string');
  assertNonEmptyString(userId, 'userId');
  if (!options || typeof options !== 'object') {
    throw new InvalidArgumentError(
      'redact: options must include vaultStore, keyManager, and kekManager',
    );
  }
  if (!options.vaultStore || !options.keyManager || !options.kekManager) {
    throw new InvalidArgumentError(
      'redact: options must include vaultStore, keyManager, and kekManager',
    );
  }

  const sorted = validateConfirmedSecrets(text, confirmed);
  if (sorted.length === 0) return { text, redactions: [] };

  const built = buildRedactionWrites(text, sorted);
  await persistRedactions(userId, options, built.pending);

  return {
    text: built.text,
    redactions: built.pending.map(({ redaction }) => redaction),
  };
};
