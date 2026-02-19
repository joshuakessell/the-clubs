"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIFTEEN_MIN_MS = void 0;
exports.roundUpToQuarterHour = roundUpToQuarterHour;
exports.FIFTEEN_MIN_MS = 15 * 60 * 1000;
/**
 * Round a Date up to the next 15-minute boundary (UTC ms-based).
 * Does not mutate the input Date.
 */
function roundUpToQuarterHour(d) {
    const ms = d.getTime();
    const rounded = Math.ceil(ms / exports.FIFTEEN_MIN_MS) * exports.FIFTEEN_MIN_MS;
    return new Date(rounded);
}
