import crypto from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db';

/**
 * Idempotency-Key middleware for POST endpoints.
 *
 * When an `Idempotency-Key` header is present:
 * 1. Hash the request body to produce a request fingerprint.
 * 2. Look up (principal, route, key) in `idempotency_keys`.
 *    - If found and request hash matches → replay stored response (200/201/etc).
 *    - If found and request hash differs → 409 Conflict.
 *    - If not found → proceed, then store response after handler completes.
 *
 * When the header is absent, pass through without any idempotency logic.
 */
export async function idempotencyKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const key = request.headers['idempotency-key'] as string | undefined;
  if (!key) return; // No header → pass through

  const principalId =
    request.staff?.staffId ??
    (request.headers['kiosk-token'] ? 'kiosk' : 'anonymous');
  const routePath = request.routeOptions.url ?? request.url;
  const bodyStr = JSON.stringify(request.body ?? {});
  const requestHash = crypto.createHash('sha256').update(bodyStr).digest('hex');

  try {
    // Check for existing entry
    const existing = await query<{
      request_hash: string;
      response_status: number;
      response_body: unknown;
    }>(
      `SELECT request_hash, response_status, response_body
       FROM idempotency_keys
       WHERE principal_id = $1
         AND route_path = $2
         AND idempotency_key = $3
         AND expires_at > NOW()`,
      [principalId, routePath, key]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0]!;
      if (row.request_hash !== requestHash) {
        // Same key, different request body → conflict
        reply.status(409).send({
          error: 'Idempotency conflict',
          message:
            'An Idempotency-Key was reused with a different request body. Use a new key for new requests.',
        });
        return;
      }

      // Replay stored response
      reply.status(row.response_status).send(row.response_body);
      return;
    }

    // No existing entry → let handler run, then store the response.
    // Attach a marker so we can store the response in an onSend hook.
    // Use raw reply to add per-request hook with proper typing.
    const rawReply = reply as unknown as { addHook: (name: string, fn: (...args: unknown[]) => Promise<unknown>) => void };
    rawReply.addHook('onSend', async (...args: unknown[]) => {
      const rep = args[1] as { statusCode: number };
      const payload = args[2] as string | unknown;
      try {
        const statusCode = rep.statusCode;
        // Only store successful responses (2xx)
        if (statusCode >= 200 && statusCode < 300) {
          const parsedPayload =
            typeof payload === 'string' ? JSON.parse(payload) : payload;
          await query(
            `INSERT INTO idempotency_keys
               (principal_id, route_path, idempotency_key, request_hash, response_status, response_body)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (principal_id, route_path, idempotency_key)
             DO NOTHING`,
            [principalId, routePath, key, requestHash, statusCode, JSON.stringify(parsedPayload)]
          );
        }
      } catch {
        // Best-effort storage — don't fail the response if idempotency insert fails
      }
      return payload;
    });
  } catch (error) {
    // If idempotency check fails, let the request proceed rather than blocking
    request.log.warn(error, 'Idempotency check failed, proceeding without replay protection');
  }
}
