"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const pg_1 = __importDefault(require("pg"));
const index_1 = require("./index");
const loadEnv_1 = require("../env/loadEnv");
(0, loadEnv_1.loadEnvFromDotEnvIfPresent)();
const MIGRATIONS_TABLE = 'schema_migrations';
async function loadMigrationNames() {
    const migrationsDir = (0, node_path_1.join)(__dirname, '../../migrations');
    const files = await (0, promises_1.readdir)(migrationsDir);
    return files
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((f) => f.replace('.sql', ''));
}
async function getExecutedMigrations(client) {
    const exists = await client.query(`SELECT to_regclass('public.${MIGRATIONS_TABLE}') as exists`);
    if (!exists.rows[0]?.exists) {
        return new Set();
    }
    const result = await client.query(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id`);
    return new Set(result.rows.map((row) => row.name));
}
async function run() {
    const config = (0, index_1.loadDatabaseConfig)();
    const pool = new pg_1.default.Pool(config);
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
    }
    finally {
        client.release();
        await pool.end();
    }
}
run().catch((error) => {
    console.error('Failed to read migration status:', error);
    process.exit(1);
});
