import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types';
import { query } from '../db';
import { requireAuth, requireAdmin, requireReauthForAdmin } from '../auth/middleware';
import { generateSessionToken, getSessionExpiry } from '../auth/utils';
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
 * Schema for registration options request.
 */
const RegistrationOptionsSchema = z.object({
  staffId: z.string().uuid(),
  deviceId: z.string().min(1),
});

type RegistrationOptionsInput = z.infer<typeof RegistrationOptionsSchema>;

/**
 * Schema for registration verification request.
 */
const RegistrationVerifySchema = z.object({
  staffId: z.string().uuid(),
  deviceId: z.string().min(1),
  credentialResponse: z.any(), // RegistrationResponseJSON from client
});

type RegistrationVerifyInput = z.infer<typeof RegistrationVerifySchema>;

/**
 * Schema for authentication options request.
 */
const AuthenticationOptionsSchema = z.object({
  staffLookup: z.string().min(1), // staff ID or name
  deviceId: z.string().min(1),
});

type AuthenticationOptionsInput = z.infer<typeof AuthenticationOptionsSchema>;

/**
 * Schema for authentication verification request.
 */
const AuthenticationVerifySchema = z.object({
  deviceId: z.string().min(1),
  credentialResponse: z.any(), // AuthenticationResponseJSON from client
});

type AuthenticationVerifyInput = z.infer<typeof AuthenticationVerifySchema>;

/**
 * WebAuthn routes for passkey registration and authentication.
 */
export async function webauthnRoutes(fastify: FastifyInstance): Promise<void> {
  const rpId = getRpId();
  const rpName = process.env.WEBAUTHN_RP_NAME || 'Club Operations';

  /**
   * POST /v1/auth/webauthn/registration/options
   *
   * Generate registration options for enrolling a new passkey.
   */
  fastify.post('/v1/auth/webauthn/registration/options', async (request, reply) => {
    let body: RegistrationOptionsInput;

    try {
      body = RegistrationOptionsSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      // Verify staff exists and is active
      const staffResult = await query<{ id: string; name: string }>(
        `SELECT id, name FROM staff WHERE id = $1 AND active = true`,
        [body.staffId]
      );

      if (staffResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'Staff not found or inactive',
        });
      }

      const staff = staffResult.rows[0]!;

      // Get existing credentials for this staff member
      const existingCredentials = await getStaffCredentials(body.staffId);

      // Generate challenge
      const challenge = generateChallenge();

      // Store challenge
      await storeChallenge(challenge, body.staffId, body.deviceId, 'registration');

      // Generate registration options
      const options = await generateRegistrationOptions({
        rpName,
        rpID: rpId,
        userID: body.staffId,
        userName: staff.name,
        userDisplayName: staff.name,
        timeout: 120000, // 2 minutes
        attestationType: 'none', // We don't need attestation
        excludeCredentials: existingCredentials.map((cred) => ({
          id: cred.credentialID,
          type: 'public-key',
          transports: cred.transports,
        })),
        authenticatorSelection: {
          userVerification: 'required', // Require fingerprint/PIN
          authenticatorAttachment: 'platform', // Prefer platform authenticators (fingerprint)
        },
        supportedAlgorithmIDs: [-7, -257], // ES256 and RS256
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

  /**
   * POST /v1/auth/webauthn/registration/verify
   *
   * Verify and store a new passkey credential.
   */
  fastify.post('/v1/auth/webauthn/registration/verify', async (request, reply) => {
    let body: RegistrationVerifyInput;

    try {
      body = RegistrationVerifySchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const origin = getRpOrigin(request.headers.origin);

      // Extract challenge from clientDataJSON
      const clientData = JSON.parse(
        Buffer.from(body.credentialResponse.response.clientDataJSON, 'base64url').toString()
      );
      const expectedChallenge = clientData.challenge;

      // Consume challenge
      const challengeData = await consumeChallenge(expectedChallenge);
      if (!challengeData || challengeData.staffId !== body.staffId) {
        return reply.status(400).send({
          error: 'Invalid or expired challenge',
        });
      }

      // Verify staff exists
      const staffResult = await query<{ id: string; name: string }>(
        `SELECT id, name FROM staff WHERE id = $1 AND active = true`,
        [body.staffId]
      );

      if (staffResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'Staff not found or inactive',
        });
      }

      // Verify registration response
      const verification = await verifyRegistrationResponse({
        response: body.credentialResponse,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
      });

      if (!verification.verified) {
        return reply.status(400).send({
          error: 'Registration verification failed',
        });
      }

      // Store credential
      const credentialId = Buffer.from(verification.registrationInfo!.credentialID).toString(
        'base64url'
      );

      await storeCredential(
        body.staffId,
        body.deviceId,
        credentialId,
        Buffer.from(verification.registrationInfo!.credentialPublicKey),
        verification.registrationInfo!.counter,
        // Transports are optional and may not be present depending on client/browser.
        body.credentialResponse?.response?.transports as unknown as
          | AuthenticatorTransportFuture[]
          | undefined
      );

      // audit_log.entity_id is UUID; use the staff_webauthn_credentials row id (not the credential_id text).
      const credRow = await query<{ id: string }>(
        `SELECT id FROM staff_webauthn_credentials WHERE staff_id = $1 AND credential_id = $2 LIMIT 1`,
        [body.staffId, credentialId]
      );
      const credentialRowId = credRow.rows[0]?.id;
      if (!credentialRowId) {
        return reply
          .status(500)
          .send({ error: 'Failed to load created credential for audit logging' });
      }

      // Log audit action
      await insertAuditLogQuery(query, {
        staffId: body.staffId,
        action: 'STAFF_WEBAUTHN_ENROLLED',
        entityType: 'staff_webauthn_credential',
        entityId: credentialRowId,
        newValue: {
          deviceId: body.deviceId,
          transports: body.credentialResponse?.response?.transports,
        },
      });

      return reply.send({
        verified: true,
        credentialId,
      });
    } catch (error) {
      request.log.error(error, 'Failed to verify registration');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to verify registration',
      });
    }
  });

  /**
   * POST /v1/auth/webauthn/authentication/options
   *
   * Generate authentication options for signing in with a passkey.
   */
  fastify.post('/v1/auth/webauthn/authentication/options', async (request, reply) => {
    let body: AuthenticationOptionsInput;

    try {
      body = AuthenticationOptionsSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      // Find staff by ID or name (must be active)
      const staffResult = await query<{ id: string; name: string; active: boolean }>(
        `SELECT id, name, active FROM staff 
         WHERE (id::text = $1 OR name ILIKE $1)
         AND active = true
         LIMIT 1`,
        [body.staffLookup]
      );

      if (staffResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'Staff not found or inactive',
        });
      }

      // Enforce active status
      if (!staffResult.rows[0]!.active) {
        return reply.status(403).send({
          error: 'Staff account is inactive',
        });
      }

      const staff = staffResult.rows[0]!;

      // Get credentials for this staff member
      const credentials = await getStaffCredentials(staff.id);

      if (credentials.length === 0) {
        return reply.status(400).send({
          error: 'No passkeys registered for this staff member',
        });
      }

      // Generate challenge
      const challenge = generateChallenge();

      // Store challenge
      await storeChallenge(challenge, staff.id, body.deviceId, 'authentication');

      // Generate authentication options
      const options = await generateAuthenticationOptions({
        rpID: rpId,
        timeout: 120000, // 2 minutes
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

  /**
   * POST /v1/auth/webauthn/authentication/verify
   *
   * Verify authentication response and issue session token.
   */
  fastify.post('/v1/auth/webauthn/authentication/verify', async (request, reply) => {
    let body: AuthenticationVerifyInput;

    try {
      body = AuthenticationVerifySchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const origin = getRpOrigin(request.headers.origin);

      // Extract credential ID from response
      const credentialIdBase64 = body.credentialResponse.id;
      const credentialId = Buffer.from(credentialIdBase64, 'base64url').toString('base64url');

      // Get credential and staff
      const credentialData = await getCredentialByCredentialId(credentialId);
      if (!credentialData) {
        return reply.status(400).send({
          error: 'Credential not found',
        });
      }

      // Extract challenge from clientDataJSON
      const clientData = JSON.parse(
        Buffer.from(body.credentialResponse.response.clientDataJSON, 'base64url').toString()
      );
      const expectedChallenge = clientData.challenge;

      // Consume challenge
      const challengeData = await consumeChallenge(expectedChallenge);
      if (!challengeData || challengeData.staffId !== credentialData.staffId) {
        return reply.status(400).send({
          error: 'Invalid or expired challenge',
        });
      }

      // Verify authentication response
      const verification = await verifyAuthenticationResponse({
        response: body.credentialResponse,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        authenticator: credentialData.credential,
        requireUserVerification: true,
      });

      if (!verification.verified) {
        return reply.status(400).send({
          error: 'Authentication verification failed',
        });
      }

      // Update sign count
      await updateCredentialSignCount(credentialId, verification.authenticationInfo.newCounter);

      // Get staff info (must be active)
      const staffResult = await query<{ id: string; name: string; role: string; active: boolean }>(
        `SELECT id, name, role, active FROM staff WHERE id = $1 AND active = true`,
        [credentialData.staffId]
      );

      if (staffResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'Staff not found or inactive',
        });
      }

      // Enforce active status
      if (!staffResult.rows[0]!.active) {
        return reply.status(403).send({
          error: 'Staff account is inactive',
        });
      }

      const staff = staffResult.rows[0]!;

      // Create session and get the session ID
      const sessionToken = generateSessionToken();
      const expiresAt = getSessionExpiry();

      const sessionResult = await query<{ id: string }>(
        `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [staff.id, body.deviceId, 'tablet', sessionToken, expiresAt]
      );
      const sessionId = sessionResult.rows[0]!.id;

      // Log audit action (use session UUID id, not the token string)
      await insertAuditLogQuery(query, {
        staffId: staff.id,
        action: 'STAFF_LOGIN_WEBAUTHN',
        entityType: 'staff_session',
        entityId: sessionId,
      });

      // Create or update timeclock session for cleaning station sign-in (WebAuthn)
      // Only if employee is not already signed into a register
      const registerSession = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM register_sessions
         WHERE employee_id = $1 AND signed_out_at IS NULL`,
        [staff.id]
      );

      // If not signed into register, assume cleaning station sign-in
      if (parseInt(registerSession.rows[0]?.count || '0', 10) === 0) {
        const now = new Date();
        // Find nearest scheduled shift
        const shiftResult = await query<{
          id: string;
          starts_at: Date;
          ends_at: Date;
        }>(
          `SELECT id, starts_at, ends_at
           FROM employee_shifts
           WHERE employee_id = $1
           AND status != 'CANCELED'
           AND (
             (starts_at <= $2 AND ends_at >= $2)
             OR (starts_at > $2 AND starts_at <= $2 + INTERVAL '60 minutes')
           )
           ORDER BY ABS(EXTRACT(EPOCH FROM (starts_at - $2::timestamp)))
           LIMIT 1`,
          [staff.id, now]
        );

        const shiftId = shiftResult.rows.length > 0 ? shiftResult.rows[0]!.id : null;

        // Check if employee already has an open timeclock session
        const existingTimeclock = await query<{ id: string }>(
          `SELECT id FROM timeclock_sessions
           WHERE employee_id = $1 AND clock_out_at IS NULL`,
          [staff.id]
        );

        if (existingTimeclock.rows.length === 0) {
          // Create new timeclock session for cleaning station
          await query(
            `INSERT INTO timeclock_sessions 
             (employee_id, shift_id, clock_in_at, source, notes)
             VALUES ($1, $2, $3, 'OFFICE_DASHBOARD', NULL)`,
            [staff.id, shiftId, now]
          );
        } else {
          // Update existing session to attach shift if not already attached
          if (shiftId) {
            await query(
              `UPDATE timeclock_sessions
               SET shift_id = $1
               WHERE id = $2 AND shift_id IS NULL`,
              [shiftId, existingTimeclock.rows[0]!.id]
            );
          }
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

  /**
   * GET /v1/auth/webauthn/credentials/:staffId
   *
   * Get all passkeys for a staff member (admin only).
   */
  fastify.get<{ Params: { staffId: string } }>(
    '/v1/auth/webauthn/credentials/:staffId',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const { staffId } = request.params;

        const result = await query<{
          id: string;
          device_id: string;
          credential_id: string;
          sign_count: number;
          transports: string[] | null;
          created_at: Date;
          last_used_at: Date | null;
          revoked_at: Date | null;
        }>(
          `SELECT id, device_id, credential_id, sign_count, transports, created_at, last_used_at, revoked_at
         FROM staff_webauthn_credentials
         WHERE staff_id = $1
         ORDER BY created_at DESC`,
          [staffId]
        );

        const credentials = result.rows.map((row) => ({
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

  /**
   * POST /v1/auth/webauthn/credentials/:credentialId/revoke
   *
   * Revoke a passkey credential (admin only).
   * Requires re-authentication for security.
   */
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

        // Get credential info before revoking
        const credentialResult = await query<{ id: string; staff_id: string }>(
          `SELECT id, staff_id FROM staff_webauthn_credentials WHERE credential_id = $1`,
          [credentialId]
        );

        if (credentialResult.rows.length === 0) {
          return reply.status(404).send({
            error: 'Credential not found',
          });
        }

        // Revoke credential
        await query(
          `UPDATE staff_webauthn_credentials
         SET revoked_at = NOW()
         WHERE credential_id = $1
         AND revoked_at IS NULL`,
          [credentialId]
        );

        // Log audit action
        await insertAuditLogQuery(query, {
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
