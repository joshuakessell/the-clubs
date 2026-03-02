"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calcTotals = calcTotals;
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function toInteger(value) {
    if (value === null || value === undefined)
        return undefined;
    if (typeof value === 'number' && Number.isFinite(value))
        return Math.round(value);
    const n = Number(value);
    if (!Number.isFinite(n))
        return undefined;
    return Math.round(n);
}
function coalesceNumber(...values) {
    for (const value of values) {
        if (value !== undefined)
            return value;
    }
    return undefined;
}
function extractTipFromMetadata(metadata) {
    if (!metadata)
        return undefined;
    const direct = toInteger(metadata['tip_revision'] ??
        metadata['tip_revision_amount'] ??
        metadata['tip'] ??
        metadata['tip_amount']);
    if (direct !== undefined)
        return direct;
    const revision = metadata['tip_revision'];
    if (isRecord(revision)) {
        const revisionTip = toInteger(revision['tip'] ?? revision['tip_amount']);
        if (revisionTip !== undefined)
            return revisionTip;
    }
    return undefined;
}
function sumLineItems(lineItems) {
    if (!lineItems || lineItems.length === 0)
        return undefined;
    let sum = 0;
    let hasValue = false;
    for (const item of lineItems) {
        if (item?.total === undefined)
            continue;
        sum += item.total;
        hasValue = true;
    }
    return hasValue ? sum : undefined;
}
function calcTotals(input) {
    const discrepancies = [];
    const order = input.order ?? undefined;
    const payment = input.payment ?? undefined;
    if (input.expectOrder && !order) {
        discrepancies.push('ORDER_MISSING');
    }
    if (input.expectPayment && !payment) {
        discrepancies.push('PAYMENT_MISSING');
    }
    const discount = order?.discount ?? 0;
    const tax = order?.tax ?? 0;
    const tipFromMetadata = extractTipFromMetadata(payment?.metadata ?? undefined);
    const tip = Math.max(0, coalesceNumber(payment?.tipRevision, tipFromMetadata, payment?.tip, order?.tip, 0) ?? 0);
    let subtotal = coalesceNumber(order?.subtotal, sumLineItems(order?.lineItems));
    if (subtotal === undefined && order?.total !== undefined) {
        subtotal = order.total - discount - tax - tip;
    }
    if (subtotal === undefined && payment?.baseAmount !== undefined) {
        subtotal = payment.baseAmount;
    }
    if (subtotal === undefined && payment?.total !== undefined) {
        subtotal = payment.total - discount - tax - tip;
    }
    if (subtotal === undefined) {
        subtotal = 0;
    }
    let total = order?.total;
    if (total === undefined && order) {
        total = subtotal - discount + tax + tip;
    }
    if (total === undefined && payment?.total !== undefined) {
        total = payment.total;
    }
    if (total === undefined && payment?.baseAmount !== undefined) {
        total = payment.baseAmount - discount + tax + tip;
    }
    if (total === undefined) {
        total = subtotal - discount + tax + tip;
    }
    if (order?.total !== undefined &&
        payment?.total !== undefined &&
        Math.abs(order.total - payment.total) > 1) {
        discrepancies.push('TOTAL_MISMATCH');
    }
    return {
        subtotal,
        discount,
        tax,
        tip,
        total,
        discrepancies,
    };
}
