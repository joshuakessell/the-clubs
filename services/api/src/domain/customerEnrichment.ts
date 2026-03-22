import { type DrizzleTx } from '../db';
import { customers } from '../db/schema/schema';
import { sql, eq } from 'drizzle-orm';

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
 * in routes/checkin/scan.ts. Uses conditional Drizzle sets to avoid overwriting
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

  const setValues: Record<string, unknown> = {};

  if (idExpirationDate) setValues.idExpirationDate = sql`${idExpirationDate}::date`;
  if (idNumber) setValues.idNumber = idNumber;
  if (idState) setValues.idState = idState;
  if (idType) setValues.idType = idType;
  if (idTypeOther) setValues.idTypeOther = idTypeOther;

  // Skip if nothing to update
  if (Object.keys(setValues).length === 0) return;

  setValues.updatedAt = sql`NOW()`;

  await tx.update(customers).set(setValues).where(eq(customers.id, customerId));
}
