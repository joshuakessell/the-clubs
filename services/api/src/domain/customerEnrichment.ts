import { type DrizzleTx } from '../db';
import { sql } from 'drizzle-orm';

/**
 * Parameters for enriching a customer's identity fields from a scan.
 */
export interface EnrichmentFields {
  idExpirationDate?: string | null;
  idNumber?: string | null;
  /** State or jurisdiction from the scan (maps to customers.id_state). */
  idState?: string | null;
  idType?: string | null;
  idTypeOther?: string | null;
}

/**
 * Enrich a customer record with identity fields extracted from an ID scan.
 *
 * This replaces the identical UPDATE query that was copy-pasted 5 times
 * in routes/checkin/scan.ts. Uses COALESCE / CASE to avoid overwriting
 * existing data with NULL.
 *
 * No-ops if all enrichment fields are empty.
 */
export async function enrichCustomerIdentity(
  tx: DrizzleTx,
  customerId: string,
  fields: EnrichmentFields
): Promise<void> {
  const {
    idExpirationDate,
    idNumber,
    idState,
    idType,
    idTypeOther,
  } = fields;

  // Skip if nothing to update
  const hasUpdate = idExpirationDate || idNumber || idState || idType || idTypeOther;
  if (!hasUpdate) return;

  await tx.execute(
    sql`UPDATE customers
     SET id_expiration_date = COALESCE(${idExpirationDate || null}::date, id_expiration_date),
         id_number = CASE WHEN ${idNumber || null}::text IS NOT NULL THEN ${idNumber || null} ELSE id_number END,
         id_state = CASE WHEN ${idState || null}::text IS NOT NULL THEN ${idState || null} ELSE id_state END,
         id_type = CASE WHEN ${idType || null}::text IS NOT NULL THEN ${idType || null} ELSE id_type END,
         id_type_other = CASE WHEN ${idTypeOther || null}::text IS NOT NULL THEN ${idTypeOther || null} ELSE id_type_other END,
         updated_at = NOW()
     WHERE id = ${customerId}`
  );
}
