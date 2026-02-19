import type { FastifyInstance } from 'fastify';
import { serializableTransaction } from '../db';
import { requireAuth } from '../auth/middleware';
import type { Broadcaster } from '../realtime/broadcaster';
import { getRoomTierFromNumber } from '@the-clubs/shared';
import { broadcastInventoryUpdate } from '../inventory/broadcast';
import { insertAuditLog } from '../audit/auditLog';
import { insertCustomerActivityEvent } from '../activity/customerActivityLog';

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractPaymentLineItems(
  raw: unknown
): Array<{ description: string; amount: number }> | undefined {
  if (raw === null || raw === undefined) return undefined;
  let parsed: unknown = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(parsed)) return undefined;
  const items = parsed['lineItems'];
  if (!Array.isArray(items)) return undefined;

  const normalized: Array<{ description: string; amount: number }> = [];
  for (const it of items) {
    if (!isRecord(it)) continue;
    const description = it['description'];
    const amount = toNumber(it['amount']);
    if (typeof description !== 'string' || amount === undefined) continue;
    normalized.push({ description, amount });
  }
  return normalized.length > 0 ? normalized : undefined;
}

interface RoomRow {
  id: string;
  number: string;
  type: string;
  status: string;
  assigned_to_customer_id: string | null;
}

/**
 * Upgrade disclaimer text (exact as specified).
 */
const UPGRADE_DISCLAIMER_TEXT = `Upgrade availability and time estimates are not guarantees.

Upgrade fees are charged only if an upgrade becomes available and you choose to accept it.

Upgrades do not extend your stay. Your checkout time remains the same as your original 6-hour check-in.

The full upgrade fee applies even if limited time remains.`;

/**
 * Map room number to tier (Special, Double, or Standard).
 */
function getRoomTier(roomNumber: string): 'SPECIAL' | 'DOUBLE' | 'STANDARD' {
  return getRoomTierFromNumber(parseInt(roomNumber, 10));
}

/**
 * Calculate upgrade fee based on fixed fee schedule.
 * Fees are fixed regardless of time/day/youth pricing.
 */
function calculateUpgradeFee(fromTier: string, toTier: 'STANDARD' | 'DOUBLE' | 'SPECIAL'): number {
  // Normalize fromTier (could be LOCKER, STANDARD, DOUBLE, SPECIAL)
  const from = fromTier === 'LOCKER' || fromTier === 'GYM_LOCKER' ? 'LOCKER' : fromTier;

  // Fixed upgrade fee schedule
  if (from === 'LOCKER') {
    if (toTier === 'STANDARD') return 8;
    if (toTier === 'DOUBLE') return 17;
    if (toTier === 'SPECIAL') return 27;
  } else if (from === 'STANDARD') {
    if (toTier === 'DOUBLE') return 9;
    if (toTier === 'SPECIAL') return 19;
  } else if (from === 'DOUBLE') {
    if (toTier === 'SPECIAL') return 9;
  }

  throw new Error(`Invalid upgrade path: ${from} -> ${toTier}`);
}

/**
 * Upgrade routes for waitlist and upgrade management.
 */
export async function upgradeRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/upgrades/disclaimer - Get upgrade disclaimer text
   *
   * Returns the upgrade disclaimer text for display.
   */
  fastify.get('/v1/upgrades/disclaimer', async (_request, reply) => {
    return reply.send({
      text: UPGRADE_DISCLAIMER_TEXT,
    });
  });

  /**
   * POST /v1/upgrades/fulfill - Fulfill upgrade from waitlist
   *
   * Complete upgrade workflow:
   * 1. Verify waitlist entry is OFFERED
   * 2. Create payment intent for upgrade fee
   * 3. After payment, perform upgrade:
   *    - Release old resource (becomes DIRTY if room, AVAILABLE if locker)
   *    - Assign new room (becomes OCCUPIED)
   *    - Update checkin_block with new room
   *    - Mark waitlist as COMPLETED
   * 4. Log audit entries
   * 5. Broadcast updates
   */
  fastify.post<{
    Body: {
      waitlistId: string;
      roomId: string;
      acknowledgedDisclaimer: boolean;
    };
  }>(
    '/v1/upgrades/fulfill',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const staff = request.staff;
      if (!staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { waitlistId, roomId, acknowledgedDisclaimer } = request.body;

      if (!acknowledgedDisclaimer) {
        return reply.status(400).send({ error: 'Upgrade disclaimer must be acknowledged' });
      }

      try {
        const result = await serializableTransaction(async (client) => {
          // 1. Get waitlist entry with lock
          const waitlistResult = await client.query<{
            id: string;
            visit_id: string;
            checkin_block_id: string;
            desired_tier: string;
            backup_tier: string;
            status: string;
            locker_or_room_assigned_initially: string | null;
            created_at: Date;
            updated_at: Date;
          }>(`SELECT * FROM waitlist WHERE id = $1 FOR UPDATE`, [waitlistId]);

          if (waitlistResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Waitlist entry not found' };
          }

          const waitlist = waitlistResult.rows[0]!;

          if (waitlist.status !== 'OFFERED') {
            throw {
              statusCode: 400,
              message: `Waitlist entry must be OFFERED (current: ${waitlist.status})`,
            };
          }

          // 2. Get checkin_block to find current resource
          const blockResult = await client.query<{
            id: string;
            visit_id: string;
            room_id: string | null;
            locker_id: string | null;
            rental_type: string;
            ends_at: Date;
            session_id: string | null;
          }>(
            `SELECT id, visit_id, room_id, locker_id, rental_type::text as rental_type, ends_at, session_id FROM checkin_blocks WHERE id = $1 FOR UPDATE`,
            [waitlist.checkin_block_id]
          );

          if (blockResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Check-in block not found' };
          }

          const block = blockResult.rows[0]!;

          let originalLineItems: Array<{ description: string; amount: number }> | undefined;
          let originalTotal: number | undefined;

          if (block.session_id) {
            const laneSessionResult = await client.query<{
              id: string;
              price_quote_json: unknown;
              payment_intent_id: string | null;
            }>(
              `SELECT id, price_quote_json, payment_intent_id FROM lane_sessions WHERE id = $1 LIMIT 1`,
              [block.session_id]
            );
            const laneSession = laneSessionResult.rows[0];

            let originalIntent: { amount?: number | string; quote_json?: unknown } | undefined;
            if (laneSession?.payment_intent_id) {
              const intentResult = await client.query<{
                id: string;
                amount: number | string;
                quote_json: unknown;
              }>(`SELECT id, amount, quote_json FROM payment_intents WHERE id = $1 LIMIT 1`, [
                laneSession.payment_intent_id,
              ]);
              originalIntent = intentResult.rows[0];
            } else {
              const intentResult = await client.query<{
                id: string;
                amount: number | string;
                quote_json: unknown;
              }>(
                `SELECT id, amount, quote_json
                 FROM payment_intents
                 WHERE lane_session_id = $1
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [block.session_id]
              );
              originalIntent = intentResult.rows[0];
            }

            originalLineItems =
              extractPaymentLineItems(laneSession?.price_quote_json) ??
              extractPaymentLineItems(originalIntent?.quote_json);
            originalTotal = toNumber(originalIntent?.amount);
          }

          // 3. Get new room and verify availability
          const newRoomResult = await client.query<RoomRow>(
            `SELECT id, number, type, status, assigned_to_customer_id FROM rooms WHERE id = $1 FOR UPDATE`,
            [roomId]
          );

          if (newRoomResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Room not found' };
          }

          const newRoom = newRoomResult.rows[0]!;

          if (newRoom.status !== 'CLEAN') {
            throw {
              statusCode: 400,
              message: `Room ${newRoom.number} is not available (status: ${newRoom.status})`,
            };
          }

          if (newRoom.assigned_to_customer_id) {
            throw { statusCode: 409, message: `Room ${newRoom.number} is already assigned` };
          }

          // Verify tier matches desired tier
          const newRoomTier = getRoomTier(newRoom.number);
          if (newRoomTier !== waitlist.desired_tier) {
            throw {
              statusCode: 400,
              message: `Room ${newRoom.number} is ${newRoomTier}, but desired tier is ${waitlist.desired_tier}`,
            };
          }

          // 4. Calculate upgrade fee
          const upgradeFee = calculateUpgradeFee(block.rental_type, newRoomTier);

          // 5. Create payment intent for upgrade fee (store room info for later retrieval)
          const intentResult = await client.query<{
            id: string;
            amount: number | string;
          }>(
            `INSERT INTO payment_intents (amount, status, quote_json)
           VALUES ($1, 'DUE', $2)
           RETURNING id, amount`,
            [
              upgradeFee,
              JSON.stringify({
                type: 'UPGRADE',
                fromTier: block.rental_type,
                toTier: newRoomTier,
                amount: upgradeFee,
                waitlistId,
                newRoomId: roomId,
                newRoomNumber: newRoom.number,
              }),
            ]
          );

          const paymentIntent = intentResult.rows[0]!;

          // 6. Log upgrade started
          await insertAuditLog(client, {
            staffId: staff.staffId,
            action: 'UPGRADE_STARTED',
            entityType: 'waitlist',
            entityId: waitlistId,
            oldValue: {
              status: waitlist.status,
              currentRentalType: block.rental_type,
              currentResourceId: block.room_id || block.locker_id,
            },
            newValue: {
              desiredTier: waitlist.desired_tier,
              newRoomId: roomId,
              newRoomNumber: newRoom.number,
              upgradeFee,
              paymentIntentId: paymentIntent.id,
              disclaimerAcknowledged: true,
            },
          });

          return {
            waitlistId,
            paymentIntentId: paymentIntent.id,
            upgradeFee:
              typeof paymentIntent.amount === 'string'
                ? parseFloat(paymentIntent.amount)
                : paymentIntent.amount,
            newRoomId: roomId,
            newRoomNumber: newRoom.number,
            newRoomTier,
            fromTier: block.rental_type,
            originalCharges: originalLineItems || [],
            originalTotal: originalTotal ?? null,
            visitId: waitlist.visit_id,
            customerId: (
              await client.query<{ customer_id: string }>(
                `SELECT customer_id FROM visits WHERE id = $1 LIMIT 1`,
                [waitlist.visit_id]
              )
            ).rows[0]!.customer_id,
          };
        });

        await serializableTransaction(async (client) => {
          const event = await insertCustomerActivityEvent(client, {
            customerId: result.customerId,
            actionType: 'UPGRADE_STARTED',
            actionCategory: 'UPGRADE',
            sourceApp: 'EMPLOYEE_REGISTER',
            actorType: 'STAFF',
            actorStaffId: staff.staffId,
            actorStaffName: staff.name,
            summary: `Upgrade started: ${result.fromTier} → ${result.newRoomTier} (Room ${result.newRoomNumber})`,
            metadata: {
              visitId: result.visitId,
              waitlistId: result.waitlistId,
              paymentIntentId: result.paymentIntentId,
              fromTier: result.fromTier,
              toTier: result.newRoomTier,
              newRoomNumber: result.newRoomNumber,
              upgradeFee: result.upgradeFee,
            },
            dedupeKey: `ACT:UPGRADE_STARTED:${result.waitlistId}`,
            searchParts: [result.waitlistId, result.paymentIntentId, result.newRoomNumber],
          });

          request.log.info(
            {
              customerActivityEventId: event.id,
              customerId: result.customerId,
              actionType: 'UPGRADE_STARTED',
              actionCategory: 'UPGRADE',
              sourceApp: 'EMPLOYEE_REGISTER',
              actorType: 'STAFF',
              actorStaffId: staff.staffId,
            },
            'customer_activity_event'
          );
        });

        return reply.send(result);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({
            error: err.message || 'Failed to start upgrade',
          });
        }
        fastify.log.error(error, 'Failed to fulfill upgrade');
        return reply.status(500).send({ error: 'Internal server error', message: error instanceof Error ? error.message : String(error) });
      }
    }
  );

  /**
   * POST /v1/upgrades/complete - Complete upgrade after payment
   *
   * Called after payment is marked as paid.
   * Performs the actual upgrade: resource swap and inventory transitions.
   * Auth required.
   */
  fastify.post<{
    Body: {
      waitlistId: string;
      paymentIntentId: string;
    };
  }>(
    '/v1/upgrades/complete',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const staff = request.staff;
      if (!staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { waitlistId, paymentIntentId } = request.body;

      try {
        const result = await serializableTransaction(async (client) => {
          // 1. Verify payment is paid
          const intentResult = await client.query<{
            id: string;
            amount: number | string;
            status: string;
            quote_json: unknown;
          }>(`SELECT * FROM payment_intents WHERE id = $1`, [paymentIntentId]);

          if (intentResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Payment intent not found' };
          }

          const intent = intentResult.rows[0]!;

          if (intent.status !== 'PAID') {
            throw { statusCode: 400, message: `Payment must be PAID (current: ${intent.status})` };
          }

          // 2. Get waitlist entry
          const waitlistResult = await client.query<{
            id: string;
            visit_id: string;
            checkin_block_id: string;
            desired_tier: string;
            backup_tier: string;
            status: string;
          }>(`SELECT * FROM waitlist WHERE id = $1 FOR UPDATE`, [waitlistId]);

          if (waitlistResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Waitlist entry not found' };
          }

          const waitlist = waitlistResult.rows[0]!;

          if (waitlist.status !== 'OFFERED') {
            throw {
              statusCode: 400,
              message: `Waitlist entry must be OFFERED (current: ${waitlist.status})`,
            };
          }

          // 3. Get checkin_block
          const blockResult = await client.query<{
            id: string;
            visit_id: string;
            room_id: string | null;
            locker_id: string | null;
            rental_type: string;
            ends_at: Date;
            session_id: string | null;
          }>(`SELECT * FROM checkin_blocks WHERE id = $1 FOR UPDATE`, [waitlist.checkin_block_id]);

          if (blockResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Check-in block not found' };
          }

          const block = blockResult.rows[0]!;

          const upgradeAmount = toNumber(intent.amount);

          // 4. Get new room from payment intent quote (stored during fulfill)
          const quote = intent.quote_json as {
            newRoomId?: string;
            newRoomNumber?: string;
            newRoomTier?: string;
            waitlistId?: string;
          };

          if (!quote.newRoomId) {
            throw {
              statusCode: 400,
              message: 'Room ID not found in payment intent (upgrade must be fulfilled first)',
            };
          }

          const newRoomId = quote.newRoomId;

          const newRoomResult = await client.query<RoomRow>(
            `SELECT * FROM rooms WHERE id = $1 FOR UPDATE`,
            [newRoomId]
          );

          if (newRoomResult.rows.length === 0) {
            throw { statusCode: 404, message: 'New room not found' };
          }

          const newRoom = newRoomResult.rows[0]!;

          // 5. Release old resource
          const oldResourceId = block.room_id || block.locker_id;
          const oldResourceType = block.room_id ? 'room' : 'locker';

          if (oldResourceType === 'room' && oldResourceId) {
            // Room becomes DIRTY (used linens)
            await client.query(
              `UPDATE rooms 
             SET assigned_to_customer_id = NULL, status = 'DIRTY', last_status_change = NOW(), updated_at = NOW()
             WHERE id = $1`,
              [oldResourceId]
            );
          } else if (oldResourceType === 'locker' && oldResourceId) {
            // Locker becomes AVAILABLE (CLEAN)
            await client.query(
              `UPDATE lockers 
             SET assigned_to_customer_id = NULL, status = 'CLEAN', updated_at = NOW()
             WHERE id = $1`,
              [oldResourceId]
            );
          }

          // 6. Assign new room (becomes OCCUPIED)
          await client.query(
            `UPDATE rooms 
           SET assigned_to_customer_id = (SELECT customer_id FROM visits WHERE id = $1),
               status = 'OCCUPIED',
               last_status_change = NOW(),
               updated_at = NOW()
           WHERE id = $2`,
            [waitlist.visit_id, newRoomId]
          );

          // 7. Update checkin_block with new room
          await client.query(
            `UPDATE checkin_blocks 
           SET room_id = $1, locker_id = NULL, rental_type = $2, updated_at = NOW()
           WHERE id = $3`,
            [newRoomId, waitlist.desired_tier, block.id]
          );

          // 8. Mark waitlist as COMPLETED
          await client.query(
            `UPDATE waitlist 
           SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
            [waitlistId]
          );

          // 8b. Record upgrade charge tied to this payment intent (idempotent on payment_intent_id)
          if (upgradeAmount !== undefined) {
            const existingCharge = await client.query<{ id: string }>(
              `SELECT id FROM charges WHERE payment_intent_id = $1 LIMIT 1`,
              [paymentIntentId]
            );
            if (existingCharge.rows.length === 0) {
              await client.query(
                `INSERT INTO charges (visit_id, checkin_block_id, type, amount, payment_intent_id)
               VALUES ($1, $2, $3, $4, $5)`,
                [waitlist.visit_id, block.id, 'UPGRADE_FEE', upgradeAmount, paymentIntentId]
              );
            }
          }

          // 9. Log upgrade completed
          await insertAuditLog(client, {
            staffId: staff.staffId,
            action: 'UPGRADE_COMPLETED',
            entityType: 'waitlist',
            entityId: waitlistId,
            oldValue: {
              oldResourceId,
              oldResourceType,
              oldRentalType: block.rental_type,
            },
            newValue: {
              newRoomId,
              newRoomNumber: newRoom.number,
              newRentalType: waitlist.desired_tier,
              paymentIntentId,
              blockEndsAt: block.ends_at.toISOString(), // Upgrade does NOT extend stay
            },
          });

          const customerIdRow = await client.query<{ customer_id: string }>(
            `SELECT customer_id FROM visits WHERE id = $1 LIMIT 1`,
            [waitlist.visit_id]
          );

          const customerId = customerIdRow.rows[0]!.customer_id;

          const event = await insertCustomerActivityEvent(client, {
            customerId,
            actionType: 'UPGRADE_COMPLETED',
            actionCategory: 'UPGRADE',
            sourceApp: 'EMPLOYEE_REGISTER',
            actorType: 'STAFF',
            actorStaffId: staff.staffId,
            actorStaffName: staff.name,
            summary: `Upgrade completed: Room ${newRoom.number}`,
            metadata: {
              visitId: waitlist.visit_id,
              waitlistId,
              paymentIntentId,
              newRoomId,
              newRoomNumber: newRoom.number,
            },
            dedupeKey: `ACT:UPGRADE_COMPLETED:${waitlistId}`,
            searchParts: [waitlistId, paymentIntentId, newRoom.number],
          });

          request.log.info(
            {
              customerActivityEventId: event.id,
              customerId,
              actionType: 'UPGRADE_COMPLETED',
              actionCategory: 'UPGRADE',
              sourceApp: 'EMPLOYEE_REGISTER',
              actorType: 'STAFF',
              actorStaffId: staff.staffId,
            },
            'customer_activity_event'
          );

          return {
            waitlistId,
            success: true,
            oldResourceId,
            oldResourceType,
            newRoomId,
            newRoomNumber: newRoom.number,
            newRentalType: waitlist.desired_tier,
            blockEndsAt: block.ends_at, // Checkout time unchanged
            customerId,
            visitId: waitlist.visit_id,
          };
        });

        // Broadcast AFTER commit so refetch-on-event sees updated DB rows immediately.
        if (fastify.broadcaster) {
          await broadcastInventoryUpdate(fastify.broadcaster);
          fastify.broadcaster.broadcast({
            type: 'WAITLIST_UPDATED',
            payload: {
              waitlistId: result.waitlistId,
              status: 'COMPLETED',
            },
            timestamp: new Date().toISOString(),
          });
        }

        return reply.send(result);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({
            error: err.message || 'Failed to complete upgrade',
          });
        }
        fastify.log.error(error, 'Failed to complete upgrade');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
