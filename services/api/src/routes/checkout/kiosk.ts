import type { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import {
  type ResolveKeyInput,
  type CreateCheckoutRequestInput,
} from '../../checkout/schemas';
import { insertClubEventDrizzle } from '../../activity/clubEventLog';
import type {
  CheckinBlockRow,
  CheckoutRequestRow,
  CustomerRow,
  KeyTagRow,
  ResourceRow,
} from '../../checkout/types';
import type {
  CheckoutRequestSummary,
  ResolvedCheckoutKey,
} from '@the-clubs/shared';
import { calculateLateFee } from '../../checkout/utils';
import { HttpError } from '../../errors/HttpError';

async function resolveCheckoutKeyLogic(token: string): Promise<ResolvedCheckoutKey> {
  const tagResult = await db.execute<Record<string, unknown>>(
    sql`SELECT id, resource_id, tag_code, is_active FROM key_tags WHERE tag_code = ${token} AND is_active = true`
  );
  if (tagResult.rows.length === 0) throw new HttpError(404, 'Key tag not found or inactive');
  const tag = tagResult.rows[0] as unknown as KeyTagRow;
  if (!tag.resource_id) throw new HttpError(404, 'Key tag is not associated with a resource');

  const blockResult = await db.execute<Record<string, unknown>>(
    sql`SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
            cb.rental_type::text as rental_type, cb.resource_id, cb.session_id, cb.has_tv_remote
     FROM checkin_blocks cb JOIN visits v ON cb.visit_id = v.id
     WHERE cb.resource_id = ${tag.resource_id} AND v.ended_at IS NULL ORDER BY cb.ends_at DESC LIMIT 1`
  );
  if (blockResult.rows.length === 0) throw new HttpError(404, 'No active occupancy found for this key');
  const block = blockResult.rows[0] as unknown as CheckinBlockRow;

  const visitResult = await db.execute<Record<string, unknown>>(
    sql`SELECT customer_id FROM visits WHERE id = ${block.visit_id}`
  );
  if (visitResult.rows.length === 0) throw new HttpError(404, 'Visit not found');
  const customerId = (visitResult.rows[0] as unknown as { customer_id: string }).customer_id;

  const customerResult = await db.execute<Record<string, unknown>>(
    sql`SELECT id, name, membership_number, banned_until FROM customers WHERE id = ${customerId}`
  );
  if (customerResult.rows.length === 0) throw new HttpError(404, 'Customer not found');
  const customer = customerResult.rows[0] as unknown as CustomerRow;

  let resourceNumber: string | undefined;
  if (block.resource_id) {
    const resourceResult = await db.execute<Record<string, unknown>>(
      sql`SELECT id, number, kind, tier FROM inventory_resources WHERE id = ${block.resource_id}`
    );
    if (resourceResult.rows.length > 0) {
      resourceNumber = (resourceResult.rows[0] as unknown as ResourceRow).number;
    }
  }

  const now = new Date();
  const scheduledCheckoutAt = block.ends_at instanceof Date ? block.ends_at : new Date(block.ends_at);
  const lateMinutes = Math.max(0, Math.floor((now.getTime() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
  const { feeAmount, banApplied } = calculateLateFee(lateMinutes);

  return {
    keyTagId: tag.id,
    occupancyId: block.id,
    customerId: customer.id,
    customerName: customer.name,
    membershipNumber: customer.membership_number || undefined,
    rentalType: block.rental_type,
    resourceId: block.resource_id || undefined,
    resourceNumber,
    scheduledCheckoutAt,
    hasTvRemote: block.has_tv_remote,
    lateMinutes,
    lateFeeAmount: feeAmount,
    banApplied,
  };
}

async function createCheckoutRequestLogic(body: CreateCheckoutRequestInput, fastify: FastifyInstance): Promise<string> {
  const result = await db.transaction(async (tx) => {
    const blockResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
            cb.rental_type::text as rental_type, cb.resource_id, cb.session_id, cb.has_tv_remote,
            v.customer_id
     FROM checkin_blocks cb JOIN visits v ON cb.visit_id = v.id
     WHERE cb.id = ${body.occupancyId} AND v.ended_at IS NULL`
    );
    if (blockResult.rows.length === 0) throw new HttpError(404, 'Active occupancy not found');
    const block = blockResult.rows[0] as unknown as CheckinBlockRow & { customer_id: string };

    const existingRequest = await tx.execute<Record<string, unknown>>(
      sql`SELECT id FROM checkout_requests WHERE occupancy_id = ${body.occupancyId} AND status IN ('SUBMITTED', 'CLAIMED')`
    );
    if (existingRequest.rows.length > 0) throw new HttpError(409, 'Checkout request already exists for this occupancy');

    const now = new Date();
    const scheduledCheckoutAt = block.ends_at instanceof Date ? block.ends_at : new Date(block.ends_at);
    const lateMinutes = Math.max(0, Math.floor((now.getTime() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
    const { feeAmount, banApplied } = calculateLateFee(lateMinutes);

    let keyTagId: string | null = null;
    let resourceNumber: string | undefined;

    if (block.resource_id) {
      const keyResult = await tx.execute<Record<string, unknown>>(sql`SELECT id FROM key_tags WHERE resource_id = ${block.resource_id} AND is_active = true LIMIT 1`);
      if (keyResult.rows.length > 0) keyTagId = (keyResult.rows[0] as unknown as { id: string }).id;

      const resourceResult = await tx.execute<Record<string, unknown>>(sql`SELECT number, kind FROM inventory_resources WHERE id = ${block.resource_id}`);
      if (resourceResult.rows.length > 0) resourceNumber = (resourceResult.rows[0] as unknown as ResourceRow).number;
    }

    const customerResult = await tx.execute<Record<string, unknown>>(sql`SELECT id, name, membership_number FROM customers WHERE id = ${block.customer_id}`);
    const customer = customerResult.rows[0] as unknown as CustomerRow;

    const requestResult = await tx.execute<Record<string, unknown>>(
      sql`INSERT INTO checkout_requests (
      occupancy_id, customer_id, key_tag_id, kiosk_device_id, customer_checklist_json, late_minutes, late_fee_amount, ban_applied
    ) VALUES (${body.occupancyId}, ${block.customer_id}, ${keyTagId}, ${body.kioskDeviceId}, ${JSON.stringify(body.checklist)}, ${lateMinutes}, ${feeAmount}, ${banApplied}) RETURNING id, occupancy_id, customer_id, key_tag_id, kiosk_device_id, created_at, claimed_by_staff_id, claimed_at, claim_expires_at, customer_checklist_json, status, late_minutes, late_fee_amount, ban_applied, items_confirmed, fee_paid, completed_at`
    );
    const checkoutReq = requestResult.rows[0] as unknown as CheckoutRequestRow;

    if (fastify.broadcaster) {
      const summary: CheckoutRequestSummary = {
        requestId: checkoutReq.id,
        customerId: customer.id,
        customerName: customer.name,
        membershipNumber: customer.membership_number || undefined,
        rentalType: block.rental_type,
        roomNumber: resourceNumber,
        lockerNumber: undefined,
        scheduledCheckoutAt: block.ends_at,
        currentTime: new Date(),
        lateMinutes: checkoutReq.late_minutes,
        lateFeeAmount: checkoutReq.late_fee_amount,
        banApplied: checkoutReq.ban_applied,
      };
      fastify.broadcaster.broadcast({ type: 'CHECKOUT_REQUESTED', payload: { request: summary }, timestamp: new Date().toISOString() });
    }

    let resourceLabel = '';
    if (resourceNumber) {
      const typeLabel = block.rental_type === 'LOCKER' ? 'Locker' : 'Room';
      resourceLabel = ` (${typeLabel} ${resourceNumber})`;
    }
    await insertClubEventDrizzle(tx, {
      eventType: 'CHECKOUT_REQUESTED',
      eventDomain: 'CHECKOUT',
      sourceApp: 'CUSTOMER_KIOSK',
      customerId: customer.id,
      customerName: customer.name,
      visitId: block.visit_id,
      summary: `Checkout requested — ${customer.name}${resourceLabel}`,
      metadata: { checkoutRequestId: checkoutReq.id, occupancyId: body.occupancyId, resourceNumber: resourceNumber ?? null, lateMinutes: checkoutReq.late_minutes, lateFeeAmount: checkoutReq.late_fee_amount, banApplied: checkoutReq.ban_applied },
      dedupeKey: `CLUB:CHECKOUT_REQUESTED:${checkoutReq.id}`,
    });

    return checkoutReq.id;
  }, { isolationLevel: 'serializable' });

  return result;
}

export function registerCheckoutKioskRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkout/resolve-key - Resolve a key tag to checkout information
   */
  fastify.post<{ Body: ResolveKeyInput }>('/v1/checkout/resolve-key', {}, async (request, reply) => {
    try {
      const result = await resolveCheckoutKeyLogic(request.body.token);
      return reply.send(result);
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      fastify.log.error({ error: errorMessage, stack: errorStack }, 'Failed to resolve checkout key');
      return reply.status(500).send({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'test' ? errorMessage : undefined,
      });
    }
  });

  /**
   * POST /v1/checkout/request - Create a checkout request
   */
  fastify.post<{ Body: CreateCheckoutRequestInput }>(
    '/v1/checkout/request',
    {},
    async (request, reply) => {
      try {
        const requestId = await createCheckoutRequestLogic(request.body, fastify);
        return reply.status(201).send({ requestId });
      } catch (error) {
        if (error instanceof HttpError) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to create checkout request');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
