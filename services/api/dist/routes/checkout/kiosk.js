"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckoutKioskRoutes = registerCheckoutKioskRoutes;
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const clubEventLog_1 = require("../../activity/clubEventLog");
const utils_1 = require("../../checkout/utils");
const HttpError_1 = require("../../errors/HttpError");
/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by insertClubEvent.
 */
function toQueryable(tx) {
    return {
        async query(queryText, params) {
            const values = params ?? [];
            let built = drizzle_orm_1.sql.empty();
            const regex = /\$(\d+)/g;
            let lastIndex = 0;
            for (const match of queryText.matchAll(regex)) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex, match.index))}`;
                const paramIndex = Number.parseInt(match[1], 10) - 1;
                built = (0, drizzle_orm_1.sql) `${built}${values[paramIndex]}`;
                lastIndex = match.index + match[0].length;
            }
            if (lastIndex < queryText.length) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex))}`;
            }
            const result = await tx.execute(built);
            return { rows: result.rows };
        },
    };
}
async function resolveCheckoutKeyLogic(token) {
    const tagResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, resource_id, tag_code, is_active FROM key_tags WHERE tag_code = ${token} AND is_active = true`);
    if (tagResult.rows.length === 0)
        throw new HttpError_1.HttpError(404, 'Key tag not found or inactive');
    const tag = tagResult.rows[0];
    if (!tag.resource_id)
        throw new HttpError_1.HttpError(404, 'Key tag is not associated with a resource');
    const blockResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
            cb.rental_type::text as rental_type, cb.resource_id, cb.session_id, cb.has_tv_remote
     FROM checkin_blocks cb JOIN visits v ON cb.visit_id = v.id
     WHERE cb.resource_id = ${tag.resource_id} AND v.ended_at IS NULL ORDER BY cb.ends_at DESC LIMIT 1`);
    if (blockResult.rows.length === 0)
        throw new HttpError_1.HttpError(404, 'No active occupancy found for this key');
    const block = blockResult.rows[0];
    const visitResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT customer_id FROM visits WHERE id = ${block.visit_id}`);
    if (visitResult.rows.length === 0)
        throw new HttpError_1.HttpError(404, 'Visit not found');
    const customerId = visitResult.rows[0].customer_id;
    const customerResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, membership_number, banned_until FROM customers WHERE id = ${customerId}`);
    if (customerResult.rows.length === 0)
        throw new HttpError_1.HttpError(404, 'Customer not found');
    const customer = customerResult.rows[0];
    let resourceNumber;
    if (block.resource_id) {
        const resourceResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, number, kind, tier FROM inventory_resources WHERE id = ${block.resource_id}`);
        if (resourceResult.rows.length > 0) {
            resourceNumber = resourceResult.rows[0].number;
        }
    }
    const now = new Date();
    const scheduledCheckoutAt = block.ends_at instanceof Date ? block.ends_at : new Date(block.ends_at);
    const lateMinutes = Math.max(0, Math.floor((now.getTime() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
    const { feeAmount, banApplied } = (0, utils_1.calculateLateFee)(lateMinutes);
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
async function createCheckoutRequestLogic(body, fastify) {
    const result = await db_1.db.transaction(async (tx) => {
        const blockResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
            cb.rental_type::text as rental_type, cb.resource_id, cb.session_id, cb.has_tv_remote,
            v.customer_id
     FROM checkin_blocks cb JOIN visits v ON cb.visit_id = v.id
     WHERE cb.id = ${body.occupancyId} AND v.ended_at IS NULL`);
        if (blockResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Active occupancy not found');
        const block = blockResult.rows[0];
        const existingRequest = await tx.execute((0, drizzle_orm_1.sql) `SELECT id FROM checkout_requests WHERE occupancy_id = ${body.occupancyId} AND status IN ('SUBMITTED', 'CLAIMED')`);
        if (existingRequest.rows.length > 0)
            throw new HttpError_1.HttpError(409, 'Checkout request already exists for this occupancy');
        const now = new Date();
        const scheduledCheckoutAt = block.ends_at instanceof Date ? block.ends_at : new Date(block.ends_at);
        const lateMinutes = Math.max(0, Math.floor((now.getTime() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
        const { feeAmount, banApplied } = (0, utils_1.calculateLateFee)(lateMinutes);
        let keyTagId = null;
        if (block.resource_id) {
            const keyResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id FROM key_tags WHERE resource_id = ${block.resource_id} AND is_active = true LIMIT 1`);
            if (keyResult.rows.length > 0)
                keyTagId = keyResult.rows[0].id;
        }
        const requestResult = await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO checkout_requests (
      occupancy_id, customer_id, key_tag_id, kiosk_device_id, customer_checklist_json, late_minutes, late_fee_amount, ban_applied
    ) VALUES (${body.occupancyId}, ${block.customer_id}, ${keyTagId}, ${body.kioskDeviceId}, ${JSON.stringify(body.checklist)}, ${lateMinutes}, ${feeAmount}, ${banApplied}) RETURNING id, occupancy_id, customer_id, key_tag_id, kiosk_device_id, created_at, claimed_by_staff_id, claimed_at, claim_expires_at, customer_checklist_json, status, late_minutes, late_fee_amount, ban_applied, items_confirmed, fee_paid, completed_at`);
        return requestResult.rows[0];
    }, { isolationLevel: 'serializable' });
    const blockResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at, cb.rental_type::text as rental_type, cb.resource_id, cb.session_id, cb.has_tv_remote, v.customer_id FROM checkin_blocks cb JOIN visits v ON cb.visit_id = v.id WHERE cb.id = ${body.occupancyId}`);
    const block = blockResult.rows[0];
    const customerResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, membership_number FROM customers WHERE id = ${block.customer_id}`);
    const customer = customerResult.rows[0];
    let resourceNumber;
    if (block.resource_id) {
        const resourceResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT number, kind FROM inventory_resources WHERE id = ${block.resource_id}`);
        if (resourceResult.rows.length > 0)
            resourceNumber = resourceResult.rows[0].number;
    }
    if (fastify.broadcaster) {
        const summary = {
            requestId: result.id, customerId: customer.id, customerName: customer.name, membershipNumber: customer.membership_number || undefined,
            rentalType: block.rental_type, roomNumber: resourceNumber, lockerNumber: undefined, scheduledCheckoutAt: block.ends_at, currentTime: new Date(), lateMinutes: result.late_minutes, lateFeeAmount: result.late_fee_amount, banApplied: result.ban_applied,
        };
        fastify.broadcaster.broadcast({ type: 'CHECKOUT_REQUESTED', payload: { request: summary }, timestamp: new Date().toISOString() });
    }
    await db_1.db.transaction(async (tx) => {
        const resourceLabel = resourceNumber ? ` (${block.rental_type === 'LOCKER' ? 'Locker' : 'Room'} ${resourceNumber})` : '';
        await (0, clubEventLog_1.insertClubEventDrizzle)(tx, {
            eventType: 'CHECKOUT_REQUESTED', eventDomain: 'CHECKOUT', sourceApp: 'CUSTOMER_KIOSK', customerId: customer.id, customerName: customer.name, visitId: block.visit_id, summary: `Checkout requested — ${customer.name}${resourceLabel}`,
            metadata: { checkoutRequestId: result.id, occupancyId: body.occupancyId, resourceNumber: resourceNumber ?? null, lateMinutes: result.late_minutes, lateFeeAmount: result.late_fee_amount, banApplied: result.ban_applied },
            dedupeKey: `CLUB:CHECKOUT_REQUESTED:${result.id}`,
        });
    });
    return result.id;
}
function registerCheckoutKioskRoutes(fastify) {
    /**
     * POST /v1/checkout/resolve-key - Resolve a key tag to checkout information
     */
    fastify.post('/v1/checkout/resolve-key', {}, async (request, reply) => {
        try {
            const result = await resolveCheckoutKeyLogic(request.body.token);
            return reply.send(result);
        }
        catch (error) {
            if (error instanceof HttpError_1.HttpError) {
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
    fastify.post('/v1/checkout/request', {}, async (request, reply) => {
        try {
            const requestId = await createCheckoutRequestLogic(request.body, fastify);
            return reply.status(201).send({ requestId });
        }
        catch (error) {
            if (error instanceof HttpError_1.HttpError) {
                return reply.status(error.statusCode).send({ error: error.message });
            }
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            fastify.log.error(error, 'Failed to create checkout request');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
