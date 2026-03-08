import type { LaneSessionRow, PoolClient } from './types';
import { HttpError } from '../errors/HttpError';

export async function assertCustomerLanguageSelected(
  client: PoolClient,
  session: LaneSessionRow
): Promise<void> {
  if (!session.customer_id) {
    throw new HttpError(400, 'Session has no customer');
  }
  const result = await client.query<{ primary_language: string | null }>(
    `SELECT primary_language FROM customers WHERE id = $1 LIMIT 1`,
    [session.customer_id]
  );
  const primaryLanguage = result.rows[0]?.primary_language;
  if (!primaryLanguage || primaryLanguage.trim().length === 0) {
    throw new HttpError(409, 'Language selection required', { code: 'LANGUAGE_REQUIRED' });
  }
}
