/**
 * Payment service — business logic for order creation and completion.
 *
 * Unified billing: all monetary transactions go through the orders table.
 * Replaces the former paymentIntents-based flow.
 *
 * Migrated to Drizzle ORM — uses db.transaction() with tx.execute(sql).
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { insertCustomerSpendLedgerEntryDrizzle } from '../ledger/customerSpendLedger';
import { createSquareOrder } from './squareSyncService';
import { getCatalogIdForLineItem } from '../config/squareCatalog';
import {
  calculatePriceQuote,
  calculateRenewalQuote,
  type PricingInput,
} from '../pricing/engine';
import { type CustomerRow, type LaneSessionRow, type OrderRow, LANE_SESSION_COLS, ORDER_COLS } from '../checkin/types';
import { buildFullSessionUpdatedPayload } from '../checkin/payload';
import { toDate, toNumber } from '../checkin/utils';
import { calculateAge } from '../checkin/identity';
import { insertAuditLogDrizzle } from '../audit/auditLog';
import { HttpError } from '../errors/HttpError';
import {
  buildLineItemsFromQuote,
  computeOrderTotals,
  ensureOrderWithReceipt,
  toDollars,
} from '../money/orderAudit';
import { type DrizzleTx } from '../db';



// ── Helpers ──

function isFlowCommandsEnabled(): boolean {
  return process.env.FLOW_COMMANDS === 'true';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseOrderQuote(raw: unknown): {
  type?: string;
  waitlistId?: string;
  visitId?: string;
  blockId?: string;
} {
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return isRecord(parsed) ? parsed : {}; }
    catch { return {}; }
  }
  return isRecord(raw) ? raw : {};
}

// ── Service Methods ──

/**
 * Creates (or reuses) an OPEN order for a lane session's checkout.
 * Replaces the former createPaymentIntent function.
 */
export async function createCheckoutOrder(laneId: string) {
  return db.transaction(async (tx) => {
    const sessionResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT ${sql.raw(LANE_SESSION_COLS)} FROM lane_sessions WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT') ORDER BY created_at DESC LIMIT 1`
    );
    if (sessionResult.rows.length === 0) throw new HttpError(404, 'No active session found');
    const session = sessionResult.rows[0] as unknown as LaneSessionRow;

    if (!session.selection_confirmed || !session.selection_locked_at) throw new HttpError(400, 'Selection must be confirmed/locked before creating payment intent');
    if (!session.desired_rental_type && !session.backup_rental_type) throw new HttpError(400, 'No desired rental type set on session');

    // Customer info for pricing
    let customerAge: number | undefined;
    let membershipCardType: 'NONE' | 'SIX_MONTH' | undefined;
    let membershipValidUntil: Date | undefined;

    if (session.customer_id) {
      const customerResult = await tx.execute<Record<string, unknown>>(
        sql`SELECT dob, membership_card_type, membership_valid_until FROM customers WHERE id = ${session.customer_id}`
      );
      if (customerResult.rows.length > 0) {
        const customer = customerResult.rows[0] as unknown as CustomerRow;
        customerAge = calculateAge(customer.dob);
        membershipCardType = (customer.membership_card_type as 'NONE' | 'SIX_MONTH') || undefined;
        membershipValidUntil = toDate(customer.membership_valid_until) || undefined;
      }
    }

    const rentalType = (session.desired_rental_type || session.backup_rental_type || 'LOCKER') as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';
    const isRenewal = session.checkin_mode === 'RENEWAL';
    const renewalHours = session.renewal_hours === 2 || session.renewal_hours === 6 ? session.renewal_hours : null;
    if (isRenewal && !renewalHours) throw new HttpError(400, 'Renewal hours not set for this session');

    const pricingInput: PricingInput = {
      rentalType, customerAge, checkInTime: new Date(),
      membershipCardType, membershipValidUntil,
      includeSixMonthMembershipPurchase: !!session.membership_purchase_intent,
    };
    const quote = isRenewal ? calculateRenewalQuote({ ...pricingInput, renewalHours }) : calculatePriceQuote(pricingInput);
    const quoteJson = JSON.stringify(quote);
    const totalStr = quote.total.toString();

    // Ensure at most one active OPEN order for this session
    const openOrders = await tx.execute<Record<string, unknown>>(
      sql`SELECT ${sql.raw(ORDER_COLS)} FROM orders WHERE lane_session_id = ${session.id} AND status = 'OPEN' ORDER BY created_at DESC`
    );
    const openRows = openOrders.rows as unknown as OrderRow[];

    let order: OrderRow;
    if (openRows.length > 0) {
      order = openRows[0]!;
      if (openRows.length > 1) {
        const extraIds = openRows.slice(1).map((r) => r.id);
        await tx.execute(sql`UPDATE orders SET status = 'CANCELED', updated_at = NOW() WHERE id IN (${sql.join(extraIds.map(id => sql`${id}::uuid`), sql`, `)})`);
      }
      await tx.execute(sql`UPDATE orders SET total = ${totalStr}, subtotal = ${totalStr}, quote_json = ${quoteJson}::jsonb, updated_at = NOW() WHERE id = ${order.id}`);
    } else {
      const orderResult = await tx.execute<Record<string, unknown>>(
        sql`INSERT INTO orders (lane_session_id, customer_id, status, subtotal, discount, tax, total, quote_json)
            VALUES (${session.id}, ${session.customer_id}, 'OPEN', ${totalStr}, '0', '0', ${totalStr}, ${quoteJson}::jsonb)
            RETURNING ${sql.raw(ORDER_COLS)}`
      );
      order = orderResult.rows[0] as unknown as OrderRow;
    }

    // Map quote items to order line items (idempotent: delete existing first)
    await tx.execute(sql`DELETE FROM order_line_items WHERE order_id = ${order.id}`);
    const lineItemKind = isRenewal ? 'RENEWAL_FEE' : 'CHECKIN_FEE';
    const quoteObj = typeof quote === 'object' && 'lineItems' in quote && Array.isArray((quote as any).lineItems)
      ? (quote as any).lineItems as Array<{ description: string; amount: number }>
      : [];
    if (quoteObj.length > 0) {
      for (const item of quoteObj) {
        const itemTotal = item.amount.toString();
        await tx.execute(sql`INSERT INTO order_line_items (order_id, kind, name, quantity, unit_price, total)
          VALUES (${order.id}, ${lineItemKind}, ${item.description}, 1, ${itemTotal}, ${itemTotal})`);
      }
    } else if (quote.total > 0) {
      await tx.execute(sql`INSERT INTO order_line_items (order_id, kind, name, quantity, unit_price, total)
        VALUES (${order.id}, ${lineItemKind}, ${isRenewal ? 'Renewal fee' : 'Check-in fee'}, 1, ${totalStr}, ${totalStr})`);
    }

    await tx.execute(sql`UPDATE lane_sessions SET order_id = ${order.id}, price_quote_json = ${quoteJson}::jsonb, status = 'AWAITING_PAYMENT', updated_at = NOW() WHERE id = ${session.id}`);

    if (isFlowCommandsEnabled()) {
      const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `pay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await tx.execute(sql`
        INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
        VALUES (${session.id}, ${commandId}, 'EMPLOYEE', 'SET_STEP', ${'{"step":"PAYMENT"}'}::jsonb)
        ON CONFLICT (session_id, command_id) DO NOTHING
      `);
      await tx.execute(sql`UPDATE lane_sessions SET flow_step = 'PAYMENT', flow_version = COALESCE(flow_version, 0) + 1, flow_last_command_id = ${commandId}, flow_last_actor = 'EMPLOYEE', updated_at = NOW() WHERE id = ${session.id}`);
    }

    return { sessionId: session.id, orderId: order.id, amount: toNumber(order.total), quote };
  });
}


export async function createSquarePOSOrder(laneId: string) {
  return db.transaction(async (tx) => {
    const sessionResult = await tx.execute<{ id: string, order_id: string | null, customer_id: string | null, assigned_resource_id: string | null, assigned_resource_type: string | null }>(
      sql`SELECT id, order_id, customer_id, assigned_resource_id, assigned_resource_type FROM lane_sessions WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT') ORDER BY created_at DESC LIMIT 1`
    );
    if (sessionResult.rows.length === 0) throw new HttpError(404, 'No active session found');
    const session = sessionResult.rows[0];

    if (!session.order_id) throw new HttpError(400, 'Session has no active order yet');

    let squareCustomerId: string | null = null;
    let customerName: string | null = null;
    let customerDobStr: string | null = null;
    let membershipNumber: string | null = null;

    if (session.customer_id) {
       const custResult = await tx.execute<{ square_customer_id: string | null, name: string | null, dob: string | null, membership_number: string | null }>(
           sql`SELECT square_customer_id, name, dob, membership_number FROM customers WHERE id = ${session.customer_id}`
       );
       if (custResult.rows.length > 0) {
         squareCustomerId = custResult.rows[0].square_customer_id;
         customerName = custResult.rows[0].name;
         customerDobStr = custResult.rows[0].dob;
         membershipNumber = custResult.rows[0].membership_number;
       }
    }

    let resourceNumber: string | null = null;
    if (session.assigned_resource_id) {
       const res = await tx.execute<{ number: string }>(sql`SELECT number FROM inventory_resources WHERE id = ${session.assigned_resource_id}`);
       resourceNumber = res.rows[0]?.number ?? null;
    }

    const lineItemsResult = await tx.execute<{ name: string, total: string | number }>(
      sql`SELECT name, total FROM order_line_items WHERE order_id = ${session.order_id}`
    );

    if (lineItemsResult.rows.length === 0) throw new HttpError(400, 'Order has no line items');

    const lineItems = lineItemsResult.rows.map((row) => {
        const catalogObjectId = getCatalogIdForLineItem(row.name);

        let noteText: string | undefined = undefined;
        
        // Items requiring detailed notes: Rooms, Lockers, Late Fees, Lost Key Fees
        const requiresNote = row.name.includes('Room') || 
                             row.name.includes('Locker') || 
                             row.name.includes('Fee') || 
                             row.name.includes('Lost Key');
                             
        const isYouth = row.name.includes('Youth');

        if (requiresNote) {
           const noteParts: string[] = [];
           
           if (resourceNumber) {
             const typeStr = session.assigned_resource_type === 'locker' ? 'Locker' : 'Room';
             noteParts.push(`${typeStr} ${resourceNumber}`);
           }
           if (customerName) {
             noteParts.push(customerName);
           }
           if (customerDobStr) {
             noteParts.push(customerDobStr);
           }
           if (membershipNumber && !isYouth) {
             noteParts.push(`Mem: ${membershipNumber}`);
           }
           
           if (noteParts.length > 0) {
             noteText = noteParts.join(' | ');
           }
        }

        return {
           name: row.name,
           amountCents: Math.round(Number(row.total) * 100),
           note: noteText,
           catalogObjectId
        };
    });

    const squareOrderId = await createSquareOrder({
      squareCustomerId,
      lineItems
    });

    if (!squareOrderId) throw new HttpError(500, 'Failed to create Square Order');

    return { squareOrderId, orderId: session.order_id };
  });
}


export interface MarkPaidInput {
  orderId: string;
  staffId: string;
  squareTransactionId?: string;
  paymentMethod?: 'CASH' | 'CREDIT';
  registerNumber?: number;
  tip?: number;
}

export async function markOrderPaid(input: MarkPaidInput) {
  const orderId = input.orderId;
  const resolvedPaymentMethod = input.paymentMethod === 'CASH' || input.paymentMethod === 'CREDIT'
    ? input.paymentMethod
    : input.squareTransactionId ? 'CREDIT' : undefined;
  const resolvedRegisterNumber = typeof input.registerNumber === 'number' && Number.isFinite(input.registerNumber) ? Math.trunc(input.registerNumber) : undefined;
  const resolvedTip = typeof input.tip === 'number' && Number.isFinite(input.tip) ? Math.trunc(input.tip) : undefined;

  return db.transaction(async (tx) => {
    const orderResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT ${sql.raw(ORDER_COLS)} FROM orders WHERE id = ${orderId}`
    );
    if (orderResult.rows.length === 0) throw new HttpError(404, 'Order not found');
    const order = orderResult.rows[0] as unknown as OrderRow & {
      payment_method?: string | null; register_number?: number | null;
      square_transaction_id?: string | null; paid_at?: Date | null;
      lane_session_id?: string | null; tip?: number | null; paid_by_staff_id?: string | null;
    };

    const queryable = tx;

    const resolveOrderContext = async (orderRow: typeof order, quote: { type?: string; waitlistId?: string; visitId?: string; blockId?: string }) => {
      let customerId: string | null = null;
      if (orderRow.lane_session_id) {
        const lsResult = await tx.execute<{ id: string; customer_id: string | null }>(sql`SELECT id, customer_id FROM lane_sessions WHERE id = ${orderRow.lane_session_id}`);
        customerId = lsResult.rows[0]?.customer_id ?? null;
      } else if (quote.type === 'UPGRADE' && quote.waitlistId) {
        const wlc = await tx.execute<{ customer_id: string | null }>(sql`SELECT v.customer_id FROM waitlist w JOIN visits v ON v.id = w.visit_id WHERE w.id = ${quote.waitlistId}`);
        customerId = wlc.rows[0]?.customer_id ?? null;
      } else if (quote.type === 'FINAL_EXTENSION' && quote.visitId) {
        const vc = await tx.execute<{ customer_id: string | null }>(sql`SELECT customer_id FROM visits WHERE id = ${quote.visitId}`);
        customerId = vc.rows[0]?.customer_id ?? null;
      }
      let registerSessionId: string | null = null;
      if (orderRow.register_number) {
        const rs = await tx.execute<{ id: string }>(sql`SELECT id FROM register_sessions WHERE register_number = ${orderRow.register_number} AND (signed_out_at IS NULL OR signed_out_at >= NOW()) ORDER BY created_at DESC LIMIT 1`);
        registerSessionId = rs.rows[0]?.id ?? null;
      }
      return { customerId, registerSessionId };
    };

    const ensureAuditTrail = async (orderRow: typeof order, quote: { type?: string; waitlistId?: string; visitId?: string; blockId?: string }) => {
      const amount = toDollars(orderRow.total);
      const lineItems = buildLineItemsFromQuote(orderRow.quote_json, amount);
      const totals = computeOrderTotals(lineItems.items, amount, orderRow.tip ?? 0);
      const { customerId, registerSessionId } = await resolveOrderContext(orderRow, quote);
      await ensureOrderWithReceipt(queryable, {
        dedupeKey: { field: 'orderId', value: orderRow.id },
        customerId, registerSessionId, createdByStaffId: input.staffId, totals,
        lineItems: lineItems.items,
        metadata: { orderId: orderRow.id, paymentType: quote.type ?? null, paymentMethod: orderRow.payment_method ?? null, registerNumber: orderRow.register_number ?? null },
        tender: { orderId: orderRow.id, paymentMethod: orderRow.payment_method ?? null, amount: amount ?? null, tip: orderRow.tip ?? 0, registerNumber: orderRow.register_number ?? null, providerPaymentId: orderRow.square_transaction_id ?? input.squareTransactionId ?? null },
      });
    };

    if (order.status === 'PAID') {
      if (!order.paid_by_staff_id) {
        await tx.execute(sql`UPDATE orders SET paid_by_staff_id = ${input.staffId} WHERE id = ${order.id} AND paid_by_staff_id IS NULL`);
      }
      const quote = parseOrderQuote(order.quote_json);
      if (input.squareTransactionId || order.square_transaction_id) {
        const extId = input.squareTransactionId || order.square_transaction_id;
        await tx.execute(sql`INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id) VALUES ('square', 'payment', ${order.id}, ${extId}) ON CONFLICT DO NOTHING`);
      }
      await ensureAuditTrail(order, quote);
      return { orderId: order.id, status: 'PAID' as const, alreadyPaid: true, laneSessionToBroadcast: null as null | { sessionId: string; laneId: string } };
    }

    // Mark as paid
    const updatedOrder = await tx.execute<Record<string, unknown>>(
      sql`UPDATE orders SET status = 'PAID', paid_at = NOW(),
       square_transaction_id = COALESCE(${input.squareTransactionId || null}, square_transaction_id),
       payment_method = COALESCE(${resolvedPaymentMethod ?? null}, payment_method),
       register_number = COALESCE(${resolvedRegisterNumber ?? null}, register_number),
       tip = COALESCE(${resolvedTip?.toString() ?? null}, tip),
       paid_by_staff_id = COALESCE(${input.staffId}, paid_by_staff_id),
       updated_at = NOW() WHERE id = ${orderId} RETURNING ${sql.raw(ORDER_COLS)}`
    );
    const paidOrder = updatedOrder.rows[0] as unknown as typeof order;

    if (input.squareTransactionId || paidOrder.square_transaction_id) {
      const extId = input.squareTransactionId || paidOrder.square_transaction_id;
      await tx.execute(sql`INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id) VALUES ('square', 'payment', ${paidOrder.id}, ${extId}) ON CONFLICT DO NOTHING`);
    }

    const quote = parseOrderQuote(paidOrder.quote_json);
    const paymentType = quote.type;

    if (paymentType === 'UPGRADE' && quote.waitlistId) {
      await insertAuditLogDrizzle(tx, { staffId: input.staffId, action: 'UPGRADE_PAID', entityType: 'order', entityId: orderId, oldValue: { status: 'OPEN' }, newValue: { status: 'PAID', waitlistId: quote.waitlistId } });
    } else if (paymentType === 'FINAL_EXTENSION' && quote.visitId && quote.blockId) {
      await insertAuditLogDrizzle(tx, { staffId: input.staffId, action: 'FINAL_EXTENSION_PAID', entityType: 'order', entityId: orderId, oldValue: { status: 'OPEN' }, newValue: { status: 'PAID', visitId: quote.visitId, blockId: quote.blockId } });
      await insertAuditLogDrizzle(tx, { staffId: input.staffId, action: 'FINAL_EXTENSION_COMPLETED', entityType: 'visit', entityId: quote.visitId, oldValue: { orderId, status: 'OPEN' }, newValue: { orderId, status: 'PAID', blockId: quote.blockId } });
    } else {
      const sessionResult = await tx.execute<Record<string, unknown>>(
        sql`SELECT ${sql.raw(LANE_SESSION_COLS)} FROM lane_sessions WHERE order_id = ${paidOrder.id}`
      );
      if (sessionResult.rows.length > 0) {
        const session = sessionResult.rows[0] as unknown as LaneSessionRow;
        await tx.execute(sql`UPDATE lane_sessions SET status = 'AWAITING_SIGNATURE', updated_at = NOW() WHERE id = ${session.id}`);
        await ensureAuditTrail(paidOrder, quote);

        // ── Write spend ledger entries so ChargesTab can show visit charges ──
        if (session.customer_id) {
          const visitRow = await tx.execute<{ visit_id: string }>(
            sql`SELECT visit_id FROM checkin_blocks WHERE session_id = ${session.id} ORDER BY created_at DESC LIMIT 1`
          );
          const visitId = visitRow.rows[0]?.visit_id ?? null;
          const amount = toDollars(paidOrder.total) ?? 0;
          const parsedQuote = parseOrderQuote(paidOrder.quote_json);
          const quoteObj = typeof paidOrder.quote_json === 'string'
            ? JSON.parse(paidOrder.quote_json)
            : paidOrder.quote_json;
          const lineItems: Array<{ description: string; amount: number }> =
            Array.isArray(quoteObj?.lineItems) ? quoteObj.lineItems : [];

          if (lineItems.length > 0) {
            for (const item of lineItems) {
              await insertCustomerSpendLedgerEntryDrizzle(tx, {
                customerId: session.customer_id,
                visitId,
                entryType: 'CHECKIN_CHARGE',
                amount: typeof item.amount === 'number' ? item.amount : 0,
                sourceApp: 'EMPLOYEE_REGISTER',
                actorType: 'STAFF',
                actorStaffId: input.staffId,
                summary: item.description ?? 'Check-in charge',
                dedupeKey: `LEDGER:CHECKIN:${paidOrder.id}:${item.description}`,
              });
            }
          } else if (amount > 0) {
            await insertCustomerSpendLedgerEntryDrizzle(tx, {
              customerId: session.customer_id,
              visitId,
              entryType: 'CHECKIN_CHARGE',
              amount,
              sourceApp: 'EMPLOYEE_REGISTER',
              actorType: 'STAFF',
              actorStaffId: input.staffId,
              summary: `Check-in payment (${parsedQuote.type ?? 'standard'})`,
              dedupeKey: `LEDGER:CHECKIN:${paidOrder.id}`,
            });
          }
        }

        return { orderId: paidOrder.id, status: 'PAID' as const, laneSessionToBroadcast: { sessionId: session.id, laneId: session.lane_id } };
      }
    }

    await ensureAuditTrail(paidOrder, quote);
    return { orderId: paidOrder.id, status: 'PAID' as const, laneSessionToBroadcast: null as null | { sessionId: string; laneId: string } };
  });
}



export async function getSessionPayload(sessionId: string) {
  return buildFullSessionUpdatedPayload(sessionId);
}
