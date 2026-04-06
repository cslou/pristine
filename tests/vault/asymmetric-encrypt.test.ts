import { createDecipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptAndWrapValue } from '../../src/privacy/vault/asymmetric-encrypt.js';
import { decodeBase64Url } from '../../src/privacy/vault/base64url.js';
import { generateKek, unwrapDekWithKek } from '../../src/privacy/kek/kek-manager.js';

describe('encryptAndWrapValue', () => {
  it('returns a valid zk-v2 envelope with KEK wrapping', () => {
    const kek = generateKek();
    const fingerprint = 'sha256:abc123';

    const result = encryptAndWrapValue(
      'secret-value',
      'phone_number',
      'placeholder-uuid',
      kek,
      fingerprint,
    );

    expect(result.scheme).toBe('zk-v2');
    expect(result.algorithm).toBe('aes-256-gcm');
    expect(result.keyWrapping).toBe('aes-256-kw+rsa-oaep-256');
    expect(result.keyId).toBe(fingerprint);
    expect(result.sensitiveType).toBe('phone_number');
    expect(result.aad).toBe('placeholder:placeholder-uuid:phone_number');
    expect(result.ciphertext).toBeTruthy();
    expect(result.iv).toBeTruthy();
    expect(result.authTag).toBeTruthy();
    expect(result.wrappedDek).toBeTruthy();
  });

  it('produces base64url-encoded fields with correct lengths', () => {
    const kek = generateKek();

    const result = encryptAndWrapValue('test', 'email_address', 'ph-1', kek, 'sha256:def456');

    const iv = decodeBase64Url(result.iv);
    expect(iv.byteLength).toBe(12);

    const authTag = decodeBase64Url(result.authTag);
    expect(authTag.byteLength).toBe(16);

    // AES-256-KW output: 40 bytes (32-byte DEK + 8-byte integrity)
    const wrappedDek = decodeBase64Url(result.wrappedDek);
    expect(wrappedDek.byteLength).toBe(40);
  });

  it('round-trips: unwrap DEK with KEK then decrypt value', () => {
    const kek = generateKek();
    const plaintext = 'my-passport-number-E12345678';

    const envelope = encryptAndWrapValue(plaintext, 'passport', 'ph-round-trip', kek, 'sha256:rt');

    const wrappedDekBuf = Buffer.from(decodeBase64Url(envelope.wrappedDek));
    const dek = unwrapDekWithKek(wrappedDekBuf, kek);
    expect(dek.length).toBe(32);

    const ciphertext = Buffer.from(decodeBase64Url(envelope.ciphertext));
    const iv = Buffer.from(decodeBase64Url(envelope.iv));
    const authTag = Buffer.from(decodeBase64Url(envelope.authTag));

    const decipher = createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAAD(Buffer.from(envelope.aad));
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    expect(decrypted.toString('utf8')).toBe(plaintext);
  });

  it('produces different ciphertexts for same input (random DEK + IV)', () => {
    const kek = generateKek();

    const a = encryptAndWrapValue('same', 'ssn', 'ph-1', kek, 'sha256:x');
    const b = encryptAndWrapValue('same', 'ssn', 'ph-1', kek, 'sha256:x');

    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.wrappedDek).not.toBe(b.wrappedDek);
  });

  it('binds AAD correctly so tampering is detected', () => {
    const kek = generateKek();

    const envelope = encryptAndWrapValue('secret', 'credit_card', 'ph-aad', kek, 'sha256:aad-test');

    const dek = unwrapDekWithKek(Buffer.from(decodeBase64Url(envelope.wrappedDek)), kek);

    const decipher = createDecipheriv(
      'aes-256-gcm',
      dek,
      Buffer.from(decodeBase64Url(envelope.iv)),
    );
    decipher.setAAD(Buffer.from('wrong-aad'));
    decipher.setAuthTag(Buffer.from(decodeBase64Url(envelope.authTag)));

    expect(() => {
      decipher.update(Buffer.from(decodeBase64Url(envelope.ciphertext)));
      decipher.final();
    }).toThrow();
  });

  it('handles empty plaintext', () => {
    const kek = generateKek();

    const envelope = encryptAndWrapValue('', 'other', 'ph-empty', kek, 'sha256:empty');

    expect(envelope.scheme).toBe('zk-v2');
    expect(typeof envelope.ciphertext).toBe('string');
  });

  it('handles unicode plaintext', () => {
    const kek = generateKek();
    const plaintext = 'Taro Yamada - \u5c71\u7530\u592a\u90ce';

    const envelope = encryptAndWrapValue(
      plaintext,
      'identity_number',
      'ph-unicode',
      kek,
      'sha256:uni',
    );

    const dek = unwrapDekWithKek(Buffer.from(decodeBase64Url(envelope.wrappedDek)), kek);

    const decipher = createDecipheriv(
      'aes-256-gcm',
      dek,
      Buffer.from(decodeBase64Url(envelope.iv)),
    );
    decipher.setAAD(Buffer.from(envelope.aad));
    decipher.setAuthTag(Buffer.from(decodeBase64Url(envelope.authTag)));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(decodeBase64Url(envelope.ciphertext))),
      decipher.final(),
    ]);

    expect(decrypted.toString('utf8')).toBe(plaintext);
  });
});
