import type { FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db';

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
    return false;
  }

  const token = authHeader.substring(7);

  try {
    const sessionResult = await query<{
      staff_id: string;
      id: string;
      name: string;
      role: string;
    }>(
      `SELECT 
        ss.staff_id,
        ss.id,
        s.name,
        s.role
      FROM staff_sessions ss
      JOIN staff s ON s.id = ss.staff_id
      WHERE ss.session_token = $1 
        AND ss.revoked_at IS NULL
        AND ss.expires_at > NOW()
        AND s.active = true`,
      [token]
    );

    if (sessionResult.rows.length === 0) {
      return false;
    }

    const row = sessionResult.rows[0]!;
    request.staff = {
      staffId: row.staff_id,
      name: row.name,
      role: row.role,
      sessionId: row.id,
    };

    return true;
  } catch (error) {
    request.log.error(error, 'Error validating session token');
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

  try {
    const sessionResult = await query<{ reauth_ok_until: Date | null }>(
      `SELECT reauth_ok_until
       FROM staff_sessions
       WHERE session_token = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()`,
      [token]
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
