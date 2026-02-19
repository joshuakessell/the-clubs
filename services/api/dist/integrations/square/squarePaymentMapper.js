"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapSquareStatus = mapSquareStatus;
exports.mapSquarePayment = mapSquarePayment;
function toCents(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'number' && Number.isFinite(value))
        return Math.trunc(value);
    if (typeof value === 'bigint')
        return Number(value);
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}
function toMoneyAmount(money, fallbackCurrency) {
    if (!money)
        return null;
    const amountCents = toCents(money.amount ?? null);
    if (amountCents === null)
        return null;
    const currency = money.currency || fallbackCurrency || 'USD';
    return { amountCents, currency };
}
function mapSourceType(sourceType) {
    if (!sourceType)
        return null;
    const normalized = sourceType.toUpperCase();
    if (normalized === 'CARD')
        return 'CARD';
    if (normalized === 'CASH')
        return 'CASH';
    return 'OTHER';
}
function mapSquareStatus(payment) {
    const status = payment.status?.toUpperCase();
    const refunded = toCents(payment.refundedMoney?.amount ?? null) ?? 0;
    const total = toCents(payment.totalMoney?.amount ?? null) ??
        toCents(payment.amountMoney?.amount ?? null) ??
        0;
    if (status === 'COMPLETED') {
        if (refunded > 0) {
            return refunded >= total ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
        }
        return 'PAID';
    }
    if (status === 'APPROVED')
        return 'AUTHORIZED';
    if (status === 'PENDING')
        return 'PENDING';
    if (status === 'CANCELED')
        return 'CANCELED';
    if (status === 'FAILED')
        return 'FAILED';
    if (refunded > 0) {
        return refunded >= total ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    }
    return 'PENDING';
}
function mapSquarePayment(payment) {
    const totalMoney = payment.totalMoney ?? payment.amountMoney ?? null;
    const amount = toMoneyAmount(totalMoney) ?? { amountCents: 0, currency: 'USD' };
    const tipAmount = toMoneyAmount(payment.tipMoney ?? null, amount.currency);
    const taxAmount = toMoneyAmount(payment.taxMoney ?? null, amount.currency);
    const createdAt = payment.createdAt ?? payment.updatedAt ?? new Date().toISOString();
    return {
        provider: 'square',
        externalId: payment.id || '',
        status: mapSquareStatus(payment),
        amount,
        tipAmount: tipAmount ?? null,
        taxAmount: taxAmount ?? null,
        createdAt,
        metadata: {
            orderExternalId: payment.orderId ?? null,
            customerExternalId: payment.customerId ?? null,
            locationId: payment.locationId ?? null,
            referenceId: payment.referenceId ?? null,
            source: mapSourceType(payment.sourceType),
        },
    };
}
