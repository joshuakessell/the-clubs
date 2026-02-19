import Fastify from 'fastify';
import cors from '@fastify/cors';
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
  shiftsRoutes,
  timeclockRoutes,
  documentsRoutes,
  sessionDocumentsRoutes,
  scheduleRoutes,
  timeoffRoutes,
  cashDrawerRoutes,
  breakRoutes,
  orderRoutes,
  customerSpendLedgerRoutes,
} from './routes';
import { createBroadcaster, type Broadcaster } from './realtime/broadcaster';
import { LocalLaneSockets } from './realtime/localSockets';
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

  // Register CORS — lock origins to an explicit allow-list in production.
  // ALLOWED_ORIGINS can be a comma-separated list (e.g. "https://a.com,https://b.com").
  // Falls back to `true` (any origin) only when unset, for local development.
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : true;
  await fastify.register(cors, {
    origin: allowedOrigins,
    credentials: true,
  });

  await fastify.register(websocket);

  // Create broadcaster for realtime events
  const localLaneSockets = new LocalLaneSockets();
  fastify.decorate('localLaneSockets', localLaneSockets);
  const broadcaster = createBroadcaster({ localLaneSockets });

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
  await fastify.register(shiftsRoutes);
  await fastify.register(timeclockRoutes);
  await fastify.register(documentsRoutes);
  await fastify.register(sessionDocumentsRoutes);
  await fastify.register(scheduleRoutes);
  await fastify.register(timeoffRoutes);
  await fastify.register(cashDrawerRoutes);
  await fastify.register(breakRoutes);
  await fastify.register(orderRoutes);
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
          if (SEED_ON_STARTUP) {
            fastify.log.info(
              'DEMO_MODE enabled, rebuilding demo data on startup (SEED_ON_STARTUP=true)...'
            );
          } else {
            fastify.log.info(
              'DEMO_MODE enabled; restoring demo snapshot and shifting timestamps (fast startup).'
            );
          }
          try {
            await seedDemoData({ forceReseed: SEED_ON_STARTUP });
          } catch (seedErr) {
            fastify.log.error(
              seedErr,
              '❌ Demo seed failed (non-fatal) — server will continue without demo data.'
            );
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
