export type Queryable = {
  query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export type CashDrawerSessionSnapshot = {
  drawerSessionId: string;
  registerSessionId: string;
  openedAt: string;
  closeoutAt: string;
  openingFloatCents: number;
  expectedCashCents: number;
  eventTotals: {
    paidInCents: number;
    paidOutCents: number;
    dropCents: number;
    adjustmentCents: number;
    noSaleCount: number;
  };
  tenderSummary: {
    cashTotalCents: number;
    cardTotalCents: number;
    tipTotalCents: number;
    taxTotalCents: number;
    discountTotalCents: number;
    grossTotalCents: number;
    netTotalCents: number;
    orderCount: number;
  };
  refundsSummary: {
    refundedCount: number;
    refundedTotalCents: number;
    partialRefundCount: number;
    partialRefundTotalCents: number;
    voidCount: number;
    voidTotalCents: number;
  };
};

export type CashDrawerSessionRow = {
  id: string;
  register_session_id: string;
  opened_at: Date;
  opening_float_cents: number;
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
    paid_in_cents: number | string | null;
    paid_out_cents: number | string | null;
    drop_cents: number | string | null;
    adjustment_cents: number | string | null;
    no_sale_count: number | string | null;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'PAID_IN' THEN amount_cents ELSE 0 END), 0) AS paid_in_cents,
       COALESCE(SUM(CASE WHEN type = 'PAID_OUT' THEN amount_cents ELSE 0 END), 0) AS paid_out_cents,
       COALESCE(SUM(CASE WHEN type = 'DROP' THEN amount_cents ELSE 0 END), 0) AS drop_cents,
       COALESCE(SUM(CASE WHEN type = 'ADJUSTMENT' THEN amount_cents ELSE 0 END), 0) AS adjustment_cents,
       COALESCE(COUNT(*) FILTER (WHERE type = 'NO_SALE_OPEN'), 0) AS no_sale_count
     FROM cash_drawer_events
     WHERE cash_drawer_session_id = $1`,
    [session.id]
  );

  const tenderTotals = await client.query<{
    cash_total_cents: number | string | null;
    card_total_cents: number | string | null;
    tip_total_cents: number | string | null;
    tax_total_cents: number | string | null;
    discount_total_cents: number | string | null;
    gross_total_cents: number | string | null;
    net_total_cents: number | string | null;
    order_count: number | string | null;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN (metadata_json->'tender'->>'paymentMethod') = 'CASH' THEN total_cents ELSE 0 END), 0)
         AS cash_total_cents,
       COALESCE(SUM(CASE WHEN (metadata_json->'tender'->>'paymentMethod') = 'CREDIT' THEN total_cents ELSE 0 END), 0)
         AS card_total_cents,
       COALESCE(SUM(tip_cents), 0) AS tip_total_cents,
       COALESCE(SUM(tax_cents), 0) AS tax_total_cents,
       COALESCE(SUM(discount_cents), 0) AS discount_total_cents,
       COALESCE(SUM(subtotal_cents + tax_cents + tip_cents), 0) AS gross_total_cents,
       COALESCE(SUM(total_cents), 0) AS net_total_cents,
       COALESCE(COUNT(*), 0) AS order_count
     FROM orders
     WHERE register_session_id = $1
       AND created_at >= $2
       AND created_at <= $3`,
    [session.register_session_id, session.opened_at, closeoutAt]
  );

  const refundTotals = await client.query<{
    refunded_count: number | string | null;
    refunded_total_cents: number | string | null;
    partial_refund_count: number | string | null;
    partial_refund_total_cents: number | string | null;
    void_count: number | string | null;
    void_total_cents: number | string | null;
  }>(
    `SELECT
       COALESCE(COUNT(*) FILTER (WHERE status = 'REFUNDED'), 0) AS refunded_count,
       COALESCE(SUM(total_cents) FILTER (WHERE status = 'REFUNDED'), 0) AS refunded_total_cents,
       COALESCE(COUNT(*) FILTER (WHERE status = 'PARTIALLY_REFUNDED'), 0) AS partial_refund_count,
       COALESCE(SUM(total_cents) FILTER (WHERE status = 'PARTIALLY_REFUNDED'), 0) AS partial_refund_total_cents,
       COALESCE(COUNT(*) FILTER (WHERE status = 'CANCELED'), 0) AS void_count,
       COALESCE(SUM(total_cents) FILTER (WHERE status = 'CANCELED'), 0) AS void_total_cents
     FROM orders
     WHERE register_session_id = $1
       AND created_at >= $2
       AND created_at <= $3`,
    [session.register_session_id, session.opened_at, closeoutAt]
  );

  const events = eventTotals.rows[0] ?? {
    paid_in_cents: 0,
    paid_out_cents: 0,
    drop_cents: 0,
    adjustment_cents: 0,
    no_sale_count: 0,
  };
  const tender = tenderTotals.rows[0] ?? {
    cash_total_cents: 0,
    card_total_cents: 0,
    tip_total_cents: 0,
    tax_total_cents: 0,
    discount_total_cents: 0,
    gross_total_cents: 0,
    net_total_cents: 0,
    order_count: 0,
  };
  const refunds = refundTotals.rows[0] ?? {
    refunded_count: 0,
    refunded_total_cents: 0,
    partial_refund_count: 0,
    partial_refund_total_cents: 0,
    void_count: 0,
    void_total_cents: 0,
  };

  const expectedCashCents =
    session.opening_float_cents +
    toInt(events.paid_in_cents) -
    toInt(events.paid_out_cents) -
    toInt(events.drop_cents) +
    toInt(events.adjustment_cents) +
    toInt(tender.cash_total_cents);

  return {
    drawerSessionId: session.id,
    registerSessionId: session.register_session_id,
    openedAt: session.opened_at.toISOString(),
    closeoutAt: closeoutAt.toISOString(),
    openingFloatCents: session.opening_float_cents,
    expectedCashCents,
    eventTotals: {
      paidInCents: toInt(events.paid_in_cents),
      paidOutCents: toInt(events.paid_out_cents),
      dropCents: toInt(events.drop_cents),
      adjustmentCents: toInt(events.adjustment_cents),
      noSaleCount: toInt(events.no_sale_count),
    },
    tenderSummary: {
      cashTotalCents: toInt(tender.cash_total_cents),
      cardTotalCents: toInt(tender.card_total_cents),
      tipTotalCents: toInt(tender.tip_total_cents),
      taxTotalCents: toInt(tender.tax_total_cents),
      discountTotalCents: toInt(tender.discount_total_cents),
      grossTotalCents: toInt(tender.gross_total_cents),
      netTotalCents: toInt(tender.net_total_cents),
      orderCount: toInt(tender.order_count),
    },
    refundsSummary: {
      refundedCount: toInt(refunds.refunded_count),
      refundedTotalCents: toInt(refunds.refunded_total_cents),
      partialRefundCount: toInt(refunds.partial_refund_count),
      partialRefundTotalCents: toInt(refunds.partial_refund_total_cents),
      voidCount: toInt(refunds.void_count),
      voidTotalCents: toInt(refunds.void_total_cents),
    },
  };
}
