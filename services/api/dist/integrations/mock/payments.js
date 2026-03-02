"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockPaymentsProvider = void 0;
const helpers_1 = require("./helpers");
function nextPaymentId(store, prefix) {
    if (prefix === 'mock-pay') {
        const next = store.counters.payment;
        store.counters.payment += 1;
        return `${prefix}-${next}`;
    }
    const next = store.counters.refund;
    store.counters.refund += 1;
    return `${prefix}-${next}`;
}
function extractSource(metadata) {
    const value = (0, helpers_1.getMetadataString)(metadata, 'source');
    if (value === 'CARD' || value === 'CASH' || value === 'OTHER')
        return value;
    return undefined;
}
function matchesFilters(payment, filters) {
    if (!filters)
        return true;
    if (filters.status && payment.status !== filters.status)
        return false;
    const metadata = payment.metadata ?? null;
    const customerExternalId = (0, helpers_1.getMetadataString)(metadata, 'customerExternalId');
    const orderExternalId = (0, helpers_1.getMetadataString)(metadata, 'orderExternalId');
    const source = extractSource(metadata);
    if (filters.customerExternalId && filters.customerExternalId !== customerExternalId)
        return false;
    if (filters.orderExternalId && filters.orderExternalId !== orderExternalId)
        return false;
    if (filters.source && filters.source !== source)
        return false;
    return true;
}
function createPaymentRecord(params, store, source) {
    return {
        provider: 'mock',
        externalId: nextPaymentId(store, 'mock-pay'),
        status: 'PAID',
        amount: params.amount,
        tipAmount: null,
        taxAmount: null,
        createdAt: new Date().toISOString(),
        metadata: (0, helpers_1.mergeMetadata)(params.metadata ?? null, {
            source,
            orderExternalId: params.orderExternalId ?? null,
            customerExternalId: params.customerExternalId ?? null,
        }),
    };
}
class MockPaymentsProvider {
    store;
    constructor(store) {
        this.store = store;
    }
    async createCardPayment(params) {
        const record = createPaymentRecord(params, this.store, 'CARD');
        this.store.payments.push(record);
        return record;
    }
    async recordCashPayment(params) {
        const record = createPaymentRecord(params, this.store, 'CASH');
        this.store.payments.push(record);
        return record;
    }
    async listPayments(range, filters) {
        return this.store.payments.filter((payment) => (0, helpers_1.isWithinRange)(payment.createdAt, range) && matchesFilters(payment, filters));
    }
    async listRefunds(range, filters) {
        return this.store.refunds.filter((refund) => (0, helpers_1.isWithinRange)(refund.createdAt, range) && matchesFilters(refund, filters));
    }
    async refundPayment(params) {
        const original = this.store.payments.find((payment) => payment.externalId === params.paymentExternalId);
        const refundAmount = params.amount ?? original?.amount ?? { amount: 0, currency: 'USD' };
        const status = original && refundAmount.amount < original.amount.amount
            ? 'PARTIALLY_REFUNDED'
            : 'REFUNDED';
        if (original) {
            original.status = status;
        }
        const record = {
            provider: 'mock',
            externalId: nextPaymentId(this.store, 'mock-refund'),
            status,
            amount: refundAmount,
            tipAmount: null,
            taxAmount: null,
            createdAt: new Date().toISOString(),
            metadata: (0, helpers_1.mergeMetadata)(params.metadata ?? null, {
                paymentExternalId: params.paymentExternalId,
                orderExternalId: (0, helpers_1.getMetadataString)(original?.metadata ?? null, 'orderExternalId') ?? null,
                customerExternalId: (0, helpers_1.getMetadataString)(original?.metadata ?? null, 'customerExternalId') ?? null,
                reason: params.reason ?? null,
                source: 'OTHER',
            }),
        };
        this.store.refunds.push(record);
        return record;
    }
}
exports.MockPaymentsProvider = MockPaymentsProvider;
