export interface OrderLineItemInput {
  totalCents?: number;
}

export interface OrderTotalsInput {
  subtotalCents?: number;
  discountCents?: number;
  taxCents?: number;
  tipCents?: number;
  totalCents?: number;
  lineItems?: OrderLineItemInput[];
}

export interface PaymentTotalsInput {
  baseAmountCents?: number;
  totalCents?: number;
  tipCents?: number;
  tipRevisionCents?: number;
  metadata?: Record<string, unknown> | null;
}

export interface CalcTotalsInput {
  order?: OrderTotalsInput | null;
  payment?: PaymentTotalsInput | null;
  expectOrder?: boolean;
  expectPayment?: boolean;
}

export interface TotalsResult {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  discrepancies: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n);
}

function coalesceNumber(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function extractTipFromMetadata(metadata?: Record<string, unknown> | null): number | undefined {
  if (!metadata) return undefined;
  const direct = toInteger(
    metadata['tip_revision_cents'] ??
      metadata['tip_revision_amount_cents'] ??
      metadata['tip_cents'] ??
      metadata['tip_amount_cents']
  );
  if (direct !== undefined) return direct;
  const revision = metadata['tip_revision'];
  if (isRecord(revision)) {
    const revisionTip = toInteger(revision['tip_cents'] ?? revision['tip_amount_cents']);
    if (revisionTip !== undefined) return revisionTip;
  }
  return undefined;
}

function sumLineItems(lineItems?: OrderLineItemInput[]): number | undefined {
  if (!lineItems || lineItems.length === 0) return undefined;
  let sum = 0;
  let hasValue = false;
  for (const item of lineItems) {
    if (item?.totalCents === undefined) continue;
    sum += item.totalCents;
    hasValue = true;
  }
  return hasValue ? sum : undefined;
}

export function calcTotals(input: CalcTotalsInput): TotalsResult {
  const discrepancies: string[] = [];
  const order = input.order ?? undefined;
  const payment = input.payment ?? undefined;

  if (input.expectOrder && !order) {
    discrepancies.push('ORDER_MISSING');
  }

  if (input.expectPayment && !payment) {
    discrepancies.push('PAYMENT_MISSING');
  }

  const discountCents = order?.discountCents ?? 0;
  const taxCents = order?.taxCents ?? 0;

  const tipFromMetadata = extractTipFromMetadata(payment?.metadata ?? undefined);
  const tipCents = Math.max(
    0,
    coalesceNumber(
      payment?.tipRevisionCents,
      tipFromMetadata,
      payment?.tipCents,
      order?.tipCents,
      0
    ) ?? 0
  );

  let subtotalCents = coalesceNumber(order?.subtotalCents, sumLineItems(order?.lineItems));
  if (subtotalCents === undefined && order?.totalCents !== undefined) {
    subtotalCents = order.totalCents - discountCents - taxCents - tipCents;
  }
  if (subtotalCents === undefined && payment?.baseAmountCents !== undefined) {
    subtotalCents = payment.baseAmountCents;
  }
  if (subtotalCents === undefined && payment?.totalCents !== undefined) {
    subtotalCents = payment.totalCents - discountCents - taxCents - tipCents;
  }
  if (subtotalCents === undefined) {
    subtotalCents = 0;
  }

  let totalCents = order?.totalCents;
  if (totalCents === undefined && order) {
    totalCents = subtotalCents - discountCents + taxCents + tipCents;
  }
  if (totalCents === undefined && payment?.totalCents !== undefined) {
    totalCents = payment.totalCents;
  }
  if (totalCents === undefined && payment?.baseAmountCents !== undefined) {
    totalCents = payment.baseAmountCents - discountCents + taxCents + tipCents;
  }
  if (totalCents === undefined) {
    totalCents = subtotalCents - discountCents + taxCents + tipCents;
  }

  if (
    order?.totalCents !== undefined &&
    payment?.totalCents !== undefined &&
    Math.abs(order.totalCents - payment.totalCents) > 1
  ) {
    discrepancies.push('TOTAL_MISMATCH');
  }

  return {
    subtotalCents,
    discountCents,
    taxCents,
    tipCents,
    totalCents,
    discrepancies,
  };
}
