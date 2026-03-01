import { calcTotals, type OrderTotalsInput } from './calcTotals';
import { parsePriceQuote } from '../checkin/utils';

export interface CloseoutDiscrepancy {
  payment_id?: string;
  codes: string[];
}

export interface TenderSummarySnapshot {
  cash_total: number;
  card_total: number;
  tip_total: number;
  tax_total: number;
  discount_total: number;
  gross_total: number;
  net_total: number;
  discrepancies?: CloseoutDiscrepancy[];
}

export interface TenderPaymentInput {
  id?: string;
  amount: number | string | null;
  tip?: number | null;
  payment_method?: string | null;
  quote_json?: unknown;
  metadata?: Record<string, unknown> | null;
  tip_revision?: number | null;
}

function toDollars(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n);
}

function orderFromQuote(quoteJson: unknown): OrderTotalsInput | undefined {
  const parsed = parsePriceQuote(quoteJson);
  if (!parsed) return undefined;
  const lineItems = parsed.lineItems
    .map((item) => ({ total: toDollars(item.amount) ?? 0 }))
    .filter((item) => item.total !== 0 || parsed.lineItems.length === 1);

  let subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const total = toDollars(parsed.total);
  if (subtotal === 0 && total !== undefined) {
    subtotal = total;
  }

  return {
    subtotal,
    total,
    lineItems,
  };
}

export function buildTenderSummaryFromPayments(
  payments: TenderPaymentInput[]
): TenderSummarySnapshot {
  const summary: TenderSummarySnapshot = {
    cash_total: 0,
    card_total: 0,
    tip_total: 0,
    tax_total: 0,
    discount_total: 0,
    gross_total: 0,
    net_total: 0,
  };

  const discrepancies: CloseoutDiscrepancy[] = [];

  for (const payment of payments) {
    const order = orderFromQuote(payment.quote_json);
    const baseAmount = toDollars(payment.amount);
    const tip = payment.tip ?? undefined;

    const totals = calcTotals({
      order,
      payment: {
        baseAmount,
        tip: tip ?? undefined,
        tipRevision: payment.tip_revision ?? undefined,
        metadata: payment.metadata ?? undefined,
      },
      expectOrder: !!payment.quote_json,
      expectPayment: true,
    });

    if (totals.discrepancies.length > 0) {
      discrepancies.push({
        payment_id: payment.id,
        codes: totals.discrepancies,
      });
    }

    summary.tip_total += totals.tip;
    summary.tax_total += totals.tax;
    summary.discount_total += totals.discount;
    summary.gross_total += totals.subtotal + totals.tax + totals.tip;
    summary.net_total += totals.total;

    if (payment.payment_method === 'CASH') {
      summary.cash_total += totals.total;
    } else if (payment.payment_method === 'CREDIT') {
      summary.card_total += totals.total;
    }
  }

  if (discrepancies.length > 0) {
    summary.discrepancies = discrepancies;
  }

  return summary;
}
