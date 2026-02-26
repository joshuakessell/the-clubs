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
exports.db = exports.pg = void 0;
exports.loadDatabaseConfig = loadDatabaseConfig;
exports.getPool = getPool;
exports.initializeDatabase = initializeDatabase;
exports.closeDatabase = closeDatabase;
exports.query = query;
exports.transaction = transaction;
exports.serializableTransaction = serializableTransaction;
exports.getDb = getDb;
const node_fs_1 = __importDefault(require("node:fs"));
const pg_1 = __importDefault(require("pg"));
exports.pg = pg_1.default;
const node_postgres_1 = require("drizzle-orm/node-postgres");
const schema = __importStar(require("./schema"));
const { Pool } = pg_1.default;
function resolveSslConfig() {
    if (process.env.DB_SSL !== 'true') {
        return undefined;
    }
    const sslCaPath = (process.env.DB_SSL_CA_PATH ?? '').trim();
    if (sslCaPath) {
        return {
            ca: node_fs_1.default.readFileSync(sslCaPath, 'utf8'),
            rejectUnauthorized: true,
        };
    }
    return { rejectUnauthorized: false };
}
function parseConnectionTimeoutMillis() {
    const raw = (process.env.DB_CONNECTION_TIMEOUT_MS ?? '').trim();
    if (!raw)
        return 5000;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0)
        return 5000;
    return Math.floor(value);
}
function parseDatabaseUrl(urlString) {
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
    }
    catch {
        return {};
    }
}
/**
 * Load database configuration from environment variables.
 */
function loadDatabaseConfig() {
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
            }
            catch {
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
    const hasExplicitHost = typeof process.env.DB_HOST === 'string' && process.env.DB_HOST.trim().length > 0;
    if (!hasExplicitHost) {
        throw new Error('Database is not configured. Set DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD.');
    }
    return {
        host: process.env.DB_HOST.trim(),
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
let pool = null;
/**
 * Get the shared database connection pool.
 * Creates the pool on first call.
 */
function getPool() {
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
async function initializeDatabase() {
    const dbPool = getPool();
    // Test the connection
    const client = await dbPool.connect();
    try {
        await client.query('SELECT NOW()');
        console.log('Database connection established');
    }
    finally {
        client.release();
    }
    return dbPool;
}
/**
 * Close the database connection pool.
 */
async function closeDatabase() {
    if (pool) {
        await pool.end();
        pool = null;
        console.log('Database connection pool closed');
    }
}
/**
 * Execute a query with automatic client acquisition and release.
 */
async function query(text, params) {
    const dbPool = getPool();
    const start = Date.now();
    const result = await dbPool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.DB_LOG_QUERIES === 'true') {
        if (process.env.NODE_ENV === 'production') {
            // In production, only log duration and row count to avoid leaking schema details
            console.log('Executed query', { duration, rows: result.rowCount });
        }
        else {
            console.log('Executed query', { text, duration, rows: result.rowCount });
        }
    }
    return result;
}
/**
 * Execute a transaction with automatic commit/rollback.
 */
async function transaction(callback) {
    const dbPool = getPool();
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
/**
 * Execute a serializable transaction for critical operations like bookings.
 * This provides the highest isolation level to prevent race conditions.
 */
async function serializableTransaction(callback) {
    const dbPool = getPool();
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
/**
 * Drizzle ORM client wrapping the shared pg.Pool.
 * Provides type-safe queries via the auto-generated schema.
 *
 * Usage:
 *   import { db } from '../db';
 *   import { customers, staff } from '../db/schema';
 *   import { eq } from 'drizzle-orm';
 *
 *   const rows = await db.select().from(customers).where(eq(customers.name, 'John'));
 */
let _db = null;
function getDb() {
    if (!_db) {
        _db = (0, node_postgres_1.drizzle)(getPool(), { schema });
    }
    return _db;
}
/** Convenience alias — prefer `getDb()` if you need to ensure the pool is initialized. */
exports.db = new Proxy({}, {
    get(_target, prop, receiver) {
        return Reflect.get(getDb(), prop, receiver);
    },
});
