import fs from 'node:fs';
import pg from 'pg';

const { Pool } = pg;

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

function resolveSslConfig(): pg.PoolConfig['ssl'] {
  if (process.env.DB_SSL !== 'true') {
    return undefined;
  }

  const sslCaPath = (process.env.DB_SSL_CA_PATH ?? '').trim();
  if (sslCaPath) {
    return {
      ca: fs.readFileSync(sslCaPath, 'utf8'),
      rejectUnauthorized: true,
    };
  }

  return { rejectUnauthorized: false };
}

function parseConnectionTimeoutMillis(): number {
  const raw = (process.env.DB_CONNECTION_TIMEOUT_MS ?? '').trim();
  if (!raw) return 5000;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 5000;
  return Math.floor(value);
}

function parseDatabaseUrl(urlString: string): {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
} {
  try {
    const url = new URL(urlString);

    // Best-effort support for postgres connection strings used by hosting providers.
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      return {};
    }

    const host = url.hostname || undefined;
    const port = url.port ? parseInt(url.port, 10) : undefined;
    const databaseFromPath = url.pathname.replace(/^\/+/, '');
    const database = databaseFromPath ? databaseFromPath : undefined;
    const user = url.username || undefined;
    const password = url.password || undefined;

    return {
      host,
      port: typeof port === 'number' && !Number.isNaN(port) ? port : undefined,
      database,
      user,
      password,
    };
  } catch {
    return {};
  }
}

/**
 * Load database configuration from environment variables.
 */
export function loadDatabaseConfig(): pg.PoolConfig {
  const connectionTimeoutMillis = parseConnectionTimeoutMillis();
  const ssl = resolveSslConfig();

  if (process.env.DATABASE_URL) {
    const databaseUrlRaw = process.env.DATABASE_URL;
    const parsed = parseDatabaseUrl(databaseUrlRaw);

    // `pg` reads the `DATABASE_URL` environment variable implicitly, even when
    // passing a config object without `connectionString`.
    //
    // To ensure SSL behavior is controlled exclusively by `DB_SSL` and
    // `DB_SSL_CA_PATH`, we provide an explicit `connectionString` that strips
    // query params like `sslmode=require` from hosting-provider URLs.
    const sanitizedConnectionString = (() => {
      try {
        const url = new URL(databaseUrlRaw);
        url.search = '';
        return url.toString();
      } catch {
        return databaseUrlRaw;
      }
    })();

    return {
      connectionString: sanitizedConnectionString,
      ...(parsed.host ? { host: parsed.host } : {}),
      ...(typeof parsed.port === 'number' ? { port: parsed.port } : {}),
      ...(parsed.database ? { database: parsed.database } : {}),
      ...(parsed.user ? { user: parsed.user } : {}),
      ...(parsed.password ? { password: parsed.password } : {}),
      ssl,
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis,
    };
  }

  const hasExplicitHost =
    typeof process.env.DB_HOST === 'string' && process.env.DB_HOST.trim().length > 0;

  if (!hasExplicitHost) {
    throw new Error(
      'Database is not configured. Set DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD.'
    );
  }

  return {
    host: process.env.DB_HOST!.trim(),
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'club_operations',
    user: process.env.DB_USER || 'clubops',
    password: process.env.DB_PASSWORD || 'clubops_dev',
    ssl,
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis,
  };
}

let pool: pg.Pool | null = null;

/**
 * Get the shared database connection pool.
 * Creates the pool on first call.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    const config = loadDatabaseConfig();
    pool = new Pool(config);

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('Unexpected error on idle database client', err);
    });
  }
  return pool;
}

/**
 * Initialize the database connection pool.
 * Tests the connection and returns the pool.
 */
export async function initializeDatabase(): Promise<pg.Pool> {
  const dbPool = getPool();

  // Test the connection
  const client = await dbPool.connect();
  try {
    await client.query('SELECT NOW()');
    console.log('Database connection established');
  } finally {
    client.release();
  }

  return dbPool;
}

/**
 * Close the database connection pool.
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Database connection pool closed');
  }
}

/**
 * Execute a query with automatic client acquisition and release.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const dbPool = getPool();
  const start = Date.now();
  const result = await dbPool.query<T>(text, params);
  const duration = Date.now() - start;

  if (process.env.DB_LOG_QUERIES === 'true') {
    console.log('Executed query', { text, duration, rows: result.rowCount });
  }

  return result;
}

/**
 * Execute a transaction with automatic commit/rollback.
 */
export async function transaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const dbPool = getPool();
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Execute a serializable transaction for critical operations like bookings.
 * This provides the highest isolation level to prevent race conditions.
 */
export async function serializableTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const dbPool = getPool();
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export { pg };
