/**
 * seed-demo.ts — Thin wrapper around the unified simulator.
 *
 * This module is the public API used by the server startup path (index.ts)
 * and the `seed:demo` npm script. All simulation logic now lives in
 * `./seed-demo/simulator.ts`. This file re-exports `runSimulator` under
 * the legacy name `seedDemoData` so existing call sites keep working.
 */
import { loadEnvFromDotEnvIfPresent } from '../env/loadEnv';
import { closeDatabase } from './index';
import { runSimulator } from './seed-demo/simulator';

loadEnvFromDotEnvIfPresent();

/**
 * Main entrypoint for demo seeding.
 * Called from index.ts at startup (DEMO_MODE=true) and from the CLI.
 */
export async function seedDemoData(options: { forceReseed?: boolean } = {}): Promise<void> {
  if (process.env.DEMO_MODE !== 'true') {
    return;
  }
  await runSimulator(options);
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
    .finally(() => closeDatabase());
}
