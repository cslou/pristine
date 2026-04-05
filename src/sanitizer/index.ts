import type {
  SensitivePlaceholderMatch,
  ResolveInput,
  ApprovalDecisionPayload,
  ApprovalRequestPayload,
  SensitiveField,
  SanitizedMemory,
} from './types.js';
import { ResolveApprovalError, ResolveApprovalTimeoutError } from '../core/errors.js';

export const PLACEHOLDER_REGEX = /\[SENSITIVE:([a-z_]+):([0-9a-f-]+)\]/;

const NO_REENTRY_METADATA = Symbol('memory.resolve.noLlmReentry');

const resolvedStringRegistry = new Set<string>();

export const clearResolvedStringRegistry = (): void => {
  resolvedStringRegistry.clear();
};

const isObjectLike = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const asApprovedLookup = (approvedValues?: ResolveInput['approvedValues']): Map<string, string> => {
  if (approvedValues === undefined) {
    return new Map();
  }

  if (approvedValues instanceof Map) {
    return new Map(approvedValues);
  }

  return new Map(Object.entries(approvedValues));
};

const collectFromText = (text: string): SensitivePlaceholderMatch[] => {
  const placeholderMatcher = new RegExp(PLACEHOLDER_REGEX.source, 'g');
  const matches = text.matchAll(placeholderMatcher);
  const collected: SensitivePlaceholderMatch[] = [];

  for (const match of matches) {
    const placeholder = match[0];
    const type = match[1];
    const id = match[2];

    if (type === undefined || id === undefined || placeholder === undefined) {
      continue;
    }

    collected.push({
      placeholder,
      type,
      id,
    });
  }

  return collected;
};

export const collectPlaceholders = (payload: unknown): SensitivePlaceholderMatch[] => {
  const collected: SensitivePlaceholderMatch[] = [];

  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      collected.push(...collectFromText(value));
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        walk(entry);
      }
      return;
    }

    if (isObjectLike(value)) {
      for (const key of Object.keys(value)) {
        walk(value[key]);
      }
    }
  };

  walk(payload);
  return collected;
};

const collectUniquePlaceholders = (
  matches: SensitivePlaceholderMatch[],
): SensitivePlaceholderMatch[] => {
  const seen = new Set<string>();
  const unique: SensitivePlaceholderMatch[] = [];

  for (const match of matches) {
    if (seen.has(match.id)) {
      continue;
    }
    seen.add(match.id);
    unique.push(match);
  }

  return unique;
};

const defaultApprovalTimeoutMs = 5_000;

const applyDecisionPayload = (
  payload: ApprovalDecisionPayload,
  approvedValues: Map<string, string>,
): void => {
  if (!Array.isArray(payload.decisions)) {
    throw new ResolveApprovalError('Approval callback must return an array of decisions.');
  }

  for (const decision of payload.decisions) {
    if (typeof decision.id !== 'string' || decision.id.length === 0) {
      continue;
    }

    if (!decision.approved) {
      approvedValues.delete(decision.id);
      continue;
    }

    if (typeof decision.value === 'string' && decision.value.length > 0) {
      approvedValues.set(decision.id, decision.value);
    }
  }
};

const assertChallengeSucceeded = (payload: ApprovalDecisionPayload): void => {
  if (payload.challengeSuccess !== true) {
    throw new ResolveApprovalError('Approval challenge was not successful.');
  }
};

const approvePlaceholders = async (
  payload: unknown,
  input: ResolveInput,
): Promise<Map<string, string>> => {
  const allMatches = collectPlaceholders(payload);
  const uniqueMatches = collectUniquePlaceholders(allMatches);

  if (input.approvalCallback === undefined || uniqueMatches.length === 0) {
    return asApprovedLookup(input.approvedValues);
  }

  const request: ApprovalRequestPayload = {
    requestId: crypto.randomUUID(),
    placeholders: uniqueMatches,
  };

  const timeoutMs = input.approvalTimeoutMs ?? defaultApprovalTimeoutMs;
  const approvedValues = asApprovedLookup(input.approvedValues);

  let response: ApprovalDecisionPayload;
  try {
    response = await Promise.race([
      input.approvalCallback(request),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new ResolveApprovalTimeoutError(
              `Approval callback timed out after ${timeoutMs}ms for request ${request.requestId}.`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } catch (error: unknown) {
    if (error instanceof ResolveApprovalTimeoutError) {
      throw error;
    }
    throw new ResolveApprovalError(
      error instanceof Error ? error.message : 'Approval callback failed.',
    );
  }

  if (response.requestId !== request.requestId) {
    throw new ResolveApprovalError('Approval callback returned an unexpected request id.');
  }

  assertChallengeSucceeded(response);
  applyDecisionPayload(response, approvedValues);

  return approvedValues;
};

const replacePlaceholdersInText = (text: string, approvedLookup: Map<string, string>): string => {
  if (approvedLookup.size === 0) {
    return text;
  }

  const placeholderMatcher = new RegExp(PLACEHOLDER_REGEX.source, 'g');
  return text.replace(placeholderMatcher, (_match, _type: string, id: string) => {
    const replacement = approvedLookup.get(id);
    return replacement === undefined ? _match : replacement;
  });
};

const resolvePayload = (payload: unknown, approvedLookup: Map<string, string>): unknown => {
  if (typeof payload === 'string') {
    return replacePlaceholdersInText(payload, approvedLookup);
  }

  if (Array.isArray(payload)) {
    return payload.map((entry) => resolvePayload(entry, approvedLookup));
  }

  if (isObjectLike(payload)) {
    const resolved: Record<string, unknown> = {};
    for (const key of Object.keys(payload)) {
      resolved[key] = resolvePayload(payload[key], approvedLookup);
    }
    return resolved;
  }

  return payload;
};

const markNoLlmReentryDeep = <TInput>(payload: TInput): TInput => {
  if (typeof payload === 'string' || payload === null || payload === undefined) {
    return payload;
  }

  if (Array.isArray(payload)) {
    const copied = payload.map((entry) => markNoLlmReentryDeep(entry));
    Object.defineProperty(copied, NO_REENTRY_METADATA, {
      value: true,
      enumerable: false,
      configurable: false,
    });
    return copied as TInput;
  }

  if (isObjectLike(payload)) {
    const copied: Record<string, unknown> = {};
    for (const key of Object.keys(payload)) {
      copied[key] = markNoLlmReentryDeep((payload as Record<string, unknown>)[key]);
    }
    Object.defineProperty(copied, NO_REENTRY_METADATA, {
      value: true,
      enumerable: false,
      configurable: false,
    });
    return copied as TInput;
  }

  return payload;
};

const markNoLlmReentry = <TInput>(payload: TInput): TInput => {
  if (typeof payload === 'string') {
    resolvedStringRegistry.add(payload);
    return payload;
  }

  return markNoLlmReentryDeep(payload);
};

const hasNoLlmMarkerDeep = (payload: unknown): boolean => {
  if (payload === null || payload === undefined || typeof payload === 'string') {
    return false;
  }

  if (Array.isArray(payload) || isObjectLike(payload)) {
    if (Object.prototype.hasOwnProperty.call(payload, NO_REENTRY_METADATA)) {
      return true;
    }

    if (Array.isArray(payload)) {
      return payload.some(hasNoLlmMarkerDeep);
    }

    return Object.keys(payload).some((key) =>
      hasNoLlmMarkerDeep((payload as Record<string, unknown>)[key]),
    );
  }

  return false;
};

const hasNoLlmMarker = (payload: unknown): boolean => {
  if (typeof payload === 'string') {
    return resolvedStringRegistry.has(payload);
  }

  return hasNoLlmMarkerDeep(payload);
};

export const assertNoLlmReentry = (payload: unknown, operation = 'LLM payload'): void => {
  if (hasNoLlmMarker(payload)) {
    throw new ResolveApprovalError(`Resolved payload is not allowed for ${operation}.`);
  }
};

export const resolve = <TInput>(
  payload: TInput,
  input: ResolveInput = {},
): TInput | Promise<TInput> => {
  if (input.approvalCallback === undefined) {
    const approvedValues = asApprovedLookup(input.approvedValues);
    return markNoLlmReentry(resolvePayload(payload, approvedValues)) as TInput;
  }

  return (async () => {
    const approvedValues = await approvePlaceholders(payload, input);
    return markNoLlmReentry(resolvePayload(payload, approvedValues) as TInput);
  })();
};

// --- Sanitizer ---

const TYPE_DESCRIPTIONS: Record<string, string> = {
  identity_number: 'Identity number',
  bank_account: 'Bank account number',
  credit_card: 'Credit card number',
  phone_number: 'Phone number',
  email_address: 'Email address',
  address: 'Address',
  physical_address: 'Address',
  health: 'Health information',
  financial: 'Financial information',
  relationship: 'Relationship information',
  legal: 'Legal information',
  other: 'Sensitive information',
};

const descriptionForType = (type: string): string => {
  return TYPE_DESCRIPTIONS[type] ?? 'Sensitive information';
};

const naturalTextForType = (type: string): string => {
  const description = descriptionForType(type);
  return `[${description}]`;
};

const createUniqueSensitiveFieldId = (id: string, index: number): string => {
  return index === 0 ? id : `${id}-${index + 1}`;
};

const normalizeAndOrderSensitiveFields = (fields: SensitiveField[]): SensitiveField[] => {
  const seen = new Map<string, number>();

  const normalized = fields.map((field) => {
    const seenIndex = seen.get(field.id) ?? 0;
    seen.set(field.id, seenIndex + 1);

    return {
      ...field,
      id: createUniqueSensitiveFieldId(field.id, seenIndex),
    };
  });

  return normalized.sort((a, b) => a.id.localeCompare(b.id));
};

export const sanitizeText = (text: string): SanitizedMemory => {
  const sensitiveFields: SensitiveField[] = [];
  const placeholderMatcher = new RegExp(PLACEHOLDER_REGEX.source, 'g');

  const sanitized = text.replace(placeholderMatcher, (_match, type: string, id: string) => {
    sensitiveFields.push({
      id,
      type,
      description: descriptionForType(type),
      status: 'requires_approval' as const,
    });
    return naturalTextForType(type);
  });

  return {
    text: sanitized,
    sensitiveFields: normalizeAndOrderSensitiveFields(sensitiveFields),
  };
};

export type {
  SensitiveField,
  SanitizedMemory,
  SensitivePlaceholderMatch,
  ResolveInput,
  ApprovalRequestPayload,
  ApprovalDecision,
  ApprovalDecisionPayload,
} from './types.js';
