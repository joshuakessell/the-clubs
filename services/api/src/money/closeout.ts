export type Queryable = {
  query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export type CashDrawerSessionSnapshot = {
  drawerSessionId: string;
  registerSessionId: string;
  openedAt: string;
  closeoutAt: string;
  openingFloat: number;
  expectedCash: number;
  eventTotals: {
    paidIn: number;
    paidOut: number;
    drop: number;
    adjustment: number;
    noSaleCount: number;
  };
  tenderSummary: {
    cashTotal: number;
    cardTotal: number;
    tipTotal: number;
    taxTotal: number;
    discountTotal: number;
    grossTotal: number;
    netTotal: number;
    orderCount: number;
  };
  refundsSummary: {
    refundedCount: number;
    refundedTotal: number;
    partialRefundCount: number;
    partialRefundTotal: number;
    voidCount: number;
    voidTotal: number;
  };
};

export type CashDrawerSessionRow = {
  id: string;
  register_session_id: string;
  opened_at: Date;
  opening_float: number;
};

function toInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export async function buildCloseoutSnapshot(
  client: Queryable,
  session: CashDrawerSessionRow,
  closeoutAt: Date
): Promise<CashDrawerSessionSnapshot> {
  const eventTotals = await client.query<{
    paid_in: number | string | null;
    paid_out: number | string | null;
    drop_amount: number | string | null;
    adjustment: number | string | null;
    no_sale_count: number | string | null;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'PAID_IN' THEN amount ELSE 0 END), 0) AS paid_in,
       COALESCE(SUM(CASE WHEN type = 'PAID_OUT' THEN amount ELSE 0 END), 0) AS paid_out,
       COALESCE(SUM(CASE WHEN type = 'DROP' THEN amount ELSE 0 END), 0) AS drop_amount,
       COALESCE(SUM(CASE WHEN type = 'ADJUSTMENT' THEN amount ELSE 0 END), 0) AS adjustment,
       COALESCE(COUNT(*) FILTER (WHERE type = 'NO_SALE_OPEN'), 0) AS no_sale_count
     FROM cash_drawer_events
     WHERE cash_drawer_session_id = $1`,
    [session.id]
  );

  const tenderTotals = await client.query<{
    cash_total: number | string | null;
    card_total: number | string | null;
    tip_total: number | string | null;
    tax_total: number | string | null;
    discount_total: number | string | null;
    gross_total: number | string | null;
    net_total: number | string | null;
    order_count: number | string | null;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN (metadata_json->'tender'->>'paymentMethod') = 'CASH' THEN total ELSE 0 END), 0)
         AS cash_total,
       COALESCE(SUM(CASE WHEN (metadata_json->'tender'->>'paymentMethod') = 'CREDIT' THEN total ELSE 0 END), 0)
         AS card_total,
       COALESCE(SUM(tip), 0) AS tip_total,
       COALESCE(SUM(tax), 0) AS tax_total,
       COALESCE(SUM(discount), 0) AS discount_total,
       COALESCE(SUM(subtotal + tax + tip), 0) AS gross_total,
       COALESCE(SUM(total), 0) AS net_total,
       COALESCE(COUNT(*), 0) AS order_count
     FROM orders
     WHERE register_session_id = $1
       AND created_at >= $2
       AND created_at <= $3`,
    [session.register_session_id, session.opened_at, closeoutAt]
  );

  const refundTotals = await client.query<{
    refunded_count: number | string | null;
    refunded_total: number | string | null;
    partial_refund_count: number | string | null;
    partial_refund_total: number | string | null;
    void_count: number | string | null;
    void_total: number | string | null;
  }>(
    `SELECT
       COALESCE(COUNT(*) FILTER (WHERE status = 'REFUNDED'), 0) AS refunded_count,
       COALESCE(SUM(total) FILTER (WHERE status = 'REFUNDED'), 0) AS refunded_total,
       COALESCE(COUNT(*) FILTER (WHERE status = 'PARTIALLY_REFUNDED'), 0) AS partial_refund_count,
       COALESCE(SUM(total) FILTER (WHERE status = 'PARTIALLY_REFUNDED'), 0) AS partial_refund_total,
       COALESCE(COUNT(*) FILTER (WHERE status = 'CANCELED'), 0) AS void_count,
       COALESCE(SUM(total) FILTER (WHERE status = 'CANCELED'), 0) AS void_total
     FROM orders
     WHERE register_session_id = $1
       AND created_at >= $2
       AND created_at <= $3`,
    [session.register_session_id, session.opened_at, closeoutAt]
  );

  const events = eventTotals.rows[0] ?? {
    paid_in: 0,
    paid_out: 0,
    drop_amount: 0,
    adjustment: 0,
    no_sale_count: 0,
  };
  const tender = tenderTotals.rows[0] ?? {
    cash_total: 0,
    card_total: 0,
    tip_total: 0,
    tax_total: 0,
    discount_total: 0,
    gross_total: 0,
    net_total: 0,
    order_count: 0,
  };
  const refunds = refundTotals.rows[0] ?? {
    refunded_count: 0,
    refunded_total: 0,
    partial_refund_count: 0,
    partial_refund_total: 0,
    void_count: 0,
    void_total: 0,
  };

  const expectedCash =
    session.opening_float +
    toInt(events.paid_in) -
    toInt(events.paid_out) -
    toInt(events.drop_amount) +
    toInt(events.adjustment) +
    toInt(tender.cash_total);

  return {
    drawerSessionId: session.id,
    registerSessionId: session.register_session_id,
    openedAt: session.opened_at.toISOString(),
    closeoutAt: closeoutAt.toISOString(),
    openingFloat: session.opening_float,
    expectedCash,
    eventTotals: {
      paidIn: toInt(events.paid_in),
      paidOut: toInt(events.paid_out),
      drop: toInt(events.drop_amount),
      adjustment: toInt(events.adjustment),
      noSaleCount: toInt(events.no_sale_count),
    },
    tenderSummary: {
      cashTotal: toInt(tender.cash_total),
      cardTotal: toInt(tender.card_total),
      tipTotal: toInt(tender.tip_total),
      taxTotal: toInt(tender.tax_total),
      discountTotal: toInt(tender.discount_total),
      grossTotal: toInt(tender.gross_total),
      netTotal: toInt(tender.net_total),
      orderCount: toInt(tender.order_count),
    },
    refundsSummary: {
      refundedCount: toInt(refunds.refunded_count),
      refundedTotal: toInt(refunds.refunded_total),
      partialRefundCount: toInt(refunds.partial_refund_count),
      partialRefundTotal: toInt(refunds.partial_refund_total),
      voidCount: toInt(refunds.void_count),
      voidTotal: toInt(refunds.void_total),
    },
  };
}
