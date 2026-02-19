import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { serializableTransaction, transaction } from '../../db';
import type { CheckoutRequestRow, CheckinBlockRow, WaitlistStatusRow } from '../../checkout/types';
import { MarkFeePaidSchema, type MarkFeePaidInput } from '../../checkout/schemas';
import type {
  CheckoutClaimedPayload,
  CheckoutCompletedPayload,
  CheckoutUpdatedPayload,
} from '@the-clubs/shared';
import { RoomStatus } from '@the-clubs/shared';
import { broadcastInventoryUpdate } from '../../inventory/broadcast';
import { insertAuditLog } from '../../audit/auditLog';
import { insertCustomerActivityEvent } from '../../activity/customerActivityLog';
import { insertClubEvent } from '../../activity/clubEventLog';
import { insertCustomerSpendLedgerEntry } from '../../ledger/customerSpendLedger';
import { looksLikeUuid } from '../../checkout/utils';
import { computeOrderTotals, ensureOrderWithReceipt, toCents } from '../../money/orderAudit';

export function registerCheckoutStaffRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkout/:requestId/claim - Claim a checkout request
   *
   * Employee endpoint to claim ownership of a checkout request.
   * Only employees not "mid-checkin" can claim.
   * Sets a 2-minute TTL lock.
   */
  fastify.post<{ Params: { requestId: string } }>(
    '/v1/checkout/:requestId/claim',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      try {
        const result = await serializableTransaction(async (client) => {
          // 1. Check if employee is mid-checkin
          // For now, we'll allow claiming - in a production system, you might track
          // which staff member is working on which lane/session
          // This is a placeholder check - adjust based on your business logic

          // 2. Get the request and verify it's claimable
          const requestResult = await client.query<CheckoutRequestRow>(
            `SELECT id, occupancy_id, customer_id, key_tag_id, kiosk_device_id,
                  created_at, claimed_by_staff_id, claimed_at, claim_expires_at,
                  customer_checklist_json, status, late_minutes, late_fee_amount,
                  ban_applied, items_confirmed, fee_paid, completed_at
           FROM checkout_requests
           WHERE id = $1 FOR UPDATE`,
            [request.params.requestId]
          );

          if (requestResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Checkout request not found' };
          }

          const checkoutRequest = requestResult.rows[0]!;

          if (checkoutRequest.status !== 'SUBMITTED') {
            // Check if claim expired
            if (checkoutRequest.status === 'CLAIMED' && checkoutRequest.claim_expires_at) {
              const now = new Date();
              if (now > checkoutRequest.claim_expires_at) {
                // Claim expired, allow re-claim
                // Continue to claim logic
              } else {
                throw { statusCode: 409, message: 'Checkout request already claimed' };
              }
            } else {
              throw { statusCode: 409, message: `Checkout request is ${checkoutRequest.status}` };
            }
          }

          // 3. Claim the request with 2-minute TTL
          const now = new Date();
          const claimExpiresAt = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes

          const updateResult = await client.query<CheckoutRequestRow>(
            `UPDATE checkout_requests
           SET claimed_by_staff_id = $1, claimed_at = $2, claim_expires_at = $3, status = 'CLAIMED', updated_at = NOW()
           WHERE id = $4
           RETURNING id, occupancy_id, customer_id, key_tag_id, kiosk_device_id,
                     created_at, claimed_by_staff_id, claimed_at, claim_expires_at,
                     customer_checklist_json, status, late_minutes, late_fee_amount,
                     ban_applied, items_confirmed, fee_paid, completed_at`,
            [staffId, now, claimExpiresAt, request.params.requestId]
          );

          return updateResult.rows[0]!;
        });

        // 5. Broadcast CHECKOUT_CLAIMED event
        if (fastify.broadcaster) {
          const payload: CheckoutClaimedPayload = {
            requestId: result.id,
            claimedBy: staffId,
          };

          fastify.broadcaster.broadcast({
            type: 'CHECKOUT_CLAIMED',
            payload,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.send({
          requestId: result.id,
          claimedBy: staffId,
          claimedAt: result.claimed_at,
          claimExpiresAt: result.claim_expires_at,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to claim checkout request');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/checkout/:requestId/mark-fee-paid - Mark late fee as paid
   *
   * Employee endpoint to record manual payment confirmation.
   */
  fastify.post<{ Params: { requestId: string }; Body: MarkFeePaidInput }>(
    '/v1/checkout/:requestId/mark-fee-paid',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      let body: MarkFeePaidInput;
      try {
        body = MarkFeePaidSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          // 1. Verify request is claimed by this staff member
          const requestResult = await client.query<
            CheckoutRequestRow & { customer_id: string | null; occupancy_id: string | null }
          >(
            `SELECT id, claimed_by_staff_id, status, fee_paid, late_fee_amount, customer_id, occupancy_id
           FROM checkout_requests
           WHERE id = $1`,
            [request.params.requestId]
          );

          if (requestResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Checkout request not found' };
          }

          const checkoutRequest = requestResult.rows[0]!;

          if (checkoutRequest.claimed_by_staff_id !== staffId) {
            throw { statusCode: 403, message: 'Not authorized to update this checkout request' };
          }

          if (checkoutRequest.status !== 'CLAIMED') {
            throw { statusCode: 409, message: `Checkout request is ${checkoutRequest.status}` };
          }

          // 2. Mark fee as paid
          const updateResult = await client.query<CheckoutRequestRow>(
            `UPDATE checkout_requests
           SET fee_paid = true, updated_at = NOW()
           WHERE id = $1
           RETURNING id, items_confirmed, fee_paid`,
            [request.params.requestId]
          );

          const feeAmount = Number(checkoutRequest.late_fee_amount) || 0;
          if (feeAmount > 0) {
            const existingOrder = await client.query<{ id: string }>(
              `SELECT id FROM orders WHERE metadata_json->>$1 = $2 LIMIT 1`,
              ['checkoutRequestId', request.params.requestId]
            );

            if (existingOrder.rows.length === 0) {
              const registerSession = await client.query<{
                id: string;
                register_number: number | null;
              }>(
                `SELECT id, register_number
                 FROM register_sessions
                 WHERE employee_id = $1
                   AND signed_out_at IS NULL
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [staffId]
              );
              const activeRegister = registerSession.rows[0];
              const resolvedRegisterNumber =
                body.registerNumber ?? activeRegister?.register_number ?? null;

              const quoteJson = {
                type: 'LATE_FEE',
                lineItems: [
                  {
                    description: 'Late Fee',
                    amount: feeAmount,
                    kind: 'LATE_FEE',
                  },
                ],
                total: feeAmount,
                messages: body.note ? [body.note] : [],
              };

              const paymentIntent = await client.query<{
                id: string;
                amount: number | string;
                payment_method?: string | null;
                register_number?: number | null;
                tip_cents?: number | null;
              }>(
                `INSERT INTO payment_intents
                 (amount, status, quote_json, payment_method, register_number, tip_cents, paid_at, paid_by_staff_id)
                 VALUES ($1, 'PAID', $2, $3, $4, $5, NOW(), $6)
                 RETURNING id, amount, payment_method, register_number, tip_cents`,
                [
                  feeAmount,
                  JSON.stringify(quoteJson),
                  body.paymentMethod ?? null,
                  resolvedRegisterNumber,
                  body.tipCents ?? 0,
                  staffId,
                ]
              );

              const intent = paymentIntent.rows[0]!;
              const feeCents = toCents(feeAmount) ?? 0;
              const lineItems = [
                {
                  kind: 'LATE_FEE' as const,
                  name: 'Late Fee',
                  quantity: 1,
                  unitPriceCents: feeCents,
                  totalCents: feeCents,
                },
              ];
              const totals = computeOrderTotals(lineItems, feeCents, intent.tip_cents ?? 0);

              const ensured = await ensureOrderWithReceipt(client, {
                dedupeKey: { field: 'checkoutRequestId', value: request.params.requestId },
                customerId: checkoutRequest.customer_id ?? null,
                registerSessionId: activeRegister?.id ?? null,
                createdByStaffId: staffId,
                totals,
                lineItems,
                metadata: {
                  checkoutRequestId: request.params.requestId,
                  paymentIntentId: intent.id,
                  paymentMethod: intent.payment_method ?? null,
                  registerNumber: intent.register_number ?? null,
                },
                tender: {
                  paymentIntentId: intent.id,
                  paymentMethod: intent.payment_method ?? null,
                  amountCents: feeCents,
                  tipCents: intent.tip_cents ?? 0,
                  registerNumber: intent.register_number ?? null,
                },
              });

              if (checkoutRequest.customer_id) {
                const blockRow = await client.query<{ visit_id: string }>(
                  `SELECT visit_id FROM checkin_blocks WHERE id = $1 LIMIT 1`,
                  [checkoutRequest.occupancy_id]
                );
                const visitId = blockRow.rows[0]?.visit_id ?? null;

                const ledger = await insertCustomerSpendLedgerEntry(client, {
                  customerId: checkoutRequest.customer_id,
                  visitId,
                  entryType: 'CHECKOUT_FEE_PAID',
                  amountCents: ensured.order.total_cents,
                  sourceApp: 'EMPLOYEE_REGISTER',
                  actorType: 'STAFF',
                  actorStaffId: staffId,
                  actorStaffName: request.staff!.name,
                  summary: 'Checkout fee paid',
                  metadata: {
                    checkoutRequestId: request.params.requestId,
                    orderId: ensured.order.id,
                    paymentIntentId: intent.id,
                    totalCents: ensured.order.total_cents,
                    visitId,
                  },
                  dedupeKey: `LEDGER:CHECKOUT_FEE_PAID:${request.params.requestId}`,
                });

                const event = await insertCustomerActivityEvent(client, {
                  customerId: checkoutRequest.customer_id,
                  actionType: 'CHECKOUT_FEE_PAID',
                  actionCategory: 'CHECKOUT',
                  sourceApp: 'EMPLOYEE_REGISTER',
                  actorType: 'STAFF',
                  actorStaffId: staffId,
                  actorStaffName: request.staff!.name,
                  summary: `Checkout fee paid ($${(ensured.order.total_cents / 100).toFixed(2)})`,
                  metadata: {
                    checkoutRequestId: request.params.requestId,
                    orderId: ensured.order.id,
                    paymentIntentId: intent.id,
                    spendLedgerEntryId: ledger.id,
                    visitId,
                  },
                  dedupeKey: `ACT:CHECKOUT_FEE_PAID:${request.params.requestId}`,
                  searchParts: [request.params.requestId, ensured.order.id, intent.id],
                });

                request.log.info(
                  {
                    customerActivityEventId: event.id,
                    customerId: checkoutRequest.customer_id,
                    actionType: 'CHECKOUT_FEE_PAID',
                    actionCategory: 'CHECKOUT',
                    sourceApp: 'EMPLOYEE_REGISTER',
                    actorType: 'STAFF',
                    actorStaffId: staffId,
                  },
                  'customer_activity_event'
                );
              }
            }
          }

          return updateResult.rows[0]!;
        });

        // 3. Broadcast CHECKOUT_UPDATED event
        if (fastify.broadcaster) {
          const payload: CheckoutUpdatedPayload = {
            requestId: result.id,
            itemsConfirmed: result.items_confirmed,
            feePaid: result.fee_paid,
          };

          fastify.broadcaster.broadcast({
            type: 'CHECKOUT_UPDATED',
            payload,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.send({
          requestId: result.id,
          feePaid: result.fee_paid,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to mark fee as paid');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/checkout/:requestId/confirm-items - Confirm items returned
   *
   * Employee endpoint to mark items as verified.
   */
  fastify.post<{ Params: { requestId: string } }>(
    '/v1/checkout/:requestId/confirm-items',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      try {
        const result = await transaction(async (client) => {
          // 1. Verify request is claimed by this staff member
          const requestResult = await client.query<CheckoutRequestRow>(
            `SELECT id, claimed_by_staff_id, status, items_confirmed
           FROM checkout_requests
           WHERE id = $1`,
            [request.params.requestId]
          );

          if (requestResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Checkout request not found' };
          }

          const checkoutRequest = requestResult.rows[0]!;

          if (checkoutRequest.claimed_by_staff_id !== staffId) {
            throw { statusCode: 403, message: 'Not authorized to update this checkout request' };
          }

          if (checkoutRequest.status !== 'CLAIMED') {
            throw { statusCode: 409, message: `Checkout request is ${checkoutRequest.status}` };
          }

          // 2. Mark items as confirmed
          const updateResult = await client.query<CheckoutRequestRow>(
            `UPDATE checkout_requests
           SET items_confirmed = true, updated_at = NOW()
           WHERE id = $1
           RETURNING id, items_confirmed, fee_paid`,
            [request.params.requestId]
          );

          return updateResult.rows[0]!;
        });

        // 3. Broadcast CHECKOUT_UPDATED event
        if (fastify.broadcaster) {
          const payload: CheckoutUpdatedPayload = {
            requestId: result.id,
            itemsConfirmed: result.items_confirmed,
            feePaid: result.fee_paid,
          };

          fastify.broadcaster.broadcast({
            type: 'CHECKOUT_UPDATED',
            payload,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.send({
          requestId: result.id,
          itemsConfirmed: result.items_confirmed,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to confirm items');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/checkout/:requestId/complete - Complete checkout
   *
   * Employee endpoint to finalize checkout.
   * Updates room/locker status, logs events, applies bans, and emits realtime updates.
   */
  fastify.post<{ Params: { requestId: string } }>(
    '/v1/checkout/:requestId/complete',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      try {
        const result = await serializableTransaction(async (client) => {
          // 1. Get the checkout request
          const requestResult = await client.query<CheckoutRequestRow>(
            `SELECT id, occupancy_id, customer_id, key_tag_id, kiosk_device_id,
                  created_at, claimed_by_staff_id, claimed_at, claim_expires_at,
                  customer_checklist_json, status, late_minutes, late_fee_amount,
                  ban_applied, items_confirmed, fee_paid, completed_at
           FROM checkout_requests
           WHERE id = $1 FOR UPDATE`,
            [request.params.requestId]
          );

          if (requestResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Checkout request not found' };
          }

          const checkoutRequest = requestResult.rows[0]!;

          if (checkoutRequest.claimed_by_staff_id !== staffId) {
            throw { statusCode: 403, message: 'Not authorized to complete this checkout request' };
          }

          if (checkoutRequest.status !== 'CLAIMED') {
            throw { statusCode: 409, message: `Checkout request is ${checkoutRequest.status}` };
          }

          if (!checkoutRequest.items_confirmed) {
            throw {
              statusCode: 400,
              message: 'Items must be confirmed before completing checkout',
            };
          }

          if (checkoutRequest.late_fee_amount > 0 && !checkoutRequest.fee_paid) {
            throw { statusCode: 400, message: 'Late fee must be paid before completing checkout' };
          }

          // 2. Get the checkin block
          const blockResult = await client.query<CheckinBlockRow & { customer_id: string }>(
            `SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
                  cb.rental_type::text as rental_type, cb.room_id, cb.locker_id, cb.session_id, cb.has_tv_remote,
                  v.customer_id
           FROM checkin_blocks cb
           JOIN visits v ON cb.visit_id = v.id
           WHERE cb.id = $1`,
            [checkoutRequest.occupancy_id]
          );

          if (blockResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Occupancy not found' };
          }

          const block = blockResult.rows[0]!;

          // 2b. Cancel any active waitlist entries for this visit (system cancel on checkout)
          const waitlistResult = await client.query<WaitlistStatusRow>(
            `SELECT id, status
             FROM waitlist
             WHERE visit_id = $1 AND status IN ('ACTIVE','OFFERED')
             FOR UPDATE`,
            [block.visit_id]
          );

          if (waitlistResult.rows.length > 0) {
            const waitlistIds = waitlistResult.rows.map((r) => r.id);

            await client.query(
              `UPDATE waitlist
               SET status = 'CANCELLED',
                   cancelled_at = NOW(),
                   cancelled_by_staff_id = NULL,
                   updated_at = NOW()
               WHERE id = ANY($1::uuid[])`,
              [waitlistIds]
            );

            const auditStaffId = looksLikeUuid(staffId) ? staffId : null;
            for (const row of waitlistResult.rows) {
              await insertAuditLog(client, {
                staffId: auditStaffId,
                action: 'WAITLIST_CANCELLED',
                entityType: 'waitlist',
                entityId: row.id,
                oldValue: { status: row.status },
                newValue: { status: 'CANCELLED', reason: 'CHECKED_OUT' },
              });
            }
          }

          // 3. Update room to DIRTY or locker to AVAILABLE
          if (block.room_id) {
            await client.query(
              `UPDATE rooms SET status = $1, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $2`,
              [RoomStatus.DIRTY, block.room_id]
            );
          }

          if (block.locker_id) {
            await client.query(
              `UPDATE lockers SET status = $1, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $2`,
              [RoomStatus.CLEAN, block.locker_id] // CLEAN = AVAILABLE for lockers
            );
          }

          // 4. End the visit
          await client.query(
            `UPDATE visits SET ended_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [block.visit_id]
          );

          // 6. Apply ban if needed
          // Ban is manager-approval-based. If a ban is recommended, create a manager alert.
          // (No immediate customer ban is applied here.)
          if (checkoutRequest.ban_applied) {
            await client.query(
              `
              INSERT INTO late_checkout_ban_alerts
                (customer_id, checkout_request_id, occupancy_id, visit_id,
                 late_minutes, fee_amount_cents, recommended_ban_days,
                 status, created_by_staff_id, created_by_staff_name)
              VALUES
                ($1, $2, $3, $4, $5, $6, 30, 'PENDING', $7, $8)
              ON CONFLICT (checkout_request_id) DO NOTHING
              `,
              [
                checkoutRequest.customer_id,
                checkoutRequest.id,
                checkoutRequest.occupancy_id,
                block.visit_id,
                checkoutRequest.late_minutes,
                Number(checkoutRequest.late_fee_amount) || 0,
                staffId,
                request.staff!.name,
              ]
            );
          }

          // 6b. Late fee bookkeeping (NO amount/rate changes):
          // - itemize as a charges row
          // - increment past_due_balance
          const feeAmount = Number(checkoutRequest.late_fee_amount) || 0;
          if (feeAmount > 0) {
            await client.query(
              `UPDATE customers
               SET past_due_balance = past_due_balance + $1,
                   updated_at = NOW()
               WHERE id = $2`,
              [feeAmount, checkoutRequest.customer_id]
            );

            const existingLate = await client.query<{ id: string }>(
              `SELECT id FROM charges WHERE checkin_block_id = $1 AND type = 'LATE_FEE' LIMIT 1`,
              [block.id]
            );
            if (existingLate.rows.length === 0) {
              await client.query(
                `INSERT INTO charges (visit_id, checkin_block_id, type, amount, payment_intent_id)
                 VALUES ($1, $2, 'LATE_FEE', $3, NULL)`,
                [block.visit_id, block.id, feeAmount]
              );
            }

            // Add the late fee to the customer's spend ledger so the running checkout ledger
            // includes it and it can be collected now or next visit.
            await insertCustomerSpendLedgerEntry(client, {
              customerId: checkoutRequest.customer_id,
              visitId: block.visit_id,
              entryType: 'LATE_FEE',
              amountCents: feeAmount,
              sourceApp: 'EMPLOYEE_REGISTER',
              actorType: 'STAFF',
              actorStaffId: staffId,
              actorStaffName: request.staff!.name,
              summary: `Late fee assessed ($${(feeAmount / 100).toFixed(2)})`,
              metadata: {
                checkoutRequestId: checkoutRequest.id,
                occupancyId: checkoutRequest.occupancy_id,
                lateMinutes: checkoutRequest.late_minutes,
                banApplied: checkoutRequest.ban_applied,
              },
              dedupeKey: `LEDGER:LATE_FEE:${checkoutRequest.id}`,
            });
          
            // Record a customer note for late checkouts (common staff practice).
            // This is separate from the activity log so it shows prominently on the account.
            if (checkoutRequest.late_minutes >= 30) {
              const noteText = `Late checkout: ${checkoutRequest.late_minutes} minutes late. Fee assessed: $${(
                feeAmount / 100
              ).toFixed(2)}${checkoutRequest.ban_applied ? ' (ban applied)' : ''}.`;
              const noteResult = await client.query<{ id: string }>(
                `INSERT INTO customer_notes
                   (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
                 VALUES
                   ($1, $2, $3, 'EMPLOYEE_REGISTER', $4, true)
                 RETURNING id`,
                [checkoutRequest.customer_id, staffId, request.staff!.name, noteText]
              );

              await insertCustomerActivityEvent(client, {
                customerId: checkoutRequest.customer_id,
                actionType: 'NOTE_ADDED',
                actionCategory: 'NOTE',
                sourceApp: 'EMPLOYEE_REGISTER',
                actorType: 'STAFF',
                actorStaffId: staffId,
                actorStaffName: request.staff!.name,
                summary: 'Note added (Late checkout)',
                metadata: {
                  noteId: noteResult.rows[0]?.id,
                  isImportant: true,
                  reason: 'LATE_CHECKOUT',
                  checkoutRequestId: checkoutRequest.id,
                },
                dedupeKey: `ACT:NOTE_ADDED:LATE_CHECKOUT:${checkoutRequest.id}`,
                searchParts: [checkoutRequest.id],
              });
            }
          }

          // 7. Log late checkout event if late >= 30 minutes
          if (checkoutRequest.late_minutes >= 30) {
            await client.query(
              `INSERT INTO late_checkout_events (customer_id, occupancy_id, checkout_request_id, late_minutes, fee_amount, ban_applied)
             VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                checkoutRequest.customer_id,
                checkoutRequest.occupancy_id,
                checkoutRequest.id,
                checkoutRequest.late_minutes,
                checkoutRequest.late_fee_amount,
                checkoutRequest.ban_applied,
              ]
            );
          }

          // 8. Mark checkout request as completed
          const now = new Date();
          await client.query(
            `UPDATE checkout_requests
           SET status = 'VERIFIED', completed_at = $1, updated_at = NOW()
           WHERE id = $2`,
            [now, checkoutRequest.id]
          );

          const event = await insertCustomerActivityEvent(client, {
            customerId: checkoutRequest.customer_id,
            actionType: 'CHECKOUT_COMPLETED',
            actionCategory: 'CHECKOUT',
            sourceApp: 'EMPLOYEE_REGISTER',
            actorType: 'STAFF',
            actorStaffId: staffId,
            actorStaffName: request.staff!.name,
            summary: 'Checkout completed',
            metadata: {
              checkoutRequestId: checkoutRequest.id,
              visitId: block.visit_id,
              checkinBlockId: block.id,
            },
            dedupeKey: `ACT:CHECKOUT_COMPLETED:${checkoutRequest.id}`,
            searchParts: [checkoutRequest.id, block.visit_id, block.id],
          });

          request.log.info(
            {
              customerActivityEventId: event.id,
              customerId: checkoutRequest.customer_id,
              actionType: 'CHECKOUT_COMPLETED',
              actionCategory: 'CHECKOUT',
              sourceApp: 'EMPLOYEE_REGISTER',
              actorType: 'STAFF',
              actorStaffId: staffId,
            },
            'customer_activity_event'
          );

          // Emit unified club event for analytics
          await insertClubEvent(client, {
            eventType: 'CHECKOUT_COMPLETED',
            eventDomain: 'CHECKOUT',
            sourceApp: 'EMPLOYEE_REGISTER',
            staffId,
            staffName: request.staff!.name,
            customerId: checkoutRequest.customer_id,
            visitId: block.visit_id,
            summary: `Checkout completed`,
            metadata: {
              checkoutRequestId: checkoutRequest.id,
              visitId: block.visit_id,
              checkinBlockId: block.id,
              roomId: block.room_id,
              lockerId: block.locker_id,
              lateMinutes: checkoutRequest.late_minutes,
              feeAmount: Number(checkoutRequest.late_fee_amount) || 0,
              banApplied: checkoutRequest.ban_applied,
            },
            dedupeKey: `CLUB:CHECKOUT_COMPLETED:${checkoutRequest.id}`,
          });

          return {
            requestId: checkoutRequest.id,
            kioskDeviceId: checkoutRequest.kiosk_device_id,
            roomId: block.room_id,
            lockerId: block.locker_id,
            visitId: block.visit_id,
            cancelledWaitlistIds: waitlistResult.rows.map((r) => r.id),
          };
        });

        // 9. Broadcast inventory updates
        if (fastify.broadcaster) {
          // Import inventory broadcast function
          await broadcastInventoryUpdate(fastify.broadcaster);

          // Broadcast room status changes if applicable
          if (result.roomId) {
            fastify.broadcaster.broadcastRoomStatusChanged({
              roomId: result.roomId,
              previousStatus: RoomStatus.CLEAN,
              newStatus: RoomStatus.DIRTY,
              changedBy: staffId,
              override: false,
            });
          }
        }

        // 9b. Broadcast WAITLIST_UPDATED for system-cancelled waitlist entries (after commit)
        if (fastify.broadcaster && result.cancelledWaitlistIds.length > 0) {
          for (const waitlistId of result.cancelledWaitlistIds) {
            fastify.broadcaster.broadcast({
              type: 'WAITLIST_UPDATED',
              payload: {
                waitlistId,
                status: 'CANCELLED',
                visitId: result.visitId,
              },
              timestamp: new Date().toISOString(),
            });
          }
        }

        // 10. Broadcast CHECKOUT_COMPLETED event (for kiosk)
        if (fastify.broadcaster) {
          const payload: CheckoutCompletedPayload = {
            requestId: result.requestId,
            kioskDeviceId: result.kioskDeviceId,
            success: true,
          };

          fastify.broadcaster.broadcast({
            type: 'CHECKOUT_COMPLETED',
            payload,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.send({
          requestId: result.requestId,
          completed: true,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        // Ensure CI logs include the underlying exception even if fastify/pino output is filtered.
        // eslint-disable-next-line no-console
        console.error('Failed to complete checkout', error);
        fastify.log.error(
          {
            err: error,
            requestId: request.params.requestId,
            staffId: request.staff?.staffId,
          },
          'Failed to complete checkout'
        );
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
