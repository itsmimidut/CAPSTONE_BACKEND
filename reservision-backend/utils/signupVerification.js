import crypto from 'crypto';
import { getJwtSecret } from './jwtSecret.js';

const PROOF_TTL_MS = 5 * 60 * 1000;
const encode = value => Buffer.from(value).toString('base64url');
const sign = payload => crypto.createHmac('sha256', getJwtSecret()).update(payload).digest('base64url');

export const createSignupVerificationToken = (email) => {
  const payload = encode(JSON.stringify({
    email: String(email).trim().toLowerCase(),
    purpose: 'signup',
    expiresAt: Date.now() + PROOF_TTL_MS,
    nonce: crypto.randomBytes(16).toString('base64url'),
  }));
  return `${payload}.${sign(payload)}`;
};

export const verifySignupVerificationToken = (token, email) => {
  if (typeof token !== 'string') return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false;
  try {
    const proof = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return proof.purpose === 'signup'
      && proof.email === String(email).trim().toLowerCase()
      && Number(proof.expiresAt) > Date.now();
  } catch {
    return false;
  }
};
