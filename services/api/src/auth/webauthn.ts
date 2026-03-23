import { db } from '../db';
import { eq, isNull, gt, and, sql, desc } from 'drizzle-orm';
import {
  webauthnChallenges,
  staffWebauthnCredentials,
} from '../db/schema/schema';
import type { AuthenticatorDevice, AuthenticatorTransportFuture } from '@simplewebauthn/types';
import crypto from 'node:crypto';

function parseTransports(value: string[] | null): AuthenticatorTransportFuture[] | undefined {
  if (!value || value.length === 0) return undefined;
  return value as unknown as AuthenticatorTransportFuture[];
}

export function getRpId(): string {
  return process.env.WEBAUTHN_RP_ID || 'localhost';
}

export function getRpOrigin(requestOrigin?: string): string {
  if (process.env.WEBAUTHN_RP_ORIGIN) {
    return process.env.WEBAUTHN_RP_ORIGIN;
  }

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

export function generateChallenge(): string {
  return crypto.randomBytes(32).toString('base64url');
}

type ChallengeType = 'registration' | 'authentication' | 'reauth';

export async function storeChallenge(
  challenge: string,
  staffId: string | null,
  deviceId: string | null,
  type: ChallengeType
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 2);

  await db.insert(webauthnChallenges).values({
    challenge,
    staffId,
    deviceId,
    type,
    expiresAt,
  });
}

export async function consumeChallenge(challenge: string): Promise<{
  staffId: string | null;
  deviceId: string | null;
  type: ChallengeType;
} | null> {
  const result = await db
    .select({
      staffId: webauthnChallenges.staffId,
      deviceId: webauthnChallenges.deviceId,
      type: webauthnChallenges.type,
    })
    .from(webauthnChallenges)
    .where(
      and(
        eq(webauthnChallenges.challenge, challenge),
        gt(webauthnChallenges.expiresAt, new Date())
      )
    )
    .for('update', { skipLocked: true });

  if (result.length === 0) {
    return null;
  }

  const row = result[0];

  await db.delete(webauthnChallenges).where(eq(webauthnChallenges.challenge, challenge));

  return {
    staffId: row.staffId,
    deviceId: row.deviceId,
    type: row.type as ChallengeType,
  };
}

export async function getStaffCredentials(staffId: string): Promise<AuthenticatorDevice[]> {
  const result = await db
    .select({
      credentialId: staffWebauthnCredentials.credentialId,
      publicKey: staffWebauthnCredentials.publicKey,
      signCount: staffWebauthnCredentials.signCount,
      transports: staffWebauthnCredentials.transports,
    })
    .from(staffWebauthnCredentials)
    .where(
      and(
        eq(staffWebauthnCredentials.staffId, staffId),
        isNull(staffWebauthnCredentials.revokedAt)
      )
    )
    .orderBy(desc(staffWebauthnCredentials.createdAt));

  return result.map((row) => ({
    credentialID: Buffer.from(row.credentialId, 'base64url'),
    credentialPublicKey: Buffer.from(row.publicKey, 'base64'),
    counter: Number(row.signCount),
    transports: parseTransports(row.transports ?? null),
  }));
}

export async function getCredentialByCredentialId(credentialId: string): Promise<{
  staffId: string;
  credential: AuthenticatorDevice;
} | null> {
  const result = await db
    .select({
      staffId: staffWebauthnCredentials.staffId,
      publicKey: staffWebauthnCredentials.publicKey,
      signCount: staffWebauthnCredentials.signCount,
      transports: staffWebauthnCredentials.transports,
    })
    .from(staffWebauthnCredentials)
    .where(
      and(
        eq(staffWebauthnCredentials.credentialId, credentialId),
        isNull(staffWebauthnCredentials.revokedAt)
      )
    );

  if (result.length === 0) {
    return null;
  }

  const row = result[0];

  return {
    staffId: row.staffId,
    credential: {
      credentialID: Buffer.from(credentialId, 'base64url'),
      credentialPublicKey: Buffer.from(row.publicKey, 'base64'),
      counter: Number(row.signCount),
      transports: parseTransports(row.transports ?? null),
    },
  };
}

export async function storeCredential(
  staffId: string,
  deviceId: string,
  credentialId: string,
  publicKey: Buffer,
  signCount: number,
  transports?: AuthenticatorTransportFuture[]
): Promise<void> {
  const publicKeyBase64 = publicKey.toString('base64');
  const transportsValue = transports ?? null;

  await db.insert(staffWebauthnCredentials).values({
    staffId,
    deviceId,
    credentialId,
    publicKey: publicKeyBase64,
    signCount,
    transports: transportsValue,
  });
}

export async function updateCredentialSignCount(
  credentialId: string,
  newSignCount: number
): Promise<void> {
  await db
    .update(staffWebauthnCredentials)
    .set({
      signCount: newSignCount,
      lastUsedAt: new Date(),
    })
    .where(
      and(
        eq(staffWebauthnCredentials.credentialId, credentialId),
        isNull(staffWebauthnCredentials.revokedAt)
      )
    );
}

export async function cleanupExpiredChallenges(): Promise<number> {
  const result = await db
    .delete(webauthnChallenges)
    .where(gt(sql`(NOW())`, webauthnChallenges.expiresAt))
    .returning({ id: webauthnChallenges.id });

  return result.length;
}
