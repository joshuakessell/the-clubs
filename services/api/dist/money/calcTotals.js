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
    const direct = toInteger(metadata['tip_revision_cents'] ??
        metadata['tip_revision_amount_cents'] ??
        metadata['tip_cents'] ??
        metadata['tip_amount_cents']);
    if (direct !== undefined)
        return direct;
    const revision = metadata['tip_revision'];
    if (isRecord(revision)) {
        const revisionTip = toInteger(revision['tip_cents'] ?? revision['tip_amount_cents']);
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
        if (item?.totalCents === undefined)
            continue;
        sum += item.totalCents;
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
    const discountCents = order?.discountCents ?? 0;
    const taxCents = order?.taxCents ?? 0;
    const tipFromMetadata = extractTipFromMetadata(payment?.metadata ?? undefined);
    const tipCents = Math.max(0, coalesceNumber(payment?.tipRevisionCents, tipFromMetadata, payment?.tipCents, order?.tipCents, 0) ?? 0);
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
    if (order?.totalCents !== undefined &&
        payment?.totalCents !== undefined &&
        Math.abs(order.totalCents - payment.totalCents) > 1) {
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
