import { query } from '../db';
import crypto from 'crypto';
import type { AuthenticatorDevice, AuthenticatorTransportFuture } from '@simplewebauthn/types';

function parseTransports(value: string[] | null): AuthenticatorTransportFuture[] | undefined {
  if (!value || value.length === 0) return undefined;
  // These values originate from browser APIs; we store them as text and rehydrate for SimpleWebAuthn.
  return value as unknown as AuthenticatorTransportFuture[];
}

/**
 * Get the Relying Party (RP) ID from environment or default to localhost for dev.
 * In production, this should be your actual domain.
 */
export function getRpId(): string {
  return process.env.WEBAUTHN_RP_ID || 'localhost';
}

/**
 * Get the Relying Party (RP) origin from environment or construct from request.
 */
export function getRpOrigin(requestOrigin?: string): string {
  if (process.env.WEBAUTHN_RP_ORIGIN) {
    return process.env.WEBAUTHN_RP_ORIGIN;
  }

  // For development, use localhost
  if (requestOrigin) {
    try {
      const url = new URL(requestOrigin);
      return url.origin;
    } catch {
      // Fallback
    }
  }

  return `http://${getRpId()}:3000`;
}

/**
 * Generate a random challenge for WebAuthn.
 */
export function generateChallenge(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Store a WebAuthn challenge with expiration.
 * Challenges expire after 2 minutes.
 */
export async function storeChallenge(
  challenge: string,
  staffId: string | null,
  deviceId: string | null,
  type: 'registration' | 'authentication' | 'reauth'
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 2); // 2 minute TTL

  await query(
    `INSERT INTO webauthn_challenges (challenge, staff_id, device_id, type, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [challenge, staffId, deviceId, type, expiresAt]
  );
}

/**
 * Retrieve and consume a WebAuthn challenge.
 * Returns the challenge data if valid, null if expired or not found.
 */
export async function consumeChallenge(challenge: string): Promise<{
  staffId: string | null;
  deviceId: string | null;
  type: 'registration' | 'authentication' | 'reauth';
} | null> {
  const result = await query<{
    staff_id: string | null;
    device_id: string | null;
    type: 'registration' | 'authentication' | 'reauth';
  }>(
    `SELECT staff_id, device_id, type
     FROM webauthn_challenges
     WHERE challenge = $1
     AND expires_at > NOW()
     FOR UPDATE SKIP LOCKED`,
    [challenge]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0]!;

  // Delete the challenge after consuming it (single-use)
  await query(`DELETE FROM webauthn_challenges WHERE challenge = $1`, [challenge]);

  return {
    staffId: row.staff_id,
    deviceId: row.device_id,
    type: row.type,
  };
}

/**
 * Get all active WebAuthn credentials for a staff member.
 */
export async function getStaffCredentials(staffId: string): Promise<AuthenticatorDevice[]> {
  const result = await query<{
    credential_id: string;
    public_key: string;
    sign_count: number;
    transports: string[] | null;
  }>(
    `SELECT credential_id, public_key, sign_count, transports
     FROM staff_webauthn_credentials
     WHERE staff_id = $1
     AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [staffId]
  );

  return result.rows.map((row) => ({
    credentialID: Buffer.from(row.credential_id, 'base64url'),
    credentialPublicKey: Buffer.from(row.public_key, 'base64'),
    counter: Number(row.sign_count),
    transports: parseTransports(row.transports),
  }));
}

/**
 * Get a credential by credential ID (for authentication).
 */
export async function getCredentialByCredentialId(credentialId: string): Promise<{
  staffId: string;
  credential: AuthenticatorDevice;
} | null> {
  const result = await query<{
    staff_id: string;
    public_key: string;
    sign_count: number;
    transports: string[] | null;
  }>(
    `SELECT staff_id, public_key, sign_count, transports
     FROM staff_webauthn_credentials
     WHERE credential_id = $1
     AND revoked_at IS NULL`,
    [credentialId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0]!;

  return {
    staffId: row.staff_id,
    credential: {
      credentialID: Buffer.from(credentialId, 'base64url'),
      credentialPublicKey: Buffer.from(row.public_key, 'base64'),
      counter: Number(row.sign_count),
      transports: parseTransports(row.transports),
    },
  };
}

/**
 * Store a new WebAuthn credential after successful registration.
 */
export async function storeCredential(
  staffId: string,
  deviceId: string,
  credentialId: string,
  publicKey: Buffer,
  signCount: number,
  transports?: AuthenticatorTransportFuture[]
): Promise<void> {
  await query(
    `INSERT INTO staff_webauthn_credentials 
     (staff_id, device_id, credential_id, public_key, sign_count, transports)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      staffId,
      deviceId,
      credentialId,
      publicKey.toString('base64'),
      signCount,
      transports ? JSON.stringify(transports) : null,
    ]
  );
}

/**
 * Update credential sign count after successful authentication.
 */
export async function updateCredentialSignCount(
  credentialId: string,
  newSignCount: number
): Promise<void> {
  await query(
    `UPDATE staff_webauthn_credentials
     SET sign_count = $1, last_used_at = NOW()
     WHERE credential_id = $2
     AND revoked_at IS NULL`,
    [newSignCount, credentialId]
  );
}

/**
 * Clean up expired challenges (should be run periodically).
 */
export async function cleanupExpiredChallenges(): Promise<number> {
  const result = await query(`DELETE FROM webauthn_challenges WHERE expires_at < NOW()`);
  return result.rowCount || 0;
}
