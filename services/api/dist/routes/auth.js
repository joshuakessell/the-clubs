"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
const zod_1 = require("zod");
const utils_1 = require("../auth/utils");
const middleware_1 = require("../auth/middleware");
const authService_1 = require("../services/authService");
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
     */
    fastify.get('/v1/auth/staff', async (request, reply) => {
        try {
            const isDemoMode = process.env.DEMO_MODE === 'true';
            const staffList = await (0, authService_1.listActiveStaff)(isDemoMode);
            return reply.send({
                staff: staffList,
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
        schema: { body: LoginPinSchema },
        config: {
            rateLimit: { max: 10, timeWindow: '1 minute' },
        },
    }, async (request, reply) => {
        const body = request.body;
        try {
            const isDemoMode = process.env.DEMO_MODE === 'true';
            const deviceType = body.deviceType || 'tablet';
            const result = await (0, authService_1.loginWithPin)(body.staffLookup, body.pin, body.deviceId, deviceType, isDemoMode);
            if (!result) {
                return reply.status(401).send({
                    error: 'Unauthorized',
                    message: 'Invalid credentials',
                });
            }
            const tokenHash = (0, utils_1.hashSessionToken)(result.sessionToken);
            const verifyHash = (0, utils_1.hashSessionToken)(result.sessionToken);
            request.log.info({
                staffId: result.staffId,
                tokenRawPrefix: result.sessionToken.slice(0, 8),
                tokenHashPrefix: tokenHash.slice(0, 8),
                verifyHashPrefix: verifyHash.slice(0, 8),
                hashMatch: tokenHash === verifyHash,
                sessionId: result.sessionId,
                deviceId: body.deviceId,
                tokenLength: result.sessionToken.length,
            }, 'auth_login: session created successfully');
            return reply.send({
                staffId: result.staffId,
                name: result.name,
                role: result.role,
                sessionToken: result.sessionToken,
                mustChangePin: result.mustChangePin,
            });
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
        schema: { body: ChangePinSchema },
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const body = request.body;
        if (body.newPin !== body.confirmPin) {
            return reply.status(400).send({ error: 'New PIN and confirmation do not match' });
        }
        try {
            await (0, authService_1.changeStaffPin)(request.staff.staffId, body.currentPin, body.newPin);
            return reply.send({ success: true });
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : '';
            if (msg === 'Unauthorized' || msg === 'Current PIN is incorrect') {
                return reply.status(401).send({ error: msg });
            }
            if (msg === 'Current PIN is required' || msg === 'New PIN must be different from current PIN') {
                return reply.status(400).send({ error: msg });
            }
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
        if (!authHeader?.startsWith('Bearer ')) {
            return reply.status(401).send({
                error: 'Unauthorized',
            });
        }
        const token = authHeader.substring(7);
        const tokenHash = (0, utils_1.hashSessionToken)(token);
        try {
            await (0, authService_1.logoutSession)(tokenHash);
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
        schema: { body: ReauthPinSchema },
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({
                error: 'Unauthorized',
            });
        }
        const body = request.body;
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return reply.status(401).send({
                error: 'Unauthorized',
            });
        }
        const token = authHeader.substring(7);
        const tokenHash = (0, utils_1.hashSessionToken)(token);
        try {
            const reauthOkUntil = await (0, authService_1.reauthWithPin)(request.staff.staffId, body.pin, tokenHash);
            return reply.send({
                success: true,
                reauthOkUntil: reauthOkUntil.toISOString(),
            });
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : '';
            if (msg === 'Invalid credentials' || msg === 'Session not found') {
                return reply.status(401).send({
                    error: 'Unauthorized',
                    message: msg,
                });
            }
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
            const deviceId = request.headers['x-device-id'] || 'reauth-device';
            const options = await (0, authService_1.getReauthWebauthnOptions)(request.staff.staffId, deviceId);
            return reply.send(options);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : '';
            if (msg === 'No passkeys registered for this staff member') {
                return reply.status(400).send({ error: msg });
            }
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
        if (!authHeader?.startsWith('Bearer ')) {
            return reply.status(401).send({
                error: 'Unauthorized',
            });
        }
        const token = authHeader.substring(7);
        const tokenHash = (0, utils_1.hashSessionToken)(token);
        const deviceId = request.body.deviceId || 'reauth-device';
        const origin = request.headers.origin || request.headers.host || '';
        try {
            const reauthOkUntil = await (0, authService_1.verifyReauthWebauthn)(request.staff.staffId, deviceId, tokenHash, origin, request.body.credentialResponse);
            return reply.send({
                success: true,
                reauthOkUntil: reauthOkUntil.toISOString(),
            });
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : '';
            if (msg === 'Session not found') {
                return reply.status(401).send({ error: 'Unauthorized', message: msg });
            }
            if (['Invalid or expired challenge', 'Credential not found', 'Authentication verification failed'].includes(msg)) {
                return reply.status(400).send({ error: msg });
            }
            request.log.error(error, 'Re-auth WebAuthn error');
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to process re-authentication',
            });
        }
    });
}
