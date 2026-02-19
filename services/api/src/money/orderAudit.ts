export type Queryable = {
  query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export type OrderLineItemKind = 'RETAIL' | 'ADDON' | 'UPGRADE' | 'LATE_FEE' | 'MANUAL';

export type OrderLineItemInput = {
  kind: OrderLineItemKind;
  sku?: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  discountCents?: number | null;
  taxCents?: number | null;
  totalCents?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type OrderTotalsInput = {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  currency: string;
};

export type TenderSnapshot = {
  paymentIntentId?: string | null;
  paymentMethod?: string | null;
  amountCents?: number | null;
  tipCents?: number | null;
  registerNumber?: number | null;
  providerPaymentId?: string | null;
};

export type EnsureOrderInput = {
  dedupeKey: { field: string; value: string };
  customerId?: string | null;
  registerSessionId?: string | null;
  createdByStaffId?: string | null;
  currency?: string | null;
  totals: OrderTotalsInput;
  lineItems: OrderLineItemInput[];
  metadata?: Record<string, unknown> | null;
  tender?: TenderSnapshot | null;
};

type OrderRow = {
  id: string;
  customer_id: string | null;
  register_session_id: string | null;
  created_by_staff_id: string | null;
  created_at: Date;
  status: string;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  currency: string;
  metadata_json: unknown | null;
};

type ReceiptRow = {
  id: string;
  receipt_number: string;
  issued_at: Date;
  receipt_json: unknown;
};

type OrderLineItemRow = {
  id: string;
  order_id: string;
  kind: string;
  sku: string | null;
  name: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  metadata_json: unknown | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function toCents(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

function normalizeKind(value: unknown): OrderLineItemKind | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.toUpperCase();
  if (upper === 'RETAIL') return 'RETAIL';
  if (upper === 'ADDON') return 'ADDON';
  if (upper === 'UPGRADE') return 'UPGRADE';
  if (upper === 'LATE_FEE') return 'LATE_FEE';
  if (upper === 'MANUAL') return 'MANUAL';
  return undefined;
}

export function buildReceiptNumber(order: { id: string; created_at: Date }): string {
  const date = order.created_at.toISOString().slice(0, 10).replace(/-/g, '');
  return `R-${date}-${order.id}`;
}

function parseQuote(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  let parsed: unknown = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return isRecord(parsed) ? parsed : null;
}

export function buildLineItemsFromQuote(
  quoteJson: unknown,
  fallbackAmountCents?: number
): { items: OrderLineItemInput[]; quoteType?: string } {
  const parsed = parseQuote(quoteJson);
  const quoteType = typeof parsed?.type === 'string' ? parsed.type : undefined;

  const amountFromQuote =
    toCents(toNumber(parsed?.amount) ?? undefined) ?? fallbackAmountCents ?? 0;

  if (quoteType === 'UPGRADE') {
    const fromTier = typeof parsed?.fromTier === 'string' ? parsed.fromTier : undefined;
    const toTier = typeof parsed?.toTier === 'string' ? parsed.toTier : undefined;
    const name = fromTier && toTier ? `Upgrade (${fromTier} -> ${toTier})` : 'Upgrade Fee';
    return {
      quoteType,
      items: [
        {
          kind: 'UPGRADE',
          name,
          quantity: 1,
          unitPriceCents: amountFromQuote,
          totalCents: amountFromQuote,
        },
      ],
    };
  }

  if (quoteType === 'FINAL_EXTENSION') {
    const hours = toNumber(parsed?.hours);
    const label = hours ? `Final Extension (${hours}h)` : 'Final Extension';
    return {
      quoteType,
      items: [
        {
          kind: 'MANUAL',
          name: label,
          quantity: 1,
          unitPriceCents: amountFromQuote,
          totalCents: amountFromQuote,
        },
      ],
    };
  }

  if (quoteType === 'LATE_FEE') {
    return {
      quoteType,
      items: [
        {
          kind: 'LATE_FEE',
          name: 'Late Fee',
          quantity: 1,
          unitPriceCents: amountFromQuote,
          totalCents: amountFromQuote,
        },
      ],
    };
  }

  if (quoteType === 'MANUAL') {
    const description =
      typeof parsed?.description === 'string' ? parsed.description : 'Manual Charge';
    return {
      quoteType,
      items: [
        {
          kind: 'MANUAL',
          name: description,
          quantity: 1,
          unitPriceCents: amountFromQuote,
          totalCents: amountFromQuote,
        },
      ],
    };
  }

  const lineItemsRaw = parsed?.lineItems;
  const items: OrderLineItemInput[] = [];
  if (Array.isArray(lineItemsRaw)) {
    for (const rawItem of lineItemsRaw) {
      if (!isRecord(rawItem)) continue;
      const description = rawItem.description;
      const amount = toNumber(rawItem.amount);
      if (typeof description !== 'string' || amount === undefined) continue;
      const amountCents = toCents(amount) ?? 0;
      const quantity = toNumber(rawItem.quantity) ?? 1;
      const unitPrice = toNumber(rawItem.unitPrice) ?? amount;
      const unitPriceCents = toCents(unitPrice) ?? amountCents;
      const kind = normalizeKind(rawItem.kind) ?? 'RETAIL';
      const sku = typeof rawItem.sku === 'string' ? rawItem.sku : null;
      items.push({
        kind,
        sku,
        name: description,
        quantity,
        unitPriceCents,
        totalCents: amountCents,
        discountCents: 0,
        taxCents: 0,
      });
    }
  }

  if (items.length === 0 && amountFromQuote > 0) {
    items.push({
      kind: 'MANUAL',
      name: 'Payment',
      quantity: 1,
      unitPriceCents: amountFromQuote,
      totalCents: amountFromQuote,
    });
  }

  return { items, quoteType };
}

export function computeOrderTotals(
  lineItems: OrderLineItemInput[],
  amountCents: number | undefined,
  tipCents: number
): OrderTotalsInput {
  const subtotalFromItems = lineItems.reduce((sum, item) => sum + (item.totalCents ?? 0), 0);
  const subtotalCents = subtotalFromItems > 0 ? subtotalFromItems : (amountCents ?? 0);
  const baseTotal = amountCents ?? subtotalCents;
  const totalCents = baseTotal + tipCents;

  return {
    subtotalCents,
    discountCents: 0,
    taxCents: 0,
    tipCents,
    totalCents,
    currency: 'USD',
  };
}

export async function ensureOrderWithReceipt(
  client: Queryable,
  input: EnsureOrderInput
): Promise<{ order: OrderRow; receipt?: ReceiptRow | null }> {
  const existingOrder = await client.query<OrderRow>(
    `SELECT * FROM orders WHERE metadata_json->>$1 = $2 LIMIT 1`,
    [input.dedupeKey.field, input.dedupeKey.value]
  );

  let order: OrderRow;
  if (existingOrder.rows.length > 0) {
    order = existingOrder.rows[0]!;
  } else {
    const metadata = {
      ...(input.metadata ?? {}),
      [input.dedupeKey.field]: input.dedupeKey.value,
      tender: input.tender ?? undefined,
    };

    const orderInsert = await client.query<OrderRow>(
      `INSERT INTO orders
       (customer_id, register_session_id, created_by_staff_id, status,
        subtotal_cents, discount_cents, tax_cents, tip_cents, total_cents, currency, metadata_json)
       VALUES ($1, $2, $3, 'PAID', $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        input.customerId ?? null,
        input.registerSessionId ?? null,
        input.createdByStaffId ?? null,
        input.totals.subtotalCents,
        input.totals.discountCents,
        input.totals.taxCents,
        input.totals.tipCents,
        input.totals.totalCents,
        input.currency ?? input.totals.currency,
        metadata,
      ]
    );

    order = orderInsert.rows[0]!;

    for (const item of input.lineItems) {
      await client.query(
        `INSERT INTO order_line_items
         (order_id, kind, sku, name, quantity, unit_price_cents, discount_cents, tax_cents, total_cents, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          order.id,
          item.kind,
          item.sku ?? null,
          item.name,
          item.quantity,
          item.unitPriceCents,
          item.discountCents ?? 0,
          item.taxCents ?? 0,
          item.totalCents ?? item.unitPriceCents * item.quantity,
          item.metadata ?? null,
        ]
      );
    }
  }

  const existingReceipt = await client.query<ReceiptRow>(
    `SELECT id, receipt_number, issued_at, receipt_json FROM receipts WHERE order_id = $1 LIMIT 1`,
    [order.id]
  );
  if (existingReceipt.rows.length > 0) {
    return { order, receipt: existingReceipt.rows[0]! };
  }

  const lineItems = await client.query<OrderLineItemRow>(
    `SELECT * FROM order_line_items WHERE order_id = $1`,
    [order.id]
  );

  const receiptNumber = buildReceiptNumber(order);
  const receiptJson = {
    receiptNumber,
    orderId: order.id,
    issuedAt: new Date().toISOString(),
    currency: order.currency,
    totals: {
      subtotalCents: order.subtotal_cents,
      discountCents: order.discount_cents,
      taxCents: order.tax_cents,
      tipCents: order.tip_cents,
      totalCents: order.total_cents,
    },
    tender: input.tender ?? null,
    lineItems: lineItems.rows.map((item) => ({
      id: item.id,
      kind: item.kind,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
      discountCents: item.discount_cents,
      taxCents: item.tax_cents,
      totalCents: item.total_cents,
    })),
  };

  const receiptInsert = await client.query<ReceiptRow>(
    `INSERT INTO receipts (order_id, receipt_number, receipt_json)
     VALUES ($1, $2, $3)
     RETURNING id, receipt_number, issued_at, receipt_json`,
    [order.id, receiptNumber, receiptJson]
  );

  return { order, receipt: receiptInsert.rows[0]! };
}
