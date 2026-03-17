import { describe, it, expect } from 'vitest';
import { buildCloseoutSnapshot, type Queryable, type CashDrawerSessionRow } from '../src/money/closeout';

// ── toInt is private, but we can test it indirectly through buildCloseoutSnapshot ──

function makeSession(overrides: Partial<CashDrawerSessionRow> = {}): CashDrawerSessionRow {
  return {
    id: 'drawer-1',
    register_session_id: 'reg-1',
    opened_at: new Date('2024-07-15T08:00:00Z'),
    opening_float: 200,
    ...overrides,
  };
}

type MockRow = Record<string, number | string | null>;

function makeMockClient(
  events: MockRow = {},
  tender: MockRow = {},
  refunds: MockRow = {},
): Queryable {
  let callCount = 0;
  return {
    async query<T>(_queryText: string, _params?: unknown[]): Promise<{ rows: T[] }> {
      callCount++;
      if (callCount === 1) {
        return {
          rows: [{
            paid_in: events.paid_in ?? 0,
            paid_out: events.paid_out ?? 0,
            drop_amount: events.drop_amount ?? 0,
            adjustment: events.adjustment ?? 0,
            no_sale_count: events.no_sale_count ?? 0,
          }],
        } as { rows: T[] };
      }
      if (callCount === 2) {
        return {
          rows: [{
            cash_total: tender.cash_total ?? 0,
            card_total: tender.card_total ?? 0,
            tip_total: tender.tip_total ?? 0,
            tax_total: tender.tax_total ?? 0,
            discount_total: tender.discount_total ?? 0,
            gross_total: tender.gross_total ?? 0,
            net_total: tender.net_total ?? 0,
            order_count: tender.order_count ?? 0,
          }],
        } as { rows: T[] };
      }
      // callCount === 3: refunds
      return {
        rows: [{
          refunded_count: refunds.refunded_count ?? 0,
          refunded_total: refunds.refunded_total ?? 0,
          partial_refund_count: refunds.partial_refund_count ?? 0,
          partial_refund_total: refunds.partial_refund_total ?? 0,
          void_count: refunds.void_count ?? 0,
          void_total: refunds.void_total ?? 0,
        }],
      } as { rows: T[] };
    },
  };
}

describe('buildCloseoutSnapshot', () => {
  it('builds a complete snapshot with all zeros', async () => {
    const client = makeMockClient();
    const session = makeSession();
    const closeoutAt = new Date('2024-07-15T22:00:00Z');

    const result = await buildCloseoutSnapshot(client, session, closeoutAt);

    expect(result.drawerSessionId).toBe('drawer-1');
    expect(result.registerSessionId).toBe('reg-1');
    expect(result.openedAt).toBe('2024-07-15T08:00:00.000Z');
    expect(result.closeoutAt).toBe('2024-07-15T22:00:00.000Z');
    expect(result.openingFloat).toBe(200);
    expect(result.expectedCash).toBe(200); // openingFloat + 0s
  });

  it('calculates expectedCash correctly', async () => {
    const client = makeMockClient(
      { paid_in: 50, paid_out: 10, drop_amount: 20, adjustment: 5 },
      { cash_total: 100 },
    );
    const session = makeSession({ opening_float: 200 });
    const closeoutAt = new Date('2024-07-15T22:00:00Z');

    const result = await buildCloseoutSnapshot(client, session, closeoutAt);

    // 200 + 50 - 10 - 20 + 5 + 100 = 325
    expect(result.expectedCash).toBe(325);
  });

  it('maps event totals correctly', async () => {
    const client = makeMockClient(
      { paid_in: 100, paid_out: 25, drop_amount: 50, adjustment: 10, no_sale_count: 3 },
    );
    const session = makeSession();
    const closeoutAt = new Date();

    const result = await buildCloseoutSnapshot(client, session, closeoutAt);

    expect(result.eventTotals.paidIn).toBe(100);
    expect(result.eventTotals.paidOut).toBe(25);
    expect(result.eventTotals.drop).toBe(50);
    expect(result.eventTotals.adjustment).toBe(10);
    expect(result.eventTotals.noSaleCount).toBe(3);
  });

  it('maps tender summary correctly', async () => {
    const client = makeMockClient(
      {},
      { cash_total: 500, card_total: 300, tip_total: 50, tax_total: 30, discount_total: 20, gross_total: 800, net_total: 780, order_count: 15 },
    );
    const session = makeSession();
    const closeoutAt = new Date();

    const result = await buildCloseoutSnapshot(client, session, closeoutAt);

    expect(result.tenderSummary.cashTotal).toBe(500);
    expect(result.tenderSummary.cardTotal).toBe(300);
    expect(result.tenderSummary.tipTotal).toBe(50);
    expect(result.tenderSummary.taxTotal).toBe(30);
    expect(result.tenderSummary.discountTotal).toBe(20);
    expect(result.tenderSummary.grossTotal).toBe(800);
    expect(result.tenderSummary.netTotal).toBe(780);
    expect(result.tenderSummary.orderCount).toBe(15);
  });

  it('maps refund summary correctly', async () => {
    const client = makeMockClient(
      {},
      {},
      { refunded_count: 2, refunded_total: 40, partial_refund_count: 1, partial_refund_total: 15, void_count: 3, void_total: 60 },
    );
    const session = makeSession();
    const closeoutAt = new Date();

    const result = await buildCloseoutSnapshot(client, session, closeoutAt);

    expect(result.refundsSummary.refundedCount).toBe(2);
    expect(result.refundsSummary.refundedTotal).toBe(40);
    expect(result.refundsSummary.partialRefundCount).toBe(1);
    expect(result.refundsSummary.partialRefundTotal).toBe(15);
    expect(result.refundsSummary.voidCount).toBe(3);
    expect(result.refundsSummary.voidTotal).toBe(60);
  });

  it('handles string values from DB (toInt coercion)', async () => {
    const client = makeMockClient(
      { paid_in: '100', paid_out: '25' },
      { cash_total: '500' },
    );
    const session = makeSession({ opening_float: 200 });
    const closeoutAt = new Date();

    const result = await buildCloseoutSnapshot(client, session, closeoutAt);

    expect(result.eventTotals.paidIn).toBe(100);
    expect(result.eventTotals.paidOut).toBe(25);
    expect(result.tenderSummary.cashTotal).toBe(500);
    // 200 + 100 - 25 - 0 + 0 + 500 = 775
    expect(result.expectedCash).toBe(775);
  });

  it('handles null query results (falls back to defaults)', async () => {
    // Query returns empty rows — tests the ?? fallback
    const client: Queryable = {
      async query() {
        return { rows: [] };
      },
    };
    const session = makeSession({ opening_float: 100 });
    const closeoutAt = new Date();

    const result = await buildCloseoutSnapshot(client, session, closeoutAt);

    expect(result.expectedCash).toBe(100); // just openingFloat
    expect(result.eventTotals.paidIn).toBe(0);
    expect(result.tenderSummary.cashTotal).toBe(0);
    expect(result.refundsSummary.refundedCount).toBe(0);
  });
});
