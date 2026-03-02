"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const websocket_1 = __importDefault(require("@fastify/websocket"));
const loadEnv_1 = require("./env/loadEnv");
const routes_1 = require("./routes");
const broadcaster_1 = require("./realtime/broadcaster");
const localSockets_1 = require("./realtime/localSockets");
const localSSE_1 = require("./realtime/localSSE");
const db_1 = require("./db");
const migrate_1 = require("./db/migrate");
const registers_1 = require("./routes/registers");
const seed_demo_1 = require("./db/seed-demo");
const expireWaitlist_1 = require("./waitlist/expireWaitlist");
const autoReplayOutbox_1 = require("./checkin/autoReplayOutbox");
const upgradeHolds_1 = require("./waitlist/upgradeHolds");
(0, loadEnv_1.loadEnvFromDotEnvIfPresent)();
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
async function main() {
    const fastify = (0, fastify_1.default)({
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
    // Fail-fast in production if ALLOWED_ORIGINS is unset to prevent open CORS.
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction && !process.env.ALLOWED_ORIGINS) {
        console.error('FATAL: ALLOWED_ORIGINS must be set in production. Refusing to start with open CORS.');
        process.exit(1);
    }
    const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
        : true;
    if (allowedOrigins === true) {
        fastify.log.warn('ALLOWED_ORIGINS is not set — CORS allows all origins. Set ALLOWED_ORIGINS in production.');
    }
    await fastify.register(cors_1.default, {
        origin: allowedOrigins,
        credentials: true,
    });
    // Register global rate limiting (F-03)
    // Exclude SSE/WebSocket endpoints — they're long-lived connections, not typical requests.
    await fastify.register(rate_limit_1.default, {
        max: 100,
        timeWindow: '1 minute',
        allowList: (req) => {
            const url = req.url ?? '';
            return url.startsWith('/v1/realtime/');
        },
    });
    await fastify.register(websocket_1.default);
    // Create broadcaster for realtime events
    const localLaneSockets = new localSockets_1.LocalLaneSockets();
    const localLaneSSE = new localSSE_1.LocalLaneSSEClients();
    fastify.decorate('localLaneSockets', localLaneSockets);
    fastify.decorate('localLaneSSE', localLaneSSE);
    const broadcaster = (0, broadcaster_1.createBroadcaster)({ localLaneSockets, localLaneSSE, logger: fastify.log });
    // Decorate fastify with broadcaster for access in routes
    fastify.decorate('broadcaster', broadcaster);
    fastify.decorate('dbHealthy', SKIP_DB);
    // Set up periodic cleanup for abandoned register sessions (every 30 seconds)
    const cleanupInterval = setInterval(() => {
        void (async () => {
            try {
                const cleaned = await (0, registers_1.cleanupAbandonedRegisterSessions)(fastify);
                if (cleaned > 0) {
                    fastify.log.info(`Cleaned up ${cleaned} abandoned register session(s)`);
                }
            }
            catch (error) {
                fastify.log.error(error, 'Error during register session cleanup');
            }
        })();
    }, 30000); // 30 seconds
    // Periodic waitlist expiry (every 60 seconds)
    const waitlistExpiryInterval = setInterval(() => {
        void (async () => {
            try {
                const expired = await (0, expireWaitlist_1.expireWaitlistEntries)(fastify);
                if (expired > 0) {
                    fastify.log.info(`Expired ${expired} waitlist entr${expired === 1 ? 'y' : 'ies'}`);
                }
            }
            catch (error) {
                fastify.log.error(error, 'Error during waitlist expiry');
            }
        })();
    }, 60000);
    // Periodic cleanup of expired idempotency keys (every 5 minutes)
    const idempotencyCleanupInterval = setInterval(() => {
        void (async () => {
            try {
                const { query: dbQuery } = await Promise.resolve().then(() => __importStar(require('./db')));
                const result = await dbQuery(`DELETE FROM idempotency_keys WHERE expires_at < NOW()`);
                if (result.rowCount && result.rowCount > 0) {
                    fastify.log.info(`Cleaned up ${result.rowCount} expired idempotency key(s)`);
                }
            }
            catch {
                // idempotency_keys table may not exist yet — ignore
            }
        })();
    }, 5 * 60 * 1000);
    // Helper: DB is configured only if SKIP_DB is not true and we have DATABASE_URL or all DB_* vars.
    const isDbConfigured = () => {
        if (process.env.SKIP_DB === 'true')
            return false;
        if ((process.env.DATABASE_URL ?? '').trim())
            return true;
        const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
        return required.every((k) => (process.env[k] ?? '').trim());
    };
    // Periodic upgrade hold/offer processing (every 5 seconds)
    let upgradeHoldInterval;
    if (isDbConfigured()) {
        upgradeHoldInterval = setInterval(() => {
            void (async () => {
                try {
                    const { expired, held } = await (0, upgradeHolds_1.processUpgradeHoldsTick)(fastify);
                    if (expired > 0 || held > 0) {
                        fastify.log.info({ expired, held }, 'Processed upgrade holds');
                    }
                }
                catch (error) {
                    fastify.log.error(error, 'Error during upgrade hold processing');
                }
            })();
        }, 5000);
    }
    else {
        fastify.log.warn('DB not configured (or SKIP_DB=true); skipping upgrade hold processing.');
    }
    // Register routes
    await fastify.register(routes_1.healthRoutes);
    await fastify.register(routes_1.authRoutes);
    await fastify.register(routes_1.webauthnRoutes);
    await fastify.register(routes_1.customerRoutes);
    await fastify.register(routes_1.inventoryRoutes);
    await fastify.register(routes_1.roomsRoutes);
    await fastify.register(routes_1.keysRoutes);
    await fastify.register(routes_1.cleaningRoutes);
    await fastify.register(routes_1.adminRoutes);
    await fastify.register(routes_1.agreementsRoutes);
    await fastify.register(routes_1.upgradeRoutes);
    await fastify.register(routes_1.waitlistRoutes);
    await fastify.register(routes_1.metricsRoutes);
    await fastify.register(routes_1.visitRoutes);
    await fastify.register(routes_1.checkoutRoutes);
    await fastify.register(routes_1.checkinRoutes);
    await fastify.register(routes_1.registerRoutes);
    await fastify.register(routes_1.realtimeRoutes);
    await fastify.register(routes_1.realtimeLanRoutes);
    await fastify.register(routes_1.realtimeSSERoutes);
    await fastify.register(routes_1.shiftsRoutes);
    await fastify.register(routes_1.timeclockRoutes);
    await fastify.register(routes_1.documentsRoutes);
    await fastify.register(routes_1.sessionDocumentsRoutes);
    await fastify.register(routes_1.timeoffRoutes);
    await fastify.register(routes_1.shiftTradeRoutes);
    await fastify.register(routes_1.cashDrawerRoutes);
    await fastify.register(routes_1.breakRoutes);
    await fastify.register(routes_1.orderRoutes);
    await fastify.register(routes_1.retailRoutes);
    await fastify.register(routes_1.customerSpendLedgerRoutes);
    // Auto-replay outbox (edge stack only)
    const autoReplayAbort = new AbortController();
    // Graceful shutdown
    const shutdown = async () => {
        fastify.log.info('Shutting down...');
        autoReplayAbort.abort();
        clearInterval(cleanupInterval);
        clearInterval(waitlistExpiryInterval);
        if (upgradeHoldInterval)
            clearInterval(upgradeHoldInterval);
        await fastify.close();
        if (!SKIP_DB) {
            await (0, db_1.closeDatabase)();
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
                    await (0, db_1.initializeDatabase)();
                    fastify.dbHealthy = true;
                    fastify.log.info('Database connection initialized');
                    dbInitialized = true;
                    break;
                }
                catch (err) {
                    fastify.dbHealthy = false;
                    const delayMs = DB_INIT_BASE_DELAY_MS * Math.pow(2, attempt - 1);
                    fastify.log.error(err, `Failed to initialize database (attempt ${attempt}/${DB_INIT_MAX_RETRIES}), retrying in ${delayMs}ms...`);
                    if (attempt < DB_INIT_MAX_RETRIES) {
                        await new Promise((r) => setTimeout(r, delayMs));
                    }
                }
            }
            if (dbInitialized) {
                // Run pending schema migrations before anything else
                try {
                    await (0, migrate_1.runPendingMigrations)();
                }
                catch (migrationErr) {
                    fastify.log.error(migrationErr, '❌ Schema migration failed (non-fatal) — some features may not work correctly.');
                }
                // Start auto-replay for edge stack
                if (process.env.EDGE_STACK === 'true' && process.env.CLOUD_API_BASE_URL) {
                    (0, autoReplayOutbox_1.startAutoReplayOutbox)({
                        pool: (0, db_1.getPool)(),
                        cloudApiBase: process.env.CLOUD_API_BASE_URL.replace(/\/$/, ''),
                        kioskToken: KIOSK_TOKEN,
                        signal: autoReplayAbort.signal,
                        log: (...args) => fastify.log.info(String(args.map(String).join(' '))),
                    });
                    fastify.log.info('Auto-replay outbox service started (EDGE_STACK=true)');
                }
                if (process.env.DEMO_MODE === 'true') {
                    if (process.env.SKIP_DEMO_SEED === 'true') {
                        fastify.log.info('DEMO_MODE enabled; skipping startup seed (SKIP_DEMO_SEED=true, CLI seed already ran).');
                    }
                    else if (SEED_ON_STARTUP) {
                        fastify.log.info('DEMO_MODE enabled, rebuilding demo data on startup (SEED_ON_STARTUP=true)...');
                        try {
                            await (0, seed_demo_1.seedDemoData)({ forceReseed: true });
                        }
                        catch (seedErr) {
                            fastify.log.error(seedErr, '❌ Demo seed failed (non-fatal) — server will continue without demo data.');
                        }
                    }
                    else {
                        fastify.log.info('DEMO_MODE enabled; restoring demo snapshot and shifting timestamps (fast startup).');
                        try {
                            await (0, seed_demo_1.seedDemoData)({ forceReseed: false });
                        }
                        catch (seedErr) {
                            fastify.log.error(seedErr, '❌ Demo seed failed (non-fatal) — server will continue without demo data.');
                        }
                    }
                }
            }
            else {
                fastify.log.error(`Database initialization failed after ${DB_INIT_MAX_RETRIES} attempts. Server is running but database is unavailable.`);
            }
        }
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}
main().catch(console.error);
