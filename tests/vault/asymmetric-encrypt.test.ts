import { createDecipheriv, privateDecrypt, constants } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateKeyPair } from '../../src/vault/asymmetric-crypto.js';
import { encryptAndWrapValue } from '../../src/vault/asymmetric-encrypt.js';
import { decodeBase64Url } from '../../src/vault/base64url.js';

describe('encryptAndWrapValue', () => {
  it('returns a valid zk-v2 envelope', async () => {
    const { publicKey } = await generateKeyPair();
    const fingerprint = 'sha256:abc123';

    const result = encryptAndWrapValue(
      'secret-value',
      'phone_number',
      'placeholder-uuid',
      publicKey,
      fingerprint,
    );

    expect(result.scheme).toBe('zk-v2');
    expect(result.algorithm).toBe('aes-256-gcm');
    expect(result.keyWrapping).toBe('rsa-oaep-256');
    expect(result.keyId).toBe(fingerprint);
    expect(result.sensitiveType).toBe('phone_number');
    expect(result.aad).toBe('placeholder:placeholder-uuid:phone_number');
    expect(result.ciphertext).toBeTruthy();
    expect(result.iv).toBeTruthy();
    expect(result.authTag).toBeTruthy();
    expect(result.wrappedDek).toBeTruthy();
  });

  it('produces base64url-encoded fields with correct lengths', async () => {
    const { publicKey } = await generateKeyPair();

    const result = encryptAndWrapValue('test', 'email_address', 'ph-1', publicKey, 'sha256:def456');

    const iv = decodeBase64Url(result.iv);
    expect(iv.byteLength).toBe(12);

    const authTag = decodeBase64Url(result.authTag);
    expect(authTag.byteLength).toBe(16);

    const wrappedDek = decodeBase64Url(result.wrappedDek);
    expect(wrappedDek.byteLength).toBe(512);
  });

  it('round-trips: unwrap DEK then decrypt value', async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const plaintext = 'my-passport-number-E12345678';

    const envelope = encryptAndWrapValue(
      plaintext,
      'passport',
      'ph-round-trip',
      publicKey,
      'sha256:roundtrip',
    );

    const wrappedDekBuf = Buffer.from(decodeBase64Url(envelope.wrappedDek));
    const dek = privateDecrypt(
      { key: privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
      wrappedDekBuf,
    );
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

  it('produces different ciphertexts for same input (random DEK + IV)', async () => {
    const { publicKey } = await generateKeyPair();

    const a = encryptAndWrapValue('same', 'ssn', 'ph-1', publicKey, 'sha256:x');
    const b = encryptAndWrapValue('same', 'ssn', 'ph-1', publicKey, 'sha256:x');

    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.wrappedDek).not.toBe(b.wrappedDek);
  });

  it('binds AAD correctly so tampering is detected', async () => {
    const { publicKey, privateKey } = await generateKeyPair();

    const envelope = encryptAndWrapValue(
      'secret',
      'credit_card',
      'ph-aad',
      publicKey,
      'sha256:aad-test',
    );

    const dek = privateDecrypt(
      { key: privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
      Buffer.from(decodeBase64Url(envelope.wrappedDek)),
    );

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

  it('handles empty plaintext', async () => {
    const { publicKey } = await generateKeyPair();

    const envelope = encryptAndWrapValue('', 'other', 'ph-empty', publicKey, 'sha256:empty');

    expect(envelope.scheme).toBe('zk-v2');
    expect(typeof envelope.ciphertext).toBe('string');
  });

  it('handles unicode plaintext', async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const plaintext = 'Taro Yamada - \u5c71\u7530\u592a\u90ce';

    const envelope = encryptAndWrapValue(
      plaintext,
      'identity_number',
      'ph-unicode',
      publicKey,
      'sha256:unicode',
    );

    const dek = privateDecrypt(
      { key: privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
      Buffer.from(decodeBase64Url(envelope.wrappedDek)),
    );

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
