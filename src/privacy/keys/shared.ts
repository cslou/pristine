import { KeyManagerError } from '../../core/errors.js';

const SAFE_USER_ID_RE = /^[A-Za-z0-9._-]+$/;

export const validateKeyUserId = (userId: string): void => {
  if (userId.includes('/') || userId.includes('\\') || userId.includes('..')) {
    throw new KeyManagerError(`Invalid userId "${userId}": must not contain "/", "\\", or ".."`);
  }
};

export const encodeKeyUserId = (userId: string): string => {
  if (SAFE_USER_ID_RE.test(userId)) {
    return userId;
  }

  return `u-${Buffer.from(userId, 'utf8').toString('base64url')}`;
};
