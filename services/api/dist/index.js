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
const helmet_1 = __importDefault(require("@fastify/helmet"));
const loadEnv_1 = require("./env/loadEnv");
const routes_1 = require("./routes");
const errorHandler_1 = require("./plugins/errorHandler");
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
// Fallback defaults for local dev (matching docker-compose.yml: 5433->5432)
if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5433';
    process.env.DB_NAME = 'club_operations';
    process.env.DB_USER = 'clubops';
    process.env.DB_PASSWORD = 'club-ops-dev';
}
if (!process.env.KIOSK_TOKEN) {
    process.env.KIOSK_TOKEN = 'dev-kiosk-token';
}
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const SKIP_DB = process.env.SKIP_DB === 'true';
const SEED_ON_STARTUP = process.env.SEED_ON_STARTUP === 'true';
const KIOSK_TOKEN = process.env.KIOSK_TOKEN?.trim();
if (!KIOSK_TOKEN) {
    console.error('FATAL: Missing required env var KIOSK_TOKEN. Refusing to start API server.');
    process.exit(1);
}
async function setupSecurityAndCors(fastify) {
    await fastify.register(helmet_1.default, {
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
    const defaultDevOrigins = [
        'http://localhost:5173', 'http://127.0.0.1:5173',
        'http://localhost:5174', 'http://127.0.0.1:5174',
        'http://localhost:5175', 'http://127.0.0.1:5175',
        'http://localhost:5176', 'http://127.0.0.1:5176',
    ];
    const rawOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
        : null;
    let allowedOrigins;
    if (!rawOrigins) {
        allowedOrigins = defaultDevOrigins;
    }
    else if (rawOrigins.length === 1 && rawOrigins[0] === '*') {
        allowedOrigins = defaultDevOrigins;
    }
    else {
        allowedOrigins = rawOrigins;
    }
    if (allowedOrigins === defaultDevOrigins) {
        fastify.log.info('ALLOWED_ORIGINS unset or "*". Falling back to strict local dev origins: ' + defaultDevOrigins.join(', '));
    }
    await fastify.register(cors_1.default, {
        origin: allowedOrigins,
        credentials: true,
    });
}
async function setupRateLimiting(fastify) {
    await fastify.register(rate_limit_1.default, {
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
function setupHooks(fastify) {
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
            }
            catch {
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
    if (process.env.SKIP_DB === 'true')
        return false;
    if ((process.env.DATABASE_URL ?? '').trim())
        return true;
    const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
    return required.every((k) => (process.env[k] ?? '').trim());
};
function setupPeriodicJobs(fastify) {
    const i1 = setInterval(() => {
        void (async () => {
            try {
                const cleaned = await (0, registers_1.cleanupAbandonedRegisterSessions)(fastify);
                if (cleaned > 0)
                    fastify.log.info(`Cleaned up ${cleaned} abandoned register session(s)`);
            }
            catch (error) {
                fastify.log.error(error, 'Error during register session cleanup');
            }
        })();
    }, 30000);
    const i2 = setInterval(() => {
        void (async () => {
            try {
                const expired = await (0, expireWaitlist_1.expireWaitlistEntries)(fastify);
                if (expired > 0)
                    fastify.log.info(`Expired ${expired} waitlist entr${expired === 1 ? 'y' : 'ies'}`);
            }
            catch (error) {
                fastify.log.error(error, 'Error during waitlist expiry');
            }
        })();
    }, 60000);
    const i3 = setInterval(() => {
        void (async () => {
            try {
                const { db: dbInstance } = await Promise.resolve().then(() => __importStar(require('./db')));
                const { sql: sqlTag } = await Promise.resolve().then(() => __importStar(require('drizzle-orm')));
                const result = await dbInstance.execute(sqlTag `DELETE FROM idempotency_keys WHERE expires_at < NOW()`);
                if (result.rowCount && result.rowCount > 0)
                    fastify.log.info(`Cleaned up ${result.rowCount} expired idempotency key(s)`);
            }
            catch { /* ignore */ }
        })();
    }, 5 * 60 * 1000);
    const intervals = [i1, i2, i3];
    if (isDbConfigured()) {
        const i4 = setInterval(() => {
            void (async () => {
                try {
                    const { expired } = await (0, upgradeHolds_1.processUpgradeHoldsTick)(fastify);
                    if (expired > 0)
                        fastify.log.info({ expired }, 'Processed upgrade hold expirations');
                }
                catch (error) {
                    fastify.log.error(error, 'Error during upgrade hold processing');
                }
            })();
        }, 5000);
        intervals.push(i4);
    }
    else {
        fastify.log.warn('DB not configured (or SKIP_DB=true); skipping upgrade hold processing.');
    }
    return intervals;
}
async function registerAllRoutes(fastify) {
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
}
async function verifyDatabaseHealth(fastify) {
    try {
        const { db: dbInstance } = await Promise.resolve().then(() => __importStar(require('./db')));
        const { sql: sqlTag } = await Promise.resolve().then(() => __importStar(require('drizzle-orm')));
        const healthRes = await dbInstance.execute(sqlTag `SELECT 'staff' as tbl, COUNT(*)::text as cnt FROM staff
      UNION ALL SELECT 'rooms', COUNT(*)::text FROM inventory_resources WHERE kind = 'room'
      UNION ALL SELECT 'lockers', COUNT(*)::text FROM inventory_resources WHERE kind = 'locker'
      UNION ALL SELECT 'customers', COUNT(*)::text FROM customers
      UNION ALL SELECT 'agreements', COUNT(*)::text FROM agreements WHERE active = true
      UNION ALL SELECT 'devices', COUNT(*)::text FROM devices
      UNION ALL SELECT 'staff_sessions', COUNT(*)::text FROM staff_sessions WHERE revoked_at IS NULL AND expires_at > NOW()`);
        const counts = Object.fromEntries(healthRes.rows.map(r => [r.tbl, Number.parseInt(r.cnt, 10)]));
        const critical = ['staff', 'rooms', 'lockers', 'agreements', 'devices'];
        const missing = critical.filter(t => (counts[t] ?? 0) === 0);
        if (missing.length > 0) {
            fastify.log.warn(`⚠️  DB HEALTH: Empty critical tables: [${missing.join(', ')}] — seed may have failed! Run 'pnpm demo:seed'.`);
        }
        fastify.log.info(`📊 DB health: ${counts.staff ?? 0} staff, ${counts.rooms ?? 0} rooms, ${counts.lockers ?? 0} lockers, ` +
            `${counts.customers ?? 0} customers, ${counts.agreements ?? 0} agreements, ${counts.devices ?? 0} devices, ` +
            `${counts.staff_sessions ?? 0} active sessions`);
    }
    catch (err) {
        fastify.log.warn(err, 'Failed to run startup health check');
    }
}
function startSubsystems(fastify, abortSignal) {
    if (process.env.EDGE_STACK === 'true' && process.env.CLOUD_API_BASE_URL) {
        (0, autoReplayOutbox_1.startAutoReplayOutbox)({
            pool: (0, db_1.getPool)(),
            cloudApiBase: process.env.CLOUD_API_BASE_URL.replaceAll(/\/$/, ''),
            kioskToken: process.env.KIOSK_TOKEN,
            signal: abortSignal,
            log: (...args) => fastify.log.info(String(args.map(String).join(' '))),
        });
        fastify.log.info('Auto-replay outbox service started (EDGE_STACK=true)');
    }
}
async function handleDemoSeeding(fastify) {
    if (process.env.DEMO_MODE === 'true') {
        if (process.env.SKIP_DEMO_SEED === 'true') {
            fastify.log.info('DEMO_MODE enabled; skipping startup seed.');
        }
        else {
            fastify.log.info(`DEMO_MODE enabled, seeding demo data (SEED_ON_STARTUP=${process.env.SEED_ON_STARTUP === 'true'})...`);
            try {
                await (0, seed_demo_1.seedDemoData)({ forceReseed: false });
            }
            catch (err) {
                fastify.log.error(err, '❌ Demo seed failed');
            }
        }
    }
}
async function initializeDbAndSeed(fastify, abortSignal) {
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
    if (!dbInitialized) {
        fastify.log.error(`Database initialization failed after ${DB_INIT_MAX_RETRIES} attempts.`);
        return;
    }
    try {
        await (0, migrate_1.runPendingMigrations)();
    }
    catch (err) {
        fastify.log.error(err, '❌ Schema migration failed');
    }
    await verifyDatabaseHealth(fastify);
    startSubsystems(fastify, abortSignal);
    await handleDemoSeeding(fastify);
}
async function main() {
    const fastify = (0, fastify_1.default)({
        logger: {
            level: process.env.LOG_LEVEL || 'info',
            ...(process.env.NODE_ENV === 'production' ? {} : {
                transport: {
                    target: 'pino-pretty',
                    options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
                },
            }),
        },
        ajv: {
            customOptions: {
                strict: false,
                allowUnionTypes: true,
            },
        },
    });
    await setupSecurityAndCors(fastify);
    await setupRateLimiting(fastify);
    setupHooks(fastify);
    await fastify.register(errorHandler_1.errorHandlerPlugin);
    await fastify.register(websocket_1.default);
    const localLaneSockets = new localSockets_1.LocalLaneSockets();
    const localLaneSSE = new localSSE_1.LocalLaneSSEClients();
    fastify.decorate('localLaneSockets', localLaneSockets);
    fastify.decorate('localLaneSSE', localLaneSSE);
    const broadcaster = (0, broadcaster_1.createBroadcaster)({ localLaneSockets, localLaneSSE, logger: fastify.log });
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
        if (!SKIP_DB)
            await (0, db_1.closeDatabase)();
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
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}
// NOSONAR
void (async () => {
    try {
        await main();
    }
    catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
