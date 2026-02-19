import type { FastifyInstance } from 'fastify';
import type { Broadcaster } from '../realtime/broadcaster';
import { registerCheckoutKioskRoutes } from './checkout/kiosk';
import { registerCheckoutManualRoutes } from './checkout/manual';
import { registerCheckoutStaffRoutes } from './checkout/staff-actions';

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

/**
 * Checkout routes for customer-operated checkout kiosk and employee verification.
 */
export async function checkoutRoutes(fastify: FastifyInstance): Promise<void> {
  registerCheckoutManualRoutes(fastify);

  registerCheckoutKioskRoutes(fastify);

  registerCheckoutStaffRoutes(fastify);
}
