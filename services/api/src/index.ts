import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';

import { loadEnvFromDotEnvIfPresent } from './env/loadEnv';

import {
  healthRoutes,
  authRoutes,
  webauthnRoutes,
  customerRoutes,
  inventoryRoutes,
  roomsRoutes,
  keysRoutes,
  cleaningRoutes,
  adminRoutes,
  agreementsRoutes,
  upgradeRoutes,
  waitlistRoutes,
  metricsRoutes,
  visitRoutes,
  checkoutRoutes,
  checkinRoutes,
  registerRoutes,
  realtimeRoutes,
  realtimeLanRoutes,
  realtimeSSERoutes,
  shiftsRoutes,
  timeclockRoutes,
  documentsRoutes,
  sessionDocumentsRoutes,
  timeoffRoutes,
  shiftTradeRoutes,
  cashDrawerRoutes,
  breakRoutes,
  orderRoutes,
  retailRoutes,
  customerSpendLedgerRoutes,
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

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const SKIP_DB = process.env.SKIP_DB === 'true';
const SEED_ON_STARTUP = process.env.SEED_ON_STARTUP === 'true';

// Fail-fast: the API must never start without a kiosk token configured.
// This is required for kiosk-facing authenticated endpoints that mutate state.
const KIOSK_TOKEN = process.env.KIOSK_TOKEN?.trim();
if (!KIOSK_TOKEN) {
  console.error('FATAL: Missing required env var KIOSK_TOKEN. Refusing to start API server.');
  process.exit(1);
}

// Augment FastifyInstance with broadcaster
declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
    dbHealthy: boolean;
    localLaneSockets?: LocalLaneSockets;
    localLaneSSE?: LocalLaneSSEClients;
  }
}

async function main() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      ...(process.env.NODE_ENV === 'production'
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            },
          }),
    },
  });

  // Global Request Logging
  fastify.addHook('onRequest', (request, reply, done) => {
    // Skip health checks to avoid log spam
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

  // Log response body for error responses to aid debugging
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
        // payload isn't JSON — log raw
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

  // Register CORS — lock origins to an explicit allow-list in production.
  // ALLOWED_ORIGINS can be a comma-separated list (e.g. "https://a.com,https://b.com").
  // Fail-fast in production if ALLOWED_ORIGINS is unset to prevent open CORS.
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && !process.env.ALLOWED_ORIGINS) {
    console.error('FATAL: ALLOWED_ORIGINS must be set in production. Refusing to start with open CORS.');
    process.exit(1);
  }
  const rawOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : null;
  // @fastify/cors treats an array as exact-match origins. A single '*' entry means "allow all",
  // which requires `origin: true` (reflect any origin), not the literal string '*' in an array.
  const allowedOrigins: true | string[] =
    !rawOrigins ? true :                          // env unset → allow all in dev
    rawOrigins.length === 1 && rawOrigins[0] === '*' ? true :  // explicit wildcard
    rawOrigins;                                    // explicit list
  if (allowedOrigins === true) {
    fastify.log.warn('ALLOWED_ORIGINS is not set or is "*" — CORS allows all origins. Set ALLOWED_ORIGINS in production.');
  }
  await fastify.register(cors, {
    origin: allowedOrigins,
    credentials: true,
  });

  // Register global rate limiting (F-03)
  // Exclude SSE/WebSocket endpoints — they're long-lived connections, not typical requests.
  await fastify.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    allowList: (req) => {
      const url = req.url ?? '';
      // Exempt long-lived SSE/WS connections and authenticated mutation routes
      // that are already auth-gated. The low global limit starves these during
      // bursty demo/reload scenarios.
      return url.startsWith('/v1/realtime/')
        || url.startsWith('/v1/upgrades/')
        || url.startsWith('/v1/checkout/')
        || url.startsWith('/v1/checkin/');
    },
  });

  await fastify.register(websocket);

  // Create broadcaster for realtime events
  const localLaneSockets = new LocalLaneSockets();
  const localLaneSSE = new LocalLaneSSEClients();
  fastify.decorate('localLaneSockets', localLaneSockets);
  fastify.decorate('localLaneSSE', localLaneSSE);
  const broadcaster = createBroadcaster({ localLaneSockets, localLaneSSE, logger: fastify.log });

  // Decorate fastify with broadcaster for access in routes
  fastify.decorate('broadcaster', broadcaster);
  fastify.decorate('dbHealthy', SKIP_DB);

  // Set up periodic cleanup for abandoned register sessions (every 30 seconds)
  const cleanupInterval = setInterval(() => {
    void (async () => {
      try {
        const cleaned = await cleanupAbandonedRegisterSessions(fastify);
        if (cleaned > 0) {
          fastify.log.info(`Cleaned up ${cleaned} abandoned register session(s)`);
        }
      } catch (error) {
        fastify.log.error(error, 'Error during register session cleanup');
      }
    })();
  }, 30000); // 30 seconds

  // Periodic waitlist expiry (every 60 seconds)
  const waitlistExpiryInterval = setInterval(() => {
    void (async () => {
      try {
        const expired = await expireWaitlistEntries(fastify);
        if (expired > 0) {
          fastify.log.info(`Expired ${expired} waitlist entr${expired === 1 ? 'y' : 'ies'}`);
        }
      } catch (error) {
        fastify.log.error(error, 'Error during waitlist expiry');
      }
    })();
  }, 60000);

  // Periodic cleanup of expired idempotency keys (every 5 minutes)
  const idempotencyCleanupInterval = setInterval(() => {
    void (async () => {
      try {
        const { query: dbQuery } = await import('./db');
        const result = await dbQuery(
          `DELETE FROM idempotency_keys WHERE expires_at < NOW()`
        );
        if (result.rowCount && result.rowCount > 0) {
          fastify.log.info(`Cleaned up ${result.rowCount} expired idempotency key(s)`);
        }
      } catch {
        // idempotency_keys table may not exist yet — ignore
      }
    })();
  }, 5 * 60 * 1000);

  // Helper: DB is configured only if SKIP_DB is not true and we have DATABASE_URL or all DB_* vars.
  const isDbConfigured = () => {
    if (process.env.SKIP_DB === 'true') return false;
    if ((process.env.DATABASE_URL ?? '').trim()) return true;

    const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'] as const;
    return required.every((k) => (process.env[k] ?? '').trim());
  };

  // Periodic upgrade hold/offer processing (every 5 seconds)
  let upgradeHoldInterval: NodeJS.Timeout | undefined;

  if (isDbConfigured()) {
    upgradeHoldInterval = setInterval(() => {
      void (async () => {
        try {
          const { expired, held } = await processUpgradeHoldsTick(fastify);
          if (expired > 0 || held > 0) {
            fastify.log.info({ expired, held }, 'Processed upgrade holds');
          }
        } catch (error) {
          fastify.log.error(error, 'Error during upgrade hold processing');
        }
      })();
    }, 5000);
  } else {
    fastify.log.warn('DB not configured (or SKIP_DB=true); skipping upgrade hold processing.');
  }

  // Register routes
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

  // Auto-replay outbox (edge stack only)
  const autoReplayAbort = new AbortController();

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    autoReplayAbort.abort();
    clearInterval(cleanupInterval);
    clearInterval(waitlistExpiryInterval);
    if (upgradeHoldInterval) clearInterval(upgradeHoldInterval);
    await fastify.close();
    if (!SKIP_DB) {
      await closeDatabase();
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });

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
          fastify.log.error(
            err,
            `Failed to initialize database (attempt ${attempt}/${DB_INIT_MAX_RETRIES}), retrying in ${delayMs}ms...`
          );
          if (attempt < DB_INIT_MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      }

      if (dbInitialized) {
        // Run pending schema migrations before anything else
        try {
          await runPendingMigrations();
        } catch (migrationErr) {
          fastify.log.error(
            migrationErr,
            '❌ Schema migration failed (non-fatal) — some features may not work correctly.'
          );
        }

        // Startup health check: log critical table row counts
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
          const counts = Object.fromEntries(healthRes.rows.map(r => [r.tbl, parseInt(r.cnt, 10)]));
          const critical = ['staff', 'rooms', 'lockers', 'agreements', 'devices'];
          const missing = critical.filter(t => (counts[t] ?? 0) === 0);

          if (missing.length > 0) {
            fastify.log.warn(
              `⚠️  DB HEALTH: Empty critical tables: [${missing.join(', ')}] — seed may have failed! Run 'pnpm demo:seed' or 'pnpm demo:dev:fresh'.`
            );
          }
          fastify.log.info(
            `📊 DB health: ${counts.staff ?? 0} staff, ${counts.rooms ?? 0} rooms, ${counts.lockers ?? 0} lockers, ` +
            `${counts.customers ?? 0} customers, ${counts.agreements ?? 0} agreements, ${counts.devices ?? 0} devices, ` +
            `${counts.staff_sessions ?? 0} active sessions`
          );
        } catch (healthErr) {
          fastify.log.warn(healthErr, 'Failed to run startup health check (non-fatal)');
        }

        // Start auto-replay for edge stack
        if (process.env.EDGE_STACK === 'true' && process.env.CLOUD_API_BASE_URL) {
          startAutoReplayOutbox({
            pool: getPool(),
            cloudApiBase: process.env.CLOUD_API_BASE_URL.replace(/\/$/, ''),
            kioskToken: KIOSK_TOKEN!,
            signal: autoReplayAbort.signal,
            log: (...args: unknown[]) => fastify.log.info(String(args.map(String).join(' '))),
          });
          fastify.log.info('Auto-replay outbox service started (EDGE_STACK=true)');
        }

        if (process.env.DEMO_MODE === 'true') {
          if (process.env.SKIP_DEMO_SEED === 'true') {
            fastify.log.info(
              'DEMO_MODE enabled; skipping startup seed (SKIP_DEMO_SEED=true, CLI seed already ran).'
            );
          } else if (SEED_ON_STARTUP) {
            fastify.log.info(
              'DEMO_MODE enabled, seeding demo data on startup (SEED_ON_STARTUP=true)...'
            );
            try {
              await seedDemoData({ forceReseed: false });
            } catch (seedErr) {
              fastify.log.error(
                seedErr,
                '❌ Demo seed failed (non-fatal) — server will continue without demo data.'
              );
            }
          } else {
            fastify.log.info(
              'DEMO_MODE enabled; restoring demo snapshot and shifting timestamps (fast startup).'
            );
            try {
              await seedDemoData({ forceReseed: false });
            } catch (seedErr) {
              fastify.log.error(
                seedErr,
                '❌ Demo seed failed (non-fatal) — server will continue without demo data.'
              );
            }
          }
        }
      } else {
        fastify.log.error(`Database initialization failed after ${DB_INIT_MAX_RETRIES} attempts. Server is running but database is unavailable.`);
      }
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main().catch(console.error);
