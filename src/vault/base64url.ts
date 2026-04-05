import { VaultEncodingError } from '../core/errors.js';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const toBinaryString = (value: Uint8Array): string => {
  let result = '';
  for (const byte of value) {
    result += String.fromCharCode(byte);
  }
  return result;
};

const fromBinaryString = (value: string): Uint8Array => {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }
  return bytes;
};

export const encodeBase64Url = (value: Uint8Array): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value).toString('base64url');
  }

  if (typeof btoa === 'function') {
    return btoa(toBinaryString(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  throw new VaultEncodingError('No base64url encoder is available in this runtime.');
};

export const decodeBase64Url = (value: string): Uint8Array => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new VaultEncodingError('base64url input must be a non-empty string.');
  }

  if (!BASE64URL_PATTERN.test(value)) {
    throw new VaultEncodingError('base64url input contains invalid characters.');
  }

  if (typeof Buffer !== 'undefined') {
    const decoded = new Uint8Array(Buffer.from(value, 'base64url'));
    if (encodeBase64Url(decoded) !== value) {
      throw new VaultEncodingError('base64url input is not canonical or is malformed.');
    }
    return decoded;
  }

  if (typeof atob === 'function') {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const decoded = fromBinaryString(atob(`${normalized}${padding}`));
    if (encodeBase64Url(decoded) !== value) {
      throw new VaultEncodingError('base64url input is not canonical or is malformed.');
    }
    return decoded;
  }

  throw new VaultEncodingError('No base64url decoder is available in this runtime.');
};
