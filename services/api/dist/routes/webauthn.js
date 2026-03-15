"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webauthnRoutes = webauthnRoutes;
const zod_1 = require("zod");
const server_1 = require("@simplewebauthn/server");
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const middleware_1 = require("../auth/middleware");
const utils_1 = require("../auth/utils");
const auditLog_1 = require("../audit/auditLog");
const webauthn_1 = require("../auth/webauthn");
/**
 * Drizzle-backed query function that satisfies AuditLogQueryFn.
 * Converts positional-param SQL ($1, $2, …) into Drizzle sql`` tagged template.
 */
async function drizzleQueryFn(queryText, params) {
    const parts = queryText.split(/\$\d+/);
    const values = params ?? [];
    let built = drizzle_orm_1.sql.empty();
    for (let i = 0; i < parts.length; i++) {
        built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(parts[i])}`;
        if (i < values.length) {
            built = (0, drizzle_orm_1.sql) `${built}${values[i]}`;
        }
    }
    return db_1.db.execute(built);
}
const RegistrationOptionsSchema = zod_1.z.object({
    staffId: zod_1.z.string().uuid(),
    deviceId: zod_1.z.string().min(1),
});
const RegistrationVerifySchema = zod_1.z.object({
    staffId: zod_1.z.string().uuid(),
    deviceId: zod_1.z.string().min(1),
    credentialResponse: zod_1.z.any(),
});
const AuthenticationOptionsSchema = zod_1.z.object({
    staffLookup: zod_1.z.string().min(1),
    deviceId: zod_1.z.string().min(1),
});
const AuthenticationVerifySchema = zod_1.z.object({
    deviceId: zod_1.z.string().min(1),
    credentialResponse: zod_1.z.any(),
});
async function webauthnRoutes(fastify) {
    const rpId = (0, webauthn_1.getRpId)();
    const rpName = process.env.WEBAUTHN_RP_NAME || 'Club Operations';
    // POST /v1/auth/webauthn/registration/options
    fastify.post('/v1/auth/webauthn/registration/options', {}, async (request, reply) => {
        const body = request.body;
        try {
            const staffResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name FROM staff WHERE id = ${body.staffId} AND active = true`);
            if (staffResult.rows.length === 0) {
                return reply.status(404).send({ error: 'Staff not found or inactive' });
            }
            const staff = staffResult.rows[0];
            const existingCredentials = await (0, webauthn_1.getStaffCredentials)(body.staffId);
            const challenge = (0, webauthn_1.generateChallenge)();
            await (0, webauthn_1.storeChallenge)(challenge, body.staffId, body.deviceId, 'registration');
            const options = await (0, server_1.generateRegistrationOptions)({
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
        }
        catch (error) {
            request.log.error(error, 'Failed to generate registration options');
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to generate registration options',
            });
        }
    });
    // POST /v1/auth/webauthn/registration/verify
    fastify.post('/v1/auth/webauthn/registration/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
        const body = request.body;
        try {
            const origin = (0, webauthn_1.getRpOrigin)(request.headers.origin);
            const clientData = JSON.parse(Buffer.from(body.credentialResponse.response.clientDataJSON, 'base64url').toString());
            const expectedChallenge = clientData.challenge;
            const challengeData = await (0, webauthn_1.consumeChallenge)(expectedChallenge);
            if (!challengeData || challengeData.staffId !== body.staffId) {
                return reply.status(400).send({ error: 'Invalid or expired challenge' });
            }
            const staffResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name FROM staff WHERE id = ${body.staffId} AND active = true`);
            if (staffResult.rows.length === 0) {
                return reply.status(404).send({ error: 'Staff not found or inactive' });
            }
            const verification = await (0, server_1.verifyRegistrationResponse)({
                response: body.credentialResponse,
                expectedChallenge,
                expectedOrigin: origin,
                expectedRPID: rpId,
                requireUserVerification: true,
            });
            if (!verification.verified) {
                return reply.status(400).send({ error: 'Registration verification failed' });
            }
            const credentialId = Buffer.from(verification.registrationInfo.credentialID).toString('base64url');
            await (0, webauthn_1.storeCredential)(body.staffId, body.deviceId, credentialId, Buffer.from(verification.registrationInfo.credentialPublicKey), verification.registrationInfo.counter, body.credentialResponse?.response?.transports);
            const credRow = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id FROM staff_webauthn_credentials WHERE staff_id = ${body.staffId} AND credential_id = ${credentialId} LIMIT 1`);
            const credentialRowId = credRow.rows[0]?.id;
            if (!credentialRowId) {
                return reply
                    .status(500)
                    .send({ error: 'Failed to load created credential for audit logging' });
            }
            await (0, auditLog_1.insertAuditLogQuery)(drizzleQueryFn, {
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
        }
        catch (error) {
            request.log.error(error, 'Failed to verify registration');
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to verify registration',
            });
        }
    });
    // POST /v1/auth/webauthn/authentication/options
    fastify.post('/v1/auth/webauthn/authentication/options', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
        const body = request.body;
        try {
            const staffResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, active FROM staff 
         WHERE (id::text = ${body.staffLookup} OR name ILIKE ${body.staffLookup})
         AND active = true
         LIMIT 1`);
            if (staffResult.rows.length === 0) {
                return reply.status(404).send({ error: 'Staff not found or inactive' });
            }
            const staff = staffResult.rows[0];
            if (!staff.active) {
                return reply.status(403).send({ error: 'Staff account is inactive' });
            }
            const credentials = await (0, webauthn_1.getStaffCredentials)(staff.id);
            if (credentials.length === 0) {
                return reply.status(400).send({ error: 'No passkeys registered for this staff member' });
            }
            const challenge = (0, webauthn_1.generateChallenge)();
            await (0, webauthn_1.storeChallenge)(challenge, staff.id, body.deviceId, 'authentication');
            const options = await (0, server_1.generateAuthenticationOptions)({
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
        }
        catch (error) {
            request.log.error(error, 'Failed to generate authentication options');
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to generate authentication options',
            });
        }
    });
    // POST /v1/auth/webauthn/authentication/verify
    fastify.post('/v1/auth/webauthn/authentication/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
        const body = request.body;
        try {
            const origin = (0, webauthn_1.getRpOrigin)(request.headers.origin);
            const credentialIdBase64 = body.credentialResponse.id;
            const credentialId = Buffer.from(credentialIdBase64, 'base64url').toString('base64url');
            const credentialData = await (0, webauthn_1.getCredentialByCredentialId)(credentialId);
            if (!credentialData) {
                return reply.status(400).send({ error: 'Credential not found' });
            }
            const clientData = JSON.parse(Buffer.from(body.credentialResponse.response.clientDataJSON, 'base64url').toString());
            const expectedChallenge = clientData.challenge;
            const challengeData = await (0, webauthn_1.consumeChallenge)(expectedChallenge);
            if (!challengeData || challengeData.staffId !== credentialData.staffId) {
                return reply.status(400).send({ error: 'Invalid or expired challenge' });
            }
            const verification = await (0, server_1.verifyAuthenticationResponse)({
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
            await (0, webauthn_1.updateCredentialSignCount)(credentialId, verification.authenticationInfo.newCounter);
            const staffResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, role, active FROM staff WHERE id = ${credentialData.staffId} AND active = true`);
            if (staffResult.rows.length === 0) {
                return reply.status(404).send({ error: 'Staff not found or inactive' });
            }
            const staff = staffResult.rows[0];
            if (!staff.active) {
                return reply.status(403).send({ error: 'Staff account is inactive' });
            }
            const sessionToken = (0, utils_1.generateSessionToken)();
            const expiresAt = (0, utils_1.getSessionExpiry)();
            const tokenHash = (0, utils_1.hashSessionToken)(sessionToken);
            const sessionResult = await db_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
         VALUES (${staff.id}, ${body.deviceId}, 'tablet', ${tokenHash}, ${expiresAt})
         RETURNING id`);
            const sessionId = sessionResult.rows[0].id;
            await (0, auditLog_1.insertAuditLogQuery)(drizzleQueryFn, {
                staffId: staff.id,
                action: 'STAFF_LOGIN_WEBAUTHN',
                entityType: 'staff_session',
                entityId: sessionId,
            });
            // Create or update timeclock session for cleaning station sign-in
            const registerSession = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT COUNT(*) as count FROM register_sessions
         WHERE employee_id = ${staff.id} AND signed_out_at IS NULL`);
            if (Number.parseInt(registerSession.rows[0]?.count || '0', 10) === 0) {
                const now = new Date();
                const shiftResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, starts_at, ends_at
           FROM employee_shifts
           WHERE employee_id = ${staff.id}
           AND status != 'CANCELED'
           AND (
             (starts_at <= ${now} AND ends_at >= ${now})
             OR (starts_at > ${now} AND starts_at <= ${drizzle_orm_1.sql.raw(`'${now.toISOString()}'::timestamp + INTERVAL '60 minutes'`)})
           )
           ORDER BY ABS(EXTRACT(EPOCH FROM (starts_at - ${now}::timestamp)))
           LIMIT 1`);
                const shiftRow = shiftResult.rows[0];
                const shiftId = shiftRow ? shiftRow.id : null;
                const existingTimeclock = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id FROM timeclock_sessions
           WHERE employee_id = ${staff.id} AND clock_out_at IS NULL`);
                if (existingTimeclock.rows.length === 0) {
                    await db_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO timeclock_sessions 
             (employee_id, shift_id, clock_in_at, source, notes)
             VALUES (${staff.id}, ${shiftId}, ${now}, 'OFFICE_DASHBOARD', NULL)`);
                }
                else if (shiftId) {
                    const existingId = existingTimeclock.rows[0].id;
                    await db_1.db.execute((0, drizzle_orm_1.sql) `UPDATE timeclock_sessions
             SET shift_id = ${shiftId}
             WHERE id = ${existingId} AND shift_id IS NULL`);
                }
            }
            return reply.send({
                verified: true,
                staffId: staff.id,
                name: staff.name,
                role: staff.role,
                sessionToken,
            });
        }
        catch (error) {
            request.log.error(error, 'Failed to verify authentication');
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to verify authentication',
            });
        }
    });
    // GET /v1/auth/webauthn/credentials/:staffId
    fastify.get('/v1/auth/webauthn/credentials/:staffId', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        try {
            const { staffId } = request.params;
            const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, device_id, credential_id, sign_count, transports, created_at, last_used_at, revoked_at
         FROM staff_webauthn_credentials
         WHERE staff_id = ${staffId}
         ORDER BY created_at DESC`);
            const credentials = result.rows.map((row) => ({
                id: row.id,
                deviceId: row.device_id,
                credentialId: row.credential_id,
                signCount: Number(row.sign_count),
                transports: row.transports || [],
                createdAt: row.created_at.toISOString(),
                lastUsedAt: row.last_used_at?.toISOString() || null,
                revokedAt: row.revoked_at?.toISOString() || null,
                isActive: row.revoked_at === null,
            }));
            return reply.send({ credentials });
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch credentials');
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to fetch credentials',
            });
        }
    });
    // POST /v1/auth/webauthn/credentials/:credentialId/revoke
    fastify.post('/v1/auth/webauthn/credentials/:credentialId/revoke', {
        preHandler: [middleware_1.requireReauthForAdmin],
    }, async (request, reply) => {
        const staff = request.staff;
        if (!staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        try {
            const { credentialId } = request.params;
            const credentialResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, staff_id FROM staff_webauthn_credentials WHERE credential_id = ${credentialId}`);
            if (credentialResult.rows.length === 0) {
                return reply.status(404).send({ error: 'Credential not found' });
            }
            await db_1.db.execute((0, drizzle_orm_1.sql) `UPDATE staff_webauthn_credentials
         SET revoked_at = NOW()
         WHERE credential_id = ${credentialId}
         AND revoked_at IS NULL`);
            await (0, auditLog_1.insertAuditLogQuery)(drizzleQueryFn, {
                staffId: staff.staffId,
                action: 'STAFF_WEBAUTHN_REVOKED',
                entityType: 'staff_webauthn_credential',
                entityId: credentialResult.rows[0].id,
            });
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to revoke credential');
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to revoke credential',
            });
        }
    });
}
