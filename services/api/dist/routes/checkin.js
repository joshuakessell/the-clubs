"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkinRoutes = checkinRoutes;
const add_ons_1 = require("./checkin/add-ons");
const agreements_1 = require("./checkin/agreements");
const demo_payment_1 = require("./checkin/demo-payment");
const flow_command_1 = require("./checkin/flow-command");
const highlight_option_1 = require("./checkin/highlight-option");
const lane_session_1 = require("./checkin/lane-session");
const lane_sessions_1 = require("./checkin/lane-sessions");
const language_1 = require("./checkin/language");
const membership_1 = require("./checkin/membership");
const notes_1 = require("./checkin/notes");
const past_due_1 = require("./checkin/past-due");
const payment_intent_1 = require("./checkin/payment-intent");
const reset_1 = require("./checkin/reset");
const scan_1 = require("./checkin/scan");
const selection_1 = require("./checkin/selection");
const switch_resource_1 = require("./checkin/switch-resource");
const waitlist_1 = require("./checkin/waitlist");
const kiosk_heartbeat_1 = require("./checkin/kiosk-heartbeat");
/**
 * Check-in flow routes.
 */
async function checkinRoutes(fastify) {
    (0, lane_session_1.registerCheckinLaneSessionRoutes)(fastify);
    (0, scan_1.registerCheckinScanRoutes)(fastify);
    (0, selection_1.registerCheckinSelectionRoutes)(fastify);
    (0, switch_resource_1.registerCheckinSwitchResourceRoutes)(fastify);
    (0, waitlist_1.registerCheckinWaitlistRoutes)(fastify);
    (0, payment_intent_1.registerCheckinPaymentIntentRoutes)(fastify);
    (0, agreements_1.registerCheckinAgreementRoutes)(fastify);
    (0, lane_sessions_1.registerCheckinLaneSessionsRoutes)(fastify);
    (0, past_due_1.registerCheckinPastDueRoutes)(fastify);
    (0, language_1.registerCheckinLanguageRoutes)(fastify);
    (0, membership_1.registerCheckinMembershipRoutes)(fastify);
    (0, add_ons_1.registerCheckinAddOnRoutes)(fastify);
    (0, highlight_option_1.registerCheckinHighlightRoutes)(fastify);
    (0, notes_1.registerCheckinNoteRoutes)(fastify);
    (0, demo_payment_1.registerCheckinDemoPaymentRoutes)(fastify);
    (0, flow_command_1.registerCheckinFlowCommandRoutes)(fastify);
    (0, reset_1.registerCheckinResetRoutes)(fastify);
    (0, kiosk_heartbeat_1.registerKioskHeartbeatRoutes)(fastify);
}
