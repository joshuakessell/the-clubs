import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { loadDatabaseConfig } from './index';
import { loadEnvFromDotEnvIfPresent } from '../env/loadEnv';

loadEnvFromDotEnvIfPresent();

const MIGRATIONS_TABLE = 'schema_migrations';

async function loadMigrationNames(): Promise<string[]> {
  const migrationsDir = join(__dirname, '../../migrations');
  const files = await readdir(migrationsDir);
  return files
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => f.replace('.sql', ''));
}

async function getExecutedMigrations(client: pg.PoolClient): Promise<Set<string>> {
  const exists = await client.query<{ exists: string | null }>(
    `SELECT to_regclass('public.${MIGRATIONS_TABLE}') as exists`
  );
  if (!exists.rows[0]?.exists) {
    return new Set();
  }

  const result = await client.query<{ name: string }>(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id`
  );
  return new Set(result.rows.map((row) => row.name));
}

async function run(): Promise<void> {
  const config = loadDatabaseConfig();
  const pool = new pg.Pool(config);
  const client = await pool.connect();

  try {
    const migrations = await loadMigrationNames();
    const executed = await getExecutedMigrations(client);
    const pending = migrations.filter((name) => !executed.has(name));

    console.log(`Executed migrations: ${executed.size}`);
    console.log(`Pending migrations: ${pending.length}`);
    if (pending.length > 0) {
      console.log('Pending:');
      for (const name of pending) {
        console.log(`  - ${name}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error('Failed to read migration status:', error);
  process.exit(1);
});
