"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckoutKioskRoutes = registerCheckoutKioskRoutes;
const db_1 = require("../../db");
const schemas_1 = require("../../checkout/schemas");
const clubEventLog_1 = require("../../activity/clubEventLog");
const utils_1 = require("../../checkout/utils");
const HttpError_1 = require("../../errors/HttpError");
function registerCheckoutKioskRoutes(fastify) {
    /**
     * POST /v1/checkout/resolve-key - Resolve a key tag to checkout information
     *
     * Public endpoint for checkout kiosk to resolve a scanned key QR code.
     * Returns customer info, scheduled checkout time, and computed late fees.
     */
    fastify.post('/v1/checkout/resolve-key', { schema: { body: schemas_1.ResolveKeySchema } }, async (request, reply) => {
        const body = request.body;
        try {
            // 1. Find the key tag
            const tagResult = await (0, db_1.query)(`SELECT id, room_id, locker_id, tag_code, is_active
         FROM key_tags
         WHERE tag_code = $1 AND is_active = true`, [body.token]);
            if (tagResult.rows.length === 0) {
                return reply.status(404).send({
                    error: 'Key tag not found or inactive',
                });
            }
            const tag = tagResult.rows[0];
            // 2. Find the active checkin block for this key
            let blockResult;
            if (tag.room_id) {
                blockResult = await (0, db_1.query)(`SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
                  cb.rental_type::text as rental_type, cb.room_id, cb.locker_id, cb.session_id, cb.has_tv_remote
           FROM checkin_blocks cb
           JOIN visits v ON cb.visit_id = v.id
           WHERE cb.room_id = $1 AND v.ended_at IS NULL
           ORDER BY cb.ends_at DESC
           LIMIT 1`, [tag.room_id]);
            }
            else if (tag.locker_id) {
                blockResult = await (0, db_1.query)(`SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
                  cb.rental_type::text as rental_type, cb.room_id, cb.locker_id, cb.session_id, cb.has_tv_remote
           FROM checkin_blocks cb
           JOIN visits v ON cb.visit_id = v.id
           WHERE cb.locker_id = $1 AND v.ended_at IS NULL
           ORDER BY cb.ends_at DESC
           LIMIT 1`, [tag.locker_id]);
            }
            else {
                return reply.status(404).send({
                    error: 'Key tag is not associated with a room or locker',
                });
            }
            if (blockResult.rows.length === 0) {
                return reply.status(404).send({
                    error: 'No active occupancy found for this key',
                });
            }
            const block = blockResult.rows[0];
            // 3. Get customer information
            const visitResult = await (0, db_1.query)('SELECT customer_id FROM visits WHERE id = $1', [block.visit_id]);
            if (visitResult.rows.length === 0) {
                return reply.status(404).send({
                    error: 'Visit not found',
                });
            }
            const customerId = visitResult.rows[0].customer_id;
            const customerResult = await (0, db_1.query)('SELECT id, name, membership_number, banned_until FROM customers WHERE id = $1', [customerId]);
            if (customerResult.rows.length === 0) {
                return reply.status(404).send({
                    error: 'Customer not found',
                });
            }
            const customer = customerResult.rows[0];
            // 4. Get room/locker details
            let roomNumber;
            let lockerNumber;
            if (block.room_id) {
                const roomResult = await (0, db_1.query)('SELECT id, number, type FROM rooms WHERE id = $1', [block.room_id]);
                if (roomResult.rows.length > 0) {
                    roomNumber = roomResult.rows[0].number;
                }
            }
            if (block.locker_id) {
                const lockerResult = await (0, db_1.query)('SELECT id, number FROM lockers WHERE id = $1', [block.locker_id]);
                if (lockerResult.rows.length > 0) {
                    lockerNumber = lockerResult.rows[0].number;
                }
            }
            // 5. Calculate lateness
            const now = new Date();
            // Ensure ends_at is a Date object (PostgreSQL returns it as a Date, but be safe)
            const scheduledCheckoutAt = block.ends_at instanceof Date ? block.ends_at : new Date(block.ends_at);
            const lateMinutes = Math.max(0, Math.floor((now.getTime() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
            const { feeAmount, banApplied } = (0, utils_1.calculateLateFee)(lateMinutes);
            const result = {
                keyTagId: tag.id,
                occupancyId: block.id,
                customerId: customer.id,
                customerName: customer.name,
                membershipNumber: customer.membership_number || undefined,
                rentalType: block.rental_type,
                roomId: block.room_id || undefined,
                roomNumber,
                lockerId: block.locker_id || undefined,
                lockerNumber,
                scheduledCheckoutAt,
                hasTvRemote: block.has_tv_remote,
                lateMinutes,
                lateFeeAmount: feeAmount,
                banApplied,
            };
            return reply.send(result);
        }
        catch (error) {
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
     *
     * Public endpoint for checkout kiosk to submit a checkout request.
     * Triggers CHECKOUT_REQUESTED realtime event.
     */
    fastify.post('/v1/checkout/request', { schema: { body: schemas_1.CreateCheckoutRequestSchema } }, async (request, reply) => {
        const body = request.body;
        try {
            const result = await (0, db_1.serializableTransaction)(async (client) => {
                // 1. Verify the block exists and is active
                const blockResult = await client.query(`SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
                  cb.rental_type::text as rental_type, cb.room_id, cb.locker_id, cb.session_id, cb.has_tv_remote,
                  v.customer_id
           FROM checkin_blocks cb
           JOIN visits v ON cb.visit_id = v.id
           WHERE cb.id = $1 AND v.ended_at IS NULL`, [body.occupancyId]);
                if (blockResult.rows.length === 0) {
                    throw new HttpError_1.HttpError(404, 'Active occupancy not found');
                }
                const block = blockResult.rows[0];
                // 2. Check for existing active request
                const existingRequest = await client.query(`SELECT id FROM checkout_requests
           WHERE occupancy_id = $1 AND status IN ('SUBMITTED', 'CLAIMED')`, [body.occupancyId]);
                if (existingRequest.rows.length > 0) {
                    throw new HttpError_1.HttpError(409, 'Checkout request already exists for this occupancy');
                }
                // 3. Calculate lateness (same as resolve-key)
                const now = new Date();
                const scheduledCheckoutAt = block.ends_at;
                const lateMinutes = Math.max(0, Math.floor((now.getTime() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
                const { feeAmount, banApplied } = (0, utils_1.calculateLateFee)(lateMinutes);
                // 4. Get key tag ID if available
                let keyTagId = null;
                if (block.room_id) {
                    const keyResult = await client.query(`SELECT id FROM key_tags WHERE room_id = $1 AND is_active = true LIMIT 1`, [block.room_id]);
                    if (keyResult.rows.length > 0) {
                        keyTagId = keyResult.rows[0].id;
                    }
                }
                else if (block.locker_id) {
                    const keyResult = await client.query(`SELECT id FROM key_tags WHERE locker_id = $1 AND is_active = true LIMIT 1`, [block.locker_id]);
                    if (keyResult.rows.length > 0) {
                        keyTagId = keyResult.rows[0].id;
                    }
                }
                // 5. Create the checkout request
                const requestResult = await client.query(`INSERT INTO checkout_requests (
            occupancy_id, customer_id, key_tag_id, kiosk_device_id,
            customer_checklist_json, late_minutes, late_fee_amount, ban_applied
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, occupancy_id, customer_id, key_tag_id, kiosk_device_id,
                    created_at, claimed_by_staff_id, claimed_at, claim_expires_at,
                    customer_checklist_json, status, late_minutes, late_fee_amount,
                    ban_applied, items_confirmed, fee_paid, completed_at`, [
                    body.occupancyId,
                    block.customer_id,
                    keyTagId,
                    body.kioskDeviceId,
                    JSON.stringify(body.checklist),
                    lateMinutes,
                    feeAmount,
                    // "banApplied" here means "ban recommended" (manager approval required).
                    banApplied,
                ]);
                return requestResult.rows[0];
            });
            // 6. Get customer and room/locker info for realtime event
            const blockResult = await (0, db_1.query)(`SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
                cb.rental_type::text as rental_type, cb.room_id, cb.locker_id, cb.session_id, cb.has_tv_remote,
                v.customer_id
         FROM checkin_blocks cb
         JOIN visits v ON cb.visit_id = v.id
         WHERE cb.id = $1`, [body.occupancyId]);
            const block = blockResult.rows[0];
            const customerResult = await (0, db_1.query)('SELECT id, name, membership_number FROM customers WHERE id = $1', [block.customer_id]);
            const customer = customerResult.rows[0];
            let roomNumber;
            let lockerNumber;
            if (block.room_id) {
                const roomResult = await (0, db_1.query)('SELECT number FROM rooms WHERE id = $1', [
                    block.room_id,
                ]);
                if (roomResult.rows.length > 0) {
                    roomNumber = roomResult.rows[0].number;
                }
            }
            if (block.locker_id) {
                const lockerResult = await (0, db_1.query)('SELECT number FROM lockers WHERE id = $1', [
                    block.locker_id,
                ]);
                if (lockerResult.rows.length > 0) {
                    lockerNumber = lockerResult.rows[0].number;
                }
            }
            // 7. Broadcast CHECKOUT_REQUESTED event
            if (fastify.broadcaster) {
                const summary = {
                    requestId: result.id,
                    customerId: customer.id,
                    customerName: customer.name,
                    membershipNumber: customer.membership_number || undefined,
                    rentalType: block.rental_type,
                    roomNumber,
                    lockerNumber,
                    scheduledCheckoutAt: block.ends_at,
                    currentTime: new Date(),
                    lateMinutes: result.late_minutes,
                    lateFeeAmount: result.late_fee_amount,
                    banApplied: result.ban_applied,
                };
                const payload = {
                    request: summary,
                };
                fastify.broadcaster.broadcast({
                    type: 'CHECKOUT_REQUESTED',
                    payload,
                    timestamp: new Date().toISOString(),
                });
            }
            // Log club event for checkout requested
            await (0, db_1.transaction)(async (client) => {
                const resourceLabel = roomNumber ? ` (Room ${roomNumber})` : lockerNumber ? ` (Locker ${lockerNumber})` : '';
                await (0, clubEventLog_1.insertClubEvent)(client, {
                    eventType: 'CHECKOUT_REQUESTED',
                    eventDomain: 'CHECKOUT',
                    sourceApp: 'CUSTOMER_KIOSK',
                    customerId: customer.id,
                    customerName: customer.name,
                    visitId: block.visit_id,
                    summary: `Checkout requested \u2014 ${customer.name}${resourceLabel}`,
                    metadata: {
                        checkoutRequestId: result.id,
                        occupancyId: body.occupancyId,
                        roomNumber: roomNumber ?? null,
                        lockerNumber: lockerNumber ?? null,
                        lateMinutes: result.late_minutes,
                        lateFeeAmount: result.late_fee_amount,
                        banApplied: result.ban_applied,
                    },
                    dedupeKey: `CLUB:CHECKOUT_REQUESTED:${result.id}`,
                });
            });
            return reply.status(201).send({
                requestId: result.id,
            });
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            fastify.log.error(error, 'Failed to create checkout request');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
