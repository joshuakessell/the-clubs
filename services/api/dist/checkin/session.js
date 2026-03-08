"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertCustomerLanguageSelected = assertCustomerLanguageSelected;
const HttpError_1 = require("../errors/HttpError");
async function assertCustomerLanguageSelected(client, session) {
    if (!session.customer_id) {
        throw new HttpError_1.HttpError(400, 'Session has no customer');
    }
    const result = await client.query(`SELECT primary_language FROM customers WHERE id = $1 LIMIT 1`, [session.customer_id]);
    const primaryLanguage = result.rows[0]?.primary_language;
    if (!primaryLanguage || primaryLanguage.trim().length === 0) {
        throw new HttpError_1.HttpError(409, 'Language selection required', { code: 'LANGUAGE_REQUIRED' });
    }
}
