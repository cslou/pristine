import { randomUUID } from 'node:crypto';
import { InvalidArgumentError } from '../../core/errors.js';
import type {
  RedactConfirmedSecret,
  RedactOptions,
  RedactResult,
  RedactResultRedaction,
  SourceSpan,
} from '../../core/types.js';
import { computeKeyFingerprint } from '../vault/asymmetric-crypto.js';
import { encryptAndWrapValue } from '../vault/asymmetric-encrypt.js';

const buildPlaceholder = (type: string, id: string): string => `[SENSITIVE:${type}:${id}]`;

const normalizeType = (type: string): string => {
  const normalized = type
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return normalized.length > 0 ? normalized : 'other';
};

const assertNonEmptyString = (value: string, fieldName: string): void => {
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

const safeAlias = (label: string | undefined, rawValue: string): string | undefined => {
  if (!label || label.trim().length === 0) return undefined;
  const trimmed = label.trim();
  if (trimmed === rawValue || trimmed.includes(rawValue) || rawValue.includes(trimmed)) {
    return undefined;
  }
  return trimmed;
};

const validateConfirmedSecrets = (
  text: string,
  confirmed: readonly RedactConfirmedSecret[],
): readonly RedactConfirmedSecret[] => {
  if (!Array.isArray(confirmed)) {
    throw new InvalidArgumentError('redact: confirmed must be an array');
  }

  const sorted = [...confirmed].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start);
  let cursor = 0;

  for (const [index, secret] of sorted.entries()) {
    assertValidSpan(secret.sourceSpan, text.length, `confirmed[${index}]`);
    assertNonEmptyString(secret.type, `confirmed[${index}].type`);
    if (secret.candidateId !== undefined) {
      assertNonEmptyString(secret.candidateId, `confirmed[${index}].candidateId`);
    }
    if (secret.label !== undefined && typeof secret.label !== 'string') {
      throw new InvalidArgumentError(`redact: confirmed[${index}].label must be a string`);
    }
    if (secret.sourceSpan.start < cursor) {
      throw new InvalidArgumentError('redact: confirmed sourceSpans must not overlap');
    }
    cursor = secret.sourceSpan.end;
  }

  return sorted;
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

  const { publicKey } = await options.keyManager.getOrCreateKeyPair(userId);
  const fingerprint = computeKeyFingerprint(publicKey);
  const kek = await options.kekManager.getOrCreate(userId);

  let redactedText = '';
  let sourceCursor = 0;
  const pendingRedactions: Array<{
    readonly redaction: RedactResultRedaction;
    readonly rawValue: string;
    readonly placeholderId: string;
  }> = [];

  for (const secret of sorted) {
    const rawValue = text.slice(secret.sourceSpan.start, secret.sourceSpan.end);
    const type = normalizeType(secret.type);
    const placeholderId = randomUUID();
    const placeholder = buildPlaceholder(type, placeholderId);

    redactedText += text.slice(sourceCursor, secret.sourceSpan.start);
    const redactedStart = redactedText.length;
    redactedText += placeholder;
    const redactedEnd = redactedText.length;
    sourceCursor = secret.sourceSpan.end;

    const alias = safeAlias(secret.label, rawValue);
    pendingRedactions.push({
      rawValue,
      placeholderId,
      redaction: {
        candidateId: secret.candidateId,
        sensitiveRef: placeholderId,
        placeholder,
        type,
        label: secret.label,
        alias,
        sourceSpan: secret.sourceSpan,
        redactedSpan: { start: redactedStart, end: redactedEnd },
      },
    });
  }

  redactedText += text.slice(sourceCursor);

  await options.vaultStore.addEntries(
    pendingRedactions.map(({ rawValue, placeholderId, redaction }) => ({
      userId,
      placeholderId,
      sensitiveType: redaction.type,
      encrypted: encryptAndWrapValue(rawValue, redaction.type, placeholderId, kek, fingerprint),
    })),
  );

  for (const { redaction } of pendingRedactions) {
    if (redaction.alias) {
      await options.vaultStore.updateEntry(userId, redaction.sensitiveRef, {
        alias: redaction.alias,
      });
    }
  }

  return {
    text: redactedText,
    redactions: pendingRedactions.map(({ redaction }) => redaction),
  };
};
