"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertCustomerLanguageSelected = assertCustomerLanguageSelected;
async function assertCustomerLanguageSelected(client, session) {
    if (!session.customer_id) {
        throw { statusCode: 400, message: 'Session has no customer' };
    }
    const result = await client.query(`SELECT primary_language FROM customers WHERE id = $1 LIMIT 1`, [session.customer_id]);
    const primaryLanguage = result.rows[0]?.primary_language;
    if (!primaryLanguage || primaryLanguage.trim().length === 0) {
        throw {
            statusCode: 409,
            code: 'LANGUAGE_REQUIRED',
            message: 'Language selection required',
        };
    }
}
