import { afterAll } from 'vitest';
import { closeDatabase } from '../src/db/index.js';

// Guardrail: ensure the shared pg.Pool is always closed so Vitest can exit deterministically,
// even if individual test files forget to tear down the DB.
afterAll(async () => {
  await closeDatabase();
});
