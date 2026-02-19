"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireKioskTokenOrStaff = requireKioskTokenOrStaff;
const crypto_1 = __importDefault(require("crypto"));
function getHeader(request, name) {
    const direct = request.headers[name];
    if (typeof direct === 'string')
        return direct;
    const lower = request.headers[name.toLowerCase()];
    if (typeof lower === 'string')
        return lower;
    const upper = request.headers[name.toUpperCase()];
    if (typeof upper === 'string')
        return upper;
    return undefined;
}
function timingSafeEquals(a, b) {
    const aa = Buffer.from(a);
    const bb = Buffer.from(b);
    if (aa.length !== bb.length)
        return false;
    return crypto_1.default.timingSafeEqual(aa, bb);
}
/**
 * Kiosk authentication for kiosk-facing, state-mutating endpoints.
 *
 * Policy:
 * - If a valid staff Bearer token is present (optionalAuth already ran), allow.
 * - Else require an `x-kiosk-token` header matching process.env.KIOSK_TOKEN.
 *
 * This is a pragmatic LAN threat-model guard to prevent unauthenticated callers from mutating
 * lane session / inventory state.
 */
async function requireKioskTokenOrStaff(request, reply) {
    if (request.staff)
        return;
    const expected = process.env.KIOSK_TOKEN;
    if (!expected) {
        request.log.error('KIOSK_TOKEN is not configured; refusing kiosk mutation request');
        reply.status(500).send({
            error: 'Server misconfigured',
            message: 'Kiosk token not configured',
        });
        return;
    }
    const provided = getHeader(request, 'x-kiosk-token');
    if (!provided || !timingSafeEquals(provided, expected)) {
        reply.status(401).send({
            error: 'Unauthorized',
            message: 'Valid kiosk token required',
        });
        return;
    }
}
