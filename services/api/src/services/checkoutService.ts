/**
 * Checkout service — business logic for manual checkout and staff-action checkout flows.
 *
 * Extracted from routes/checkout/manual.ts and routes/checkout/staff-actions.ts.
 * Zero HTTP/Fastify concepts. All broadcasting is handled by the route layer.
 *
 * Migrated to Drizzle ORM — uses db.execute(sql) and db.transaction().
 */
import { RoomStatus } from '@the-clubs/shared';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import type {
  ManualCheckoutCandidateRow,
  ManualResolveRow,
  CheckoutRequestRow,
  CheckinBlockRow,
  WaitlistStatusRow,
} from '../checkout/types';
import type { MarkFeePaidInput } from '../checkout/schemas';
import { calculateLateFee, looksLikeUuid } from '../checkout/utils';
import { insertAuditLogDrizzle } from '../audit/auditLog';
import { insertCustomerActivityEventDrizzle } from '../activity/customerActivityLog';
import { insertClubEventDrizzle } from '../activity/clubEventLog';
import { insertCustomerSpendLedgerEntryDrizzle } from '../ledger/customerSpendLedger';
import { computeOrderTotals, ensureOrderWithReceipt } from '../money/orderAudit';
import { HttpError } from '../errors/HttpError';
import { type DrizzleTx } from '../db';



/**
 * Adapter: wraps a Drizzle transaction to satisfy the Queryable interface
 * expected by ensureOrderWithReceipt.
 */
function toQueryable(tx: DrizzleTx) {
  return {
    async query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const parts = queryText.split(/\$\d+/);
      const values = params ?? [];
      let built = sql.empty();
      for (let i = 0; i < parts.length; i++) {
        built = sql`${built}${sql.raw(parts[i]!)}`;
        if (i < values.length) {
          built = sql`${built}${values[i]}`;
        }
      }
      const result = await (tx as any).execute(built);
      return { rows: result.rows as T[] };
    },
  };
}

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
  resourceId?: string | null;
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
  itemsConfirmed: boolean;
}

export interface ConfirmItemsResult {
  requestId: string;
  itemsConfirmed: boolean;
  feePaid?: boolean;
}

export interface CompleteCheckoutResult {
  requestId: string;
  resourceId: string | null;
  visitId: string;
  kioskDeviceId: string | null;
  cancelledWaitlistIds: string[];
}

// ── Manual Checkout ──

/**
 * List checkout candidates (overdue or within 60 minutes of checkout).
 */
export async function listManualCandidates(): Promise<ManualCheckoutCandidate[]> {
  const result = await db.execute<Record<string, unknown>>(
    sql`
    SELECT DISTINCT ON (cb.resource_id)
      cb.id as occupancy_id,
      cb.visit_id as visit_id,
      CASE WHEN ir.kind = 'room' THEN 'ROOM' ELSE 'LOCKER' END as resource_type,
      ir.number as number,
      c.id as customer_id,
      c.name as customer_name,
      cb.starts_at as checkin_at,
      cb.ends_at as scheduled_checkout_at,
      (cb.ends_at < NOW()) as is_overdue
    FROM checkin_blocks cb
    JOIN visits v ON cb.visit_id = v.id
    JOIN customers c ON v.customer_id = c.id
    JOIN inventory_resources ir ON cb.resource_id = ir.id
    WHERE cb.resource_id IS NOT NULL
      AND v.ended_at IS NULL
      AND cb.ends_at <= NOW() + INTERVAL '60 minutes'
    ORDER BY cb.resource_id, cb.ends_at DESC
    `
  );

  return (result.rows as unknown as ManualCheckoutCandidateRow[]).map((r) => ({
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
    const res = await db.execute<Record<string, unknown>>(
      sql`SELECT cb.id as occupancy_id, cb.visit_id, v.customer_id, c.name as customer_name,
              cb.starts_at as checkin_at, cb.ends_at as scheduled_checkout_at,
              cb.resource_id, ir.number as resource_number, ir.kind as resource_kind, cb.session_id
       FROM checkin_blocks cb
       JOIN visits v ON cb.visit_id = v.id
       JOIN customers c ON v.customer_id = c.id
       LEFT JOIN inventory_resources ir ON cb.resource_id = ir.id
       WHERE cb.id = ${occupancyId} AND v.ended_at IS NULL`
    );
    return (res.rows[0] as unknown as ManualResolveRow) ?? null;
  };

  const loadLatestByResourceId = async (resourceId: string) => {
    const res = await db.execute<Record<string, unknown>>(
      sql`SELECT cb.id as occupancy_id, cb.visit_id, v.customer_id, c.name as customer_name,
              cb.starts_at as checkin_at, cb.ends_at as scheduled_checkout_at,
              cb.resource_id, ir.number as resource_number, ir.kind as resource_kind, cb.session_id
       FROM checkin_blocks cb
       JOIN visits v ON cb.visit_id = v.id
       JOIN customers c ON v.customer_id = c.id
       LEFT JOIN inventory_resources ir ON cb.resource_id = ir.id
       WHERE cb.resource_id = ${resourceId} AND v.ended_at IS NULL
       ORDER BY cb.ends_at DESC LIMIT 1`
    );
    return (res.rows[0] as unknown as ManualResolveRow) ?? null;
  };

  let row: ManualResolveRow | null = null;
  if (input.occupancyId) {
    row = await loadByOccupancyId(input.occupancyId);
  } else if (input.number) {
    const resourceRes = await db.execute<{ id: string }>(sql`SELECT id FROM inventory_resources WHERE number = ${input.number}`);
    if (resourceRes.rows[0]?.id) {
      row = await loadLatestByResourceId(resourceRes.rows[0].id);
    }
  }

  if (!row) return null;

  const scheduledCheckoutAt = row.scheduled_checkout_at;
  const lateMinutes = Math.max(0, Math.floor((Date.now() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
  const { feeAmount, banApplied } = calculateLateFee(lateMinutes);
  const resourceType = row.resource_kind === 'locker' ? 'LOCKER' as const : 'ROOM' as const;
  const number = row.resource_number;

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
  const result = await db.transaction(async (tx) => {
    const occRes = await tx.execute<Record<string, unknown>>(
      sql`SELECT cb.id as occupancy_id, cb.visit_id, v.customer_id, c.name as customer_name,
              cb.starts_at as checkin_at, cb.ends_at as scheduled_checkout_at,
              cb.resource_id, ir.number as resource_number, ir.kind as resource_kind,
              cb.session_id, v.ended_at as visit_ended_at
       FROM checkin_blocks cb
       JOIN visits v ON cb.visit_id = v.id
       JOIN customers c ON v.customer_id = c.id
       LEFT JOIN inventory_resources ir ON cb.resource_id = ir.id
       WHERE cb.id = ${occupancyId}
       FOR UPDATE OF v`
    );

    if (occRes.rows.length === 0) throw new HttpError(404, 'Occupancy not found');
    const row = occRes.rows[0] as unknown as ManualResolveRow & { visit_ended_at: Date | null };

    const scheduledCheckoutAt = row.scheduled_checkout_at;
    const resourceType = row.resource_kind === 'locker' ? 'LOCKER' as const : 'ROOM' as const;
    const number = row.resource_number;

    if (!number) throw new HttpError(500, 'Resource not found for occupancy');

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
        resourceId: row.resource_id,
        cancelledWaitlistIds: [] as string[],
        visitId: row.visit_id,
      };
    }

    const lateMinutes = Math.max(0, Math.floor((Date.now() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
    const { feeAmount, banApplied } = calculateLateFee(lateMinutes);

    // Cancel active waitlist entries for this visit
    const waitlistResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT id, status FROM waitlist WHERE visit_id = ${row.visit_id} AND status IN ('ACTIVE','OFFERED') FOR UPDATE`
    );
    const waitlistRows = waitlistResult.rows as unknown as WaitlistStatusRow[];

    if (waitlistRows.length > 0) {
      const waitlistIds = waitlistRows.map((r) => r.id);
      await tx.execute(sql`UPDATE waitlist SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by_staff_id = NULL, updated_at = NOW() WHERE id = ANY(${waitlistIds}::uuid[])`);
      const auditStaffId = looksLikeUuid(staff.staffId) ? staff.staffId : null;
      for (const wl of waitlistRows) {
        await insertAuditLogDrizzle(tx, {
          staffId: auditStaffId,
          action: 'WAITLIST_CANCELLED',
          entityType: 'waitlist',
          entityId: wl.id,
          oldValue: { status: wl.status },
          newValue: { status: 'CANCELLED', reason: 'CHECKED_OUT' },
        });
      }
    }

    // Release resource: rooms → DIRTY, lockers → CLEAN
    if (row.resource_id) {
      const targetStatus = row.resource_kind === 'locker' ? RoomStatus.CLEAN : RoomStatus.DIRTY;
      await tx.execute(sql`UPDATE inventory_resources SET status = ${targetStatus}, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = ${row.resource_id}`);
    }

    // End the visit
    await tx.execute(sql`UPDATE visits SET ended_at = NOW(), updated_at = NOW() WHERE id = ${row.visit_id}`);

    // Ban for severe late checkouts
    if (banApplied) {
      await tx.execute(sql`UPDATE customers SET banned_until = GREATEST(COALESCE(banned_until, NOW()), NOW() + INTERVAL '30 days'), updated_at = NOW() WHERE id = ${row.customer_id}`);
      await tx.execute(sql`INSERT INTO late_checkout_ban_alerts
        (customer_id, checkout_request_id, occupancy_id, visit_id, late_minutes, fee_amount, recommended_ban_days, status, created_by_staff_id, created_by_staff_name)
       VALUES (${row.customer_id}, NULL, ${row.occupancy_id}, ${row.visit_id}, ${lateMinutes}, ${feeAmount}, 30, 'PENDING', ${staff.staffId}, ${staff.staffName})
       ON CONFLICT (occupancy_id) WHERE checkout_request_id IS NULL DO NOTHING`);
    }

    // Late fee bookkeeping
    if (feeAmount > 0) {
      if (payAtCheckout) {
        const quoteJson = JSON.stringify({ type: 'LATE_FEE', total: feeAmount });
        const existingOrder = await tx.execute<{ id: string }>(
          sql`INSERT INTO orders (amount, status, quote_json, payment_method, paid_at, paid_by_staff_id)
           VALUES (${feeAmount}, 'PAID', ${quoteJson}::jsonb, ${paymentMethod ?? null}, NOW(), ${staff.staffId}) RETURNING id`
        );
        const orderId = existingOrder.rows[0]!.id;
        const existingLate = await tx.execute<{ id: string }>(sql`SELECT id FROM order_line_items WHERE checkin_block_id = ${row.occupancy_id} AND type = 'LATE_FEE' LIMIT 1`);
        if (existingLate.rows.length === 0) {
          await tx.execute(sql`INSERT INTO order_line_items (visit_id, checkin_block_id, type, amount, order_id) VALUES (${row.visit_id}, ${row.occupancy_id}, 'LATE_FEE', ${feeAmount}, ${orderId})`);
        }
      } else {
        await tx.execute(sql`UPDATE customers SET past_due_balance = past_due_balance + ${feeAmount}, updated_at = NOW() WHERE id = ${row.customer_id}`);
        const existingLate = await tx.execute<{ id: string }>(sql`SELECT id FROM order_line_items WHERE checkin_block_id = ${row.occupancy_id} AND type = 'LATE_FEE' LIMIT 1`);
        if (existingLate.rows.length === 0) {
          await tx.execute(sql`INSERT INTO order_line_items (visit_id, checkin_block_id, type, amount, order_id) VALUES (${row.visit_id}, ${row.occupancy_id}, 'LATE_FEE', ${feeAmount}, ${null})`);
        }
      }

      // Club event for late fee
      await insertClubEventDrizzle(tx, {
        eventType: 'LATE_FEE_CHARGED',
        eventDomain: 'SALES',
        sourceApp: 'EMPLOYEE_REGISTER',
        staffId: looksLikeUuid(staff.staffId) ? staff.staffId : null,
        staffName: staff.staffName,
        customerId: row.customer_id,
        customerName: row.customer_name,
        visitId: row.visit_id,
        amount: feeAmount,
        summary: `Late fee charged — $${feeAmount.toFixed(2)} (${lateMinutes} min late)`,
        metadata: {
          occupancyId: row.occupancy_id,
          lateMinutes,
          feeAmount,
          banApplied,
          payAtCheckout,
        },
        dedupeKey: `CLUB:LATE_FEE_CHARGED:MANUAL:${row.occupancy_id}`,
      });
    }

    // Log late checkout event if late >= 30 minutes
    if (lateMinutes >= 30) {
      await tx.execute(sql`INSERT INTO late_checkout_events (customer_id, occupancy_id, checkout_request_id, late_minutes, fee_amount, ban_applied) VALUES (${row.customer_id}, ${row.occupancy_id}, ${null}, ${lateMinutes}, ${feeAmount}, ${banApplied})`);

      // Auto-note on customer account for late checkout
      const paymentNote = feeAmount > 0
        ? payAtCheckout
          ? `Fee paid at checkout.`
          : `Fee added to past due balance.`
        : `No fee assessed.`;
      const noteText = `Late checkout: ${lateMinutes} minutes late. Fee assessed: $${feeAmount.toFixed(2)}. ${paymentNote}${banApplied ? ' Ban applied.' : ''}`;
      const safeStaffId = looksLikeUuid(staff.staffId) ? staff.staffId : null;
      await tx.execute(sql`INSERT INTO customer_notes
           (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
         VALUES (${row.customer_id}, ${safeStaffId}, ${staff.staffName}, 'EMPLOYEE_REGISTER', ${noteText}, true)`);
    }

    // Emit club event
    await insertClubEventDrizzle(tx, {
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
        resourceId: row.resource_id,
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
      resourceId: row.resource_id,
      cancelledWaitlistIds: waitlistRows.map((r) => r.id),
      visitId: row.visit_id,
    };
  }, { isolationLevel: 'serializable' });

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
  const result = await db.transaction(async (tx) => {
    const requestResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT id, occupancy_id, customer_id, key_tag_id, kiosk_device_id,
              created_at, claimed_by_staff_id, claimed_at, claim_expires_at,
              customer_checklist_json, status, late_minutes, late_fee_amount,
              ban_applied, items_confirmed, fee_paid, completed_at
       FROM checkout_requests WHERE id = ${requestId} FOR UPDATE`
    );

    if (requestResult.rows.length === 0) throw new HttpError(404, 'Checkout request not found');
    const checkoutRequest = requestResult.rows[0] as unknown as CheckoutRequestRow;

    if (checkoutRequest.status !== 'SUBMITTED') {
      if (checkoutRequest.status === 'CLAIMED' && checkoutRequest.claim_expires_at) {
        if (new Date() <= checkoutRequest.claim_expires_at) {
          throw new HttpError(409, 'Checkout request already claimed');
        }
        // Claim expired — allow re-claim
      } else {
        throw new HttpError(409, `Checkout request is ${checkoutRequest.status}`);
      }
    }

    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + 2 * 60 * 1000);

    const updateResult = await tx.execute<Record<string, unknown>>(
      sql`UPDATE checkout_requests
       SET claimed_by_staff_id = ${staff.staffId}, claimed_at = ${now}, claim_expires_at = ${claimExpiresAt}, status = 'CLAIMED', updated_at = NOW()
       WHERE id = ${requestId}
       RETURNING id, claimed_at, claim_expires_at`
    );

    const updated = updateResult.rows[0] as unknown as CheckoutRequestRow;
    return {
      requestId: updated.id,
      claimedBy: staff.staffId,
      claimedAt: updated.claimed_at,
      claimExpiresAt: updated.claim_expires_at,
    };
  }, { isolationLevel: 'serializable' });

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
  const result = await db.transaction(async (tx) => {
    const requestResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT id, claimed_by_staff_id, status, fee_paid, late_fee_amount, customer_id, occupancy_id
       FROM checkout_requests WHERE id = ${requestId}`
    );

    if (requestResult.rows.length === 0) throw new HttpError(404, 'Checkout request not found');
    const checkoutRequest = requestResult.rows[0] as unknown as CheckoutRequestRow & { customer_id: string | null; occupancy_id: string | null };

    if (checkoutRequest.claimed_by_staff_id !== staff.staffId) {
      throw new HttpError(403, 'Not authorized to update this checkout request');
    }
    if (checkoutRequest.status !== 'CLAIMED') {
      throw new HttpError(409, `Checkout request is ${checkoutRequest.status}`);
    }

    const updateResult = await tx.execute<Record<string, unknown>>(
      sql`UPDATE checkout_requests SET fee_paid = true, updated_at = NOW() WHERE id = ${requestId}
       RETURNING id, items_confirmed, fee_paid`
    );

    const feeAmount = Number(checkoutRequest.late_fee_amount) || 0;
    if (feeAmount > 0) {
      const existingOrder = await tx.execute<{ id: string }>(
        sql`SELECT id FROM orders WHERE metadata_json->>'checkoutRequestId' = ${requestId} LIMIT 1`
      );

      if (existingOrder.rows.length === 0) {
        const registerSession = await tx.execute<{ id: string; register_number: number | null }>(
          sql`SELECT id, register_number FROM register_sessions WHERE employee_id = ${staff.staffId} AND signed_out_at IS NULL ORDER BY created_at DESC LIMIT 1`
        );
        const activeRegister = registerSession.rows[0];
        const resolvedRegisterNumber = body.registerNumber ?? activeRegister?.register_number ?? null;

        const quoteJson = JSON.stringify({
          type: 'LATE_FEE',
          lineItems: [{ description: 'Late Fee', amount: feeAmount, kind: 'LATE_FEE' }],
          total: feeAmount,
          messages: body.note ? [body.note] : [],
        });

        const existingOrder = await tx.execute<Record<string, unknown>>(
          sql`INSERT INTO orders
           (amount, status, quote_json, payment_method, register_number, tip, paid_at, paid_by_staff_id)
           VALUES (${feeAmount}, 'PAID', ${quoteJson}::jsonb, ${body.paymentMethod ?? null}, ${resolvedRegisterNumber}, ${body.tip ?? 0}, NOW(), ${staff.staffId})
           RETURNING id, amount, payment_method, register_number, tip`
        );

        const intent = existingOrder.rows[0] as unknown as { id: string; amount: number | string; payment_method?: string | null; register_number?: number | null; tip?: number | null };
        const lineItems = [{ kind: 'LATE_FEE' as const, name: 'Late Fee', quantity: 1, unitPrice: feeAmount, total: feeAmount }];
        const totals = computeOrderTotals(lineItems, feeAmount, intent.tip ?? 0);

        const ensured = await ensureOrderWithReceipt(toQueryable(tx), {
          dedupeKey: { field: 'checkoutRequestId', value: requestId },
          customerId: checkoutRequest.customer_id ?? null,
          registerSessionId: activeRegister?.id ?? null,
          createdByStaffId: staff.staffId,
          totals,
          lineItems,
          metadata: {
            checkoutRequestId: requestId,
            orderId: intent.id,
            paymentMethod: intent.payment_method ?? null,
            registerNumber: intent.register_number ?? null,
          },
          tender: {
            orderId: intent.id,
            paymentMethod: intent.payment_method ?? null,
            amount: feeAmount,
            tip: intent.tip ?? 0,
            registerNumber: intent.register_number ?? null,
          },
        });

        if (checkoutRequest.customer_id) {
          const blockRow = await tx.execute<{ visit_id: string }>(
            sql`SELECT visit_id FROM checkin_blocks WHERE id = ${checkoutRequest.occupancy_id} LIMIT 1`
          );
          const visitId = blockRow.rows[0]?.visit_id ?? null;

          await insertCustomerSpendLedgerEntryDrizzle(tx, {
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
              total: ensured.order.total,
              visitId,
            },
            dedupeKey: `LEDGER:CHECKOUT_FEE_PAID:${requestId}`,
          });

          await insertCustomerActivityEventDrizzle(tx, {
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
              visitId,
            },
            dedupeKey: `ACT:CHECKOUT_FEE_PAID:${requestId}`,
            searchParts: [requestId, ensured.order.id, intent.id],
          });

          // Look up customer name for the club event
          const custNameResult = await tx.execute<{ name: string }>(
            sql`SELECT name FROM customers WHERE id = ${checkoutRequest.customer_id}`
          );

          await insertClubEventDrizzle(tx, {
            eventType: 'LATE_FEE_CHARGED',
            eventDomain: 'SALES',
            sourceApp: 'EMPLOYEE_REGISTER',
            staffId: staff.staffId,
            staffName: staff.staffName,
            customerId: checkoutRequest.customer_id,
            customerName: custNameResult.rows[0]?.name ?? null,
            visitId,
            amount: feeAmount,
            summary: `Late fee paid — $${feeAmount.toFixed(2)}`,
            metadata: {
              checkoutRequestId: requestId,
              orderId: ensured.order.id,
              feeAmount,
            },
            dedupeKey: `CLUB:LATE_FEE_CHARGED:${requestId}`,
          });
        }
      }
    }

    const updated = updateResult.rows[0] as unknown as CheckoutRequestRow;
    return {
      requestId: updated.id,
      feePaid: updated.fee_paid,
      itemsConfirmed: updated.items_confirmed,
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
  return db.transaction(async (tx) => {
    const requestResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT id, claimed_by_staff_id, status, items_confirmed FROM checkout_requests WHERE id = ${requestId}`
    );

    if (requestResult.rows.length === 0) throw new HttpError(404, 'Checkout request not found');
    const checkoutRequest = requestResult.rows[0] as unknown as CheckoutRequestRow;

    if (checkoutRequest.claimed_by_staff_id !== staff.staffId) {
      throw new HttpError(403, 'Not authorized to update this checkout request');
    }
    if (checkoutRequest.status !== 'CLAIMED') {
      throw new HttpError(409, `Checkout request is ${checkoutRequest.status}`);
    }

    const updateResult = await tx.execute<Record<string, unknown>>(
      sql`UPDATE checkout_requests SET items_confirmed = true, updated_at = NOW() WHERE id = ${requestId}
       RETURNING id, items_confirmed, fee_paid`
    );

    const updated = updateResult.rows[0] as unknown as CheckoutRequestRow;
    return {
      requestId: updated.id,
      itemsConfirmed: updated.items_confirmed,
      feePaid: updated.fee_paid,
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
  return db.transaction(async (tx) => {
    const requestResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT id, occupancy_id, customer_id, key_tag_id, kiosk_device_id,
              created_at, claimed_by_staff_id, claimed_at, claim_expires_at,
              customer_checklist_json, status, late_minutes, late_fee_amount,
              ban_applied, items_confirmed, fee_paid, completed_at
       FROM checkout_requests WHERE id = ${requestId} FOR UPDATE`
    );

    if (requestResult.rows.length === 0) throw new HttpError(404, 'Checkout request not found');
    const checkoutRequest = requestResult.rows[0] as unknown as CheckoutRequestRow;

    if (checkoutRequest.claimed_by_staff_id !== staff.staffId) {
      throw new HttpError(403, 'Not authorized to complete this checkout request');
    }
    if (checkoutRequest.status !== 'CLAIMED') {
      throw new HttpError(409, `Checkout request is ${checkoutRequest.status}`);
    }
    if (!checkoutRequest.items_confirmed) {
      throw new HttpError(400, 'Items must be confirmed before completing checkout');
    }
    if (checkoutRequest.late_fee_amount > 0 && !checkoutRequest.fee_paid) {
      throw new HttpError(400, 'Late fee must be paid before completing checkout');
    }

    // Get the checkin block
    const blockResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
              cb.rental_type::text as rental_type, cb.resource_id, cb.session_id, cb.has_tv_remote,
              v.customer_id
       FROM checkin_blocks cb
       JOIN visits v ON cb.visit_id = v.id
       WHERE cb.id = ${checkoutRequest.occupancy_id}`
    );

    if (blockResult.rows.length === 0) throw new HttpError(404, 'Occupancy not found');
    const block = blockResult.rows[0] as unknown as CheckinBlockRow & { customer_id: string };

    // Cancel active waitlist entries
    const waitlistResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT id, status FROM waitlist WHERE visit_id = ${block.visit_id} AND status IN ('ACTIVE','OFFERED') FOR UPDATE`
    );
    const waitlistRows = waitlistResult.rows as unknown as WaitlistStatusRow[];

    if (waitlistRows.length > 0) {
      const waitlistIds = waitlistRows.map((r) => r.id);
      await tx.execute(sql`UPDATE waitlist SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by_staff_id = NULL, updated_at = NOW() WHERE id = ANY(${waitlistIds}::uuid[])`);
      const auditStaffId = looksLikeUuid(staff.staffId) ? staff.staffId : null;
      for (const row of waitlistRows) {
        await insertAuditLogDrizzle(tx, {
          staffId: auditStaffId,
          action: 'WAITLIST_CANCELLED',
          entityType: 'waitlist',
          entityId: row.id,
          oldValue: { status: row.status },
          newValue: { status: 'CANCELLED', reason: 'CHECKED_OUT' },
        });
      }
    }

    // Release resource: rooms → DIRTY, lockers → CLEAN
    if (block.resource_id) {
      // Determine resource kind for status
      const kindResult = await tx.execute<{ kind: string }>(sql`SELECT kind FROM inventory_resources WHERE id = ${block.resource_id}`);
      const kind = kindResult.rows[0]?.kind;
      const targetStatus = kind === 'locker' ? RoomStatus.CLEAN : RoomStatus.DIRTY;
      await tx.execute(sql`UPDATE inventory_resources SET status = ${targetStatus}, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = ${block.resource_id}`);
    }

    // End the visit
    await tx.execute(sql`UPDATE visits SET ended_at = NOW(), updated_at = NOW() WHERE id = ${block.visit_id}`);

    // Ban alert if needed
    if (checkoutRequest.ban_applied) {
      await tx.execute(sql`INSERT INTO late_checkout_ban_alerts
        (customer_id, checkout_request_id, occupancy_id, visit_id, late_minutes, fee_amount, recommended_ban_days, status, created_by_staff_id, created_by_staff_name)
       VALUES (${checkoutRequest.customer_id}, ${checkoutRequest.id}, ${checkoutRequest.occupancy_id}, ${block.visit_id}, ${checkoutRequest.late_minutes}, ${Number(checkoutRequest.late_fee_amount) || 0}, 30, 'PENDING', ${staff.staffId}, ${staff.staffName})
       ON CONFLICT (checkout_request_id) DO NOTHING`);
    }

    // Late fee bookkeeping
    const feeAmount = Number(checkoutRequest.late_fee_amount) || 0;
    if (feeAmount > 0) {
      await tx.execute(sql`UPDATE customers SET past_due_balance = past_due_balance + ${feeAmount}, updated_at = NOW() WHERE id = ${checkoutRequest.customer_id}`);

      const existingLate = await tx.execute<{ id: string }>(sql`SELECT id FROM order_line_items WHERE checkin_block_id = ${block.id} AND type = 'LATE_FEE' LIMIT 1`);
      if (existingLate.rows.length === 0) {
        await tx.execute(sql`INSERT INTO order_line_items (visit_id, checkin_block_id, type, amount, order_id) VALUES (${block.visit_id}, ${block.id}, 'LATE_FEE', ${feeAmount}, ${null})`);
      }

      await insertCustomerSpendLedgerEntryDrizzle(tx, {
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
        const feePaidStatus = checkoutRequest.fee_paid ? 'Fee paid at checkout.' : 'Fee added to past due balance.';
        const noteText = `Late checkout: ${checkoutRequest.late_minutes} minutes late. Fee assessed: $${feeAmount.toFixed(2)}. ${feeAmount > 0 ? feePaidStatus : 'No fee assessed.'}${checkoutRequest.ban_applied ? ' Ban applied.' : ''}`;
        const noteResult = await tx.execute<{ id: string }>(
          sql`INSERT INTO customer_notes
             (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
           VALUES (${checkoutRequest.customer_id}, ${staff.staffId}, ${staff.staffName}, 'EMPLOYEE_REGISTER', ${noteText}, true) RETURNING id`
        );

        await insertCustomerActivityEventDrizzle(tx, {
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
      await tx.execute(sql`INSERT INTO late_checkout_events (customer_id, occupancy_id, checkout_request_id, late_minutes, fee_amount, ban_applied) VALUES (${checkoutRequest.customer_id}, ${checkoutRequest.occupancy_id}, ${checkoutRequest.id}, ${checkoutRequest.late_minutes}, ${checkoutRequest.late_fee_amount}, ${checkoutRequest.ban_applied})`);
    }

    // Mark checkout request as completed
    await tx.execute(sql`UPDATE checkout_requests SET status = 'VERIFIED', completed_at = NOW(), updated_at = NOW() WHERE id = ${checkoutRequest.id}`);

    // Activity event
    await insertCustomerActivityEventDrizzle(tx, {
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
    await insertClubEventDrizzle(tx, {
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
        resourceId: block.resource_id,
        lateMinutes: checkoutRequest.late_minutes,
        feeAmount: Number(checkoutRequest.late_fee_amount) || 0,
        banApplied: checkoutRequest.ban_applied,
      },
      dedupeKey: `CLUB:CHECKOUT_COMPLETED:${checkoutRequest.id}`,
    });

    return {
      requestId: checkoutRequest.id,
      kioskDeviceId: checkoutRequest.kiosk_device_id,
      resourceId: block.resource_id,
      visitId: block.visit_id,
      cancelledWaitlistIds: waitlistRows.map((r) => r.id),
    };
  }, { isolationLevel: 'serializable' });
}
