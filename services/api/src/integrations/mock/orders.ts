import type {
  AddLineItemParams,
  CreateOrderParams,
  FinalizeOrderPaidParams,
  OrderLineItemDTO,
  OrderRecord,
  OrdersProvider,
} from '../contracts/providers';
import type { MockOrder, MockStore } from './fixtures';
import { mergeMetadata } from './helpers';

function nextOrderId(store: MockStore): string {
  const next = store.counters.order;
  store.counters.order += 1;
  return `mock-order-${next}`;
}

function computeLineTotals(item: OrderLineItemDTO): {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
} {
  const discount = item.discountCents ?? 0;
  const tax = item.taxCents ?? 0;
  const subtotal = item.quantity * item.unitPriceCents;
  const total = item.totalCents ?? subtotal - discount + tax;
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    taxCents: tax,
    totalCents: total,
  };
}

function recomputeTotals(order: MockOrder): void {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  let total = 0;

  for (const item of order.lineItems) {
    const computed = computeLineTotals(item);
    subtotal += computed.subtotalCents;
    discount += computed.discountCents;
    tax += computed.taxCents;
    total += computed.totalCents;
  }

  order.subtotalCents = subtotal;
  order.discountCents = discount;
  order.taxCents = tax;
  order.totalCents = total + order.tipCents;
}

function toOrderRecord(order: MockOrder): OrderRecord {
  return {
    externalId: order.externalId,
    status: order.status,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    taxCents: order.taxCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
    currency: order.currency,
    createdAt: order.createdAt,
    metadata: order.metadata ?? null,
  };
}

export class MockOrdersProvider implements OrdersProvider {
  constructor(private readonly store: MockStore) {}

  async createOrder(params: CreateOrderParams): Promise<OrderRecord> {
    const created: MockOrder = {
      externalId: nextOrderId(this.store),
      status: 'OPEN',
      subtotalCents: 0,
      discountCents: 0,
      taxCents: 0,
      tipCents: 0,
      totalCents: 0,
      currency: params.currency,
      createdAt: new Date().toISOString(),
      metadata: mergeMetadata(params.metadata ?? null, {
        internalOrderId: params.internalOrderId ?? null,
        customerExternalId: params.customerExternalId ?? null,
      }),
      lineItems: [],
    };

    this.store.orders.push(created);
    return toOrderRecord(created);
  }

  async addLineItem(params: AddLineItemParams): Promise<OrderRecord> {
    const order = this.store.orders.find((item) => item.externalId === params.orderExternalId);
    if (!order) {
      throw new Error('Order not found');
    }

    const nextItem: OrderLineItemDTO = {
      ...params.item,
      discountCents: params.item.discountCents ?? 0,
      taxCents: params.item.taxCents ?? 0,
      totalCents: params.item.totalCents ?? undefined,
    };

    const computed = computeLineTotals(nextItem);
    if (nextItem.totalCents === undefined) {
      nextItem.totalCents = computed.totalCents;
    }

    order.lineItems.push(nextItem);
    recomputeTotals(order);
    return toOrderRecord(order);
  }

  async finalizeOrderPaid(params: FinalizeOrderPaidParams): Promise<OrderRecord> {
    const order = this.store.orders.find((item) => item.externalId === params.orderExternalId);
    if (!order) {
      throw new Error('Order not found');
    }

    order.status = 'PAID';
    order.metadata = mergeMetadata(order.metadata ?? null, {
      paymentExternalId: params.paymentExternalId ?? null,
      paymentFinalizedAt: new Date().toISOString(),
    });
    recomputeTotals(order);
    return toOrderRecord(order);
  }

  async getOrderByExternalId(externalId: string): Promise<OrderRecord | null> {
    const order = this.store.orders.find((item) => item.externalId === externalId);
    return order ? toOrderRecord(order) : null;
  }
}
