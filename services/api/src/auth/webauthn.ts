import { db } from '../db';
import { sql } from 'drizzle-orm';
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

  await db.execute(
    sql`INSERT INTO webauthn_challenges (challenge, staff_id, device_id, type, expires_at)
     VALUES (${challenge}, ${staffId}, ${deviceId}, ${type}, ${expiresAt})`
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
  const result = await db.execute<{
    staff_id: string | null;
    device_id: string | null;
    type: 'registration' | 'authentication' | 'reauth';
  }>(
    sql`SELECT staff_id, device_id, type
     FROM webauthn_challenges
     WHERE challenge = ${challenge}
     AND expires_at > NOW()
     FOR UPDATE SKIP LOCKED`
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0]!;

  // Delete the challenge after consuming it (single-use)
  await db.execute(sql`DELETE FROM webauthn_challenges WHERE challenge = ${challenge}`);

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
  const result = await db.execute<{
    credential_id: string;
    public_key: string;
    sign_count: number;
    transports: string[] | null;
  }>(
    sql`SELECT credential_id, public_key, sign_count, transports
     FROM staff_webauthn_credentials
     WHERE staff_id = ${staffId}
     AND revoked_at IS NULL
     ORDER BY created_at DESC`
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
  const result = await db.execute<{
    staff_id: string;
    public_key: string;
    sign_count: number;
    transports: string[] | null;
  }>(
    sql`SELECT staff_id, public_key, sign_count, transports
     FROM staff_webauthn_credentials
     WHERE credential_id = ${credentialId}
     AND revoked_at IS NULL`
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
  const publicKeyBase64 = publicKey.toString('base64');
  const transportsJson = transports ? JSON.stringify(transports) : null;
  await db.execute(
    sql`INSERT INTO staff_webauthn_credentials 
     (staff_id, device_id, credential_id, public_key, sign_count, transports)
     VALUES (${staffId}, ${deviceId}, ${credentialId}, ${publicKeyBase64}, ${signCount}, ${transportsJson})`
  );
}

/**
 * Update credential sign count after successful authentication.
 */
export async function updateCredentialSignCount(
  credentialId: string,
  newSignCount: number
): Promise<void> {
  await db.execute(
    sql`UPDATE staff_webauthn_credentials
     SET sign_count = ${newSignCount}, last_used_at = NOW()
     WHERE credential_id = ${credentialId}
     AND revoked_at IS NULL`
  );
}

/**
 * Clean up expired challenges (should be run periodically).
 */
export async function cleanupExpiredChallenges(): Promise<number> {
  const result = await db.execute<{ id: string }>(
    sql`DELETE FROM webauthn_challenges WHERE expires_at < NOW() RETURNING id`
  );
  return result.rows.length;
}
