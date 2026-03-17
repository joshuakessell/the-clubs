import type { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { hashSessionToken } from './utils';

/**
 * Extended Fastify request with staff information.
 */
declare module 'fastify' {
  interface FastifyRequest {
    staff?: {
      staffId: string;
      name: string;
      role: string;
      sessionId: string;
    };
  }
}

/**
 * Extract and validate session token from Authorization header.
 * Attaches staff information to request.staff if valid.
 */
async function extractStaffFromToken(request: FastifyRequest): Promise<boolean> {
  const authHeader =
    request.headers.authorization ??
    // Defensive: some test/inject clients may pass non-normalized header keys
    ((request.headers as Record<string, unknown>)['Authorization'] as string | undefined) ??
    ((request.headers as Record<string, unknown>)['AUTHORIZATION'] as string | undefined);
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    request.log.debug({ hasAuth: !!authHeader, url: request.url }, 'auth_reject: no Bearer header');
    return false;
  }

  const token = authHeader.substring(7);
  const tokenHash = hashSessionToken(token);

  try {
    const sessionResult = await db.execute<{
      staff_id: string;
      id: string;
      name: string;
      role: string;
    }>(
      sql`SELECT 
        ss.staff_id,
        ss.id,
        s.name,
        s.role
      FROM staff_sessions ss
      JOIN staff s ON s.id = ss.staff_id
      WHERE ss.session_token = ${tokenHash} 
        AND ss.revoked_at IS NULL
        AND ss.expires_at > NOW()
        AND s.active = true`
    );

    if (sessionResult.rows.length === 0) {
      // Log the first 8 chars of the token hash for correlation (safe — hash is not reversible)
      request.log.warn(
        { tokenHashPrefix: tokenHash.slice(0, 8), tokenRawPrefix: token.slice(0, 8), url: request.url },
        'auth_reject: no active session found for token hash'
      );
      return false;
    }

    const row = sessionResult.rows[0]!;
    request.staff = {
      staffId: row.staff_id,
      name: row.name,
      role: row.role,
      sessionId: row.id,
    };

    // Sliding window: extend session expiry on each authenticated request.
    // Only fires if less than 23h remain (throttles to ~1 write/hour max).
    db.execute(
      sql`UPDATE staff_sessions
       SET expires_at = NOW() + INTERVAL '24 hours'
       WHERE session_token = ${tokenHash}
         AND expires_at - NOW() < INTERVAL '23 hours'`
    ).catch(() => {}); // fire-and-forget, non-blocking

    return true;
  } catch (error) {
    request.log.error({ err: error, url: request.url }, 'auth_reject: DB error validating session token');
    return false;
  }
}

/**
 * Middleware to require authentication.
 * Validates Bearer token and attaches staff info to request.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
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
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.staff) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  // In DEMO_MODE, allow any authenticated user to access admin endpoints
  if (process.env.DEMO_MODE === 'true') return;

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
export async function requireReauth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.staff) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  const authHeader =
    request.headers.authorization ??
    // Defensive: some test/inject clients may pass non-normalized header keys
    ((request.headers as Record<string, unknown>)['Authorization'] as string | undefined) ??
    ((request.headers as Record<string, unknown>)['AUTHORIZATION'] as string | undefined);
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Valid session token required',
    });
    return;
  }

  const token = authHeader.substring(7);
  const tokenHash = hashSessionToken(token);

  try {
    const sessionResult = await db.execute<{ reauth_ok_until: Date | null }>(
      sql`SELECT reauth_ok_until
       FROM staff_sessions
       WHERE session_token = ${tokenHash}
         AND revoked_at IS NULL
         AND expires_at > NOW()`
    );

    if (sessionResult.rows.length === 0) {
      reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid session',
      });
      return;
    }

    const reauthOkUntil = sessionResult.rows[0]!.reauth_ok_until;
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
  } catch (error) {
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
export async function requireReauthForAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
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
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  // Try to extract staff, but don't fail if not present
  await extractStaffFromToken(request);
}
