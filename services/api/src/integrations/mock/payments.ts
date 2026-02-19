import type {
  CreateCardPaymentParams,
  PaymentFilters,
  PaymentRecord,
  PaymentsProvider,
  RecordCashPaymentParams,
  RefundParams,
} from '../contracts/providers';
import type { MockStore } from './fixtures';
import { getMetadataString, isWithinRange, mergeMetadata } from './helpers';

function nextPaymentId(store: MockStore, prefix: 'mock-pay' | 'mock-refund'): string {
  if (prefix === 'mock-pay') {
    const next = store.counters.payment;
    store.counters.payment += 1;
    return `${prefix}-${next}`;
  }
  const next = store.counters.refund;
  store.counters.refund += 1;
  return `${prefix}-${next}`;
}

function extractSource(
  metadata?: Record<string, unknown> | null
): 'CARD' | 'CASH' | 'OTHER' | undefined {
  const value = getMetadataString(metadata, 'source');
  if (value === 'CARD' || value === 'CASH' || value === 'OTHER') return value;
  return undefined;
}

function matchesFilters(payment: PaymentRecord, filters?: PaymentFilters): boolean {
  if (!filters) return true;
  if (filters.status && payment.status !== filters.status) return false;

  const metadata = payment.metadata ?? null;
  const customerExternalId = getMetadataString(metadata, 'customerExternalId');
  const orderExternalId = getMetadataString(metadata, 'orderExternalId');
  const source = extractSource(metadata);

  if (filters.customerExternalId && filters.customerExternalId !== customerExternalId) return false;
  if (filters.orderExternalId && filters.orderExternalId !== orderExternalId) return false;
  if (filters.source && filters.source !== source) return false;

  return true;
}

function createPaymentRecord(
  params: CreateCardPaymentParams | RecordCashPaymentParams,
  store: MockStore,
  source: 'CARD' | 'CASH'
): PaymentRecord {
  return {
    provider: 'mock',
    externalId: nextPaymentId(store, 'mock-pay'),
    status: 'PAID',
    amount: params.amount,
    tipAmount: null,
    taxAmount: null,
    createdAt: new Date().toISOString(),
    metadata: mergeMetadata(params.metadata ?? null, {
      source,
      orderExternalId: params.orderExternalId ?? null,
      customerExternalId: params.customerExternalId ?? null,
    }),
  };
}

export class MockPaymentsProvider implements PaymentsProvider {
  constructor(private readonly store: MockStore) {}

  async createCardPayment(params: CreateCardPaymentParams): Promise<PaymentRecord> {
    const record = createPaymentRecord(params, this.store, 'CARD');
    this.store.payments.push(record);
    return record;
  }

  async recordCashPayment(params: RecordCashPaymentParams): Promise<PaymentRecord> {
    const record = createPaymentRecord(params, this.store, 'CASH');
    this.store.payments.push(record);
    return record;
  }

  async listPayments(range: { from: Date | string; to: Date | string }, filters?: PaymentFilters) {
    return this.store.payments.filter(
      (payment) => isWithinRange(payment.createdAt, range) && matchesFilters(payment, filters)
    );
  }

  async listRefunds(range: { from: Date | string; to: Date | string }, filters?: PaymentFilters) {
    return this.store.refunds.filter(
      (refund) => isWithinRange(refund.createdAt, range) && matchesFilters(refund, filters)
    );
  }

  async refundPayment(params: RefundParams): Promise<PaymentRecord> {
    const original = this.store.payments.find(
      (payment) => payment.externalId === params.paymentExternalId
    );
    const refundAmount = params.amount ?? original?.amount ?? { amountCents: 0, currency: 'USD' };
    const status =
      original && refundAmount.amountCents < original.amount.amountCents
        ? 'PARTIALLY_REFUNDED'
        : 'REFUNDED';

    if (original) {
      original.status = status;
    }

    const record: PaymentRecord = {
      provider: 'mock',
      externalId: nextPaymentId(this.store, 'mock-refund'),
      status,
      amount: refundAmount,
      tipAmount: null,
      taxAmount: null,
      createdAt: new Date().toISOString(),
      metadata: mergeMetadata(params.metadata ?? null, {
        paymentExternalId: params.paymentExternalId,
        orderExternalId: getMetadataString(original?.metadata ?? null, 'orderExternalId') ?? null,
        customerExternalId:
          getMetadataString(original?.metadata ?? null, 'customerExternalId') ?? null,
        reason: params.reason ?? null,
        source: 'OTHER',
      }),
    };

    this.store.refunds.push(record);
    return record;
  }
}
