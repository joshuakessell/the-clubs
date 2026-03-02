"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
const zod_1 = require("zod");
const db_1 = require("../db");
const utils_1 = require("../auth/utils");
const middleware_1 = require("../auth/middleware");
const auditLog_1 = require("../audit/auditLog");
/**
 * Schema for PIN login request.
 */
const LoginPinSchema = zod_1.z.object({
    staffLookup: zod_1.z.string().min(1), // staff ID or name
    deviceId: zod_1.z.string().min(1),
    pin: zod_1.z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
    deviceType: zod_1.z.enum(['tablet', 'kiosk', 'desktop']).optional(), // Optional device type
});
/**
 * Authentication routes.
 */
async function authRoutes(fastify) {
    /**
     * GET /v1/auth/staff - Get list of active staff for login selection
     *
     * Public endpoint that returns active staff members (name, id, role only).
     * Used by login screens to show available staff for selection.
     */
    fastify.get('/v1/auth/staff', async (request, reply) => {
        try {
            const result = await (0, db_1.query)(`SELECT id, name, role
         FROM staff
         WHERE active = true
         AND pin_hash IS NOT NULL
         ORDER BY name`);
            return reply.send({
                staff: result.rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                    role: row.role,
                })),
            });
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch staff list');
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to fetch staff list',
            });
        }
    });
    /**
     * POST /v1/auth/login-pin - Staff login with PIN
     *
     * Accepts staff ID or name and PIN for authentication.
     * Creates a session and returns session token.
     */
    fastify.post('/v1/auth/login-pin', {
        config: {
            rateLimit: { max: 10, timeWindow: '1 minute' },
        },
    }, async (request, reply) => {
        let body;
        try {
            body = LoginPinSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        try {
            const isDemoMode = process.env.DEMO_MODE === 'true';
            const result = await (0, db_1.transaction)(async (client) => {
                // Find staff by ID or name (must be active)
                // Use separate conditions to avoid type mismatch (UUID vs VARCHAR)
                // In DEMO_MODE, allow staff without a pin_hash
                const staffResult = await client.query(`SELECT id, name, role, pin_hash, active, force_pin_change
           FROM staff
           WHERE (id::text = $1 OR name ILIKE $1)
           ${isDemoMode ? '' : 'AND pin_hash IS NOT NULL'}
           AND active = true
           LIMIT 1`, [body.staffLookup]);
                if (staffResult.rows.length === 0) {
                    return null;
                }
                const staff = staffResult.rows[0];
                // Enforce active status
                if (!staff.active) {
                    return null;
                }
                // Verify PIN (skip in DEMO_MODE — accept any PIN)
                if (!isDemoMode) {
                    if (!staff.pin_hash || !(await (0, utils_1.verifyPin)(body.pin, staff.pin_hash))) {
                        return null;
                    }
                }
                // Generate session token
                const sessionToken = (0, utils_1.generateSessionToken)();
                const expiresAt = (0, utils_1.getSessionExpiry)();
                // Use provided device type or default to 'tablet'
                const deviceType = body.deviceType || 'tablet';
                // Create session and get the session ID
                // Store only the SHA-256 hash of the token; the raw token is returned to the client once.
                const tokenHash = (0, utils_1.hashSessionToken)(sessionToken);
                const sessionResult = await client.query(`INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`, [staff.id, body.deviceId, deviceType, tokenHash, expiresAt]);
                const sessionId = sessionResult.rows[0].id;
                // Log for correlation with auth_reject diagnostics
                // Also verify the hash is consistent (debugging persistent 401 mismatch)
                const verifyHash = (0, utils_1.hashSessionToken)(sessionToken);
                request.log.info({
                    staffId: staff.id,
                    tokenRawPrefix: sessionToken.slice(0, 8),
                    tokenHashPrefix: tokenHash.slice(0, 8),
                    verifyHashPrefix: verifyHash.slice(0, 8),
                    hashMatch: tokenHash === verifyHash,
                    sessionId,
                    deviceId: body.deviceId,
                    tokenLength: sessionToken.length,
                }, 'auth_login: session created successfully');
                // Log audit action (use session UUID id, not the token string)
                await (0, auditLog_1.insertAuditLog)(client, {
                    staffId: staff.id,
                    action: 'STAFF_LOGIN_PIN',
                    entityType: 'staff_session',
                    entityId: sessionId,
                });
                // Create or update timeclock session for office dashboard sign-in
                // Only if employee is not already signed into a register
                // This is optional - if tables don't exist, skip gracefully
                try {
                    const registerSession = await client.query(`SELECT COUNT(*) as count FROM register_sessions
             WHERE employee_id = $1 AND signed_out_at IS NULL`, [staff.id]);
                    // If not signed into register, try to create timeclock session
                    if (parseInt(registerSession.rows[0]?.count || '0', 10) === 0) {
                        // Check if timeclock_sessions table exists by trying a simple query
                        try {
                            const now = new Date();
                            // Check if employee already has an open timeclock session
                            const existingTimeclock = await client.query(`SELECT id FROM timeclock_sessions
                 WHERE employee_id = $1 AND clock_out_at IS NULL`, [staff.id]);
                            if (existingTimeclock.rows.length === 0) {
                                // Try to find nearest scheduled shift (if employee_shifts table exists)
                                let shiftId = null;
                                try {
                                    const shiftResult = await client.query(`SELECT id, starts_at, ends_at
                     FROM employee_shifts
                     WHERE employee_id = $1
                     AND status != 'CANCELED'
                     AND (
                       (starts_at <= $2 AND ends_at >= $2)
                       OR (starts_at > $2 AND starts_at <= $2 + INTERVAL '60 minutes')
                     )
                     ORDER BY ABS(EXTRACT(EPOCH FROM (starts_at - $2::timestamp)))
                     LIMIT 1`, [staff.id, now]);
                                    shiftId = shiftResult.rows.length > 0 ? shiftResult.rows[0].id : null;
                                }
                                catch {
                                    // employee_shifts table doesn't exist, skip shift lookup
                                }
                                // Create new timeclock session for office dashboard
                                await client.query(`INSERT INTO timeclock_sessions 
                   (employee_id, shift_id, clock_in_at, source, notes)
                   VALUES ($1, $2, $3, 'OFFICE_DASHBOARD', NULL)`, [staff.id, shiftId, now]);
                            }
                            else {
                                // Update existing session to attach shift if not already attached
                                try {
                                    const shiftResult = await client.query(`SELECT id FROM employee_shifts
                     WHERE employee_id = $1
                     AND status != 'CANCELED'
                     AND (
                       (starts_at <= $2 AND ends_at >= $2)
                       OR (starts_at > $2 AND starts_at <= $2 + INTERVAL '60 minutes')
                     )
                     ORDER BY ABS(EXTRACT(EPOCH FROM (starts_at - $2::timestamp)))
                     LIMIT 1`, [staff.id, new Date()]);
                                    const shiftId = shiftResult.rows.length > 0 ? shiftResult.rows[0].id : null;
                                    if (shiftId) {
                                        await client.query(`UPDATE timeclock_sessions
                       SET shift_id = $1
                       WHERE id = $2 AND shift_id IS NULL`, [shiftId, existingTimeclock.rows[0].id]);
                                    }
                                }
                                catch {
                                    // employee_shifts table doesn't exist, skip shift update
                                }
                            }
                        }
                        catch {
                            // timeclock_sessions table doesn't exist, skip timeclock logic
                        }
                    }
                }
                catch {
                    // register_sessions or timeclock tables don't exist, skip timeclock logic
                }
                return {
                    staffId: staff.id,
                    name: staff.name,
                    role: staff.role,
                    sessionToken,
                    mustChangePin: staff.force_pin_change,
                };
            });
            if (!result) {
                return reply.status(401).send({
                    error: 'Unauthorized',
                    message: 'Invalid credentials',
                });
            }
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Login error');
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: `Failed to process login: ${errorMessage}`,
            });
        }
    });
    /**
     * POST /v1/auth/change-pin - Change PIN (used after forced reset or self-service)
     *
     * If force_pin_change is set, currentPin is not required.
     * Otherwise, currentPin must be verified.
     */
    const ChangePinSchema = zod_1.z.object({
        currentPin: zod_1.z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits').optional(),
        newPin: zod_1.z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
        confirmPin: zod_1.z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
    });
    fastify.post('/v1/auth/change-pin', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        let body;
        try {
            body = ChangePinSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        if (body.newPin !== body.confirmPin) {
            return reply.status(400).send({ error: 'New PIN and confirmation do not match' });
        }
        try {
            const { hashPin } = await Promise.resolve().then(() => __importStar(require('../auth/utils')));
            // Look up staff to check force_pin_change flag
            const staffResult = await (0, db_1.query)(`SELECT pin_hash, force_pin_change FROM staff WHERE id = $1 AND active = true`, [request.staff.staffId]);
            if (staffResult.rows.length === 0) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            const staff = staffResult.rows[0];
            // If NOT a forced change, verify current PIN
            if (!staff.force_pin_change) {
                if (!body.currentPin) {
                    return reply.status(400).send({ error: 'Current PIN is required' });
                }
                if (!staff.pin_hash || !(await (0, utils_1.verifyPin)(body.currentPin, staff.pin_hash))) {
                    return reply.status(401).send({ error: 'Current PIN is incorrect' });
                }
                if (body.newPin === body.currentPin) {
                    return reply.status(400).send({ error: 'New PIN must be different from current PIN' });
                }
            }
            // Hash new PIN and update
            const newPinHash = await hashPin(body.newPin);
            await (0, db_1.query)(`UPDATE staff SET pin_hash = $1, force_pin_change = false, updated_at = NOW() WHERE id = $2`, [newPinHash, request.staff.staffId]);
            // Audit log
            await (0, auditLog_1.insertAuditLogQuery)(db_1.query, {
                staffId: request.staff.staffId,
                action: 'STAFF_PIN_CHANGED',
                entityType: 'staff',
                entityId: request.staff.staffId,
                metadata: { selfChange: true, forced: staff.force_pin_change },
            });
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to change PIN');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * POST /v1/auth/logout - Staff logout
     *
     * Revokes the current session token.
     */
    fastify.post('/v1/auth/logout', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.status(401).send({
                error: 'Unauthorized',
            });
        }
        const token = authHeader.substring(7);
        const tokenHash = (0, utils_1.hashSessionToken)(token);
        try {
            // Get staff ID and session ID before revoking
            const sessionResult = await (0, db_1.query)(`SELECT staff_id, id FROM staff_sessions WHERE session_token = $1 AND revoked_at IS NULL`, [tokenHash]);
            if (sessionResult.rows.length > 0) {
                const staffId = sessionResult.rows[0].staff_id;
                const sessionId = sessionResult.rows[0].id;
                await (0, db_1.query)(`UPDATE staff_sessions
           SET revoked_at = NOW()
           WHERE session_token = $1
           AND revoked_at IS NULL`, [tokenHash]);
                // Log audit action (use session UUID id, not the token string)
                await (0, auditLog_1.insertAuditLogQuery)(db_1.query, {
                    staffId,
                    action: 'STAFF_LOGOUT',
                    entityType: 'staff_session',
                    entityId: sessionId,
                });
                // Close timeclock session if employee is no longer signed into any register or cleaning station
                const otherRegisterSession = await (0, db_1.query)(`SELECT COUNT(*) as count FROM register_sessions
           WHERE employee_id = $1 AND signed_out_at IS NULL`, [staffId]);
                const otherStaffSession = await (0, db_1.query)(`SELECT COUNT(*) as count FROM staff_sessions
           WHERE staff_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`, [staffId]);
                // Only close timeclock if no other active sessions
                if (parseInt(otherRegisterSession.rows[0]?.count || '0', 10) === 0 &&
                    parseInt(otherStaffSession.rows[0]?.count || '0', 10) === 0) {
                    await (0, db_1.query)(`UPDATE timeclock_sessions
             SET clock_out_at = NOW()
             WHERE employee_id = $1 AND clock_out_at IS NULL`, [staffId]);
                }
            }
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Logout error');
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to logout',
            });
        }
    });
    /**
     * GET /v1/auth/me - Get current staff identity
     *
     * Returns the authenticated staff member's information.
     */
    fastify.get('/v1/auth/me', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({
                error: 'Unauthorized',
            });
        }
        return reply.send({
            staffId: request.staff.staffId,
            name: request.staff.name,
            role: request.staff.role,
        });
    });
    /**
     * POST /v1/auth/reauth-pin - Re-authenticate with PIN for sensitive admin actions
     *
     * Requires existing session. Verifies PIN and sets reauth_ok_until timestamp
     * (valid for 5 minutes).
     */
    const ReauthPinSchema = zod_1.z.object({
        pin: zod_1.z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
    });
    fastify.post('/v1/auth/reauth-pin', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({
                error: 'Unauthorized',
            });
        }
        let body;
        try {
            body = ReauthPinSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.status(401).send({
                error: 'Unauthorized',
            });
        }
        const token = authHeader.substring(7);
        const tokenHash = (0, utils_1.hashSessionToken)(token);
        try {
            // Get staff PIN hash
            const staffResult = await (0, db_1.query)(`SELECT pin_hash FROM staff WHERE id = $1 AND active = true`, [request.staff.staffId]);
            if (staffResult.rows.length === 0 || !staffResult.rows[0].pin_hash) {
                return reply.status(401).send({
                    error: 'Unauthorized',
                    message: 'Invalid credentials',
                });
            }
            // Verify PIN
            if (!(await (0, utils_1.verifyPin)(body.pin, staffResult.rows[0].pin_hash))) {
                return reply.status(401).send({
                    error: 'Unauthorized',
                    message: 'Invalid PIN',
                });
            }
            // Get session ID first
            const sessionResult = await (0, db_1.query)(`SELECT id FROM staff_sessions WHERE session_token = $1 AND revoked_at IS NULL`, [tokenHash]);
            if (sessionResult.rows.length === 0) {
                return reply.status(401).send({
                    error: 'Unauthorized',
                    message: 'Session not found',
                });
            }
            const sessionId = sessionResult.rows[0].id;
            // Set reauth_ok_until to 5 minutes from now
            const reauthOkUntil = new Date(Date.now() + 5 * 60 * 1000);
            await (0, db_1.query)(`UPDATE staff_sessions
         SET reauth_ok_until = $1
         WHERE session_token = $2
         AND revoked_at IS NULL`, [reauthOkUntil, tokenHash]);
            // Log audit action (use session UUID id, not the token string)
            await (0, auditLog_1.insertAuditLogQuery)(db_1.query, {
                staffId: request.staff.staffId,
                action: 'STAFF_REAUTH_PIN',
                entityType: 'staff_session',
                entityId: sessionId,
            });
            return reply.send({
                success: true,
                reauthOkUntil: reauthOkUntil.toISOString(),
            });
        }
        catch (error) {
            request.log.error(error, 'Re-auth error');
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to process re-authentication',
            });
        }
    });
    /**
     * POST /v1/auth/reauth/webauthn/options - Get WebAuthn options for re-authentication
     *
     * Requires existing session. Returns WebAuthn authentication options for the current staff.
     */
    fastify.post('/v1/auth/reauth/webauthn/options', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({
                error: 'Unauthorized',
            });
        }
        try {
            // Import WebAuthn utilities
            const { generateAuthenticationOptions } = await Promise.resolve().then(() => __importStar(require('@simplewebauthn/server')));
            const { getRpId, generateChallenge, storeChallenge, getStaffCredentials } = await Promise.resolve().then(() => __importStar(require('../auth/webauthn.js')));
            const rpId = getRpId();
            const deviceId = request.headers['x-device-id'] || 'reauth-device';
            // Get credentials for this staff member
            const credentials = await getStaffCredentials(request.staff.staffId);
            if (credentials.length === 0) {
                return reply.status(400).send({
                    error: 'No passkeys registered for this staff member',
                });
            }
            // Generate challenge
            const challenge = generateChallenge();
            // Store challenge with reauth type
            await storeChallenge(challenge, request.staff.staffId, deviceId, 'reauth');
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
        }
        catch (error) {
            request.log.error(error, 'Failed to generate reauth WebAuthn options');
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to generate re-authentication options',
            });
        }
    });
    /**
     * POST /v1/auth/reauth/webauthn/verify - Verify WebAuthn re-authentication
     *
     * Requires existing session. Verifies WebAuthn response and sets reauth_ok_until.
     */
    fastify.post('/v1/auth/reauth/webauthn/verify', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({
                error: 'Unauthorized',
            });
        }
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.status(401).send({
                error: 'Unauthorized',
            });
        }
        const token = authHeader.substring(7);
        const tokenHash = (0, utils_1.hashSessionToken)(token);
        const deviceId = request.body.deviceId || 'reauth-device';
        const origin = request.headers.origin || request.headers.host || '';
        try {
            // Import WebAuthn utilities
            const { verifyAuthenticationResponse } = await Promise.resolve().then(() => __importStar(require('@simplewebauthn/server')));
            const { getRpId, getRpOrigin, consumeChallenge, getCredentialByCredentialId, updateCredentialSignCount, } = await Promise.resolve().then(() => __importStar(require('../auth/webauthn.js')));
            const rpId = getRpId();
            const rpOrigin = getRpOrigin(origin);
            // Get and consume challenge
            const challengeResult = await (0, db_1.query)(`SELECT challenge FROM webauthn_challenges
         WHERE staff_id = $1
           AND device_id = $2
           AND type = 'reauth'
           AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1`, [request.staff.staffId, deviceId]);
            if (challengeResult.rows.length === 0) {
                return reply.status(400).send({
                    error: 'Invalid or expired challenge',
                });
            }
            const expectedChallenge = challengeResult.rows[0].challenge;
            await consumeChallenge(expectedChallenge);
            // Get credential
            const credentialResponse = request.body.credentialResponse;
            const credentialId = credentialResponse.id || credentialResponse.rawId || '';
            const credentialData = await getCredentialByCredentialId(credentialId);
            if (!credentialData) {
                return reply.status(400).send({
                    error: 'Credential not found',
                });
            }
            // Verify authentication response
            const verification = await verifyAuthenticationResponse({
                response: request.body.credentialResponse,
                expectedChallenge,
                expectedOrigin: rpOrigin,
                expectedRPID: rpId,
                authenticator: credentialData.credential,
                requireUserVerification: true,
            });
            if (!verification.verified) {
                return reply.status(400).send({
                    error: 'Authentication verification failed',
                });
            }
            // Update credential sign count
            if (verification.authenticationInfo) {
                await updateCredentialSignCount(credentialId, verification.authenticationInfo.newCounter);
            }
            // Get session ID first
            const sessionResult = await (0, db_1.query)(`SELECT id FROM staff_sessions WHERE session_token = $1 AND revoked_at IS NULL`, [tokenHash]);
            if (sessionResult.rows.length === 0) {
                return reply.status(401).send({
                    error: 'Unauthorized',
                    message: 'Session not found',
                });
            }
            const sessionId = sessionResult.rows[0].id;
            // Set reauth_ok_until to 5 minutes from now
            const reauthOkUntil = new Date(Date.now() + 5 * 60 * 1000);
            await (0, db_1.query)(`UPDATE staff_sessions
         SET reauth_ok_until = $1
         WHERE session_token = $2
         AND revoked_at IS NULL`, [reauthOkUntil, tokenHash]);
            // Log audit action (use session UUID id, not the token string)
            await (0, auditLog_1.insertAuditLogQuery)(db_1.query, {
                staffId: request.staff.staffId,
                action: 'STAFF_REAUTH_WEBAUTHN',
                entityType: 'staff_session',
                entityId: sessionId,
            });
            return reply.send({
                success: true,
                reauthOkUntil: reauthOkUntil.toISOString(),
            });
        }
        catch (error) {
            request.log.error(error, 'Re-auth WebAuthn error');
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to process re-authentication',
            });
        }
    });
}
