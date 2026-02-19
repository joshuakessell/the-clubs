import type { FastifyInstance } from 'fastify';
import type { Broadcaster } from '../realtime/broadcaster';
import { registerCheckinAddOnRoutes } from './checkin/add-ons';
import { registerCheckinAgreementRoutes } from './checkin/agreements';
import { registerCheckinDemoPaymentRoutes } from './checkin/demo-payment';
import { registerCheckinFlowCommandRoutes } from './checkin/flow-command';
import { registerCheckinHighlightRoutes } from './checkin/highlight-option';
import { registerCheckinLaneSessionRoutes } from './checkin/lane-session';
import { registerCheckinLaneSessionsRoutes } from './checkin/lane-sessions';
import { registerCheckinLanguageRoutes } from './checkin/language';
import { registerCheckinMembershipRoutes } from './checkin/membership';
import { registerCheckinNoteRoutes } from './checkin/notes';
import { registerCheckinPastDueRoutes } from './checkin/past-due';
import { registerCheckinPaymentIntentRoutes } from './checkin/payment-intent';
import { registerCheckinResetRoutes } from './checkin/reset';
import { registerCheckinScanRoutes } from './checkin/scan';
import { registerCheckinSelectionRoutes } from './checkin/selection';
import { registerCheckinSwitchResourceRoutes } from './checkin/switch-resource';
import { registerCheckinWaitlistRoutes } from './checkin/waitlist';

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

/**
 * Check-in flow routes.
 */
export async function checkinRoutes(fastify: FastifyInstance): Promise<void> {
  registerCheckinLaneSessionRoutes(fastify);

  registerCheckinScanRoutes(fastify);

  registerCheckinSelectionRoutes(fastify);

  registerCheckinSwitchResourceRoutes(fastify);

  registerCheckinWaitlistRoutes(fastify);

  registerCheckinPaymentIntentRoutes(fastify);

  registerCheckinAgreementRoutes(fastify);

  registerCheckinLaneSessionsRoutes(fastify);

  registerCheckinPastDueRoutes(fastify);

  registerCheckinLanguageRoutes(fastify);

  registerCheckinMembershipRoutes(fastify);

  registerCheckinAddOnRoutes(fastify);

  registerCheckinHighlightRoutes(fastify);

  registerCheckinNoteRoutes(fastify);

  registerCheckinDemoPaymentRoutes(fastify);

  registerCheckinFlowCommandRoutes(fastify);

  registerCheckinResetRoutes(fastify);
}
