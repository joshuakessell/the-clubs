import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { sql, and, eq, gt } from 'drizzle-orm';
import { idempotencyKeys } from '../db/schema/index';

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
    const existingRows = await db
      .select({
        requestHash: idempotencyKeys.requestHash,
        responseStatus: idempotencyKeys.responseStatus,
        responseBody: idempotencyKeys.responseBody,
      })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.principalId, principalId),
          eq(idempotencyKeys.routePath, routePath),
          eq(idempotencyKeys.idempotencyKey, key),
          gt(idempotencyKeys.expiresAt, sql`NOW()`)
        )
      );

    if (existingRows.length > 0) {
      const row = existingRows[0];
      if (row.requestHash !== requestHash) {
        // Same key, different request body → conflict
        reply.status(409).send({
          error: 'Idempotency conflict',
          message:
            'An Idempotency-Key was reused with a different request body. Use a new key for new requests.',
        });
        return;
      }

      // Replay stored response
      reply.status(row.responseStatus).send(row.responseBody);
      return;
    }

    // No existing entry → let handler run, then store the response.
    // Attach a marker so we can store the response in an onSend hook.
    // Use raw reply to add per-request hook with proper typing.
    const rawReply = reply as unknown as { addHook: (name: string, fn: (...args: unknown[]) => Promise<unknown>) => void };
    rawReply.addHook('onSend', async (...args: unknown[]) => {
      const rep = args[1] as { statusCode: number };
      const payload = args[2];
      try {
        const statusCode = rep.statusCode;
        // Only store successful responses (2xx)
        if (statusCode >= 200 && statusCode < 300) {
          const parsedPayload =
            typeof payload === 'string' ? JSON.parse(payload) : payload;
          
          await db
            .insert(idempotencyKeys)
            .values({
              principalId,
              routePath,
              idempotencyKey: key,
              requestHash,
              responseStatus: statusCode,
              responseBody: parsedPayload, // Let Drizzle stringify the JSON
            })
            .onConflictDoNothing({
              target: [idempotencyKeys.principalId, idempotencyKeys.routePath, idempotencyKeys.idempotencyKey],
            });
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
