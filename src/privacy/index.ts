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
import type { RevealResult, SecureAndRedactResult } from '../core/types.js';
import { scrubStructuredSensitivePatterns } from './safety-scan.js';

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

  const text = resolve(redactedText, { approvedValues }) as string;
  const revealedValues = uniqueStrings(
    matches
      .map((match) => approvedValues.get(match.id))
      .filter((value): value is string => typeof value === 'string'),
  );

  return { text, revealedValues };
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
