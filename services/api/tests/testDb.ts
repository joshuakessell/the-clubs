import type pg from 'pg';

export type QueryFn = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
) => Promise<pg.QueryResult<T>>;

/**
 * Truncate all public tables (except schema_migrations) to provide a clean slate
 * for integration tests that share a single database instance.
 *
 * IMPORTANT: This assumes test files are not running concurrently against the same DB.
 */
export async function truncateAllTables(query: QueryFn): Promise<void> {
  // If the DB isn't reachable (common for local/unit-only runs), treat as a no-op.
  // Integration tests that require DB connectivity should guard themselves.
  try {
    await query('SELECT 1');
  } catch {
    return;
  }

  const tables = await query<{ tablename: string }>(
    `
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> 'schema_migrations'
    `
  );

  const names = tables.rows
    .map((r) => r.tablename)
    .filter((t) => t !== 'schema_migrations')
    .map((t) => `"${t.replace(/"/g, '""')}"`);

  if (names.length === 0) return;

  await query(`TRUNCATE TABLE ${names.join(', ')} RESTART IDENTITY CASCADE`);
}
