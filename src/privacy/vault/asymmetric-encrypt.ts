import { createCipheriv, randomBytes } from 'node:crypto';
import { encodeBase64Url } from './base64url.js';
import type { KeyWrappingScheme, ZkV2EncryptedValue } from '../../core/types.js';
import { wrapDekWithKek } from '../kek/kek-manager.js';

const AES_GCM_IV_LENGTH = 12;
const DEK_LENGTH = 32;

export const encryptAndWrapValue = (
  plaintext: string,
  sensitiveType: string,
  placeholderId: string,
  kek: Buffer,
  keyFingerprint: string,
): ZkV2EncryptedValue => {
  const dek = randomBytes(DEK_LENGTH);
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  const aad = `placeholder:${placeholderId}:${sensitiveType}`;

  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const wrappedDek = wrapDekWithKek(dek, kek);
  const keyWrapping: KeyWrappingScheme = 'aes-256-kw+rsa-oaep-256';

  return {
    scheme: 'zk-v2',
    algorithm: 'aes-256-gcm',
    keyWrapping,
    keyId: keyFingerprint,
    sensitiveType,
    ciphertext: encodeBase64Url(new Uint8Array(encrypted)),
    iv: encodeBase64Url(new Uint8Array(iv)),
    authTag: encodeBase64Url(new Uint8Array(authTag)),
    wrappedDek: encodeBase64Url(new Uint8Array(wrappedDek)),
    aad,
  };
};
