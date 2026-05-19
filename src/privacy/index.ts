import { createDecipheriv } from 'node:crypto';
import type { KeyManager, PrivacyPipeline, VaultStore } from '../core/interfaces.js';
import { PLACEHOLDER_REGEX, collectPlaceholders, resolve } from './sanitizer/index.js';
import { encryptAndWrapValue } from './vault/asymmetric-encrypt.js';
import { computeKeyFingerprint, unwrapDek } from './vault/asymmetric-crypto.js';
import { decodeBase64Url } from './vault/base64url.js';
import { toApprovedValue } from './vault/sqlite/index.js';
import { createPrivacyPipeline } from './pipeline.js';
import {
  createDeterministicPatternRuleSet,
  type DeterministicClassifierConfig,
} from './classifier/deterministic/index.js';
import type { KekManager } from './kek/kek-manager.js';
import { unwrapDekWithKek } from './kek/kek-manager.js';
import type {
  ClassifierCallback,
  ClassifyOptions,
  ClassifyResult,
  DetectCandidate,
  DetectOptions,
  DetectResult,
  DeleteSensitiveResult,
  ListSensitiveOptions,
  RedactConfirmedSecret,
  RedactOptions,
  RedactResult,
  RevealResult,
  SecureAndRedactResult,
  SensitiveRef,
  SensitiveSummary,
  UpdateSensitiveInput,
  VaultEntry,
} from '../core/types.js';
import { scrubStructuredSensitivePatterns } from './safety-scan.js';
import {
  InvalidArgumentError,
  PrivacyPipelineError,
  SensitiveNotFoundError,
} from '../core/errors.js';

export interface SecureAndRedactConfig {
  readonly vaultStore: VaultStore;
  readonly keyManager: KeyManager;
  readonly kekManager: KekManager;
  readonly userId: string;
  readonly classifier?: DeterministicClassifierConfig;
  readonly pipeline?: PrivacyPipeline;
}

export interface RevealConfig {
  readonly vaultStore: VaultStore;
  readonly keyManager: KeyManager;
  readonly kekManager: KekManager;
  readonly userId: string;
}

export interface SensitiveConfig {
  readonly vaultStore: VaultStore;
  readonly userId: string;
}

const PIPELINE_CACHE = new Map<string, PrivacyPipeline>();

const classifierCacheKey = (config?: DeterministicClassifierConfig): string =>
  JSON.stringify(config ?? {});

const resolvePrivacyPipeline = (config: SecureAndRedactConfig): PrivacyPipeline => {
  if (config.pipeline) {
    return config.pipeline;
  }

  const cacheKey = classifierCacheKey(config.classifier);
  const cached = PIPELINE_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pipeline = createPrivacyPipeline({ classifier: config.classifier });
  PIPELINE_CACHE.set(cacheKey, pipeline);
  return pipeline;
};

const includeWarnings = <T extends object>(value: T, warnings?: readonly string[]): T => {
  if (!warnings || warnings.length === 0) {
    return value;
  }
  return { ...value, warnings };
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const uniqueStrings = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
};

const assertNonEmptyUserId = (userId: string, operation: string): void => {
  if (userId.trim().length === 0) {
    throw new InvalidArgumentError(`${operation}: userId must be a non-empty string`);
  }
};

const assertNonEmptySensitiveRef = (sensitiveRef: SensitiveRef, operation: string): void => {
  if (sensitiveRef.trim().length === 0) {
    throw new InvalidArgumentError(`${operation}: sensitiveRef must be a non-empty string`);
  }
};

const decryptEntries = async (
  entries: readonly VaultEntry[],
  config: RevealConfig,
): Promise<Map<string, string>> => {
  if (entries.length === 0) {
    return new Map();
  }

  const { privateKey } = await config.keyManager.getOrCreateKeyPair(config.userId);
  const kek = await config.kekManager.getOrCreate(config.userId);
  const approvedValues = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.placeholderId) continue;

    const envelope = toApprovedValue(entry);
    const wrappedDekBuf = Buffer.from(decodeBase64Url(envelope.wrappedDek));

    let dek: Buffer;
    if (envelope.keyWrapping === 'aes-256-kw+rsa-oaep-256') {
      dek = unwrapDekWithKek(wrappedDekBuf, kek);
    } else {
      dek = unwrapDek(wrappedDekBuf, privateKey);
    }

    const ciphertext = Buffer.from(decodeBase64Url(envelope.ciphertext));
    const iv = Buffer.from(decodeBase64Url(envelope.iv));
    const authTag = Buffer.from(decodeBase64Url(envelope.authTag));

    const decipher = createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAAD(Buffer.from(envelope.aad));
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    approvedValues.set(entry.placeholderId, decrypted.toString('utf8'));
  }

  return approvedValues;
};

export function detect(text: string, options: DetectOptions = {}): DetectResult {
  if (typeof text !== 'string') {
    throw new InvalidArgumentError('detect: text must be a string');
  }

  return options.sourceSurface
    ? { sourceSurface: options.sourceSurface, candidates: [] }
    : { candidates: [] };
}

export async function classify(
  text: string,
  candidates: readonly DetectCandidate[],
  classifierCallback: ClassifierCallback,
  options: ClassifyOptions = {},
): Promise<ClassifyResult> {
  void text;
  void candidates;
  void classifierCallback;
  void options;
  throw new PrivacyPipelineError('classify primitive implementation is not available yet');
}

export async function redact(
  text: string,
  confirmed: readonly RedactConfirmedSecret[],
  userId: string,
  options: RedactOptions = {},
): Promise<RedactResult> {
  void text;
  void confirmed;
  void userId;
  void options;
  throw new PrivacyPipelineError('redact primitive implementation is not available yet');
}

/**
 * Classify text for sensitive content, redact detected entities with placeholders,
 * encrypt original values, and store them in the vault.
 */
export async function secureAndRedact(
  text: string,
  config: SecureAndRedactConfig,
): Promise<SecureAndRedactResult> {
  const pipeline = resolvePrivacyPipeline(config);
  const { report, redaction, safetyViolations } = await pipeline.classifyAndRedact(text);
  const redactedText = redaction?.redactedText ?? text;
  const warnings = report.warnings;

  if (safetyViolations.length > 0) {
    return includeWarnings(
      {
        ok: false,
        reason: 'safety_scan',
        redactedText,
        safetyViolations,
      },
      warnings,
    );
  }

  const placeholders = redaction?.placeholders ?? [];

  if (placeholders.length === 0) {
    return includeWarnings({ ok: true, redactedText, placeholderIds: [] }, warnings);
  }

  const { publicKey } = await config.keyManager.getOrCreateKeyPair(config.userId);
  const fingerprint = computeKeyFingerprint(publicKey);
  const kek = await config.kekManager.getOrCreate(config.userId);

  const vaultEntries = placeholders.map((placeholder) => ({
    userId: config.userId,
    placeholderId: placeholder.id,
    sensitiveType: placeholder.type,
    encrypted: encryptAndWrapValue(
      placeholder.originalText,
      placeholder.type,
      placeholder.id,
      kek,
      fingerprint,
    ),
  }));

  await config.vaultStore.addEntries(vaultEntries);

  return includeWarnings(
    {
      ok: true,
      redactedText,
      placeholderIds: placeholders.map((placeholder) => placeholder.id),
    },
    warnings,
  );
}

/**
 * Retrieve encrypted values from the vault, decrypt with the private key,
 * and replace placeholders with the original values.
 * The result is marked as no-LLM-reentry to prevent accidental re-classification.
 */
export async function reveal(redactedText: string, config: RevealConfig): Promise<RevealResult> {
  const matches = collectPlaceholders(redactedText);
  if (matches.length === 0) {
    return { text: redactedText, revealedValues: [] };
  }

  const placeholderIds = matches.map((m) => m.id);
  const entries = await config.vaultStore.getEntriesByPlaceholderIds(config.userId, placeholderIds);

  if (entries.length === 0) {
    return { text: redactedText, revealedValues: [] };
  }

  const approvedValues = await decryptEntries(entries, config);

  const text = resolve(redactedText, { approvedValues }) as string;
  const revealedValues = uniqueStrings(
    matches
      .map((match) => approvedValues.get(match.id))
      .filter((value): value is string => typeof value === 'string'),
  );

  return { text, revealedValues };
}

export async function listSensitive(
  config: SensitiveConfig,
  options?: ListSensitiveOptions,
): Promise<readonly SensitiveSummary[]> {
  assertNonEmptyUserId(config.userId, 'listSensitive');

  if (
    options !== undefined &&
    (typeof options !== 'object' || options === null || Array.isArray(options))
  ) {
    throw new InvalidArgumentError('listSensitive: options must be an object');
  }
  if (options?.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    throw new InvalidArgumentError('listSensitive: options.limit must be a positive integer');
  }

  return config.vaultStore.listEntries(config.userId, options);
}

export async function getSensitive(
  sensitiveRef: SensitiveRef,
  config: SensitiveConfig,
): Promise<SensitiveSummary | null> {
  assertNonEmptyUserId(config.userId, 'getSensitive');
  assertNonEmptySensitiveRef(sensitiveRef, 'getSensitive');
  return config.vaultStore.getEntry(config.userId, sensitiveRef);
}

export async function updateSensitive(
  sensitiveRef: SensitiveRef,
  input: UpdateSensitiveInput,
  config: SensitiveConfig,
): Promise<SensitiveSummary> {
  assertNonEmptyUserId(config.userId, 'updateSensitive');
  assertNonEmptySensitiveRef(sensitiveRef, 'updateSensitive');
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InvalidArgumentError('updateSensitive: input must be an object');
  }
  if (input.alias !== undefined && input.alias !== null && typeof input.alias !== 'string') {
    throw new InvalidArgumentError(
      'updateSensitive: input.alias must be a string, null, or undefined',
    );
  }
  return config.vaultStore.updateEntry(config.userId, sensitiveRef, input);
}

export async function deleteSensitive(
  sensitiveRefs: readonly SensitiveRef[],
  config: SensitiveConfig,
): Promise<DeleteSensitiveResult> {
  assertNonEmptyUserId(config.userId, 'deleteSensitive');
  if (!Array.isArray(sensitiveRefs)) {
    throw new InvalidArgumentError('deleteSensitive: sensitiveRefs must be an array');
  }
  if (sensitiveRefs.some((value) => typeof value !== 'string')) {
    throw new InvalidArgumentError('deleteSensitive: sensitiveRefs must contain only strings');
  }
  const normalizedRefs = sensitiveRefs.map((value) => value.trim());
  if (normalizedRefs.some((value) => value.length === 0)) {
    throw new InvalidArgumentError('deleteSensitive: sensitiveRefs must not contain empty strings');
  }
  return config.vaultStore.deleteEntries(config.userId, uniqueStrings(normalizedRefs));
}

export async function resolveSensitive(
  sensitiveRef: SensitiveRef,
  config: RevealConfig,
): Promise<string> {
  assertNonEmptyUserId(config.userId, 'resolveSensitive');
  assertNonEmptySensitiveRef(sensitiveRef, 'resolveSensitive');

  const entries = await config.vaultStore.getEntriesByPlaceholderIds(config.userId, [sensitiveRef]);
  const approvedValues = await decryptEntries(entries, config);
  const value = approvedValues.get(sensitiveRef);

  if (value === undefined) {
    throw new SensitiveNotFoundError(`Sensitive entry not found for ref ${sensitiveRef}`);
  }

  return value;
}

/**
 * Safety net: scrub revealed plaintext, leftover placeholders, and obvious structured patterns.
 */
export function scrubOutput(
  text: string,
  revealedValues: readonly string[],
  classifier?: DeterministicClassifierConfig,
): string {
  const sortedRevealedValues = [...uniqueStrings(revealedValues)].sort(
    (a, b) => b.length - a.length,
  );
  let scrubbed = text;

  for (const value of sortedRevealedValues) {
    scrubbed = scrubbed.replace(new RegExp(escapeRegExp(value), 'g'), '');
  }

  const globalRegex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
  scrubbed = scrubbed.replace(globalRegex, '');

  const ruleSet = createDeterministicPatternRuleSet(classifier);
  return scrubStructuredSensitivePatterns(scrubbed, ruleSet.rules);
}
