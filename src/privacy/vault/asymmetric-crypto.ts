import {
  constants,
  createHash,
  createPublicKey,
  generateKeyPair as generateKeyPairCb,
  privateDecrypt,
  publicEncrypt,
} from 'node:crypto';
import { promisify } from 'node:util';
import { AsymmetricCryptoError } from '../../core/errors.js';

const generateKeyPairAsync = promisify(generateKeyPairCb);
const RSA_MODULUS_LENGTH = 4096;
const DEK_LENGTH_BYTES = 32;
const MIN_RSA_MODULUS_LENGTH = 2048; // bits

export interface KeyPairResult {
  readonly publicKey: string;
  readonly privateKey: string;
}

/**
 * Generates an RSA-4096 key pair asynchronously to avoid blocking the event
 * loop (~150-500ms for RSA-4096 synchronous generation).
 */
export const generateKeyPair = async (): Promise<KeyPairResult> => {
  const { publicKey, privateKey } = await generateKeyPairAsync('rsa', {
    modulusLength: RSA_MODULUS_LENGTH,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};

export const wrapDek = (dek: Buffer, publicKeyPem: string): Buffer => {
  if (dek.length !== DEK_LENGTH_BYTES) {
    throw new AsymmetricCryptoError(
      `DEK must be exactly ${DEK_LENGTH_BYTES} bytes, got ${dek.length}.`,
    );
  }

  try {
    return publicEncrypt(
      {
        key: publicKeyPem,
        oaepHash: 'sha256',
        padding: constants.RSA_PKCS1_OAEP_PADDING,
      },
      dek,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AsymmetricCryptoError(`Failed to wrap DEK: ${message}`);
  }
};

export const unwrapDek = (wrappedDek: Buffer, privateKeyPem: string): Buffer => {
  try {
    return privateDecrypt(
      {
        key: privateKeyPem,
        oaepHash: 'sha256',
        padding: constants.RSA_PKCS1_OAEP_PADDING,
      },
      wrappedDek,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AsymmetricCryptoError(`Failed to unwrap DEK: ${message}`);
  }
};

export const validatePublicKey = (pem: string): void => {
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey(pem);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AsymmetricCryptoError(`Invalid public key PEM: ${message}`);
  }

  if (key.asymmetricKeyType !== 'rsa') {
    throw new AsymmetricCryptoError(
      `Public key must be RSA, got ${key.asymmetricKeyType ?? 'unknown'}.`,
    );
  }

  const details = key.asymmetricKeyDetails;
  const modulusLength = details?.modulusLength;
  if (modulusLength === undefined || modulusLength < MIN_RSA_MODULUS_LENGTH) {
    throw new AsymmetricCryptoError(
      `RSA key must be at least ${MIN_RSA_MODULUS_LENGTH}-bit, got ${modulusLength ?? 0}-bit.`,
    );
  }
};

export const computeKeyFingerprint = (publicKeyPem: string): string => {
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey(publicKeyPem);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AsymmetricCryptoError(`Invalid public key PEM: ${message}`);
  }

  const der = key.export({ type: 'spki', format: 'der' });
  const hex = createHash('sha256').update(der).digest('hex');
  return `sha256:${hex}`;
};
