import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { requireAuth, requireAdmin, requireReauthForAdmin } from '../auth/middleware';
import { generateSessionToken, getSessionExpiry, hashSessionToken } from '../auth/utils';
import { insertAuditLogQuery } from '../audit/auditLog';
import {
  getRpId,
  getRpOrigin,
  generateChallenge,
  storeChallenge,
  consumeChallenge,
  getStaffCredentials,
  getCredentialByCredentialId,
  storeCredential,
  updateCredentialSignCount,
} from '../auth/webauthn';

/**
 * Drizzle-backed query function that satisfies AuditLogQueryFn.
 * Converts positional-param SQL ($1, $2, …) into Drizzle sql`` tagged template.
 */
async function drizzleQueryFn(queryText: string, params?: unknown[]): Promise<unknown> {
  const parts = queryText.split(/\$\d+/);
  const values = params ?? [];
  let built = sql.empty();
  for (let i = 0; i < parts.length; i++) {
    built = sql`${built}${sql.raw(parts[i]!)}`;
    if (i < values.length) {
      built = sql`${built}${values[i]}`;
    }
  }
  return db.execute(built);
}

const RegistrationOptionsSchema = z.object({
  staffId: z.string().uuid(),
  deviceId: z.string().min(1),
});

type RegistrationOptionsInput = z.infer<typeof RegistrationOptionsSchema>;

const RegistrationVerifySchema = z.object({
  staffId: z.string().uuid(),
  deviceId: z.string().min(1),
  credentialResponse: z.any(),
});

type RegistrationVerifyInput = z.infer<typeof RegistrationVerifySchema>;

const AuthenticationOptionsSchema = z.object({
  staffLookup: z.string().min(1),
  deviceId: z.string().min(1),
});

type AuthenticationOptionsInput = z.infer<typeof AuthenticationOptionsSchema>;

const AuthenticationVerifySchema = z.object({
  deviceId: z.string().min(1),
  credentialResponse: z.any(),
});

type AuthenticationVerifyInput = z.infer<typeof AuthenticationVerifySchema>;

export async function webauthnRoutes(fastify: FastifyInstance): Promise<void> {
  const rpId = getRpId();
  const rpName = process.env.WEBAUTHN_RP_NAME || 'Club Operations';

  // POST /v1/auth/webauthn/registration/options
  fastify.post('/v1/auth/webauthn/registration/options', {}, async (request, reply) => {
    const body = request.body as RegistrationOptionsInput;

    try {
      const staffResult = await db.execute<Record<string, unknown>>(
        sql`SELECT id, name FROM staff WHERE id = ${body.staffId} AND active = true`
      );

      if (staffResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Staff not found or inactive' });
      }

      const staff = staffResult.rows[0] as unknown as { id: string; name: string };
      const existingCredentials = await getStaffCredentials(body.staffId);
      const challenge = generateChallenge();
      await storeChallenge(challenge, body.staffId, body.deviceId, 'registration');

      const options = await generateRegistrationOptions({
        rpName,
        rpID: rpId,
        userID: body.staffId,
        userName: staff.name,
        userDisplayName: staff.name,
        timeout: 120000,
        attestationType: 'none',
        excludeCredentials: existingCredentials.map((cred) => ({
          id: cred.credentialID,
          type: 'public-key',
          transports: cred.transports,
        })),
        authenticatorSelection: {
          userVerification: 'required',
          authenticatorAttachment: 'platform',
        },
        supportedAlgorithmIDs: [-7, -257],
      });

      return reply.send(options);
    } catch (error) {
      request.log.error(error, 'Failed to generate registration options');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to generate registration options',
      });
    }
  });

  // POST /v1/auth/webauthn/registration/verify
  fastify.post('/v1/auth/webauthn/registration/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = request.body as RegistrationVerifyInput;

    try {
      const origin = getRpOrigin(request.headers.origin);

      const clientData = JSON.parse(
        Buffer.from(body.credentialResponse.response.clientDataJSON, 'base64url').toString()
      );
      const expectedChallenge = clientData.challenge;

      const challengeData = await consumeChallenge(expectedChallenge);
      if (!challengeData || challengeData.staffId !== body.staffId) {
        return reply.status(400).send({ error: 'Invalid or expired challenge' });
      }

      const staffResult = await db.execute<Record<string, unknown>>(
        sql`SELECT id, name FROM staff WHERE id = ${body.staffId} AND active = true`
      );

      if (staffResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Staff not found or inactive' });
      }

      const verification = await verifyRegistrationResponse({
        response: body.credentialResponse,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
      });

      if (!verification.verified) {
        return reply.status(400).send({ error: 'Registration verification failed' });
      }

      const credentialId = Buffer.from(verification.registrationInfo!.credentialID).toString('base64url');

      await storeCredential(
        body.staffId,
        body.deviceId,
        credentialId,
        Buffer.from(verification.registrationInfo!.credentialPublicKey),
        verification.registrationInfo!.counter,
        body.credentialResponse?.response?.transports as unknown as
          | AuthenticatorTransportFuture[]
          | undefined
      );

      const credRow = await db.execute<{ id: string }>(
        sql`SELECT id FROM staff_webauthn_credentials WHERE staff_id = ${body.staffId} AND credential_id = ${credentialId} LIMIT 1`
      );
      const credentialRowId = credRow.rows[0]?.id;
      if (!credentialRowId) {
        return reply
          .status(500)
          .send({ error: 'Failed to load created credential for audit logging' });
      }

      await insertAuditLogQuery(drizzleQueryFn, {
        staffId: body.staffId,
        action: 'STAFF_WEBAUTHN_ENROLLED',
        entityType: 'staff_webauthn_credential',
        entityId: credentialRowId,
        newValue: {
          deviceId: body.deviceId,
          transports: body.credentialResponse?.response?.transports,
        },
      });

      return reply.send({ verified: true, credentialId });
    } catch (error) {
      request.log.error(error, 'Failed to verify registration');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to verify registration',
      });
    }
  });

  // POST /v1/auth/webauthn/authentication/options
  fastify.post('/v1/auth/webauthn/authentication/options', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = request.body as AuthenticationOptionsInput;

    try {
      const staffResult = await db.execute<Record<string, unknown>>(
        sql`SELECT id, name, active FROM staff 
         WHERE (id::text = ${body.staffLookup} OR name ILIKE ${body.staffLookup})
         AND active = true
         LIMIT 1`
      );

      if (staffResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Staff not found or inactive' });
      }

      const staff = staffResult.rows[0] as unknown as { id: string; name: string; active: boolean };

      if (!staff.active) {
        return reply.status(403).send({ error: 'Staff account is inactive' });
      }

      const credentials = await getStaffCredentials(staff.id);

      if (credentials.length === 0) {
        return reply.status(400).send({ error: 'No passkeys registered for this staff member' });
      }

      const challenge = generateChallenge();
      await storeChallenge(challenge, staff.id, body.deviceId, 'authentication');

      const options = await generateAuthenticationOptions({
        rpID: rpId,
        timeout: 120000,
        allowCredentials: credentials.map((cred) => ({
          id: cred.credentialID,
          type: 'public-key',
          transports: cred.transports,
        })),
        userVerification: 'required',
      });

      return reply.send(options);
    } catch (error) {
      request.log.error(error, 'Failed to generate authentication options');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to generate authentication options',
      });
    }
  });

  // POST /v1/auth/webauthn/authentication/verify
  fastify.post('/v1/auth/webauthn/authentication/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = request.body as AuthenticationVerifyInput;

    try {
      const origin = getRpOrigin(request.headers.origin);
      const credentialIdBase64 = body.credentialResponse.id;
      const credentialId = Buffer.from(credentialIdBase64, 'base64url').toString('base64url');

      const credentialData = await getCredentialByCredentialId(credentialId);
      if (!credentialData) {
        return reply.status(400).send({ error: 'Credential not found' });
      }

      const clientData = JSON.parse(
        Buffer.from(body.credentialResponse.response.clientDataJSON, 'base64url').toString()
      );
      const expectedChallenge = clientData.challenge;

      const challengeData = await consumeChallenge(expectedChallenge);
      if (!challengeData || challengeData.staffId !== credentialData.staffId) {
        return reply.status(400).send({ error: 'Invalid or expired challenge' });
      }

      const verification = await verifyAuthenticationResponse({
        response: body.credentialResponse,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        authenticator: credentialData.credential,
        requireUserVerification: true,
      });

      if (!verification.verified) {
        return reply.status(400).send({ error: 'Authentication verification failed' });
      }

      await updateCredentialSignCount(credentialId, verification.authenticationInfo.newCounter);

      const staffResult = await db.execute<Record<string, unknown>>(
        sql`SELECT id, name, role, active FROM staff WHERE id = ${credentialData.staffId} AND active = true`
      );

      if (staffResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Staff not found or inactive' });
      }

      const staff = staffResult.rows[0] as unknown as { id: string; name: string; role: string; active: boolean };

      if (!staff.active) {
        return reply.status(403).send({ error: 'Staff account is inactive' });
      }

      const sessionToken = generateSessionToken();
      const expiresAt = getSessionExpiry();
      const tokenHash = hashSessionToken(sessionToken);

      const sessionResult = await db.execute<{ id: string }>(
        sql`INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
         VALUES (${staff.id}, ${body.deviceId}, 'tablet', ${tokenHash}, ${expiresAt})
         RETURNING id`
      );
      const sessionId = sessionResult.rows[0]!.id;

      await insertAuditLogQuery(drizzleQueryFn, {
        staffId: staff.id,
        action: 'STAFF_LOGIN_WEBAUTHN',
        entityType: 'staff_session',
        entityId: sessionId,
      });

      // Create or update timeclock session for cleaning station sign-in
      const registerSession = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*) as count FROM register_sessions
         WHERE employee_id = ${staff.id} AND signed_out_at IS NULL`
      );

      if (Number.parseInt(registerSession.rows[0]?.count || '0', 10) === 0) {
        const now = new Date();
        const shiftResult = await db.execute<Record<string, unknown>>(
          sql`SELECT id, starts_at, ends_at
           FROM employee_shifts
           WHERE employee_id = ${staff.id}
           AND status != 'CANCELED'
           AND (
             (starts_at <= ${now} AND ends_at >= ${now})
             OR (starts_at > ${now} AND starts_at <= ${sql.raw(`'${now.toISOString()}'::timestamp + INTERVAL '60 minutes'`)})
           )
           ORDER BY ABS(EXTRACT(EPOCH FROM (starts_at - ${now}::timestamp)))
           LIMIT 1`
        );

        const shiftRow = shiftResult.rows[0] as unknown as { id: string; starts_at: Date; ends_at: Date } | undefined;
        const shiftId = shiftRow ? shiftRow.id : null;

        const existingTimeclock = await db.execute<{ id: string }>(
          sql`SELECT id FROM timeclock_sessions
           WHERE employee_id = ${staff.id} AND clock_out_at IS NULL`
        );

        if (existingTimeclock.rows.length === 0) {
          await db.execute(
            sql`INSERT INTO timeclock_sessions 
             (employee_id, shift_id, clock_in_at, source, notes)
             VALUES (${staff.id}, ${shiftId}, ${now}, 'OFFICE_DASHBOARD', NULL)`
          );
        } else if (shiftId) {
          const existingId = existingTimeclock.rows[0]!.id;
          await db.execute(
            sql`UPDATE timeclock_sessions
             SET shift_id = ${shiftId}
             WHERE id = ${existingId} AND shift_id IS NULL`
          );
        }
      }

      return reply.send({
        verified: true,
        staffId: staff.id,
        name: staff.name,
        role: staff.role,
        sessionToken,
      });
    } catch (error) {
      request.log.error(error, 'Failed to verify authentication');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to verify authentication',
      });
    }
  });

  // GET /v1/auth/webauthn/credentials/:staffId
  fastify.get<{ Params: { staffId: string } }>(
    '/v1/auth/webauthn/credentials/:staffId',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const { staffId } = request.params;

        const result = await db.execute<Record<string, unknown>>(
          sql`SELECT id, device_id, credential_id, sign_count, transports, created_at, last_used_at, revoked_at
         FROM staff_webauthn_credentials
         WHERE staff_id = ${staffId}
         ORDER BY created_at DESC`
        );

        type CredRow = {
          id: string;
          device_id: string;
          credential_id: string;
          sign_count: number;
          transports: string[] | null;
          created_at: Date;
          last_used_at: Date | null;
          revoked_at: Date | null;
        };

        const credentials = (result.rows as unknown as CredRow[]).map((row) => ({
          id: row.id,
          deviceId: row.device_id,
          credentialId: row.credential_id,
          signCount: Number(row.sign_count),
          transports: (row.transports as string[]) || [],
          createdAt: row.created_at.toISOString(),
          lastUsedAt: row.last_used_at?.toISOString() || null,
          revokedAt: row.revoked_at?.toISOString() || null,
          isActive: row.revoked_at === null,
        }));

        return reply.send({ credentials });
      } catch (error) {
        request.log.error(error, 'Failed to fetch credentials');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch credentials',
        });
      }
    }
  );

  // POST /v1/auth/webauthn/credentials/:credentialId/revoke
  fastify.post<{ Params: { credentialId: string } }>(
    '/v1/auth/webauthn/credentials/:credentialId/revoke',
    {
      preHandler: [requireReauthForAdmin],
    },
    async (request, reply) => {
      const staff = request.staff;
      if (!staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      try {
        const { credentialId } = request.params;

        const credentialResult = await db.execute<{ id: string; staff_id: string }>(
          sql`SELECT id, staff_id FROM staff_webauthn_credentials WHERE credential_id = ${credentialId}`
        );

        if (credentialResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Credential not found' });
        }

        await db.execute(
          sql`UPDATE staff_webauthn_credentials
         SET revoked_at = NOW()
         WHERE credential_id = ${credentialId}
         AND revoked_at IS NULL`
        );

        await insertAuditLogQuery(drizzleQueryFn, {
          staffId: staff.staffId,
          action: 'STAFF_WEBAUTHN_REVOKED',
          entityType: 'staff_webauthn_credential',
          entityId: credentialResult.rows[0]!.id,
        });

        return reply.send({ success: true });
      } catch (error) {
        request.log.error(error, 'Failed to revoke credential');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to revoke credential',
        });
      }
    }
  );
}
