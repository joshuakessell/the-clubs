"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDemoData = seedDemoData;
/**
 * seed-demo.ts — Thin wrapper around the unified simulator.
 *
 * This module is the public API used by the server startup path (index.ts)
 * and the `seed:demo` npm script. All simulation logic now lives in
 * `./seed-demo/simulator.ts`. This file re-exports `runSimulator` under
 * the legacy name `seedDemoData` so existing call sites keep working.
 */
const loadEnv_1 = require("../env/loadEnv");
const index_1 = require("./index");
const simulator_1 = require("./seed-demo/simulator");
(0, loadEnv_1.loadEnvFromDotEnvIfPresent)();
/**
 * Main entrypoint for demo seeding.
 * Called from index.ts at startup (DEMO_MODE=true) and from the CLI.
 */
async function seedDemoData(options = {}) {
    if (process.env.DEMO_MODE !== 'true') {
        return;
    }
    await (0, simulator_1.runSimulator)(options);
}
// ---------------------------------------------------------------------------
// CLI entrypoint
// Allows running: DEMO_MODE=true pnpm --filter @the-clubs/api exec tsx src/db/seed-demo.ts
// ---------------------------------------------------------------------------
if (require.main === module) {
    seedDemoData()
        .catch((err) => {
        console.error('❌ seed-demo CLI failed:', err);
        process.exitCode = 1;
    })
        .finally(() => (0, index_1.closeDatabase)());
}
