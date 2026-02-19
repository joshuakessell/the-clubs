import type { FastifyInstance } from 'fastify';
import { getRoomTierFromNumber } from '@the-clubs/shared';
import { requireAuth } from '../../auth/middleware';
import { insertAuditLog } from '../../audit/auditLog';
import { serializableTransaction } from '../../db';
import { broadcastInventoryUpdate } from '../../inventory/broadcast';
import { getUpgradeFee, type RentalType } from '../../pricing/engine';
import { transaction } from '../../db';
import { insertCustomerActivityEvent } from '../../activity/customerActivityLog';

type RentalTier = 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL';
type SwitchPaymentOutcome = 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE';
type PreviousRoomStatus = 'CLEAN' | 'CLEANING' | 'DIRTY';

function normalizeRentalTier(value: string | null | undefined): RentalTier {
  if (value === 'STANDARD' || value === 'DOUBLE' || value === 'SPECIAL') {
    return value;
  }
  return 'LOCKER';
}

function computeAdditionalFee(from: RentalTier, to: RentalTier): number {
  if (from === to) return 0;
  const fee = getUpgradeFee(from as RentalType, to as RentalType);
  return typeof fee === 'number' && Number.isFinite(fee) && fee > 0 ? fee : 0;
}

function getTierFromRoomNumber(roomNumber: string): RentalTier {
  const parsed = Number.parseInt(roomNumber, 10);
  if (!Number.isFinite(parsed)) return 'STANDARD';
  return getRoomTierFromNumber(parsed);
}

type SwitchHttpError = {
  statusCode: number;
  message: string;
  code?: string;
  additionalFee?: number;
  currentRentalType?: RentalTier;
  targetRentalType?: RentalTier;
  // Optional context for secondary effects outside the aborted transaction.
  visitId?: string;
  checkinBlockId?: string;
  targetResourceType?: 'room' | 'locker';
  targetResourceId?: string;
  targetResourceNumber?: string;
};

export function registerCheckinSwitchResourceRoutes(fastify: FastifyInstance): void {
  fastify.post<{
    Params: { visitId: string };
    Body: {
      targetResourceType: 'room' | 'locker';
      targetResourceId: string;
      previousRoomStatus?: PreviousRoomStatus;
      paymentOutcome?: SwitchPaymentOutcome;
      declineReason?: string;
    };
  }>(
    '/v1/checkin/visits/:visitId/switch-resource',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      const { visitId } = request.params;
      const {
        targetResourceType,
        targetResourceId,
        previousRoomStatus = 'DIRTY',
        paymentOutcome,
        declineReason,
      } = request.body;

      if (!targetResourceId) {
        return reply.status(400).send({ error: 'targetResourceId is required' });
      }

      if (targetResourceType !== 'room' && targetResourceType !== 'locker') {
        return reply.status(400).send({ error: 'targetResourceType must be room or locker' });
      }

      if (
        previousRoomStatus !== 'CLEAN' &&
        previousRoomStatus !== 'CLEANING' &&
        previousRoomStatus !== 'DIRTY'
      ) {
        return reply.status(400).send({ error: 'previousRoomStatus is invalid' });
      }

      if (
        paymentOutcome &&
        paymentOutcome !== 'CASH_SUCCESS' &&
        paymentOutcome !== 'CREDIT_SUCCESS' &&
        paymentOutcome !== 'CREDIT_DECLINE'
      ) {
        return reply.status(400).send({ error: 'paymentOutcome is invalid' });
      }

      try {
        const result = await serializableTransaction(async (client) => {
          const visitResult = await client.query<{
            id: string;
            customer_id: string;
            ended_at: Date | null;
          }>(
            `SELECT id, customer_id, ended_at
             FROM visits
             WHERE id = $1
             FOR UPDATE`,
            [visitId]
          );

          if (visitResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Visit not found' } satisfies SwitchHttpError;
          }

          const visit = visitResult.rows[0]!;

          if (visit.ended_at) {
            throw {
              statusCode: 409,
              message: 'Visit is already completed',
            } satisfies SwitchHttpError;
          }

          const blockResult = await client.query<{
            id: string;
            room_id: string | null;
            locker_id: string | null;
            rental_type: string;
          }>(
            `SELECT id, room_id, locker_id, rental_type::text
             FROM checkin_blocks
             WHERE visit_id = $1
             ORDER BY ends_at DESC
             LIMIT 1
             FOR UPDATE`,
            [visitId]
          );

          if (blockResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active check-in block found' } satisfies SwitchHttpError;
          }

          const block = blockResult.rows[0]!;
          const currentResourceType: 'room' | 'locker' | null = block.room_id
            ? 'room'
            : block.locker_id
              ? 'locker'
              : null;
          const currentResourceId = block.room_id || block.locker_id;

          if (!currentResourceType || !currentResourceId) {
            throw {
              statusCode: 400,
              message: 'Current visit has no assigned room/locker',
            } satisfies SwitchHttpError;
          }

          if (
            currentResourceType === targetResourceType &&
            String(currentResourceId) === String(targetResourceId)
          ) {
            throw {
              statusCode: 400,
              message: 'Selected resource is already assigned',
            } satisfies SwitchHttpError;
          }

          let currentResourceNumber = '';
          if (currentResourceType === 'room') {
            const currentRoomResult = await client.query<{
              id: string;
              number: string;
            }>(`SELECT id, number FROM rooms WHERE id = $1 FOR UPDATE`, [currentResourceId]);
            if (currentRoomResult.rows.length === 0) {
              throw {
                statusCode: 404,
                message: 'Current room not found',
              } satisfies SwitchHttpError;
            }
            currentResourceNumber = currentRoomResult.rows[0]!.number;
          } else {
            const currentLockerResult = await client.query<{
              id: string;
              number: string;
            }>(`SELECT id, number FROM lockers WHERE id = $1 FOR UPDATE`, [currentResourceId]);
            if (currentLockerResult.rows.length === 0) {
              throw {
                statusCode: 404,
                message: 'Current locker not found',
              } satisfies SwitchHttpError;
            }
            currentResourceNumber = currentLockerResult.rows[0]!.number;
          }

          let targetResourceNumber = '';
          let targetRentalType: RentalTier;

          if (targetResourceType === 'room') {
            const targetRoomResult = await client.query<{
              id: string;
              number: string;
              status: string;
              assigned_to_customer_id: string | null;
            }>(
              `SELECT id, number, status, assigned_to_customer_id
               FROM rooms
               WHERE id = $1
               FOR UPDATE`,
              [targetResourceId]
            );

            if (targetRoomResult.rows.length === 0) {
              throw { statusCode: 404, message: 'Target room not found' } satisfies SwitchHttpError;
            }

            const targetRoom = targetRoomResult.rows[0]!;
            if (targetRoom.status !== 'CLEAN' || targetRoom.assigned_to_customer_id) {
              throw {
                statusCode: 409,
                message: `Room ${targetRoom.number} is not available`,
              } satisfies SwitchHttpError;
            }

            targetResourceNumber = targetRoom.number;
            targetRentalType = getTierFromRoomNumber(targetRoom.number);
          } else {
            const targetLockerResult = await client.query<{
              id: string;
              number: string;
              status: string;
              assigned_to_customer_id: string | null;
            }>(
              `SELECT id, number, status, assigned_to_customer_id
               FROM lockers
               WHERE id = $1
               FOR UPDATE`,
              [targetResourceId]
            );

            if (targetLockerResult.rows.length === 0) {
              throw { statusCode: 404, message: 'Target locker not found' } satisfies SwitchHttpError;
            }

            const targetLocker = targetLockerResult.rows[0]!;
            if (targetLocker.status !== 'CLEAN' || targetLocker.assigned_to_customer_id) {
              throw {
                statusCode: 409,
                message: `Locker ${targetLocker.number} is not available`,
              } satisfies SwitchHttpError;
            }

            targetResourceNumber = targetLocker.number;
            targetRentalType = 'LOCKER';
          }

          const currentRentalType = normalizeRentalTier(block.rental_type);
          const additionalFee = computeAdditionalFee(currentRentalType, targetRentalType);

          let paymentIntentId: string | null = null;

          if (additionalFee > 0) {
            if (!paymentOutcome) {
              throw {
                statusCode: 409,
                code: 'PAYMENT_REQUIRED',
                message: 'Additional payment required for this switch',
                additionalFee,
                currentRentalType,
                targetRentalType,
              } satisfies SwitchHttpError;
            }

            if (paymentOutcome === 'CREDIT_DECLINE') {
              throw {
                statusCode: 402,
                code: 'PAYMENT_DECLINED',
                message: declineReason ?? 'Credit declined',
                additionalFee,
                currentRentalType,
                targetRentalType,
                // Pass through context so we can persist a cancelled intent outside this transaction.
                // (The serializableTransaction will roll back all writes when we throw.)
                visitId,
                checkinBlockId: block.id,
                targetResourceType,
                targetResourceId,
                targetResourceNumber,
              } satisfies SwitchHttpError;
            }

            const paymentResult = await client.query<{ id: string }>(
              `INSERT INTO payment_intents (amount, status, quote_json, paid_at)
               VALUES ($1, 'PAID', $2, NOW())
               RETURNING id`,
              [
                additionalFee,
                JSON.stringify({
                  type: 'SWITCH_UPCHARGE',
                  method: paymentOutcome,
                  visitId,
                  checkinBlockId: block.id,
                  currentRentalType,
                  targetRentalType,
                  targetResourceType,
                  targetResourceId,
                  targetResourceNumber,
                }),
              ]
            );

            paymentIntentId = paymentResult.rows[0]!.id;

            await client.query(
              `INSERT INTO charges (visit_id, checkin_block_id, type, amount, payment_intent_id)
               VALUES ($1, $2, 'UPGRADE_FEE', $3, $4)`,
              [visitId, block.id, additionalFee, paymentIntentId]
            );
          }

          if (currentResourceType === 'room') {
            await client.query(
              `UPDATE rooms
               SET assigned_to_customer_id = NULL,
                   status = $1,
                   last_status_change = NOW(),
                   updated_at = NOW()
               WHERE id = $2`,
              [previousRoomStatus, currentResourceId]
            );
          } else {
            await client.query(
              `UPDATE lockers
               SET assigned_to_customer_id = NULL,
                   status = 'CLEAN',
                   updated_at = NOW()
               WHERE id = $1`,
              [currentResourceId]
            );
          }

          if (targetResourceType === 'room') {
            await client.query(
              `UPDATE rooms
               SET assigned_to_customer_id = $1,
                   status = 'OCCUPIED',
                   last_status_change = NOW(),
                   updated_at = NOW()
               WHERE id = $2`,
              [visit.customer_id, targetResourceId]
            );
          } else {
            await client.query(
              `UPDATE lockers
               SET assigned_to_customer_id = $1,
                   status = 'OCCUPIED',
                   updated_at = NOW()
               WHERE id = $2`,
              [visit.customer_id, targetResourceId]
            );
          }

          await client.query(
            `UPDATE checkin_blocks
             SET room_id = $1,
                 locker_id = $2,
                 rental_type = $3::public.rental_type,
                 updated_at = NOW()
             WHERE id = $4`,
            [
              targetResourceType === 'room' ? targetResourceId : null,
              targetResourceType === 'locker' ? targetResourceId : null,
              targetRentalType,
              block.id,
            ]
          );

          await insertAuditLog(client, {
            staffId,
            action: 'UPDATE',
            entityType: targetResourceType,
            entityId: targetResourceId,
            oldValue: {
              visitId,
              checkinBlockId: block.id,
              resourceType: currentResourceType,
              resourceId: currentResourceId,
              resourceNumber: currentResourceNumber,
              rentalType: currentRentalType,
              previousRoomStatus: currentResourceType === 'room' ? previousRoomStatus : null,
            },
            newValue: {
              resourceType: targetResourceType,
              resourceId: targetResourceId,
              resourceNumber: targetResourceNumber,
              rentalType: targetRentalType,
              additionalFee,
              paymentIntentId,
            },
          });

          return {
            visitId,
            checkinBlockId: block.id,
            previousResourceType: currentResourceType,
            previousResourceId: currentResourceId,
            previousResourceNumber: currentResourceNumber,
            previousRentalType: currentRentalType,
            newResourceType: targetResourceType,
            newResourceId: targetResourceId,
            newResourceNumber: targetResourceNumber,
            newRentalType: targetRentalType,
            additionalFee,
            paymentIntentId,
          };
        });

        if (fastify.broadcaster) {
          await broadcastInventoryUpdate(fastify.broadcaster);
        }

        // Customer activity log
        await transaction(async (client) => {
          // Derive customerId from visit
          const visitRow = await client.query<{ customer_id: string }>(
            `SELECT customer_id FROM visits WHERE id = $1 LIMIT 1`,
            [result.visitId]
          );
          const customerId = visitRow.rows[0]?.customer_id;
          if (!customerId) return;

          const actionType = result.newResourceType === 'room' ? 'ROOM_CHANGED' : 'LOCKER_CHANGED';

          const event = await insertCustomerActivityEvent(client, {
            customerId,
            actionType,
            actionCategory: 'RESOURCE_CHANGE',
            sourceApp: 'EMPLOYEE_REGISTER',
            actorType: 'STAFF',
            actorStaffId: staffId,
            actorStaffName: request.staff!.name,
            summary:
              result.newResourceType === 'room'
                ? `Room changed: ${result.previousResourceNumber ?? '—'} → ${result.newResourceNumber}`
                : `Locker changed: ${result.previousResourceNumber ?? '—'} → ${result.newResourceNumber}`,
            metadata: {
              visitId: result.visitId,
              checkinBlockId: result.checkinBlockId,
              fromResourceType: result.previousResourceType,
              fromResourceId: result.previousResourceId,
              fromResourceNumber: result.previousResourceNumber,
              toResourceType: result.newResourceType,
              toResourceId: result.newResourceId,
              toResourceNumber: result.newResourceNumber,
              additionalFee: result.additionalFee,
              paymentIntentId: result.paymentIntentId,
            },
            dedupeKey: `ACT:${actionType}:${result.checkinBlockId}:${result.newResourceId}`,
            searchParts: [result.newResourceNumber, result.previousResourceNumber ?? ''],
          });

          request.log.info(
            {
              customerActivityEventId: event.id,
              customerId,
              actionType,
              actionCategory: 'RESOURCE_CHANGE',
              sourceApp: 'EMPLOYEE_REGISTER',
              actorType: 'STAFF',
              actorStaffId: staffId,
            },
            'customer_activity_event'
          );
        });

        return reply.send({ success: true, ...result });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as SwitchHttpError;

          // If a card was declined, record a cancelled payment_intent for auditability.
          // This must happen outside the aborted serializable transaction.
          if (err.code === 'PAYMENT_DECLINED' && 'checkinBlockId' in err && 'visitId' in err) {
            const checkinBlockId = (err as unknown as { checkinBlockId?: string }).checkinBlockId;
            const declinedVisitId = (err as unknown as { visitId?: string }).visitId;
            if (checkinBlockId && declinedVisitId) {
              try {
                await transaction(async (client) => {
                  await client.query(
                    `INSERT INTO payment_intents (amount, status, quote_json)
                     VALUES ($1, 'CANCELLED', $2)`,
                    [
                      err.additionalFee ?? 0,
                      JSON.stringify({
                        type: 'SWITCH_UPCHARGE',
                        visitId: declinedVisitId,
                        checkinBlockId,
                        currentRentalType: err.currentRentalType,
                        targetRentalType: err.targetRentalType,
                        targetResourceType: (err as unknown as { targetResourceType?: string })
                          .targetResourceType,
                        targetResourceId: (err as unknown as { targetResourceId?: string })
                          .targetResourceId,
                        targetResourceNumber: (err as unknown as { targetResourceNumber?: string })
                          .targetResourceNumber,
                        declineReason: err.message,
                      }),
                    ]
                  );
                });
              } catch (persistError) {
                request.log.warn(persistError, 'Failed to persist cancelled switch payment_intent');
              }
            }
          }

          return reply.status(err.statusCode).send({
            error: err.message,
            code: err.code,
            additionalFee: err.additionalFee,
            currentRentalType: err.currentRentalType,
            targetRentalType: err.targetRentalType,
          });
        }
        request.log.error(error, 'Failed to switch assigned resource');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
