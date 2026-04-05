import { createDecipheriv, privateDecrypt, constants } from 'node:crypto';
import type { LlmClient, SensitivityClassifier, VaultStore } from '../core/interfaces.js';
import { PLACEHOLDER_REGEX, collectPlaceholders, resolve } from '../sanitizer/index.js';
import { redactText, type RedactionPlaceholder } from '../vault/redaction.js';
import { encryptAndWrapValue } from '../vault/asymmetric-encrypt.js';
import { computeKeyFingerprint } from '../vault/asymmetric-crypto.js';
import { decodeBase64Url } from '../vault/base64url.js';
import { toApprovedValue } from '../vault/sqlite/index.js';
import {
  createCombinedClassifier,
  type CombinedClassifierConfig,
} from '../classifier/combined/index.js';

export interface SecureAndRedactConfig {
  readonly client: LlmClient;
  readonly vaultStore: VaultStore;
  readonly publicKeyPem: string;
  readonly userId: string;
  readonly classifier?: CombinedClassifierConfig;
}

export interface SecureAndRedactResult {
  readonly redactedText: string;
  readonly placeholderIds: readonly string[];
}

export interface RevealConfig {
  readonly vaultStore: VaultStore;
  readonly privateKeyPem: string;
  readonly userId: string;
}

/**
 * Classify text for PII, redact detected entities with placeholders,
 * encrypt original values, and store them in the vault.
 */
export async function secureAndRedact(
  text: string,
  config: SecureAndRedactConfig,
): Promise<SecureAndRedactResult> {
  const classifier: SensitivityClassifier = createCombinedClassifier(
    config.client,
    config.classifier,
  );

  const report = await classifier.classify(text);

  if (!report.hasSensitiveContent || report.entities.length === 0) {
    return { redactedText: text, placeholderIds: [] };
  }

  const { redactedText, placeholders } = redactText(text, report);

  if (placeholders.length === 0) {
    return { redactedText, placeholderIds: [] };
  }

  const fingerprint = computeKeyFingerprint(config.publicKeyPem);

  const vaultEntries = placeholders.map((p: RedactionPlaceholder) => ({
    userId: config.userId,
    placeholderId: p.id,
    sensitiveType: p.type,
    encrypted: encryptAndWrapValue(p.originalText, p.type, p.id, config.publicKeyPem, fingerprint),
  }));

  await config.vaultStore.addEntries(vaultEntries);

  return {
    redactedText,
    placeholderIds: placeholders.map((p) => p.id),
  };
}

/**
 * Retrieve encrypted values from the vault, decrypt with the private key,
 * and replace placeholders with the original values.
 * The result is marked as no-LLM-reentry to prevent accidental re-classification.
 */
export async function reveal(redactedText: string, config: RevealConfig): Promise<string> {
  const matches = collectPlaceholders(redactedText);
  if (matches.length === 0) {
    return redactedText;
  }

  const placeholderIds = matches.map((m) => m.id);
  const entries = await config.vaultStore.getEntriesByPlaceholderIds(config.userId, placeholderIds);

  const approvedValues = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.placeholderId) continue;

    const envelope = toApprovedValue(entry);

    const wrappedDek = Buffer.from(decodeBase64Url(envelope.wrappedDek));
    const dek = privateDecrypt(
      { key: config.privateKeyPem, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
      wrappedDek,
    );

    const ciphertext = Buffer.from(decodeBase64Url(envelope.ciphertext));
    const iv = Buffer.from(decodeBase64Url(envelope.iv));
    const authTag = Buffer.from(decodeBase64Url(envelope.authTag));

    const decipher = createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAAD(Buffer.from(envelope.aad));
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    approvedValues.set(entry.placeholderId, decrypted.toString('utf8'));
  }

  return resolve(redactedText, { approvedValues }) as string;
}

/**
 * Safety net: remove any remaining [SENSITIVE:...] placeholders from text.
 * Use this before sending output to users to ensure no leaked placeholders.
 */
export function scrubOutput(text: string): string {
  const globalRegex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
  return text.replace(globalRegex, '');
}
