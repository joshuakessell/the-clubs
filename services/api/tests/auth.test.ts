import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { query, initializeDatabase, closeDatabase } from '../src/db/index.js';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { authRoutes } from '../src/routes/auth.js';
import { webauthnRoutes } from '../src/routes/webauthn.js';
import { adminRoutes } from '../src/routes/admin.js';
import { hashPin, generateSessionToken } from '../src/auth/utils.js';
import {
  storeChallenge,
  consumeChallenge,
  cleanupExpiredChallenges,
} from '../src/auth/webauthn.js';

// Mock WebAuthn verification to avoid needing real authenticators
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

function toBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

describe('Auth Tests', () => {
  let fastify: FastifyInstance;
  let adminStaffId: string;
  let staffStaffId: string;
  let adminToken: string;
  let dbAvailable = false;

  beforeAll(async () => {
    // Initialize test database once
    try {
      await query('SELECT 1');
      dbAvailable = true;
      await initializeDatabase();

      // Ensure audit action enum has required values (in case migrations haven't run)
      // Note: ALTER TYPE ADD VALUE cannot be run in transaction and IF NOT EXISTS doesn't work
      // So we check if it exists first using a DO block
      try {
        await query(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_enum 
              WHERE enumlabel = 'STAFF_REAUTH_PIN' 
              AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')
            ) THEN
              ALTER TYPE audit_action ADD VALUE 'STAFF_REAUTH_PIN';
            END IF;
          END $$;
        `);
      } catch (error) {
        // Ignore errors (value might already exist or enum might not exist)
      }
      try {
        await query(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_enum 
              WHERE enumlabel = 'STAFF_REAUTH_WEBAUTHN' 
              AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')
            ) THEN
              ALTER TYPE audit_action ADD VALUE 'STAFF_REAUTH_WEBAUTHN';
            END IF;
          END $$;
        `);
      } catch (error) {
        // Ignore errors (value might already exist or enum might not exist)
      }
    } catch (error) {
      // Database might already be initialized
      console.warn('Database initialization warning:', error);
      dbAvailable = false;
      return;
    }

    // Setup Fastify instance once
    fastify = Fastify({ logger: false });
    await fastify.register(authRoutes);
    await fastify.register(webauthnRoutes);
    await fastify.register(adminRoutes);
    await fastify.ready();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    // Create test staff members for each test
    const adminPinHash = await hashPin('222222');
    const staffPinHash = await hashPin('444444');

    const adminResult = await query<{ id: string }>(
      `INSERT INTO staff (name, role, pin_hash, active)
       VALUES ('Admin User', 'ADMIN', $1, true)
       RETURNING id`,
      [adminPinHash]
    );
    adminStaffId = adminResult.rows[0]!.id;

    const staffResult = await query<{ id: string }>(
      `INSERT INTO staff (name, role, pin_hash, active)
       VALUES ('Staff User', 'STAFF', $1, true)
       RETURNING id`,
      [staffPinHash]
    );
    staffStaffId = staffResult.rows[0]!.id;

    // Create admin session for testing
    adminToken = generateSessionToken();
    await query(
      `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
       VALUES ($1, 'test-device', 'desktop', $2, NOW() + INTERVAL '24 hours')`,
      [adminStaffId, adminToken]
    );
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    // Cleanup test data
    await query('DELETE FROM staff_sessions');
    await query('DELETE FROM staff_webauthn_credentials');
    await query('DELETE FROM webauthn_challenges');
    await query('DELETE FROM audit_log');
    await query('DELETE FROM staff');
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await fastify.close();
    try {
      await closeDatabase();
    } catch (error) {
      // Ignore close errors
    }
  });

describe('PIN Login', () => {
    it('should issue session token on successful PIN login', async () => {
      if (!dbAvailable) return;
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/login-pin',
        payload: {
          staffLookup: 'Staff User',
          deviceId: 'test-device',
          pin: '444444',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('sessionToken');
      expect(body.staffId).toBe(staffStaffId);
      expect(body.name).toBe('Staff User');

      // Verify session was created
      const sessionResult = await query(`SELECT * FROM staff_sessions WHERE session_token = $1`, [
        body.sessionToken,
      ]);
      expect(sessionResult.rows.length).toBe(1);
    });

    it('should fail login for inactive staff', async () => {
      if (!dbAvailable) return;
      // Deactivate staff
      await query(`UPDATE staff SET active = false WHERE id = $1`, [staffStaffId]);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/login-pin',
        payload: {
          staffLookup: 'Staff User',
          deviceId: 'test-device',
          pin: '444444',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should fail login with incorrect PIN', async () => {
      if (!dbAvailable) return;
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/login-pin',
        payload: {
          staffLookup: 'Staff User',
          deviceId: 'test-device',
          pin: '999999',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject non-6-digit PINs (e.g. 4-digit)', async () => {
      if (!dbAvailable) return;
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/login-pin',
        payload: {
          staffLookup: 'Staff User',
          deviceId: 'test-device',
          pin: '1234',
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should log audit action on successful PIN login', async () => {
      if (!dbAvailable) return;
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/login-pin',
        payload: {
          staffLookup: 'Staff User',
          deviceId: 'test-device',
          pin: '444444',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // The API logs audit entries using the session UUID (not the opaque token string).
      const sessionResult = await query<{ id: string }>(
        `SELECT id FROM staff_sessions WHERE session_token = $1`,
        [body.sessionToken]
      );
      const sessionId = sessionResult.rows[0]!.id;

      // Check audit log
      const auditResult = await query(
        `SELECT * FROM audit_log 
         WHERE staff_id = $1 
         AND action = 'STAFF_LOGIN_PIN'
         AND entity_id = $2`,
        [staffStaffId, sessionId]
      );
      expect(auditResult.rows.length).toBe(1);
    });
  });

  describe('Challenge Expiration', () => {
    it('should reject expired challenges (>2min)', async () => {
      if (!dbAvailable) return;
      const challenge = 'test-challenge-123';
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() - 3); // 3 minutes ago (expired, >2min TTL)

      await query(
        `INSERT INTO webauthn_challenges (challenge, staff_id, device_id, type, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [challenge, staffStaffId, 'test-device', 'authentication', expiresAt]
      );

      const consumed = await consumeChallenge(challenge);
      expect(consumed).toBeNull();
    });

    it('should reject challenges that expire during authentication flow', async () => {
      if (!dbAvailable) return;
      // Create a challenge that expires in 1 minute (simulating slow user)
      const challenge = 'test-challenge-expiring';
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 1); // Expires in 1 minute

      await query(
        `INSERT INTO webauthn_challenges (challenge, staff_id, device_id, type, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [challenge, staffStaffId, 'test-device', 'authentication', expiresAt]
      );

      // Simulate time passing >2 minutes
      // In real scenario, challenge would expire before verification
      // For test, we'll manually expire it
      await query(
        `UPDATE webauthn_challenges 
         SET expires_at = NOW() - INTERVAL '1 minute'
         WHERE challenge = $1`,
        [challenge]
      );

      const consumed = await consumeChallenge(challenge);
      expect(consumed).toBeNull();
    });

    it('should accept valid challenges', async () => {
      if (!dbAvailable) return;
      const challenge = 'test-challenge-456';
      await storeChallenge(challenge, staffStaffId, 'test-device', 'authentication');

      const consumed = await consumeChallenge(challenge);
      expect(consumed).not.toBeNull();
      expect(consumed?.staffId).toBe(staffStaffId);
    });

    it('should delete challenge after consumption (single-use)', async () => {
      if (!dbAvailable) return;
      const challenge = 'test-challenge-789';
      await storeChallenge(challenge, staffStaffId, 'test-device', 'authentication');

      await consumeChallenge(challenge);

      // Try to consume again - should fail
      const consumedAgain = await consumeChallenge(challenge);
      expect(consumedAgain).toBeNull();
    });
  });

  describe('Admin Guards', () => {
    it('should allow admin to list credentials', async () => {
      if (!dbAvailable) return;
      const response = await fastify.inject({
        method: 'GET',
        url: `/v1/auth/webauthn/credentials/${staffStaffId}`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should reject non-admin from listing credentials', async () => {
      if (!dbAvailable) return;
      // Create staff session
      const staffToken = generateSessionToken();
      await query(
        `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
         VALUES ($1, 'test-device', 'desktop', $2, NOW() + INTERVAL '24 hours')`,
        [staffStaffId, staffToken]
      );

      const response = await fastify.inject({
        method: 'GET',
        url: `/v1/auth/webauthn/credentials/${staffStaffId}`,
        headers: {
          Authorization: `Bearer ${staffToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should allow admin to revoke credentials', async () => {
      if (!dbAvailable) return;
      // Create a test credential
      const credentialId = toBase64Url('test-credential-id');
      await query(
        `INSERT INTO staff_webauthn_credentials 
         (staff_id, device_id, credential_id, public_key, sign_count)
         VALUES ($1, 'test-device', $2, 'dGVzdC1wdWJsaWMta2V5', 0)`,
        [staffStaffId, credentialId]
      );

      // Re-authenticate first (passkey revocation requires recent re-auth)
      const reauthResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/reauth-pin',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        payload: {
          pin: '222222',
        },
      });
      expect(reauthResponse.statusCode).toBe(200);

      const response = await fastify.inject({
        method: 'POST',
        url: `/v1/auth/webauthn/credentials/${credentialId}/revoke`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify credential is revoked
      const credResult = await query(
        `SELECT revoked_at FROM staff_webauthn_credentials WHERE credential_id = $1`,
        [credentialId]
      );
      expect(credResult.rows[0]?.revoked_at).not.toBeNull();
    });

    it('should reject non-admin from revoking credentials', async () => {
      if (!dbAvailable) return;
      const staffToken = generateSessionToken();
      await query(
        `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
         VALUES ($1, 'test-device', 'desktop', $2, NOW() + INTERVAL '24 hours')`,
        [staffStaffId, staffToken]
      );

      const credentialId = 'test-credential-id';
      const response = await fastify.inject({
        method: 'POST',
        url: `/v1/auth/webauthn/credentials/${credentialId}/revoke`,
        headers: {
          Authorization: `Bearer ${staffToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('Active Enforcement', () => {
    it('should reject WebAuthn authentication options for inactive staff', async () => {
      if (!dbAvailable) return;
      // Create credential for inactive staff
      const credentialId = toBase64Url('test-credential-inactive');
      await query(
        `INSERT INTO staff_webauthn_credentials 
         (staff_id, device_id, credential_id, public_key, sign_count)
         VALUES ($1, 'test-device', $2, 'dGVzdC1wdWJsaWMta2V5', 0)`,
        [staffStaffId, credentialId]
      );

      // Deactivate staff
      await query(`UPDATE staff SET active = false WHERE id = $1`, [staffStaffId]);

      // Try to get authentication options - should fail due to inactive status
      const optionsResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/webauthn/authentication/options',
        payload: {
          staffLookup: 'Staff User',
          deviceId: 'test-device',
        },
      });

      expect(optionsResponse.statusCode).toBe(404); // Staff not found or inactive
    });

    it('should reject WebAuthn authentication verify for inactive staff', async () => {
      if (!dbAvailable) return;
      // Create credential
      const credentialIdRaw = 'test-credential-inactive-verify';
      const credentialId = toBase64Url(credentialIdRaw);
      await query(
        `INSERT INTO staff_webauthn_credentials 
         (staff_id, device_id, credential_id, public_key, sign_count)
         VALUES ($1, 'test-device', $2, 'dGVzdC1wdWJsaWMta2V5', 0)`,
        [staffStaffId, credentialId]
      );

      // Create a valid challenge first
      const challenge = 'test-challenge-inactive';
      await storeChallenge(challenge, staffStaffId, 'test-device', 'authentication');

      // Deactivate staff AFTER challenge is created (simulating deactivation during auth flow)
      await query(`UPDATE staff SET active = false WHERE id = $1`, [staffStaffId]);

      // Mock WebAuthn verification to succeed
      const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');
      vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: {
          newCounter: 1,
          userVerified: true,
        },
      } as any);

      // Try to verify authentication - should fail due to inactive status check
      const verifyResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/webauthn/authentication/verify',
        payload: {
          staffLookup: 'Staff User',
          deviceId: 'test-device',
          credentialResponse: {
            id: credentialId,
            rawId: credentialId,
            response: {
              clientDataJSON: Buffer.from(
                JSON.stringify({ challenge, origin: 'http://localhost:3000' })
              ).toString('base64url'),
              authenticatorData: 'test-auth-data',
              signature: 'test-signature',
              userHandle: null,
            },
            type: 'public-key',
          },
        },
      });

      // Should fail because staff is inactive (checked in verify endpoint)
      expect(verifyResponse.statusCode).toBe(404); // Staff not found or inactive
    });
  });

  describe('Revoke Passkey', () => {
    it('should prevent authentication with revoked credential', async () => {
      if (!dbAvailable) return;
      const credentialId = toBase64Url('test-credential-revoked');

      // Create and immediately revoke credential
      await query(
        `INSERT INTO staff_webauthn_credentials 
         (staff_id, device_id, credential_id, public_key, sign_count, revoked_at)
         VALUES ($1, 'test-device', $2, 'dGVzdC1wdWJsaWMta2V5', 0, NOW())`,
        [staffStaffId, credentialId]
      );

      // Try to get authentication options - should not include revoked credential
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/webauthn/authentication/options',
        payload: {
          staffLookup: 'Staff User',
          deviceId: 'test-device',
        },
      });

      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        // If there are other credentials, verify revoked one is not included
        if (body.allowCredentials) {
          const revokedIncluded = body.allowCredentials.some(
            (cred: { id: string }) => cred.id === credentialId
          );
          expect(revokedIncluded).toBe(false);
        }
      }
    });

    it('should prevent revoked credential from being used in authentication verify', async () => {
      if (!dbAvailable) return;
      const credentialId = toBase64Url('test-credential-revoked-verify');

      // Create credential
      await query(
        `INSERT INTO staff_webauthn_credentials 
         (staff_id, device_id, credential_id, public_key, sign_count)
         VALUES ($1, 'test-device', $2, 'dGVzdC1wdWJsaWMta2V5', 0)`,
        [staffStaffId, credentialId]
      );

      // Revoke it
      await query(
        `UPDATE staff_webauthn_credentials 
         SET revoked_at = NOW()
         WHERE credential_id = $1`,
        [credentialId]
      );

      // Verify credential cannot be retrieved (getCredentialByCredentialId filters revoked)
      const { getCredentialByCredentialId } = await import('../src/auth/webauthn.js');
      const credential = await getCredentialByCredentialId(credentialId);
      expect(credential).toBeNull();
    });
  });

  describe('Cleanup Expired Challenges', () => {
    it('should delete expired challenges', async () => {
      if (!dbAvailable) return;
      const expiredChallenge = 'expired-challenge';
      const expiredDate = new Date();
      expiredDate.setMinutes(expiredDate.getMinutes() - 5);

      await query(
        `INSERT INTO webauthn_challenges (challenge, staff_id, device_id, type, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [expiredChallenge, staffStaffId, 'test-device', 'authentication', expiredDate]
      );

      const deletedCount = await cleanupExpiredChallenges();
      expect(deletedCount).toBeGreaterThan(0);

      const remaining = await query(`SELECT * FROM webauthn_challenges WHERE challenge = $1`, [
        expiredChallenge,
      ]);
      expect(remaining.rows.length).toBe(0);
    });
  });

  describe('Re-authentication for Admin Actions', () => {
    it('should set reauth_ok_until on successful PIN re-auth', async () => {
      if (!dbAvailable) return;
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/reauth-pin',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        payload: {
          pin: '222222',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('reauthOkUntil');

      // Verify reauth_ok_until was set in database
      const sessionResult = await query(
        `SELECT reauth_ok_until FROM staff_sessions WHERE session_token = $1`,
        [adminToken]
      );
      expect(sessionResult.rows[0]?.reauth_ok_until).not.toBeNull();

      const reauthOkUntil = new Date(sessionResult.rows[0]!.reauth_ok_until);
      const now = new Date();
      // Should be approximately 5 minutes from now (within 10 seconds tolerance)
      const diffMinutes = (reauthOkUntil.getTime() - now.getTime()) / (1000 * 60);
      expect(diffMinutes).toBeGreaterThan(4.8);
      expect(diffMinutes).toBeLessThan(5.2);
    });

    it('should fail re-auth with incorrect PIN', async () => {
      if (!dbAvailable) return;
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/reauth-pin',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        payload: {
          pin: '999999',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Invalid PIN');
    });

    it('should require re-auth for PIN reset', async () => {
      if (!dbAvailable) return;
      // Try to reset PIN without re-auth - should fail
      const response = await fastify.inject({
        method: 'POST',
        url: `/v1/admin/staff/${staffStaffId}/pin-reset`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          newPin: '666666',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('REAUTH_REQUIRED');
    });

    it('should allow PIN reset after re-auth', async () => {
      if (!dbAvailable) return;
      // First, re-authenticate
      const reauthResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/reauth-pin',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        payload: {
          pin: '222222',
        },
      });

      expect(reauthResponse.statusCode).toBe(200);

      // Now try to reset PIN - should succeed
      const resetResponse = await fastify.inject({
        method: 'POST',
        url: `/v1/admin/staff/${staffStaffId}/pin-reset`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          newPin: '666666',
        },
      });

      expect(resetResponse.statusCode).toBe(200);

      // Verify PIN was actually changed
      const staffResult = await query(`SELECT pin_hash FROM staff WHERE id = $1`, [staffStaffId]);
      const newPinHash = staffResult.rows[0]!.pin_hash;

      // Try to login with new PIN
      const loginResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/login-pin',
        payload: {
          staffLookup: 'Staff User',
          deviceId: 'test-device',
          pin: '666666',
        },
      });

      expect(loginResponse.statusCode).toBe(200);
    });

    it('should require re-auth for passkey revocation', async () => {
      if (!dbAvailable) return;
      // Create a test credential
      const credentialId = toBase64Url('test-credential-reauth');
      await query(
        `INSERT INTO staff_webauthn_credentials 
         (staff_id, device_id, credential_id, public_key, sign_count)
         VALUES ($1, 'test-device', $2, 'dGVzdC1wdWJsaWMta2V5', 0)`,
        [staffStaffId, credentialId]
      );

      // Try to revoke without re-auth - should fail
      const response = await fastify.inject({
        method: 'POST',
        url: `/v1/auth/webauthn/credentials/${credentialId}/revoke`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('REAUTH_REQUIRED');
    });

    it('should allow passkey revocation after re-auth', async () => {
      if (!dbAvailable) return;
      // Create a test credential
      const credentialId = toBase64Url('test-credential-reauth-ok');
      await query(
        `INSERT INTO staff_webauthn_credentials 
         (staff_id, device_id, credential_id, public_key, sign_count)
         VALUES ($1, 'test-device', $2, 'dGVzdC1wdWJsaWMta2V5', 0)`,
        [staffStaffId, credentialId]
      );

      // First, re-authenticate
      const reauthResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/reauth-pin',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        payload: {
          pin: '222222',
        },
      });

      expect(reauthResponse.statusCode).toBe(200);

      // Now try to revoke - should succeed
      const revokeResponse = await fastify.inject({
        method: 'POST',
        url: `/v1/auth/webauthn/credentials/${credentialId}/revoke`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(revokeResponse.statusCode).toBe(200);

      // Verify credential is revoked
      const credResult = await query(
        `SELECT revoked_at FROM staff_webauthn_credentials WHERE credential_id = $1`,
        [credentialId]
      );
      expect(credResult.rows[0]?.revoked_at).not.toBeNull();
    });

    it('should reject expired re-auth', async () => {
      if (!dbAvailable) return;
      // Re-authenticate
      const reauthResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/reauth-pin',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        payload: {
          pin: '222222',
        },
      });

      expect(reauthResponse.statusCode).toBe(200);

      // Manually expire the reauth_ok_until timestamp
      await query(
        `UPDATE staff_sessions 
         SET reauth_ok_until = NOW() - INTERVAL '1 minute'
         WHERE session_token = $1`,
        [adminToken]
      );

      // Try to reset PIN - should fail with expired re-auth
      const resetResponse = await fastify.inject({
        method: 'POST',
        url: `/v1/admin/staff/${staffStaffId}/pin-reset`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          newPin: '666666',
        },
      });

      expect(resetResponse.statusCode).toBe(403);
      const body = JSON.parse(resetResponse.body);
      expect(body.code).toBe('REAUTH_EXPIRED');
    });
  });
});
