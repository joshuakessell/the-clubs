"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRoutes = adminRoutes;
const customers_1 = require("./admin/customers");
const activity_analytics_1 = require("./admin/activity-analytics");
const activity_log_1 = require("./admin/activity-log");
const devices_1 = require("./admin/devices");
const kpi_1 = require("./admin/kpi");
const metrics_1 = require("./admin/metrics");
const register_sessions_1 = require("./admin/register-sessions");
const reports_1 = require("./admin/reports");
const rooms_1 = require("./admin/rooms");
const staff_1 = require("./admin/staff");
const late_checkout_ban_alerts_1 = require("./admin/late-checkout-ban-alerts");
const shift_templates_1 = require("./admin/shift-templates");
const club_log_1 = require("./admin/club-log");
const club_analytics_1 = require("./admin/club-analytics");
const products_1 = require("./admin/products");
const messages_1 = require("./admin/messages");
const room_management_1 = require("./admin/room-management");
/**
 * Admin-only routes for operations management and metrics.
 */
async function adminRoutes(fastify) {
    (0, metrics_1.registerAdminMetricsRoutes)(fastify);
    (0, activity_log_1.registerAdminActivityLogRoutes)(fastify);
    (0, activity_analytics_1.registerAdminActivityAnalyticsRoutes)(fastify);
    (0, rooms_1.registerAdminRoomRoutes)(fastify);
    (0, kpi_1.registerAdminKpiRoutes)(fastify);
    (0, staff_1.registerAdminStaffRoutes)(fastify);
    (0, register_sessions_1.registerAdminRegisterSessionRoutes)(fastify);
    (0, devices_1.registerAdminDeviceRoutes)(fastify);
    (0, customers_1.registerAdminCustomerRoutes)(fastify);
    (0, late_checkout_ban_alerts_1.registerAdminLateCheckoutBanAlertRoutes)(fastify);
    (0, reports_1.registerAdminReportRoutes)(fastify);
    (0, shift_templates_1.registerShiftTemplateRoutes)(fastify);
    (0, club_log_1.registerAdminClubLogRoutes)(fastify);
    (0, club_analytics_1.registerAdminClubAnalyticsRoutes)(fastify);
    (0, products_1.registerAdminProductRoutes)(fastify);
    (0, messages_1.registerAdminMessageRoutes)(fastify);
    (0, room_management_1.registerRoomManagementRoutes)(fastify);
}
