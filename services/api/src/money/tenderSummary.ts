import { calcTotals, type OrderTotalsInput } from './calcTotals';
import { parsePriceQuote } from '../checkin/utils';

export interface CloseoutDiscrepancy {
  payment_id?: string;
  codes: string[];
}

export interface TenderSummarySnapshot {
  cash_total_cents: number;
  card_total_cents: number;
  tip_total_cents: number;
  tax_total_cents: number;
  discount_total_cents: number;
  gross_total_cents: number;
  net_total_cents: number;
  discrepancies?: CloseoutDiscrepancy[];
}

export interface TenderPaymentInput {
  id?: string;
  amount: number | string | null;
  tip_cents?: number | null;
  payment_method?: string | null;
  quote_json?: unknown;
  metadata?: Record<string, unknown> | null;
  tip_revision_cents?: number | null;
}

function toCents(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

function orderFromQuote(quoteJson: unknown): OrderTotalsInput | undefined {
  const parsed = parsePriceQuote(quoteJson);
  if (!parsed) return undefined;
  const lineItems = parsed.lineItems
    .map((item) => ({ totalCents: toCents(item.amount) ?? 0 }))
    .filter((item) => item.totalCents !== 0 || parsed.lineItems.length === 1);

  let subtotalCents = lineItems.reduce((sum, item) => sum + item.totalCents, 0);
  const totalCents = toCents(parsed.total);
  if (subtotalCents === 0 && totalCents !== undefined) {
    subtotalCents = totalCents;
  }

  return {
    subtotalCents,
    totalCents,
    lineItems,
  };
}

export function buildTenderSummaryFromPayments(
  payments: TenderPaymentInput[]
): TenderSummarySnapshot {
  const summary: TenderSummarySnapshot = {
    cash_total_cents: 0,
    card_total_cents: 0,
    tip_total_cents: 0,
    tax_total_cents: 0,
    discount_total_cents: 0,
    gross_total_cents: 0,
    net_total_cents: 0,
  };

  const discrepancies: CloseoutDiscrepancy[] = [];

  for (const payment of payments) {
    const order = orderFromQuote(payment.quote_json);
    const baseAmountCents = toCents(payment.amount);
    const tipCents = payment.tip_cents ?? undefined;

    const totals = calcTotals({
      order,
      payment: {
        baseAmountCents,
        tipCents: tipCents ?? undefined,
        tipRevisionCents: payment.tip_revision_cents ?? undefined,
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

    summary.tip_total_cents += totals.tipCents;
    summary.tax_total_cents += totals.taxCents;
    summary.discount_total_cents += totals.discountCents;
    summary.gross_total_cents += totals.subtotalCents + totals.taxCents + totals.tipCents;
    summary.net_total_cents += totals.totalCents;

    if (payment.payment_method === 'CASH') {
      summary.cash_total_cents += totals.totalCents;
    } else if (payment.payment_method === 'CREDIT') {
      summary.card_total_cents += totals.totalCents;
    }
  }

  if (discrepancies.length > 0) {
    summary.discrepancies = discrepancies;
  }

  return summary;
}
