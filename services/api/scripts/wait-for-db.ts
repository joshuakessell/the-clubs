import { Client, type ClientConfig } from 'pg';
import { loadDatabaseConfig } from '../src/db/index';
import { loadEnvFromDotEnvIfPresent } from '../src/env/loadEnv';

loadEnvFromDotEnvIfPresent();

const DEFAULT_CONFIG: ClientConfig = {
  host: 'localhost',
  port: 5432,
  // Keep defaults aligned with docker-compose.yml + local dev expectations.
  user: 'clubops',
  password: 'club-ops-dev',
  database: 'club_operations',
  connectionTimeoutMillis: parseConnectionTimeoutMillis(),
};

function resolveConfig(): ClientConfig {
  const hasDatabaseUrl = Boolean((process.env.DATABASE_URL ?? '').trim());
  const hasDbHost = Boolean((process.env.DB_HOST ?? '').trim());

  if (!hasDatabaseUrl && !hasDbHost) {
    return DEFAULT_CONFIG;
  }

  return loadDatabaseConfig();
}

function parseConnectionTimeoutMillis(): number {
  const raw = (process.env.DB_CONNECTION_TIMEOUT_MS ?? '').trim();
  if (!raw) return 5000;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 5000;
  return Math.floor(value);
}

const baseConfig = resolveConfig();

const RETRY_DELAY_MS = parseRetryDelayMs();
const MAX_RETRIES = parseMaxRetries();
const WAIT_TIMEOUT_SECONDS = Math.ceil((MAX_RETRIES * RETRY_DELAY_MS) / 1000);

function parseRetryDelayMs(): number {
  const raw = (process.env.DB_WAIT_RETRY_DELAY_MS ?? '').trim();
  if (!raw) return 1000;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 1000;
  return Math.floor(value);
}

function parseMaxRetries(): number {
  const rawSeconds = (process.env.DB_WAIT_TIMEOUT_SECONDS ?? '').trim();
  if (!rawSeconds) return Math.ceil(300_000 / RETRY_DELAY_MS);
  const valueSeconds = Number(rawSeconds);
  if (!Number.isFinite(valueSeconds) || valueSeconds <= 0) {
    return Math.ceil(300_000 / RETRY_DELAY_MS);
  }
  const totalMs = valueSeconds * 1000;
  return Math.max(1, Math.ceil(totalMs / RETRY_DELAY_MS));
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDb() {
  let lastErrorMessage = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = new Client({ ...baseConfig });

    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();

      console.log('Database is ready');
      process.exit(0);
    } catch (err) {
      lastErrorMessage = formatError(err);
      await client.end().catch(() => {});
      const suffix = lastErrorMessage ? ` Last error: ${lastErrorMessage}` : '';
      console.log(`Waiting for database (${attempt}/${MAX_RETRIES})...${suffix}`);
      await sleep(RETRY_DELAY_MS);
    }
  }

  const suffix = lastErrorMessage ? ` Last error: ${lastErrorMessage}` : '';
  console.error(`Database did not become ready in time (${WAIT_TIMEOUT_SECONDS}s).${suffix}`);
  process.exit(1);
}

waitForDb();

function formatError(error: unknown): string {
  if (!error) return '';
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    const detail = (error as { detail?: string }).detail;
    const hint = (error as { hint?: string }).hint;
    const extra = [code ? `code=${code}` : '', detail ? `detail=${detail}` : '', hint ? `hint=${hint}` : '']
      .filter(Boolean)
      .join(' ');
    return extra ? `${error.message} (${extra})` : error.message;
  }
  if (typeof error === 'object') {
    const message = (error as { message?: string }).message;
    const code = (error as { code?: string }).code;
    if (message && code) return `${message} (code=${code})`;
    if (message) return message;
  }
  return String(error);
}
