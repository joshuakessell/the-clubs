import crypto from 'crypto';
import bcrypt from 'bcrypt';

/**
 * Hash a QR token using SHA-256.
 */
export function hashQrToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Hash a PIN using bcrypt.
 */
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

/**
 * Verify a PIN against a hash.
 */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

/**
 * Generate a random session token.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Session expiration time (24 hours).
 */
export const SESSION_EXPIRY_HOURS = 24;

/**
 * Calculate session expiration timestamp.
 */
export function getSessionExpiry(): Date {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + SESSION_EXPIRY_HOURS);
  return expiry;
}
