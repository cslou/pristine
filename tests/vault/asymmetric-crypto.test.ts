import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computeKeyFingerprint,
  generateKeyPair,
  unwrapDek,
  validatePublicKey,
  wrapDek,
} from '../../src/vault/asymmetric-crypto.js';
import { AsymmetricCryptoError } from '../../src/core/errors.js';

const generateRsa2048 = (): { publicKey: string; privateKey: string } =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

const generateRsa1024 = (): { publicKey: string; privateKey: string } =>
  generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

const generateEd25519 = (): { publicKey: string; privateKey: string } =>
  generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

describe('asymmetric-crypto', () => {
  describe('generateKeyPair', () => {
    it('returns valid PEM strings', async () => {
      const { publicKey, privateKey } = await generateKeyPair();

      expect(publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
      expect(publicKey).toMatch(/-----END PUBLIC KEY-----\n$/);
      expect(privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/);
      expect(privateKey).toMatch(/-----END PRIVATE KEY-----\n$/);
    });

    it('generates RSA-4096 keys', async () => {
      const { publicKey } = await generateKeyPair();
      const key = createPublicKey(publicKey);

      expect(key.asymmetricKeyType).toBe('rsa');
      expect(key.asymmetricKeyDetails?.modulusLength).toBe(4096);
    });

    it('produces different key pairs on each call', async () => {
      const a = await generateKeyPair();
      const b = await generateKeyPair();

      expect(a.publicKey).not.toBe(b.publicKey);
      expect(a.privateKey).not.toBe(b.privateKey);
    });
  });

  describe('wrapDek / unwrapDek round-trip', () => {
    it('wraps and unwraps a DEK correctly', async () => {
      const { publicKey, privateKey } = await generateKeyPair();
      const dek = randomBytes(32);

      const wrapped = wrapDek(dek, publicKey);
      const unwrapped = unwrapDek(wrapped, privateKey);

      expect(unwrapped).toEqual(dek);
    });

    it('produces 512-byte wrapped output for RSA-4096', async () => {
      const { publicKey } = await generateKeyPair();
      const dek = randomBytes(32);

      const wrapped = wrapDek(dek, publicKey);

      expect(wrapped.length).toBe(512);
    });

    it('produces different ciphertexts for the same DEK (OAEP randomness)', async () => {
      const { publicKey } = await generateKeyPair();
      const dek = randomBytes(32);

      const wrapped1 = wrapDek(dek, publicKey);
      const wrapped2 = wrapDek(dek, publicKey);

      expect(wrapped1).not.toEqual(wrapped2);
    });
  });

  describe('wrapDek validation', () => {
    it('rejects DEK shorter than 32 bytes', () => {
      const { publicKey } = generateRsa2048();
      const shortDek = randomBytes(16);

      expect(() => wrapDek(shortDek, publicKey)).toThrow(AsymmetricCryptoError);
      expect(() => wrapDek(shortDek, publicKey)).toThrow('must be exactly 32 bytes');
    });

    it('rejects DEK longer than 32 bytes', () => {
      const { publicKey } = generateRsa2048();
      const longDek = randomBytes(64);

      expect(() => wrapDek(longDek, publicKey)).toThrow(AsymmetricCryptoError);
      expect(() => wrapDek(longDek, publicKey)).toThrow('must be exactly 32 bytes');
    });
  });

  describe('unwrapDek negative cases', () => {
    it('fails with wrong private key', async () => {
      const pairA = await generateKeyPair();
      const pairB = await generateKeyPair();
      const dek = randomBytes(32);

      const wrapped = wrapDek(dek, pairA.publicKey);

      expect(() => unwrapDek(wrapped, pairB.privateKey)).toThrow(AsymmetricCryptoError);
      expect(() => unwrapDek(wrapped, pairB.privateKey)).toThrow('Failed to unwrap DEK');
    });

    it('fails with corrupted wrapped DEK', async () => {
      const { publicKey, privateKey } = await generateKeyPair();
      const dek = randomBytes(32);

      const wrapped = wrapDek(dek, publicKey);
      wrapped[0] ^= 0xff;

      expect(() => unwrapDek(wrapped, privateKey)).toThrow(AsymmetricCryptoError);
    });
  });

  describe('validatePublicKey', () => {
    it('accepts valid RSA-4096 PEM', async () => {
      const { publicKey } = await generateKeyPair();

      expect(() => validatePublicKey(publicKey)).not.toThrow();
    });

    it('accepts valid RSA-2048 PEM (minimum allowed)', () => {
      const { publicKey } = generateRsa2048();

      expect(() => validatePublicKey(publicKey)).not.toThrow();
    });

    it('rejects non-RSA key (Ed25519)', () => {
      const { publicKey } = generateEd25519();

      expect(() => validatePublicKey(publicKey)).toThrow(AsymmetricCryptoError);
      expect(() => validatePublicKey(publicKey)).toThrow('must be RSA');
    });

    it('rejects RSA key below 2048-bit', () => {
      const { publicKey } = generateRsa1024();

      expect(() => validatePublicKey(publicKey)).toThrow(AsymmetricCryptoError);
      expect(() => validatePublicKey(publicKey)).toThrow('at least 2048-bit');
    });

    it('rejects malformed PEM string', () => {
      expect(() => validatePublicKey('not-a-pem')).toThrow(AsymmetricCryptoError);
      expect(() => validatePublicKey('not-a-pem')).toThrow('Invalid public key PEM');
    });

    it('rejects empty string', () => {
      expect(() => validatePublicKey('')).toThrow(AsymmetricCryptoError);
      expect(() => validatePublicKey('')).toThrow('Invalid public key PEM');
    });
  });

  describe('computeKeyFingerprint', () => {
    it('returns sha256:<hex> format', async () => {
      const { publicKey } = await generateKeyPair();
      const fingerprint = computeKeyFingerprint(publicKey);

      expect(fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('is deterministic for the same key', async () => {
      const { publicKey } = await generateKeyPair();

      const fp1 = computeKeyFingerprint(publicKey);
      const fp2 = computeKeyFingerprint(publicKey);

      expect(fp1).toBe(fp2);
    });

    it('produces different fingerprints for different keys', async () => {
      const a = await generateKeyPair();
      const b = await generateKeyPair();

      expect(computeKeyFingerprint(a.publicKey)).not.toBe(computeKeyFingerprint(b.publicKey));
    });
  });
});
