import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import { requireAuth, optionalAuth } from '../../auth/middleware';
import {
  getIdScanIssue,
  getIdScanIssueMessage,
  parseMembershipNumber,
} from '../../checkin/identity';
import { buildFullSessionUpdatedPayload, getAllowedRentals } from '../../checkin/payload';
import { StartLaneSessionBodySchema } from '../../checkin/schemas';
import type { CustomerRow, LaneSessionRow } from '../../checkin/types';
import { toDate } from '../../checkin/utils';
import { transaction } from '../../db';
import { insertCustomerActivityEvent } from '../../activity/customerActivityLog';
import { insertClubEvent } from '../../activity/clubEventLog';

export function registerCheckinLaneSessionRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/lane/:laneId/start
   *
   * Start a lane session with customer identification.
   * Input: { idScanValue, membershipScanValue? }
   * Output: laneSession + customer display fields
   */
  fastify.post<{
    Params: { laneId: string };
    Body: {
      customerId?: string;
      idScanValue?: string;
      membershipScanValue?: string;
      visitId?: string;
      renewalHours?: 2 | 6;
    };
  }>(
    '/v1/checkin/lane/:laneId/start',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      const { laneId } = request.params;
      let body: z.infer<typeof StartLaneSessionBodySchema>;
      try {
        body = StartLaneSessionBodySchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const {
        customerId: requestedCustomerId,
        idScanValue,
        membershipScanValue,
        visitId,
        renewalHours,
      } = body;

      try {
        const result = await transaction(async (client) => {
          // Parse membership number if provided
          let membershipNumber = membershipScanValue
            ? parseMembershipNumber(membershipScanValue)
            : null;

          // Look up or create customer (customers is canonical identity)
          let customerId: string | null = null;
          let customerName = 'Customer';
          let customerHasEncryptedLookupMarker = false;
          let idScanIssue: 'ID_EXPIRED' | 'UNDERAGE' | undefined;

          if (requestedCustomerId) {
            const customerResult = await client.query<CustomerRow>(
              `SELECT id, name, dob, id_expiration_date, membership_number, membership_card_type, membership_valid_until, banned_until, id_scan_hash
             FROM customers
             WHERE id = $1
             LIMIT 1`,
              [requestedCustomerId]
            );
            if (customerResult.rows.length === 0) {
              throw { statusCode: 404, message: 'Customer not found' };
            }
            const customer = customerResult.rows[0]!;
            customerId = customer.id;
            customerName = customer.name;
            membershipNumber = customer.membership_number || null;
            customerHasEncryptedLookupMarker = Boolean(customer.id_scan_hash);
            idScanIssue = getIdScanIssue({
              dob: customer.dob,
              idExpirationDate: customer.id_expiration_date ?? null,
            });

            const bannedUntil = toDate(customer.banned_until);
            if (bannedUntil && new Date() < bannedUntil) {
              throw {
                statusCode: 403,
                message: 'Customer is banned until ' + bannedUntil.toISOString(),
              };
            }
          } else {
            // Try to find existing customer by membership number
            if (membershipNumber) {
              const customerResult = await client.query<CustomerRow>(
                `SELECT id, name, dob, id_expiration_date, membership_number, membership_card_type, membership_valid_until, banned_until, id_scan_hash
               FROM customers
               WHERE membership_number = $1
               LIMIT 1`,
                [membershipNumber]
              );

              if (customerResult.rows.length > 0) {
                const customer = customerResult.rows[0]!;
                customerId = customer.id;
                customerName = customer.name;
                customerHasEncryptedLookupMarker = Boolean(customer.id_scan_hash);
                idScanIssue = getIdScanIssue({
                  dob: customer.dob,
                  idExpirationDate: customer.id_expiration_date ?? null,
                });

                // Check if banned
                const bannedUntil = toDate(customer.banned_until);
                if (bannedUntil && new Date() < bannedUntil) {
                  throw {
                    statusCode: 403,
                    message: 'Customer is banned until ' + bannedUntil.toISOString(),
                  };
                }
              }
            }

            // If we couldn't resolve an existing customer, create one for the session.
            // Demo behavior: use a placeholder name derived from the scanned ID value.
            if (!customerId) {
              const newCustomer = await client.query<{ id: string }>(
                `INSERT INTO customers (name, created_at, updated_at)
               VALUES ($1, NOW(), NOW())
               RETURNING id`,
                [idScanValue || 'Customer']
              );
              customerId = newCustomer.rows[0]!.id;
              customerName = idScanValue || 'Customer';
            }
          }

          // Determine mode (explicit renewal only). If an active visit exists and no explicit visitId
          // is provided, treat as "already checked in" (lookup-only) and block a new check-in flow.
          let computedMode: 'CHECKIN' | 'RENEWAL' = 'CHECKIN';
          let visitIdForSession: string | null = null;
          let blockEndsAtDate: Date | null = null;
          let currentTotalHours = 0;
          let renewalHoursForSession: number | null = null;
          let activeAssignedResourceType: 'room' | 'locker' | null = null;
          let activeAssignedResourceNumber: string | null = null;
          let activeRentalType: string | null = null;

          const resolveVisitBlocks = async (activeVisitId: string) => {
            const blocksResult = await client.query<{
              ends_at: Date;
              starts_at: Date;
            }>(
              `SELECT starts_at, ends_at FROM checkin_blocks 
             WHERE visit_id = $1 ORDER BY ends_at DESC`,
              [activeVisitId]
            );
            if (blocksResult.rows.length > 0) {
              blockEndsAtDate = blocksResult.rows[0]!.ends_at;
              for (const block of blocksResult.rows) {
                const hours =
                  (block.ends_at.getTime() - block.starts_at.getTime()) / (1000 * 60 * 60);
                currentTotalHours += hours;
              }
            }
          };

          const resolveActiveAssignment = async (activeVisitId: string) => {
            const activeBlock = await client.query<{
              rental_type: string;
              room_id: string | null;
              locker_id: string | null;
              room_number: string | null;
              locker_number: string | null;
            }>(
              `SELECT cb.rental_type, cb.room_id, cb.locker_id, r.number as room_number, l.number as locker_number
               FROM checkin_blocks cb
               LEFT JOIN rooms r ON cb.room_id = r.id
               LEFT JOIN lockers l ON cb.locker_id = l.id
               WHERE cb.visit_id = $1
               ORDER BY cb.ends_at DESC
               LIMIT 1`,
              [activeVisitId]
            );
            const row = activeBlock.rows[0];
            if (!row) return;
            activeRentalType = row.rental_type;
            if (row.room_id && row.room_number) {
              activeAssignedResourceType = 'room';
              activeAssignedResourceNumber = row.room_number;
            } else if (row.locker_id && row.locker_number) {
              activeAssignedResourceType = 'locker';
              activeAssignedResourceNumber = row.locker_number;
            }
          };

          if (renewalHours && !visitId) {
            throw { statusCode: 400, message: 'renewalHours requires an explicit visitId' };
          }

          if (visitId) {
            // Explicit visit selection forces renewal
            const visitResult = await client.query<{
              id: string;
              customer_id: string;
              started_at: Date;
              ended_at: Date | null;
            }>(`SELECT id, customer_id, started_at, ended_at FROM visits WHERE id = $1`, [visitId]);
            if (visitResult.rows.length === 0) {
              throw { statusCode: 404, message: 'Visit not found' };
            }
            const visit = visitResult.rows[0]!;
            if (customerId && visit.customer_id !== customerId) {
              throw { statusCode: 403, message: 'Visit does not belong to this customer' };
            }
            visitIdForSession = visit.id;
            computedMode = 'RENEWAL';
            await resolveVisitBlocks(visit.id);
            await resolveActiveAssignment(visit.id);

            const requestedRenewalHours = renewalHours ?? 6;
            if (!blockEndsAtDate) {
              throw { statusCode: 400, message: 'Cannot determine checkout time for renewal' };
            }
            const now = new Date();
            const diffMs = Math.abs((blockEndsAtDate as Date).getTime() - now.getTime());
            if (diffMs > 60 * 60 * 1000) {
              throw {
                statusCode: 400,
                message: 'Renewal is only available within 1 hour of checkout',
              };
            }
            if (currentTotalHours + requestedRenewalHours > 14) {
              throw {
                statusCode: 400,
                message: `Renewal would exceed 14-hour maximum. Current total: ${currentTotalHours} hours, renewal would add ${requestedRenewalHours} hours.`,
              };
            }
            renewalHoursForSession = requestedRenewalHours;
          } else if (customerId) {
            const activeVisit = await client.query<{ id: string }>(
              `SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
              [customerId]
            );
            if (activeVisit.rows.length > 0) {
              const activeVisitId = activeVisit.rows[0]!.id;

              await resolveVisitBlocks(activeVisitId);

              const activeBlock = await client.query<{
                starts_at: Date;
                ends_at: Date;
                rental_type: string;
                room_number: string | null;
                locker_number: string | null;
              }>(
                `SELECT cb.starts_at, cb.ends_at, cb.rental_type, r.number as room_number, l.number as locker_number
                 FROM checkin_blocks cb
                 LEFT JOIN rooms r ON cb.room_id = r.id
                 LEFT JOIN lockers l ON cb.locker_id = l.id
                 WHERE cb.visit_id = $1
                 ORDER BY cb.ends_at DESC
                 LIMIT 1`,
                [activeVisitId]
              );

              const block = activeBlock.rows[0];
              const assignedResourceType: 'room' | 'locker' | null = block?.room_number
                ? 'room'
                : block?.locker_number
                  ? 'locker'
                  : null;
              const assignedResourceNumber: string | null =
                block?.room_number ?? block?.locker_number ?? null;

              const waitlistResult = await client.query<{
                id: string;
                desired_tier: string;
                backup_tier: string;
                status: string;
              }>(
                `SELECT id, desired_tier, backup_tier, status
                 FROM waitlist
                 WHERE visit_id = $1 AND status IN ('ACTIVE', 'OFFERED')
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [activeVisitId]
              );
              const wl = waitlistResult.rows[0];

              throw {
                statusCode: 409,
                code: 'ALREADY_CHECKED_IN',
                message: 'Customer is currently checked in',
                activeCheckin: {
                  visitId: activeVisitId,
                  rentalType: block?.rental_type ?? null,
                  assignedResourceType,
                  assignedResourceNumber,
                  checkinAt: block?.starts_at ? block.starts_at.toISOString() : null,
                  checkoutAt: block?.ends_at ? block.ends_at.toISOString() : null,
                  overdue: block?.ends_at ? block.ends_at.getTime() < Date.now() : null,
                  currentTotalHours,
                  waitlist: wl
                    ? {
                      id: wl.id,
                      desiredTier: wl.desired_tier,
                      backupTier: wl.backup_tier,
                      status: wl.status,
                    }
                    : null,
                },
              };
            }
          }

          // Create or update lane session
          const existingSession = await client.query<LaneSessionRow>(
            `SELECT id, status FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('IDLE', 'ACTIVE', 'AWAITING_CUSTOMER')
           ORDER BY created_at DESC
           LIMIT 1`,
            [laneId]
          );

          let session: LaneSessionRow;

          if (computedMode === 'RENEWAL' && !activeRentalType) {
            throw { statusCode: 400, message: 'Unable to determine rental type for renewal' };
          }

          const desiredRentalTypeForSession =
            computedMode === 'RENEWAL' && activeRentalType ? activeRentalType : null;
          // For RENEWAL we do NOT set assigned_resource_* on the lane session.
          // The customer is already occupying a room/locker; persisting assignment here causes the
          // customer-kiosk state machine to jump straight to the "complete" screen and skip payment.
          const assignedResourceIdForSession = null;
          const assignedResourceTypeForSession = null;
          const selectionConfirmedForSession = computedMode === 'RENEWAL';
          const selectionConfirmedByForSession =
            computedMode === 'RENEWAL' ? 'EMPLOYEE' : null;
          const selectionLockedAtForSession = computedMode === 'RENEWAL' ? new Date() : null;
          const membershipChoiceForSession = null;
          // Initialize flow_step so the kiosk knows which screen to show.
          // CHECKIN starts at RENTAL (language is toggled inline); RENEWAL skips to PAYMENT.
          const flowStepForSession = computedMode === 'RENEWAL' ? 'PAYMENT' : 'RENTAL';

          if (existingSession.rows.length > 0 && existingSession.rows[0]!.status !== 'COMPLETED') {
            // Update existing session
            const updateResult = await client.query<LaneSessionRow>(
              `UPDATE lane_sessions
             SET customer_display_name = $1,
                 membership_number = $2,
                 customer_id = $3,
                 status = 'ACTIVE',
                 staff_id = $4,
                 checkin_mode = $5,
                 renewal_hours = $6,
                 desired_rental_type = $8,
                 waitlist_desired_type = NULL,
                 waitlist_desired_types_json = NULL,
                 backup_rental_type = NULL,
                 waitlist_requested_resource_number = NULL,
                 waitlist_requested_resource_type = NULL,
                 assigned_resource_id = $9,
                 assigned_resource_type = $10,
                 membership_choice = $11,
                 membership_purchase_intent = NULL,
                 membership_purchase_requested_at = NULL,
                 payment_intent_id = NULL,
                 price_quote_json = NULL,
                 disclaimers_ack_json = NULL,
                 kiosk_acknowledged_at = NULL,
                 proposed_rental_type = NULL,
                 proposed_by = NULL,
                 selection_confirmed = $12,
                 selection_confirmed_by = $13,
                 selection_locked_at = $14,
                 flow_step = $15,
                 flow_version = 0,
                 updated_at = NOW()
             WHERE id = $7
             RETURNING *`,
              [
                customerName,
                membershipNumber,
                customerId,
                staffId,
                computedMode,
                renewalHoursForSession,
                existingSession.rows[0]!.id,
                desiredRentalTypeForSession,
                assignedResourceIdForSession,
                assignedResourceTypeForSession,
                membershipChoiceForSession,
                selectionConfirmedForSession,
                selectionConfirmedByForSession,
                selectionLockedAtForSession,
                flowStepForSession,
              ]
            );
            session = updateResult.rows[0]!;
          } else {
            // Create new session
            const newSessionResult = await client.query<LaneSessionRow>(
              `INSERT INTO lane_sessions 
             (lane_id, status, staff_id, customer_id, customer_display_name, membership_number, checkin_mode, renewal_hours, desired_rental_type, assigned_resource_id, assigned_resource_type, membership_choice, selection_confirmed, selection_confirmed_by, selection_locked_at, flow_step, flow_version)
             VALUES ($1, 'ACTIVE', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 0)
             RETURNING *`,
              [
                laneId,
                staffId,
                customerId,
                customerName,
                membershipNumber,
                computedMode,
                renewalHoursForSession,
                desiredRentalTypeForSession,
                assignedResourceIdForSession,
                assignedResourceTypeForSession,
                membershipChoiceForSession,
                selectionConfirmedForSession,
                selectionConfirmedByForSession,
                selectionLockedAtForSession,
                flowStepForSession,
              ]
            );
            session = newSessionResult.rows[0]!;
          }

          // Determine allowed rentals
          const allowedRentals = getAllowedRentals(membershipNumber);

          // Get customer past-due balance if customer exists
          let pastDueBalance = 0;
          let pastDueBlocked = false;
          if (session.customer_id) {
            const customerInfo = await client.query<CustomerRow>(
              `SELECT past_due_balance FROM customers WHERE id = $1`,
              [session.customer_id]
            );
            if (customerInfo.rows.length > 0) {
              pastDueBalance = parseFloat(String(customerInfo.rows[0]!.past_due_balance || 0));
              pastDueBlocked = pastDueBalance > 0 && !(session.past_due_bypassed || false);
            }
          }

          return {
            sessionId: session.id,
            customerId,
            customerName: session.customer_display_name,
            membershipNumber: session.membership_number,
            allowedRentals,
            mode: computedMode,
            blockEndsAt: toDate(blockEndsAtDate)?.toISOString(),
            visitId: visitIdForSession || undefined,
            currentTotalHours: computedMode === 'RENEWAL' ? currentTotalHours : undefined,
            renewalHours: renewalHoursForSession ?? undefined,
            pastDueBalance,
            pastDueBlocked,
            activeAssignedResourceType: activeAssignedResourceType || undefined,
            activeAssignedResourceNumber: activeAssignedResourceNumber || undefined,
            activeRentalType: activeRentalType || undefined,
            customerHasEncryptedLookupMarker,
            idScanIssue,
          };
        });

        if (result.sessionId && result.customerId) {
          // Best-effort customer activity log (non-blocking; but within success path).
          await transaction(async (client) => {
            const event = await insertCustomerActivityEvent(client, {
              customerId: result.customerId,
              actionType: 'CHECKIN_STARTED',
              actionCategory: 'CHECKIN',
              sourceApp: 'EMPLOYEE_REGISTER',
              actorType: 'STAFF',
              actorStaffId: staffId,
              actorStaffName: request.staff!.name,
              summary: 'Check-in started',
              metadata: {
                laneId,
                laneSessionId: result.sessionId,
                mode: result.mode,
                visitId: result.visitId ?? null,
              },
              dedupeKey: `ACT:CHECKIN_STARTED:${result.sessionId}`,
              searchParts: [result.sessionId, result.visitId ?? ''],
            });

            request.log.info(
              {
                customerActivityEventId: event.id,
                customerId: result.customerId,
                actionType: 'CHECKIN_STARTED',
                actionCategory: 'CHECKIN',
                sourceApp: 'EMPLOYEE_REGISTER',
                actorType: 'STAFF',
                actorStaffId: staffId,
              },
              'customer_activity_event'
            );

            // Emit unified club event for analytics
            await insertClubEvent(client, {
              eventType: 'CHECKIN_STARTED',
              eventDomain: 'CHECKIN',
              sourceApp: 'EMPLOYEE_REGISTER',
              staffId,
              staffName: request.staff!.name,
              customerId: result.customerId,
              customerName: result.customerName,
              visitId: result.visitId ?? null,
              summary: `Check-in started for ${result.customerName}`,
              metadata: {
                laneId,
                laneSessionId: result.sessionId,
                mode: result.mode,
                visitId: result.visitId ?? null,
              },
              dedupeKey: `CLUB:CHECKIN_STARTED:${result.sessionId}`,
            });
          });
        }

        // Broadcast full session update (stable payload)
        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        if (result.idScanIssue) {
          return reply.status(403).send({
            error: getIdScanIssueMessage(result.idScanIssue),
            code: result.idScanIssue,
          });
        }

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to start lane session');
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const statusCode = (error as { statusCode: number }).statusCode;
          const message = (error as { message?: string }).message;
          const code = (error as { code?: unknown }).code;
          const activeCheckin = (error as { activeCheckin?: unknown }).activeCheckin;
          if (statusCode === 409 && code === 'ALREADY_CHECKED_IN') {
            return reply.status(200).send({
              code: 'ALREADY_CHECKED_IN',
              alreadyCheckedIn: true,
              activeCheckin:
                activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
            });
          }
          return reply.status(statusCode).send({
            error: message ?? 'Failed to start session',
            code: typeof code === 'string' ? code : undefined,
            activeCheckin:
              activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to start lane session',
        });
      }
    }
  );

  /**
   * GET /v1/checkin/lane/:laneId/session-snapshot
   *
   * Lightweight polling fallback for kiosks when WS is unavailable.
   * Returns the latest active-ish lane session payload (same as SESSION_UPDATED) or null.
   */
  fastify.get<{ Params: { laneId: string } }>(
    '/v1/checkin/lane/:laneId/session-snapshot',
    { preHandler: [optionalAuth, requireKioskTokenOrStaff] },
    async (request, reply) => {
      const { laneId } = request.params;

      const result = await transaction(async (client) => {
        const row = (
          await client.query<{ id: string }>(
            `SELECT id
             FROM lane_sessions
             WHERE lane_id = $1
               AND status IN (
                 'ACTIVE',
                 'AWAITING_CUSTOMER',
                 'AWAITING_ASSIGNMENT',
                 'AWAITING_PAYMENT',
                 'AWAITING_SIGNATURE'
               )
             ORDER BY created_at DESC
             LIMIT 1`,
            [laneId]
          )
        ).rows[0];

        const completedRow =
          row ??
          (
            await client.query<{ id: string }>(
              `SELECT id
               FROM lane_sessions
               WHERE lane_id = $1
                 AND status = 'COMPLETED'
                 AND (customer_id IS NOT NULL OR customer_display_name IS NOT NULL)
               ORDER BY updated_at DESC
               LIMIT 1`,
              [laneId]
            )
          ).rows[0];

        if (!completedRow) return { session: null as null | unknown };

        const { payload } = await buildFullSessionUpdatedPayload(client, completedRow.id);
        return { session: payload };
      });

      return reply.send(result);
    }
  );
}
