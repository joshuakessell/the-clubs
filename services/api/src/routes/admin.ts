import type { FastifyInstance } from 'fastify';
import { registerAdminCustomerRoutes } from './admin/customers';
import { registerAdminActivityAnalyticsRoutes } from './admin/activity-analytics';
import { registerAdminActivityLogRoutes } from './admin/activity-log';
import { registerAdminDeviceRoutes } from './admin/devices';
import { registerAdminKpiRoutes } from './admin/kpi';
import { registerAdminMetricsRoutes } from './admin/metrics';
import { registerAdminRegisterSessionRoutes } from './admin/register-sessions';
import { registerAdminReportRoutes } from './admin/reports';
import { registerAdminRoomRoutes } from './admin/rooms';
import { registerAdminStaffRoutes } from './admin/staff';
import { registerAdminLateCheckoutBanAlertRoutes } from './admin/late-checkout-ban-alerts';
import { registerShiftTemplateRoutes } from './admin/shift-templates';
import { registerAdminClubLogRoutes } from './admin/club-log';
import { registerAdminClubAnalyticsRoutes } from './admin/club-analytics';
import { registerAdminProductRoutes } from './admin/products';

/**
 * Admin-only routes for operations management and metrics.
 */
export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  registerAdminMetricsRoutes(fastify);

  registerAdminActivityLogRoutes(fastify);
  registerAdminActivityAnalyticsRoutes(fastify);

  registerAdminRoomRoutes(fastify);

  registerAdminKpiRoutes(fastify);

  registerAdminStaffRoutes(fastify);

  registerAdminRegisterSessionRoutes(fastify);

  registerAdminDeviceRoutes(fastify);

  registerAdminCustomerRoutes(fastify);

  registerAdminLateCheckoutBanAlertRoutes(fastify);

  registerAdminReportRoutes(fastify);

  registerShiftTemplateRoutes(fastify);

  registerAdminClubLogRoutes(fastify);
  registerAdminClubAnalyticsRoutes(fastify);
  registerAdminProductRoutes(fastify);
}
