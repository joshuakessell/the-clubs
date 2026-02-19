"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkoutRoutes = checkoutRoutes;
const kiosk_1 = require("./checkout/kiosk");
const manual_1 = require("./checkout/manual");
const staff_actions_1 = require("./checkout/staff-actions");
/**
 * Checkout routes for customer-operated checkout kiosk and employee verification.
 */
async function checkoutRoutes(fastify) {
    (0, manual_1.registerCheckoutManualRoutes)(fastify);
    (0, kiosk_1.registerCheckoutKioskRoutes)(fastify);
    (0, staff_actions_1.registerCheckoutStaffRoutes)(fastify);
}
