"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichCustomerIdentity = enrichCustomerIdentity;
/**
 * Enrich a customer record with identity fields extracted from an ID scan.
 *
 * This replaces the identical UPDATE query that was copy-pasted 5 times
 * in routes/checkin/scan.ts. Uses COALESCE / CASE to avoid overwriting
 * existing data with NULL.
 *
 * No-ops if all enrichment fields are empty.
 */
async function enrichCustomerIdentity(client, customerId, fields) {
    const { idExpirationDate, idNumber, idState, idType, idTypeOther, } = fields;
    // Skip if nothing to update
    const hasUpdate = idExpirationDate || idNumber || idState || idType || idTypeOther;
    if (!hasUpdate)
        return;
    await client.query(`UPDATE customers
     SET id_expiration_date = COALESCE($1::date, id_expiration_date),
         id_number = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE id_number END,
         id_state = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE id_state END,
         id_type = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE id_type END,
         id_type_other = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE id_type_other END,
         updated_at = NOW()
     WHERE id = $6`, [
        idExpirationDate || null,
        idNumber || null,
        idState || null,
        idType || null,
        idTypeOther || null,
        customerId,
    ]);
}
