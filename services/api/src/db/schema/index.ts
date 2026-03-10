/**
 * Barrel export for all Drizzle schema definitions.
 *
 * Usage:
 *   import { customers, staff, inventoryResources } from '../db/schema';
 *   import { db } from '../db';
 *   const result = await db.select().from(customers).where(eq(customers.name, 'John'));
 */
export * from './schema';
export * from './relations';
