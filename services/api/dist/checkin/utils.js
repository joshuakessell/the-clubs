"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toNumber = toNumber;
exports.roundToWhole = roundToWhole;
exports.parsePriceQuote = parsePriceQuote;
exports.toDate = toDate;
exports.getHttpError = getHttpError;
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function toNumber(value) {
    if (value === null || value === undefined)
        return undefined;
    if (typeof value === 'number')
        return value;
    const n = parseFloat(String(value));
    return Number.isFinite(n) ? n : undefined;
}
function roundToWhole(value) {
    return Math.round(value);
}
function parsePriceQuote(raw) {
    if (raw === null || raw === undefined)
        return null;
    let parsed = raw;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        }
        catch {
            return null;
        }
    }
    if (!isRecord(parsed))
        return null;
    const lineItemsRaw = parsed['lineItems'];
    const lineItems = [];
    if (Array.isArray(lineItemsRaw)) {
        for (const item of lineItemsRaw) {
            if (!isRecord(item))
                continue;
            const description = item['description'];
            const amount = toNumber(item['amount']);
            if (typeof description !== 'string' || amount === undefined)
                continue;
            lineItems.push({ description, amount });
        }
    }
    const total = toNumber(parsed['total']) ?? 0;
    const messagesRaw = parsed['messages'];
    const messages = Array.isArray(messagesRaw)
        ? messagesRaw.filter((m) => typeof m === 'string')
        : [];
    return { quote: parsed, lineItems, total, messages };
}
function toDate(value) {
    if (value === null || value === undefined)
        return undefined;
    if (value instanceof Date)
        return value;
    const d = new Date(String(value));
    return Number.isFinite(d.getTime()) ? d : undefined;
}
function getHttpError(error) {
    if (!error || typeof error !== 'object')
        return null;
    if (!('statusCode' in error))
        return null;
    const statusCode = error.statusCode;
    if (typeof statusCode !== 'number')
        return null;
    const message = error.message;
    const code = error.code;
    return {
        statusCode,
        message: typeof message === 'string' ? message : undefined,
        code: typeof code === 'string' ? code : undefined,
    };
}
