"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toDate = toDate;
exports.isWithinRange = isWithinRange;
exports.overlapsRange = overlapsRange;
exports.getMetadataString = getMetadataString;
exports.getMetadataNumber = getMetadataNumber;
exports.mergeMetadata = mergeMetadata;
function toDate(value) {
    return value instanceof Date ? value : new Date(value);
}
function isWithinRange(value, range) {
    const target = toDate(value).getTime();
    const from = toDate(range.from).getTime();
    const to = toDate(range.to).getTime();
    return target >= from && target <= to;
}
function overlapsRange(start, end, range) {
    const startTime = toDate(start).getTime();
    const endTime = end ? toDate(end).getTime() : startTime;
    const from = toDate(range.from).getTime();
    const to = toDate(range.to).getTime();
    return startTime <= to && endTime >= from;
}
function getMetadataString(metadata, key) {
    if (!metadata)
        return undefined;
    const value = metadata[key];
    return typeof value === 'string' ? value : undefined;
}
function getMetadataNumber(metadata, key) {
    if (!metadata)
        return undefined;
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
}
function mergeMetadata(metadata, extra) {
    if (!metadata && !extra)
        return null;
    return {
        ...(metadata ?? {}),
        ...(extra ?? {}),
    };
}
