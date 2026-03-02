/**
 * Checkout service — business logic for manual checkout and staff-action checkout flows.
 *
 * Extracted from routes/checkout/manual.ts and routes/checkout/staff-actions.ts.
 * Zero HTTP/Fastify concepts. All broadcasting is handled by the route layer.
 */
import { RoomStatus } from '@the-clubs/shared';
import { query, serializableTransaction, transaction } from '../db';
import type {
  ManualCheckoutCandidateRow,
  ManualResolveRow,
  CheckoutRequestRow,
  CheckinBlockRow,
  WaitlistStatusRow,
} from '../checkout/types';
import type { MarkFeePaidInput } from '../checkout/schemas';
import { calculateLateFee, looksLikeUuid } from '../checkout/utils';
import { insertAuditLog } from '../audit/auditLog';
import { insertCustomerActivityEvent } from '../activity/customerActivityLog';
import { insertClubEvent } from '../activity/clubEventLog';
import { insertCustomerSpendLedgerEntry } from '../ledger/customerSpendLedger';
import { computeOrderTotals, ensureOrderWithReceipt } from '../money/orderAudit';

// ── Shared context (passed from route layer) ──

export interface StaffContext {
  staffId: string;
  staffName: string;
}

// ── Result types ──

export interface ManualCheckoutCandidate {
  occupancyId: string;
  visitId: string;
  resourceType: string;
  number: string;
  customerId: string;
  customerName: string;
  checkinAt: Date;
  scheduledCheckoutAt: Date;
  isOverdue: boolean;
}

export interface ManualResolveResult {
  occupancyId: string;
  resourceType: 'ROOM' | 'LOCKER';
  number: string;
  customerName: string;
  checkinAt: Date;
  scheduledCheckoutAt: Date;
  lateMinutes: number;
  fee: number;
  banApplied: boolean;
}

export interface ManualCompleteResult {
  occupancyId: string;
  resourceType: 'ROOM' | 'LOCKER';
  number: string;
  customerName: string;
  checkinAt: Date;
  scheduledCheckoutAt: Date;
  lateMinutes: number;
  fee: number;
  banApplied: boolean;
  alreadyCheckedOut: boolean;
  roomId?: string | null;
  lockerId?: string | null;
  cancelledWaitlistIds: string[];
  visitId: string;
}

export interface ClaimResult {
  requestId: string;
  claimedBy: string;
  claimedAt: Date | null;
  claimExpiresAt: Date | null;
}

export interface MarkFeePaidResult {
  requestId: string;
  feePaid: boolean;
}

export interface ConfirmItemsResult {
  requestId: string;
  itemsConfirmed: boolean;
  feePaid?: boolean;
}

export interface CompleteCheckoutResult {
  requestId: string;
  roomId: string | null;
  lockerId: string | null;
  visitId: string;
  kioskDeviceId: string | null;
  cancelledWaitlistIds: string[];
}

// ── Manual Checkout ──

/**
 * List checkout candidates (overdue or within 60 minutes of checkout).
 */
export async function listManualCandidates(): Promise<ManualCheckoutCandidate[]> {
  const result = await query<ManualCheckoutCandidateRow>(
    `
    WITH room_candidates AS (
      SELECT DISTINCT ON (cb.room_id)
        cb.id as occupancy_id,
        cb.visit_id as visit_id,
        'ROOM'::text as resource_type,
        r.number as number,
        c.id as customer_id,
        c.name as customer_name,
        cb.starts_at as checkin_at,
        cb.ends_at as scheduled_checkout_at,
        (cb.ends_at < NOW()) as is_overdue
      FROM checkin_blocks cb
      JOIN visits v ON cb.visit_id = v.id
      JOIN customers c ON v.customer_id = c.id
      JOIN rooms r ON cb.room_id = r.id
      WHERE cb.room_id IS NOT NULL
        AND v.ended_at IS NULL
        AND cb.ends_at <= NOW() + INTERVAL '60 minutes'
      ORDER BY cb.room_id, cb.ends_at DESC
    ),
    locker_candidates AS (
      SELECT DISTINCT ON (cb.locker_id)
        cb.id as occupancy_id,
        cb.visit_id as visit_id,
        'LOCKER'::text as resource_type,
        l.number as number,
        c.id as customer_id,
        c.name as customer_name,
        cb.starts_at as checkin_at,
        cb.ends_at as scheduled_checkout_at,
        (cb.ends_at < NOW()) as is_overdue
      FROM checkin_blocks cb
      JOIN visits v ON cb.visit_id = v.id
      JOIN customers c ON v.customer_id = c.id
      JOIN lockers l ON cb.locker_id = l.id
      WHERE cb.locker_id IS NOT NULL
        AND v.ended_at IS NULL
        AND cb.ends_at <= NOW() + INTERVAL '60 minutes'
      ORDER BY cb.locker_id, cb.ends_at DESC
    )
    SELECT * FROM room_candidates
    UNION ALL
    SELECT * FROM locker_candidates
    ORDER BY is_overdue DESC, scheduled_checkout_at ASC
    `
  );

  return result.rows.map((r) => ({
    occupancyId: r.occupancy_id,
    visitId: r.visit_id,
    resourceType: r.resource_type,
    number: r.number,
    customerId: r.customer_id,
    customerName: r.customer_name,
    checkinAt: r.checkin_at,
    scheduledCheckoutAt: r.scheduled_checkout_at,
    isOverdue: r.is_overdue,
  }));
}

/**
 * Resolve a room/locker number or occupancyId into checkout timing + computed late fee.
 */
export async function resolveManualCheckout(input: {
  number?: string;
  occupancyId?: string;
}): Promise<ManualResolveResult | null> {
  const loadByOccupancyId = async (occupancyId: string) => {
    const res = await query<ManualResolveRow>(
      `SELECT cb.id as occupancy_id, cb.visit_id, v.customer_id, c.name as customer_name,
              cb.starts_at as checkin_at, cb.ends_at as scheduled_checkout_at,
              cb.room_id, r.number as room_number, cb.locker_id, l.number as locker_number, cb.session_id
       FROM checkin_blocks cb
       JOIN visits v ON cb.visit_id = v.id
       JOIN customers c ON v.customer_id = c.id
       LEFT JOIN rooms r ON cb.room_id = r.id
       LEFT JOIN lockers l ON cb.locker_id = l.id
       WHERE cb.id = $1 AND v.ended_at IS NULL`,
      [occupancyId]
    );
    return res.rows[0] ?? null;
  };

  const loadLatestByResourceId = async (table: 'rooms' | 'lockers', resourceId: string) => {
    const joinCol = table === 'rooms' ? 'room_id' : 'locker_id';
    const res = await query<ManualResolveRow>(
      `SELECT cb.id as occupancy_id, cb.visit_id, v.customer_id, c.name as customer_name,
              cb.starts_at as checkin_at, cb.ends_at as scheduled_checkout_at,
              cb.room_id, r.number as room_number, cb.locker_id, l.number as locker_number, cb.session_id
       FROM checkin_blocks cb
       JOIN visits v ON cb.visit_id = v.id
       JOIN customers c ON v.customer_id = c.id
       LEFT JOIN rooms r ON cb.room_id = r.id
       LEFT JOIN lockers l ON cb.locker_id = l.id
       WHERE cb.${joinCol} = $1 AND v.ended_at IS NULL
       ORDER BY cb.ends_at DESC LIMIT 1`,
      [resourceId]
    );
    return res.rows[0] ?? null;
  };

  let row: ManualResolveRow | null = null;
  if (input.occupancyId) {
    row = await loadByOccupancyId(input.occupancyId);
  } else if (input.number) {
    const lockerRes = await query<{ id: string }>(`SELECT id FROM lockers WHERE number = $1`, [input.number]);
    if (lockerRes.rows[0]?.id) {
      row = await loadLatestByResourceId('lockers', lockerRes.rows[0].id);
    } else {
      const roomRes = await query<{ id: string }>(`SELECT id FROM rooms WHERE number = $1`, [input.number]);
      if (roomRes.rows[0]?.id) {
        row = await loadLatestByResourceId('rooms', roomRes.rows[0].id);
      }
    }
  }

  if (!row) return null;

  const scheduledCheckoutAt = row.scheduled_checkout_at instanceof Date ? row.scheduled_checkout_at : new Date(row.scheduled_checkout_at);
  const lateMinutes = Math.max(0, Math.floor((Date.now() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
  const { feeAmount, banApplied } = calculateLateFee(lateMinutes);
  const resourceType = row.locker_id ? 'LOCKER' as const : 'ROOM' as const;
  const number = resourceType === 'LOCKER' ? row.locker_number : row.room_number;

  if (!number) return null;

  return {
    occupancyId: row.occupancy_id,
    resourceType,
    number,
    customerName: row.customer_name,
    checkinAt: row.checkin_at,
    scheduledCheckoutAt,
    lateMinutes,
    fee: feeAmount,
    banApplied,
  };
}

/**
 * Complete checkout in a manual (no checkout_request) flow.
 * Uses serializable transaction + visit row lock for idempotency.
 */
export async function completeManualCheckout(
  occupancyId: string,
  payAtCheckout: boolean,
  paymentMethod: 'CREDIT' | 'CASH' | undefined,
  staff: StaffContext
): Promise<ManualCompleteResult> {
  const result = await serializableTransaction(async (client) => {
    const occRes = await client.query<ManualResolveRow & { visit_ended_at: Date | null }>(
      `SELECT cb.id as occupancy_id, cb.visit_id, v.customer_id, c.name as customer_name,
              cb.starts_at as checkin_at, cb.ends_at as scheduled_checkout_at,
              cb.room_id, r.number as room_number, cb.locker_id, l.number as locker_number,
              cb.session_id, v.ended_at as visit_ended_at
       FROM checkin_blocks cb
       JOIN visits v ON cb.visit_id = v.id
       JOIN customers c ON v.customer_id = c.id
       LEFT JOIN rooms r ON cb.room_id = r.id
       LEFT JOIN lockers l ON cb.locker_id = l.id
       WHERE cb.id = $1
       FOR UPDATE OF v`,
      [occupancyId]
    );

    if (occRes.rows.length === 0) throw { statusCode: 404, message: 'Occupancy not found' };
    const row = occRes.rows[0]!;

    const scheduledCheckoutAt = row.scheduled_checkout_at instanceof Date ? row.scheduled_checkout_at : new Date(row.scheduled_checkout_at);
    const resourceType = row.locker_id ? 'LOCKER' as const : 'ROOM' as const;
    const number = resourceType === 'LOCKER' ? row.locker_number : row.room_number;

    if (!number) throw { statusCode: 500, message: 'Resource not found for occupancy' };

    if (row.visit_ended_at) {
      const lateMinutes = Math.max(0, Math.floor((Date.now() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
      const { feeAmount, banApplied } = calculateLateFee(lateMinutes);
      return {
        occupancyId: row.occupancy_id,
        resourceType,
        number,
        customerName: row.customer_name,
        checkinAt: row.checkin_at,
        scheduledCheckoutAt,
        lateMinutes,
        fee: feeAmount,
        banApplied,
        alreadyCheckedOut: true,
        roomId: row.room_id,
        lockerId: row.locker_id,
        cancelledWaitlistIds: [] as string[],
        visitId: row.visit_id,
      };
    }

    const lateMinutes = Math.max(0, Math.floor((Date.now() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
    const { feeAmount, banApplied } = calculateLateFee(lateMinutes);

    // Cancel active waitlist entries for this visit
    const waitlistResult = await client.query<WaitlistStatusRow>(
      `SELECT id, status FROM waitlist WHERE visit_id = $1 AND status IN ('ACTIVE','OFFERED') FOR UPDATE`,
      [row.visit_id]
    );

    if (waitlistResult.rows.length > 0) {
      const waitlistIds = waitlistResult.rows.map((r) => r.id);
      await client.query(
        `UPDATE waitlist SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by_staff_id = NULL, updated_at = NOW() WHERE id = ANY($1::uuid[])`,
        [waitlistIds]
      );
      const auditStaffId = looksLikeUuid(staff.staffId) ? staff.staffId : null;
      for (const wl of waitlistResult.rows) {
        await insertAuditLog(client, {
          staffId: auditStaffId,
          action: 'WAITLIST_CANCELLED',
          entityType: 'waitlist',
          entityId: wl.id,
          oldValue: { status: wl.status },
          newValue: { status: 'CANCELLED', reason: 'CHECKED_OUT' },
        });
      }
    }

    // Update room → DIRTY or locker → CLEAN and unassign
    if (row.room_id) {
      await client.query(`UPDATE rooms SET status = $1, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $2`, [RoomStatus.DIRTY, row.room_id]);
    }
    if (row.locker_id) {
      await client.query(`UPDATE lockers SET status = $1, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $2`, [RoomStatus.CLEAN, row.locker_id]);
    }

    // End the visit
    await client.query(`UPDATE visits SET ended_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.visit_id]);

    // Ban for severe late checkouts
    if (banApplied) {
      await client.query(
        `UPDATE customers SET banned_until = GREATEST(COALESCE(banned_until, NOW()), NOW() + INTERVAL '30 days'), updated_at = NOW() WHERE id = $1`,
        [row.customer_id]
      );
      await client.query(
        `INSERT INTO late_checkout_ban_alerts
          (customer_id, checkout_request_id, occupancy_id, visit_id, late_minutes, fee_amount, recommended_ban_days, status, created_by_staff_id, created_by_staff_name)
         VALUES ($1, NULL, $2, $3, $4, $5, 30, 'PENDING', $6, $7)
         ON CONFLICT (occupancy_id) WHERE checkout_request_id IS NULL DO NOTHING`,
        [row.customer_id, row.occupancy_id, row.visit_id, lateMinutes, feeAmount, staff.staffId, staff.staffName]
      );
    }

    // Late fee bookkeeping
    if (feeAmount > 0) {
      if (payAtCheckout) {
        const paymentIntent = await client.query<{ id: string }>(
          `INSERT INTO payment_intents (amount, status, quote_json, payment_method, paid_at, paid_by_staff_id)
           VALUES ($1, 'PAID', $2, $3, NOW(), $4) RETURNING id`,
          [feeAmount, JSON.stringify({ type: 'LATE_FEE', total: feeAmount }), paymentMethod ?? null, staff.staffId]
        );
        const paymentIntentId = paymentIntent.rows[0]!.id;
        const existingLate = await client.query<{ id: string }>(`SELECT id FROM charges WHERE checkin_block_id = $1 AND type = 'LATE_FEE' LIMIT 1`, [row.occupancy_id]);
        if (existingLate.rows.length === 0) {
          await client.query(`INSERT INTO charges (visit_id, checkin_block_id, type, amount, payment_intent_id) VALUES ($1, $2, 'LATE_FEE', $3, $4)`, [row.visit_id, row.occupancy_id, feeAmount, paymentIntentId]);
        }
      } else {
        await client.query(`UPDATE customers SET past_due_balance = past_due_balance + $1, updated_at = NOW() WHERE id = $2`, [feeAmount, row.customer_id]);
        const existingLate = await client.query<{ id: string }>(`SELECT id FROM charges WHERE checkin_block_id = $1 AND type = 'LATE_FEE' LIMIT 1`, [row.occupancy_id]);
        if (existingLate.rows.length === 0) {
          await client.query(`INSERT INTO charges (visit_id, checkin_block_id, type, amount, payment_intent_id) VALUES ($1, $2, 'LATE_FEE', $3, NULL)`, [row.visit_id, row.occupancy_id, feeAmount]);
        }
      }
    }

    // Log late checkout event if late >= 30 minutes
    if (lateMinutes >= 30) {
      await client.query(
        `INSERT INTO late_checkout_events (customer_id, occupancy_id, checkout_request_id, late_minutes, fee_amount, ban_applied) VALUES ($1, $2, NULL, $3, $4, $5)`,
        [row.customer_id, row.occupancy_id, lateMinutes, feeAmount, banApplied]
      );
    }

    // Emit club event
    await insertClubEvent(client, {
      eventType: 'CHECKOUT_COMPLETED',
      eventDomain: 'CHECKOUT',
      sourceApp: 'EMPLOYEE_REGISTER',
      staffId: looksLikeUuid(staff.staffId) ? staff.staffId : null,
      staffName: staff.staffName,
      customerId: row.customer_id,
      customerName: row.customer_name,
      visitId: row.visit_id,
      summary: `Manual checkout completed — ${row.customer_name}`,
      metadata: {
        occupancyId: row.occupancy_id,
        visitId: row.visit_id,
        roomId: row.room_id,
        lockerId: row.locker_id,
        lateMinutes,
        feeAmount,
        banApplied,
      },
      dedupeKey: `CLUB:CHECKOUT_COMPLETED:MANUAL:${row.occupancy_id}`,
    });

    return {
      occupancyId: row.occupancy_id,
      resourceType,
      number,
      customerName: row.customer_name,
      checkinAt: row.checkin_at,
      scheduledCheckoutAt,
      lateMinutes,
      fee: feeAmount,
      banApplied,
      alreadyCheckedOut: false,
      roomId: row.room_id,
      lockerId: row.locker_id,
      cancelledWaitlistIds: waitlistResult.rows.map((r) => r.id),
      visitId: row.visit_id,
    };
  });

  return result;
}

// ── Staff-Action Checkout ──

/**
 * Claim a checkout request (2-minute TTL lock).
 */
export async function claimCheckoutRequest(
  requestId: string,
  staff: StaffContext
): Promise<ClaimResult> {
  const result = await serializableTransaction(async (client) => {
    const requestResult = await client.query<CheckoutRequestRow>(
      `SELECT id, occupancy_id, customer_id, key_tag_id, kiosk_device_id,
              created_at, claimed_by_staff_id, claimed_at, claim_expires_at,
              customer_checklist_json, status, late_minutes, late_fee_amount,
              ban_applied, items_confirmed, fee_paid, completed_at
       FROM checkout_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );

    if (requestResult.rows.length === 0) throw { statusCode: 404, message: 'Checkout request not found' };
    const checkoutRequest = requestResult.rows[0]!;

    if (checkoutRequest.status !== 'SUBMITTED') {
      if (checkoutRequest.status === 'CLAIMED' && checkoutRequest.claim_expires_at) {
        if (new Date() <= checkoutRequest.claim_expires_at) {
          throw { statusCode: 409, message: 'Checkout request already claimed' };
        }
        // Claim expired — allow re-claim
      } else {
        throw { statusCode: 409, message: `Checkout request is ${checkoutRequest.status}` };
      }
    }

    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + 2 * 60 * 1000);

    const updateResult = await client.query<CheckoutRequestRow>(
      `UPDATE checkout_requests
       SET claimed_by_staff_id = $1, claimed_at = $2, claim_expires_at = $3, status = 'CLAIMED', updated_at = NOW()
       WHERE id = $4
       RETURNING id, claimed_at, claim_expires_at`,
      [staff.staffId, now, claimExpiresAt, requestId]
    );

    const updated = updateResult.rows[0]!;
    return {
      requestId: updated.id,
      claimedBy: staff.staffId,
      claimedAt: updated.claimed_at,
      claimExpiresAt: updated.claim_expires_at,
    };
  });

  return result;
}

/**
 * Mark late fee as paid on a claimed checkout request.
 */
export async function markFeePaid(
  requestId: string,
  body: MarkFeePaidInput,
  staff: StaffContext
): Promise<MarkFeePaidResult> {
  const result = await transaction(async (client) => {
    const requestResult = await client.query<
      CheckoutRequestRow & { customer_id: string | null; occupancy_id: string | null }
    >(
      `SELECT id, claimed_by_staff_id, status, fee_paid, late_fee_amount, customer_id, occupancy_id
       FROM checkout_requests WHERE id = $1`,
      [requestId]
    );

    if (requestResult.rows.length === 0) throw { statusCode: 404, message: 'Checkout request not found' };
    const checkoutRequest = requestResult.rows[0]!;

    if (checkoutRequest.claimed_by_staff_id !== staff.staffId) {
      throw { statusCode: 403, message: 'Not authorized to update this checkout request' };
    }
    if (checkoutRequest.status !== 'CLAIMED') {
      throw { statusCode: 409, message: `Checkout request is ${checkoutRequest.status}` };
    }

    const updateResult = await client.query<CheckoutRequestRow>(
      `UPDATE checkout_requests SET fee_paid = true, updated_at = NOW() WHERE id = $1
       RETURNING id, items_confirmed, fee_paid`,
      [requestId]
    );

    const feeAmount = Number(checkoutRequest.late_fee_amount) || 0;
    if (feeAmount > 0) {
      const existingOrder = await client.query<{ id: string }>(
        `SELECT id FROM orders WHERE metadata_json->>'checkoutRequestId' = $1 LIMIT 1`,
        [requestId]
      );

      if (existingOrder.rows.length === 0) {
        const registerSession = await client.query<{ id: string; register_number: number | null }>(
          `SELECT id, register_number FROM register_sessions WHERE employee_id = $1 AND signed_out_at IS NULL ORDER BY created_at DESC LIMIT 1`,
          [staff.staffId]
        );
        const activeRegister = registerSession.rows[0];
        const resolvedRegisterNumber = body.registerNumber ?? activeRegister?.register_number ?? null;

        const quoteJson = {
          type: 'LATE_FEE',
          lineItems: [{ description: 'Late Fee', amount: feeAmount, kind: 'LATE_FEE' }],
          total: feeAmount,
          messages: body.note ? [body.note] : [],
        };

        const paymentIntent = await client.query<{
          id: string;
          amount: number | string;
          payment_method?: string | null;
          register_number?: number | null;
          tip?: number | null;
        }>(
          `INSERT INTO payment_intents
           (amount, status, quote_json, payment_method, register_number, tip, paid_at, paid_by_staff_id)
           VALUES ($1, 'PAID', $2, $3, $4, $5, NOW(), $6)
           RETURNING id, amount, payment_method, register_number, tip`,
          [feeAmount, JSON.stringify(quoteJson), body.paymentMethod ?? null, resolvedRegisterNumber, body.tip ?? 0, staff.staffId]
        );

        const intent = paymentIntent.rows[0]!;
        const lineItems = [{ kind: 'LATE_FEE' as const, name: 'Late Fee', quantity: 1, unitPrice: feeAmount, total: feeAmount }];
        const totals = computeOrderTotals(lineItems, feeAmount, intent.tip ?? 0);

        const ensured = await ensureOrderWithReceipt(client, {
          dedupeKey: { field: 'checkoutRequestId', value: requestId },
          customerId: checkoutRequest.customer_id ?? null,
          registerSessionId: activeRegister?.id ?? null,
          createdByStaffId: staff.staffId,
          totals,
          lineItems,
          metadata: {
            checkoutRequestId: requestId,
            paymentIntentId: intent.id,
            paymentMethod: intent.payment_method ?? null,
            registerNumber: intent.register_number ?? null,
          },
          tender: {
            paymentIntentId: intent.id,
            paymentMethod: intent.payment_method ?? null,
            amount: feeAmount,
            tip: intent.tip ?? 0,
            registerNumber: intent.register_number ?? null,
          },
        });

        if (checkoutRequest.customer_id) {
          const blockRow = await client.query<{ visit_id: string }>(
            `SELECT visit_id FROM checkin_blocks WHERE id = $1 LIMIT 1`,
            [checkoutRequest.occupancy_id]
          );
          const visitId = blockRow.rows[0]?.visit_id ?? null;

          await insertCustomerSpendLedgerEntry(client, {
            customerId: checkoutRequest.customer_id,
            visitId,
            entryType: 'CHECKOUT_FEE_PAID',
            amount: ensured.order.total,
            sourceApp: 'EMPLOYEE_REGISTER',
            actorType: 'STAFF',
            actorStaffId: staff.staffId,
            actorStaffName: staff.staffName,
            summary: 'Checkout fee paid',
            metadata: {
              checkoutRequestId: requestId,
              orderId: ensured.order.id,
              paymentIntentId: intent.id,
              total: ensured.order.total,
              visitId,
            },
            dedupeKey: `LEDGER:CHECKOUT_FEE_PAID:${requestId}`,
          });

          await insertCustomerActivityEvent(client, {
            customerId: checkoutRequest.customer_id,
            actionType: 'CHECKOUT_FEE_PAID',
            actionCategory: 'CHECKOUT',
            sourceApp: 'EMPLOYEE_REGISTER',
            actorType: 'STAFF',
            actorStaffId: staff.staffId,
            actorStaffName: staff.staffName,
            summary: `Checkout fee paid ($${ensured.order.total.toFixed(2)})`,
            metadata: {
              checkoutRequestId: requestId,
              orderId: ensured.order.id,
              paymentIntentId: intent.id,
              visitId,
            },
            dedupeKey: `ACT:CHECKOUT_FEE_PAID:${requestId}`,
            searchParts: [requestId, ensured.order.id, intent.id],
          });
        }
      }
    }

    return {
      requestId: updateResult.rows[0]!.id,
      feePaid: updateResult.rows[0]!.fee_paid,
      itemsConfirmed: updateResult.rows[0]!.items_confirmed,
    };
  });

  return result;
}

/**
 * Confirm items returned on a claimed checkout request.
 */
export async function confirmItems(
  requestId: string,
  staff: StaffContext
): Promise<ConfirmItemsResult> {
  return transaction(async (client) => {
    const requestResult = await client.query<CheckoutRequestRow>(
      `SELECT id, claimed_by_staff_id, status, items_confirmed FROM checkout_requests WHERE id = $1`,
      [requestId]
    );

    if (requestResult.rows.length === 0) throw { statusCode: 404, message: 'Checkout request not found' };
    const checkoutRequest = requestResult.rows[0]!;

    if (checkoutRequest.claimed_by_staff_id !== staff.staffId) {
      throw { statusCode: 403, message: 'Not authorized to update this checkout request' };
    }
    if (checkoutRequest.status !== 'CLAIMED') {
      throw { statusCode: 409, message: `Checkout request is ${checkoutRequest.status}` };
    }

    const updateResult = await client.query<CheckoutRequestRow>(
      `UPDATE checkout_requests SET items_confirmed = true, updated_at = NOW() WHERE id = $1
       RETURNING id, items_confirmed, fee_paid`,
      [requestId]
    );

    return {
      requestId: updateResult.rows[0]!.id,
      itemsConfirmed: updateResult.rows[0]!.items_confirmed,
      feePaid: updateResult.rows[0]!.fee_paid,
    };
  });
}

/**
 * Complete a staff-action checkout (claim flow).
 * Ends visit, releases room/locker, cancels waitlists, applies ban + late fee, logs events.
 */
export async function completeStaffCheckout(
  requestId: string,
  staff: StaffContext
): Promise<CompleteCheckoutResult> {
  return serializableTransaction(async (client) => {
    const requestResult = await client.query<CheckoutRequestRow>(
      `SELECT id, occupancy_id, customer_id, key_tag_id, kiosk_device_id,
              created_at, claimed_by_staff_id, claimed_at, claim_expires_at,
              customer_checklist_json, status, late_minutes, late_fee_amount,
              ban_applied, items_confirmed, fee_paid, completed_at
       FROM checkout_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );

    if (requestResult.rows.length === 0) throw { statusCode: 404, message: 'Checkout request not found' };
    const checkoutRequest = requestResult.rows[0]!;

    if (checkoutRequest.claimed_by_staff_id !== staff.staffId) {
      throw { statusCode: 403, message: 'Not authorized to complete this checkout request' };
    }
    if (checkoutRequest.status !== 'CLAIMED') {
      throw { statusCode: 409, message: `Checkout request is ${checkoutRequest.status}` };
    }
    if (!checkoutRequest.items_confirmed) {
      throw { statusCode: 400, message: 'Items must be confirmed before completing checkout' };
    }
    if (checkoutRequest.late_fee_amount > 0 && !checkoutRequest.fee_paid) {
      throw { statusCode: 400, message: 'Late fee must be paid before completing checkout' };
    }

    // Get the checkin block
    const blockResult = await client.query<CheckinBlockRow & { customer_id: string }>(
      `SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
              cb.rental_type::text as rental_type, cb.room_id, cb.locker_id, cb.session_id, cb.has_tv_remote,
              v.customer_id
       FROM checkin_blocks cb
       JOIN visits v ON cb.visit_id = v.id
       WHERE cb.id = $1`,
      [checkoutRequest.occupancy_id]
    );

    if (blockResult.rows.length === 0) throw { statusCode: 404, message: 'Occupancy not found' };
    const block = blockResult.rows[0]!;

    // Cancel active waitlist entries
    const waitlistResult = await client.query<WaitlistStatusRow>(
      `SELECT id, status FROM waitlist WHERE visit_id = $1 AND status IN ('ACTIVE','OFFERED') FOR UPDATE`,
      [block.visit_id]
    );

    if (waitlistResult.rows.length > 0) {
      const waitlistIds = waitlistResult.rows.map((r) => r.id);
      await client.query(
        `UPDATE waitlist SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by_staff_id = NULL, updated_at = NOW() WHERE id = ANY($1::uuid[])`,
        [waitlistIds]
      );
      const auditStaffId = looksLikeUuid(staff.staffId) ? staff.staffId : null;
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

    // Release room/locker
    if (block.room_id) {
      await client.query(`UPDATE rooms SET status = $1, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $2`, [RoomStatus.DIRTY, block.room_id]);
    }
    if (block.locker_id) {
      await client.query(`UPDATE lockers SET status = $1, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $2`, [RoomStatus.CLEAN, block.locker_id]);
    }

    // End the visit
    await client.query(`UPDATE visits SET ended_at = NOW(), updated_at = NOW() WHERE id = $1`, [block.visit_id]);

    // Ban alert if needed
    if (checkoutRequest.ban_applied) {
      await client.query(
        `INSERT INTO late_checkout_ban_alerts
          (customer_id, checkout_request_id, occupancy_id, visit_id, late_minutes, fee_amount, recommended_ban_days, status, created_by_staff_id, created_by_staff_name)
         VALUES ($1, $2, $3, $4, $5, $6, 30, 'PENDING', $7, $8)
         ON CONFLICT (checkout_request_id) DO NOTHING`,
        [checkoutRequest.customer_id, checkoutRequest.id, checkoutRequest.occupancy_id, block.visit_id, checkoutRequest.late_minutes, Number(checkoutRequest.late_fee_amount) || 0, staff.staffId, staff.staffName]
      );
    }

    // Late fee bookkeeping
    const feeAmount = Number(checkoutRequest.late_fee_amount) || 0;
    if (feeAmount > 0) {
      await client.query(`UPDATE customers SET past_due_balance = past_due_balance + $1, updated_at = NOW() WHERE id = $2`, [feeAmount, checkoutRequest.customer_id]);

      const existingLate = await client.query<{ id: string }>(`SELECT id FROM charges WHERE checkin_block_id = $1 AND type = 'LATE_FEE' LIMIT 1`, [block.id]);
      if (existingLate.rows.length === 0) {
        await client.query(`INSERT INTO charges (visit_id, checkin_block_id, type, amount, payment_intent_id) VALUES ($1, $2, 'LATE_FEE', $3, NULL)`, [block.visit_id, block.id, feeAmount]);
      }

      await insertCustomerSpendLedgerEntry(client, {
        customerId: checkoutRequest.customer_id,
        visitId: block.visit_id,
        entryType: 'LATE_FEE',
        amount: feeAmount,
        sourceApp: 'EMPLOYEE_REGISTER',
        actorType: 'STAFF',
        actorStaffId: staff.staffId,
        actorStaffName: staff.staffName,
        summary: `Late fee assessed ($${feeAmount.toFixed(2)})`,
        metadata: {
          checkoutRequestId: checkoutRequest.id,
          occupancyId: checkoutRequest.occupancy_id,
          lateMinutes: checkoutRequest.late_minutes,
          banApplied: checkoutRequest.ban_applied,
        },
        dedupeKey: `LEDGER:LATE_FEE:${checkoutRequest.id}`,
      });

      // Customer note for late checkouts >= 30 minutes
      if (checkoutRequest.late_minutes >= 30) {
        const noteText = `Late checkout: ${checkoutRequest.late_minutes} minutes late. Fee assessed: $${feeAmount.toFixed(2)}${checkoutRequest.ban_applied ? ' (ban applied)' : ''}.`;
        const noteResult = await client.query<{ id: string }>(
          `INSERT INTO customer_notes
             (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
           VALUES ($1, $2, $3, 'EMPLOYEE_REGISTER', $4, true) RETURNING id`,
          [checkoutRequest.customer_id, staff.staffId, staff.staffName, noteText]
        );

        await insertCustomerActivityEvent(client, {
          customerId: checkoutRequest.customer_id,
          actionType: 'NOTE_ADDED',
          actionCategory: 'NOTE',
          sourceApp: 'EMPLOYEE_REGISTER',
          actorType: 'STAFF',
          actorStaffId: staff.staffId,
          actorStaffName: staff.staffName,
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

    // Log late checkout event if late >= 30 minutes
    if (checkoutRequest.late_minutes >= 30) {
      await client.query(
        `INSERT INTO late_checkout_events (customer_id, occupancy_id, checkout_request_id, late_minutes, fee_amount, ban_applied) VALUES ($1, $2, $3, $4, $5, $6)`,
        [checkoutRequest.customer_id, checkoutRequest.occupancy_id, checkoutRequest.id, checkoutRequest.late_minutes, checkoutRequest.late_fee_amount, checkoutRequest.ban_applied]
      );
    }

    // Mark checkout request as completed
    await client.query(`UPDATE checkout_requests SET status = 'VERIFIED', completed_at = NOW(), updated_at = NOW() WHERE id = $1`, [checkoutRequest.id]);

    // Activity event
    await insertCustomerActivityEvent(client, {
      customerId: checkoutRequest.customer_id,
      actionType: 'CHECKOUT_COMPLETED',
      actionCategory: 'CHECKOUT',
      sourceApp: 'EMPLOYEE_REGISTER',
      actorType: 'STAFF',
      actorStaffId: staff.staffId,
      actorStaffName: staff.staffName,
      summary: 'Checkout completed',
      metadata: {
        checkoutRequestId: checkoutRequest.id,
        visitId: block.visit_id,
        checkinBlockId: block.id,
      },
      dedupeKey: `ACT:CHECKOUT_COMPLETED:${checkoutRequest.id}`,
      searchParts: [checkoutRequest.id, block.visit_id, block.id],
    });

    // Club event
    await insertClubEvent(client, {
      eventType: 'CHECKOUT_COMPLETED',
      eventDomain: 'CHECKOUT',
      sourceApp: 'EMPLOYEE_REGISTER',
      staffId: staff.staffId,
      staffName: staff.staffName,
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
}
