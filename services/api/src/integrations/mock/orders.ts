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
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
} {
  const discount = item.discount ?? 0;
  const tax = item.tax ?? 0;
  const subtotal = item.quantity * item.unitPrice;
  const total = item.total ?? subtotal - discount + tax;
  return {
    subtotal: subtotal,
    discount: discount,
    tax: tax,
    total: total,
  };
}

function recomputeTotals(order: MockOrder): void {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  let total = 0;

  for (const item of order.lineItems) {
    const computed = computeLineTotals(item);
    subtotal += computed.subtotal;
    discount += computed.discount;
    tax += computed.tax;
    total += computed.total;
  }

  order.subtotal = subtotal;
  order.discount = discount;
  order.tax = tax;
  order.total = total + order.tip;
}

function toOrderRecord(order: MockOrder): OrderRecord {
  return {
    externalId: order.externalId,
    status: order.status,
    subtotal: order.subtotal,
    discount: order.discount,
    tax: order.tax,
    tip: order.tip,
    total: order.total,
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
      subtotal: 0,
      discount: 0,
      tax: 0,
      tip: 0,
      total: 0,
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
      discount: params.item.discount ?? 0,
      tax: params.item.tax ?? 0,
      total: params.item.total ?? undefined,
    };

    const computed = computeLineTotals(nextItem);
    if (nextItem.total === undefined) {
      nextItem.total = computed.total;
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
