import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import helmet from '@fastify/helmet';

import { loadEnvFromDotEnvIfPresent } from './env/loadEnv';

import {
  healthRoutes, authRoutes, webauthnRoutes, customerRoutes,
  inventoryRoutes, roomsRoutes, keysRoutes, cleaningRoutes,
  adminRoutes, agreementsRoutes, upgradeRoutes, waitlistRoutes,
  metricsRoutes, visitRoutes, checkoutRoutes, checkinRoutes,
  registerRoutes, realtimeRoutes, realtimeLanRoutes, realtimeSSERoutes,
  shiftsRoutes, timeclockRoutes, documentsRoutes, sessionDocumentsRoutes,
  timeoffRoutes, shiftTradeRoutes, cashDrawerRoutes, breakRoutes,
  orderRoutes, retailRoutes, customerSpendLedgerRoutes,
} from './routes';
import { createBroadcaster, type Broadcaster } from './realtime/broadcaster';
import { LocalLaneSockets } from './realtime/localSockets';
import { LocalLaneSSEClients } from './realtime/localSSE';
import { initializeDatabase, closeDatabase, getPool } from './db';
import { runPendingMigrations } from './db/migrate';
import { cleanupAbandonedRegisterSessions } from './routes/registers';
import { seedDemoData } from './db/seed-demo';
import { expireWaitlistEntries } from './waitlist/expireWaitlist';
import { startAutoReplayOutbox } from './checkin/autoReplayOutbox';
import { processUpgradeHoldsTick } from './waitlist/upgradeHolds';

loadEnvFromDotEnvIfPresent();

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const SKIP_DB = process.env.SKIP_DB === 'true';
const SEED_ON_STARTUP = process.env.SEED_ON_STARTUP === 'true';

const KIOSK_TOKEN = process.env.KIOSK_TOKEN?.trim();
if (!KIOSK_TOKEN) {
  console.error('FATAL: Missing required env var KIOSK_TOKEN. Refusing to start API server.');
  process.exit(1);
}

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
    dbHealthy: boolean;
    localLaneSockets?: LocalLaneSockets;
    localLaneSSE?: LocalLaneSSEClients;
  }
}

async function setupSecurityAndCors(fastify: FastifyInstance) {
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "http://localhost:*", "ws://localhost:*", "https:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && !process.env.ALLOWED_ORIGINS) {
    console.error('FATAL: ALLOWED_ORIGINS must be set in production. Refusing to start API server.');
    process.exit(1);
  }

  const defaultDevOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const rawOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : null;

  let allowedOrigins: true | string[];
  if (!rawOrigins) {
    allowedOrigins = defaultDevOrigins;
  } else if (rawOrigins.length === 1 && rawOrigins[0] === '*') {
    allowedOrigins = defaultDevOrigins;
  } else {
    allowedOrigins = rawOrigins;
  }

  if (allowedOrigins === defaultDevOrigins) {
    fastify.log.info('ALLOWED_ORIGINS unset or "*". Falling back to strict local dev origins: ' + defaultDevOrigins.join(', '));
  }

  await fastify.register(cors, {
    origin: allowedOrigins,
    credentials: true,
  });
}

async function setupRateLimiting(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: (req) => {
      const url = req.url ?? '';
      return url.startsWith('/v1/realtime/') || url === '/health';
    },
  });

  fastify.addHook('onRoute', (routeOptions) => {
    const method = routeOptions.method;
    const methods = Array.isArray(method) ? method : [method];
    const isWrite = methods.some((m) => ['POST', 'PUT', 'DELETE', 'PATCH'].includes(m));
    if (isWrite) {
      routeOptions.config = {
        ...routeOptions.config,
        rateLimit: { max: 30, timeWindow: '1 minute' },
      };
    }
  });
}

function setupHooks(fastify: FastifyInstance) {
  fastify.addHook('onRequest', (request, reply, done) => {
    if (request.url !== '/health') {
      fastify.log.info({ method: request.method, url: request.url }, 'Incoming Request');
    }
    done();
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    if (request.url !== '/health') {
      fastify.log.info({
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: Math.round(reply.elapsedTime) + 'ms'
      }, 'Request Completed');
    }
    done();
  });

  fastify.addHook('onSend', (request, reply, payload, done) => {
    if (reply.statusCode >= 400 && request.url !== '/health') {
      try {
        const body = typeof payload === 'string' ? JSON.parse(payload) : payload;
        fastify.log.warn({
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          errorBody: body,
        }, 'Error Response');
      } catch {
        fastify.log.warn({
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          errorBody: typeof payload === 'string' ? payload.slice(0, 500) : '(non-string payload)',
        }, 'Error Response');
      }
    }
    done(null, payload);
  });
}

const isDbConfigured = () => {
  if (process.env.SKIP_DB === 'true') return false;
  if ((process.env.DATABASE_URL ?? '').trim()) return true;
  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'] as const;
  return required.every((k) => (process.env[k] ?? '').trim());
};

function setupPeriodicJobs(fastify: FastifyInstance) {
  const i1 = setInterval(() => {
    void (async () => {
      try {
        const cleaned = await cleanupAbandonedRegisterSessions(fastify);
        if (cleaned > 0) fastify.log.info(`Cleaned up ${cleaned} abandoned register session(s)`);
      } catch (error) {
        fastify.log.error(error, 'Error during register session cleanup');
      }
    })();
  }, 30000);

  const i2 = setInterval(() => {
    void (async () => {
      try {
        const expired = await expireWaitlistEntries(fastify);
        if (expired > 0) fastify.log.info(`Expired ${expired} waitlist entr${expired === 1 ? 'y' : 'ies'}`);
      } catch (error) {
        fastify.log.error(error, 'Error during waitlist expiry');
      }
    })();
  }, 60000);

  const i3 = setInterval(() => {
    void (async () => {
      try {
        const { query: dbQuery } = await import('./db');
        const result = await dbQuery(`DELETE FROM idempotency_keys WHERE expires_at < NOW()`);
        if (result.rowCount && result.rowCount > 0) fastify.log.info(`Cleaned up ${result.rowCount} expired idempotency key(s)`);
      } catch { /* ignore */ }
    })();
  }, 5 * 60 * 1000);

  const intervals = [i1, i2, i3];

  if (isDbConfigured()) {
    const i4 = setInterval(() => {
      void (async () => {
        try {
          const { expired, held } = await processUpgradeHoldsTick(fastify);
          if (expired > 0 || held > 0) fastify.log.info({ expired, held }, 'Processed upgrade holds');
        } catch (error) {
          fastify.log.error(error, 'Error during upgrade hold processing');
        }
      })();
    }, 5000);
    intervals.push(i4);
  } else {
    fastify.log.warn('DB not configured (or SKIP_DB=true); skipping upgrade hold processing.');
  }

  return intervals;
}

async function registerAllRoutes(fastify: FastifyInstance) {
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(webauthnRoutes);
  await fastify.register(customerRoutes);
  await fastify.register(inventoryRoutes);
  await fastify.register(roomsRoutes);
  await fastify.register(keysRoutes);
  await fastify.register(cleaningRoutes);
  await fastify.register(adminRoutes);
  await fastify.register(agreementsRoutes);
  await fastify.register(upgradeRoutes);
  await fastify.register(waitlistRoutes);
  await fastify.register(metricsRoutes);
  await fastify.register(visitRoutes);
  await fastify.register(checkoutRoutes);
  await fastify.register(checkinRoutes);
  await fastify.register(registerRoutes);
  await fastify.register(realtimeRoutes);
  await fastify.register(realtimeLanRoutes);
  await fastify.register(realtimeSSERoutes);
  await fastify.register(shiftsRoutes);
  await fastify.register(timeclockRoutes);
  await fastify.register(documentsRoutes);
  await fastify.register(sessionDocumentsRoutes);
  await fastify.register(timeoffRoutes);
  await fastify.register(shiftTradeRoutes);
  await fastify.register(cashDrawerRoutes);
  await fastify.register(breakRoutes);
  await fastify.register(orderRoutes);
  await fastify.register(retailRoutes);
  await fastify.register(customerSpendLedgerRoutes);
}

async function verifyDatabaseHealth(fastify: FastifyInstance) {
  try {
    const { query: healthQuery } = await import('./db');
    const healthRes = await healthQuery<{ tbl: string; cnt: string }>(`
      SELECT 'staff' as tbl, COUNT(*)::text as cnt FROM staff
      UNION ALL SELECT 'rooms', COUNT(*)::text FROM rooms
      UNION ALL SELECT 'lockers', COUNT(*)::text FROM lockers
      UNION ALL SELECT 'customers', COUNT(*)::text FROM customers
      UNION ALL SELECT 'agreements', COUNT(*)::text FROM agreements WHERE active = true
      UNION ALL SELECT 'devices', COUNT(*)::text FROM devices
      UNION ALL SELECT 'staff_sessions', COUNT(*)::text FROM staff_sessions WHERE revoked_at IS NULL AND expires_at > NOW()
    `);
    const counts = Object.fromEntries(healthRes.rows.map(r => [r.tbl, Number.parseInt(r.cnt, 10)]));
    const critical = ['staff', 'rooms', 'lockers', 'agreements', 'devices'];
    const missing = critical.filter(t => (counts[t] ?? 0) === 0);

    if (missing.length > 0) {
      fastify.log.warn(`⚠️  DB HEALTH: Empty critical tables: [${missing.join(', ')}] — seed may have failed! Run 'pnpm demo:seed'.`);
    }
    fastify.log.info(
      `📊 DB health: ${counts.staff ?? 0} staff, ${counts.rooms ?? 0} rooms, ${counts.lockers ?? 0} lockers, ` +
      `${counts.customers ?? 0} customers, ${counts.agreements ?? 0} agreements, ${counts.devices ?? 0} devices, ` +
      `${counts.staff_sessions ?? 0} active sessions`
    );
  } catch (err) {
    fastify.log.warn(err, 'Failed to run startup health check');
  }
}

function startSubsystems(fastify: FastifyInstance, abortSignal: AbortSignal) {
  if (process.env.EDGE_STACK === 'true' && process.env.CLOUD_API_BASE_URL) {
    startAutoReplayOutbox({
      pool: getPool(),
      cloudApiBase: process.env.CLOUD_API_BASE_URL.replace(/\/$/, ''),
      kioskToken: process.env.KIOSK_TOKEN!,
      signal: abortSignal,
      log: (...args: unknown[]) => fastify.log.info(String(args.map(String).join(' '))),
    });
    fastify.log.info('Auto-replay outbox service started (EDGE_STACK=true)');
  }
}

async function handleDemoSeeding(fastify: FastifyInstance) {
  if (process.env.DEMO_MODE === 'true') {
    if (process.env.SKIP_DEMO_SEED === 'true') {
      fastify.log.info('DEMO_MODE enabled; skipping startup seed.');
    } else {
      fastify.log.info(`DEMO_MODE enabled, seeding demo data (SEED_ON_STARTUP=${process.env.SEED_ON_STARTUP === 'true'})...`);
      try {
        await seedDemoData({ forceReseed: false });
      } catch (err) {
        fastify.log.error(err, '❌ Demo seed failed');
      }
    }
  }
}

async function initializeDbAndSeed(fastify: FastifyInstance, abortSignal: AbortSignal) {
  const DB_INIT_MAX_RETRIES = 5;
  const DB_INIT_BASE_DELAY_MS = 2_000;
  let dbInitialized = false;

  for (let attempt = 1; attempt <= DB_INIT_MAX_RETRIES; attempt++) {
    try {
      await initializeDatabase();
      fastify.dbHealthy = true;
      fastify.log.info('Database connection initialized');
      dbInitialized = true;
      break;
    } catch (err) {
      fastify.dbHealthy = false;
      const delayMs = DB_INIT_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      fastify.log.error(err, `Failed to initialize database (attempt ${attempt}/${DB_INIT_MAX_RETRIES}), retrying in ${delayMs}ms...`);
      if (attempt < DB_INIT_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  if (!dbInitialized) {
    fastify.log.error(`Database initialization failed after ${DB_INIT_MAX_RETRIES} attempts.`);
    return;
  }

  try { await runPendingMigrations(); } 
  catch (err) { fastify.log.error(err, '❌ Schema migration failed'); }

  await verifyDatabaseHealth(fastify);
  startSubsystems(fastify, abortSignal);
  await handleDemoSeeding(fastify);
}

async function main() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      ...(process.env.NODE_ENV === 'production' ? {} : {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
        },
      }),
    },
  });

  await setupSecurityAndCors(fastify);
  await setupRateLimiting(fastify);
  setupHooks(fastify);

  await fastify.register(websocket);

  const localLaneSockets = new LocalLaneSockets();
  const localLaneSSE = new LocalLaneSSEClients();
  fastify.decorate('localLaneSockets', localLaneSockets);
  fastify.decorate('localLaneSSE', localLaneSSE);
  const broadcaster = createBroadcaster({ localLaneSockets, localLaneSSE, logger: fastify.log });

  fastify.decorate('broadcaster', broadcaster);
  fastify.decorate('dbHealthy', SKIP_DB);

  const activeIntervals = setupPeriodicJobs(fastify);
  await registerAllRoutes(fastify);

  const autoReplayAbort = new AbortController();

  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    autoReplayAbort.abort();
    activeIntervals.forEach(clearInterval);
    await fastify.close();
    if (!SKIP_DB) await closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });

  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`Server listening on http://${HOST}:${PORT}`);
    fastify.log.info('Available endpoints:');
    fastify.log.info('  GET  /health');
    fastify.log.info('  GET  /v1/inventory/summary');
    fastify.log.info('  GET  /v1/inventory/available');
    fastify.log.info('  POST /v1/keys/resolve');
    fastify.log.info('  POST /v1/cleaning/batch');
    fastify.log.info('  GET  /v1/cleaning/batches');

    if (!SKIP_DB) {
      await initializeDbAndSeed(fastify, autoReplayAbort.signal);
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// NOSONAR
void (async () => {
  try {
    await main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
