import { db } from '../db';
import { cashDrawerSessions, cashDrawerEvents, registerSessions, orders } from '../db/schema';
import { eq, and, sql, sum, gte } from 'drizzle-orm';
// Test query
