"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertNotBanned = assertNotBanned;
exports.assertCustomerExists = assertCustomerExists;
const HttpError_1 = require("../errors/HttpError");
/**
 * Assert that a customer is not currently banned.
 *
 * Throws HttpError(403) with code 'BANNED' if the customer's ban is active.
 * This replaces the duplicated ban-check logic found across scan.ts, visits.ts, etc.
 */
function assertNotBanned(customer) {
    if (!customer.banned_until)
        return;
    const bannedUntil = customer.banned_until instanceof Date
        ? customer.banned_until
        : new Date(customer.banned_until);
    if (bannedUntil > new Date()) {
        throw new HttpError_1.HttpError(403, `Customer is banned until ${bannedUntil.toISOString()}`, {
            code: 'BANNED',
        });
    }
}
/**
 * Assert that a customer exists and return the row.
 *
 * Throws HttpError(404) if not found.
 */
function assertCustomerExists(rows, label = 'Customer') {
    if (rows.length === 0) {
        throw new HttpError_1.HttpError(404, `${label} not found`);
    }
    return rows[0];
}
