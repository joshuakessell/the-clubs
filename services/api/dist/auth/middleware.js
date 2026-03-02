"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireAdmin = requireAdmin;
exports.requireReauth = requireReauth;
exports.requireReauthForAdmin = requireReauthForAdmin;
exports.optionalAuth = optionalAuth;
const db_1 = require("../db");
const utils_1 = require("./utils");
/**
 * Extract and validate session token from Authorization header.
 * Attaches staff information to request.staff if valid.
 */
async function extractStaffFromToken(request) {
    const authHeader = request.headers.authorization ??
        // Defensive: some test/inject clients may pass non-normalized header keys
        request.headers['Authorization'] ??
        request.headers['AUTHORIZATION'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        request.log.debug({ hasAuth: !!authHeader, url: request.url }, 'auth_reject: no Bearer header');
        return false;
    }
    const token = authHeader.substring(7);
    const tokenHash = (0, utils_1.hashSessionToken)(token);
    try {
        const sessionResult = await (0, db_1.query)(`SELECT 
        ss.staff_id,
        ss.id,
        s.name,
        s.role
      FROM staff_sessions ss
      JOIN staff s ON s.id = ss.staff_id
      WHERE ss.session_token = $1 
        AND ss.revoked_at IS NULL
        AND ss.expires_at > NOW()
        AND s.active = true`, [tokenHash]);
        if (sessionResult.rows.length === 0) {
            // Log the first 8 chars of the token hash for correlation (safe — hash is not reversible)
            request.log.warn({ tokenHashPrefix: tokenHash.slice(0, 8), tokenRawPrefix: token.slice(0, 8), url: request.url }, 'auth_reject: no active session found for token hash');
            return false;
        }
        const row = sessionResult.rows[0];
        request.staff = {
            staffId: row.staff_id,
            name: row.name,
            role: row.role,
            sessionId: row.id,
        };
        // Sliding window: extend session expiry on each authenticated request.
        // Only fires if less than 23h remain (throttles to ~1 write/hour max).
        (0, db_1.query)(`UPDATE staff_sessions
       SET expires_at = NOW() + INTERVAL '24 hours'
       WHERE session_token = $1
         AND expires_at - NOW() < INTERVAL '23 hours'`, [tokenHash]).catch(() => { }); // fire-and-forget, non-blocking
        return true;
    }
    catch (error) {
        request.log.error({ err: error, url: request.url }, 'auth_reject: DB error validating session token');
        return false;
    }
}
/**
 * Middleware to require authentication.
 * Validates Bearer token and attaches staff info to request.
 */
async function requireAuth(request, reply) {
    const isValid = await extractStaffFromToken(request);
    if (!isValid) {
        reply.status(401).send({
            error: 'Unauthorized',
            message: 'Valid session token required',
        });
        return;
    }
}
/**
 * Middleware to require admin role.
 * Must be used after requireAuth.
 */
async function requireAdmin(request, reply) {
    if (!request.staff) {
        reply.status(401).send({
            error: 'Unauthorized',
            message: 'Authentication required',
        });
        return;
    }
    // In DEMO_MODE, allow any authenticated user to access admin endpoints
    if (process.env.DEMO_MODE === 'true')
        return;
    if (request.staff.role !== 'ADMIN') {
        reply.status(403).send({
            error: 'Forbidden',
            message: 'Admin role required',
        });
        return;
    }
}
/**
 * Middleware to require re-authentication.
 * Checks that reauth_ok_until is within the last 5 minutes.
 * Must be used after requireAuth.
 */
async function requireReauth(request, reply) {
    if (!request.staff) {
        reply.status(401).send({
            error: 'Unauthorized',
            message: 'Authentication required',
        });
        return;
    }
    const authHeader = request.headers.authorization ??
        // Defensive: some test/inject clients may pass non-normalized header keys
        request.headers['Authorization'] ??
        request.headers['AUTHORIZATION'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.status(401).send({
            error: 'Unauthorized',
            message: 'Valid session token required',
        });
        return;
    }
    const token = authHeader.substring(7);
    const tokenHash = (0, utils_1.hashSessionToken)(token);
    try {
        const sessionResult = await (0, db_1.query)(`SELECT reauth_ok_until
       FROM staff_sessions
       WHERE session_token = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()`, [tokenHash]);
        if (sessionResult.rows.length === 0) {
            reply.status(401).send({
                error: 'Unauthorized',
                message: 'Invalid session',
            });
            return;
        }
        const reauthOkUntil = sessionResult.rows[0].reauth_ok_until;
        if (!reauthOkUntil) {
            reply.status(403).send({
                error: 'Re-authentication required',
                code: 'REAUTH_REQUIRED',
                message: 'This action requires recent re-authentication',
            });
            return;
        }
        if (new Date(reauthOkUntil) < new Date()) {
            reply.status(403).send({
                error: 'Re-authentication required',
                code: 'REAUTH_EXPIRED',
                message: 'Re-authentication expired; please re-authenticate',
            });
            return;
        }
    }
    catch (error) {
        request.log.error(error, 'Error checking re-authentication status');
        reply.status(500).send({
            error: 'Internal server error',
            message: 'Failed to verify re-authentication',
        });
        return;
    }
}
/**
 * Middleware to require admin role and re-authentication.
 * Must be used after requireAuth.
 */
async function requireReauthForAdmin(request, reply) {
    // First require authentication (attaches request.staff)
    await requireAuth(request, reply);
    if (reply.statusCode >= 400) {
        return;
    }
    // Then check admin role
    await requireAdmin(request, reply);
    if (reply.statusCode >= 400) {
        return;
    }
    // Then check re-authentication
    await requireReauth(request, reply);
}
/**
 * Optional authentication middleware.
 * Attaches staff info to request if a valid token is present, but never 401s.
 * Use this for kiosk-facing endpoints where auth is optional.
 */
async function optionalAuth(request, _reply) {
    // Try to extract staff, but don't fail if not present
    await extractStaffFromToken(request);
}
