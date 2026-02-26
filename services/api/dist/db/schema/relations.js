"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.laneSessionCommandsRelations = exports.clubEventsRelations = exports.schedulePatternsRelations = exports.lateCheckoutBanAlertsRelations = exports.customerSpendLedgerEntriesRelations = exports.customerActivityEventsRelations = exports.customerNotesRelations = exports.receiptsRelations = exports.orderLineItemsRelations = exports.ordersRelations = exports.staffBreakSessionsRelations = exports.cashDrawerEventsRelations = exports.cashDrawerSessionsRelations = exports.auditLogRelations = exports.lateCheckoutEventsRelations = exports.cleaningEventsRelations = exports.cleaningBatchesRelations = exports.cleaningBatchRoomsRelations = exports.checkoutRequestsRelations = exports.registerSessionsRelations = exports.paymentIntentsRelations = exports.chargesRelations = exports.inventoryReservationsRelations = exports.laneSessionsRelations = exports.agreementsRelations = exports.agreementSignaturesRelations = exports.checkinBlocksRelations = exports.waitlistRelations = exports.keyTagsRelations = exports.roomsRelations = exports.lockersRelations = exports.webauthnChallengesRelations = exports.timeclockSessionsRelations = exports.timeOffRequestsRelations = exports.staffWebauthnCredentialsRelations = exports.shiftTemplatesRelations = exports.employeeShiftsRelations = exports.staffSessionsRelations = exports.staffRelations = exports.employeeDocumentsRelations = exports.customersRelations = exports.visitsRelations = void 0;
const relations_1 = require("drizzle-orm/relations");
const schema_1 = require("./schema");
exports.visitsRelations = (0, relations_1.relations)(schema_1.visits, ({ one, many }) => ({
    customer: one(schema_1.customers, {
        fields: [schema_1.visits.customerId],
        references: [schema_1.customers.id]
    }),
    waitlists: many(schema_1.waitlist),
    checkinBlocks: many(schema_1.checkinBlocks),
    charges: many(schema_1.charges),
    customerSpendLedgerEntries: many(schema_1.customerSpendLedgerEntries),
    lateCheckoutBanAlerts: many(schema_1.lateCheckoutBanAlerts),
}));
exports.customersRelations = (0, relations_1.relations)(schema_1.customers, ({ many }) => ({
    visits: many(schema_1.visits),
    lockers: many(schema_1.lockers),
    rooms: many(schema_1.rooms),
    checkoutRequests: many(schema_1.checkoutRequests),
    lateCheckoutEvents: many(schema_1.lateCheckoutEvents),
    orders: many(schema_1.orders),
    customerNotes: many(schema_1.customerNotes),
    customerActivityEvents: many(schema_1.customerActivityEvents),
    customerSpendLedgerEntries: many(schema_1.customerSpendLedgerEntries),
    lateCheckoutBanAlerts: many(schema_1.lateCheckoutBanAlerts),
    laneSessions: many(schema_1.laneSessions),
    clubEvents: many(schema_1.clubEvents),
}));
exports.employeeDocumentsRelations = (0, relations_1.relations)(schema_1.employeeDocuments, ({ one }) => ({
    staff_employeeId: one(schema_1.staff, {
        fields: [schema_1.employeeDocuments.employeeId],
        references: [schema_1.staff.id],
        relationName: "employeeDocuments_employeeId_staff_id"
    }),
    staff_uploadedBy: one(schema_1.staff, {
        fields: [schema_1.employeeDocuments.uploadedBy],
        references: [schema_1.staff.id],
        relationName: "employeeDocuments_uploadedBy_staff_id"
    }),
}));
exports.staffRelations = (0, relations_1.relations)(schema_1.staff, ({ many }) => ({
    employeeDocuments_employeeId: many(schema_1.employeeDocuments, {
        relationName: "employeeDocuments_employeeId_staff_id"
    }),
    employeeDocuments_uploadedBy: many(schema_1.employeeDocuments, {
        relationName: "employeeDocuments_uploadedBy_staff_id"
    }),
    staffSessions: many(schema_1.staffSessions),
    employeeShifts_createdBy: many(schema_1.employeeShifts, {
        relationName: "employeeShifts_createdBy_staff_id"
    }),
    employeeShifts_employeeId: many(schema_1.employeeShifts, {
        relationName: "employeeShifts_employeeId_staff_id"
    }),
    employeeShifts_updatedBy: many(schema_1.employeeShifts, {
        relationName: "employeeShifts_updatedBy_staff_id"
    }),
    staffWebauthnCredentials: many(schema_1.staffWebauthnCredentials),
    timeOffRequests_decidedBy: many(schema_1.timeOffRequests, {
        relationName: "timeOffRequests_decidedBy_staff_id"
    }),
    timeOffRequests_employeeId: many(schema_1.timeOffRequests, {
        relationName: "timeOffRequests_employeeId_staff_id"
    }),
    timeclockSessions_createdBy: many(schema_1.timeclockSessions, {
        relationName: "timeclockSessions_createdBy_staff_id"
    }),
    timeclockSessions_employeeId: many(schema_1.timeclockSessions, {
        relationName: "timeclockSessions_employeeId_staff_id"
    }),
    webauthnChallenges: many(schema_1.webauthnChallenges),
    waitlists: many(schema_1.waitlist),
    paymentIntents: many(schema_1.paymentIntents),
    registerSessions: many(schema_1.registerSessions),
    checkoutRequests: many(schema_1.checkoutRequests),
    cleaningEvents: many(schema_1.cleaningEvents),
    auditLogs: many(schema_1.auditLog),
    cashDrawerSessions_openedByStaffId: many(schema_1.cashDrawerSessions, {
        relationName: "cashDrawerSessions_openedByStaffId_staff_id"
    }),
    cashDrawerSessions_closedByStaffId: many(schema_1.cashDrawerSessions, {
        relationName: "cashDrawerSessions_closedByStaffId_staff_id"
    }),
    cashDrawerEvents: many(schema_1.cashDrawerEvents),
    staffBreakSessions: many(schema_1.staffBreakSessions),
    orders: many(schema_1.orders),
    customerNotes: many(schema_1.customerNotes),
    customerActivityEvents: many(schema_1.customerActivityEvents),
    customerSpendLedgerEntries: many(schema_1.customerSpendLedgerEntries),
    shiftTemplates: many(schema_1.shiftTemplates),
    lateCheckoutBanAlerts_createdByStaffId: many(schema_1.lateCheckoutBanAlerts, {
        relationName: "lateCheckoutBanAlerts_createdByStaffId_staff_id"
    }),
    lateCheckoutBanAlerts_decidedByStaffId: many(schema_1.lateCheckoutBanAlerts, {
        relationName: "lateCheckoutBanAlerts_decidedByStaffId_staff_id"
    }),
    schedulePatterns_employeeId: many(schema_1.schedulePatterns, {
        relationName: "schedulePatterns_employeeId_staff_id"
    }),
    schedulePatterns_createdBy: many(schema_1.schedulePatterns, {
        relationName: "schedulePatterns_createdBy_staff_id"
    }),
    laneSessions_staffId: many(schema_1.laneSessions, {
        relationName: "laneSessions_staffId_staff_id"
    }),
    laneSessions_pastDueBypassedByStaffId: many(schema_1.laneSessions, {
        relationName: "laneSessions_pastDueBypassedByStaffId_staff_id"
    }),
    clubEvents: many(schema_1.clubEvents),
}));
exports.staffSessionsRelations = (0, relations_1.relations)(schema_1.staffSessions, ({ one }) => ({
    staff: one(schema_1.staff, {
        fields: [schema_1.staffSessions.staffId],
        references: [schema_1.staff.id]
    }),
}));
exports.employeeShiftsRelations = (0, relations_1.relations)(schema_1.employeeShifts, ({ one, many }) => ({
    staff_createdBy: one(schema_1.staff, {
        fields: [schema_1.employeeShifts.createdBy],
        references: [schema_1.staff.id],
        relationName: "employeeShifts_createdBy_staff_id"
    }),
    staff_employeeId: one(schema_1.staff, {
        fields: [schema_1.employeeShifts.employeeId],
        references: [schema_1.staff.id],
        relationName: "employeeShifts_employeeId_staff_id"
    }),
    staff_updatedBy: one(schema_1.staff, {
        fields: [schema_1.employeeShifts.updatedBy],
        references: [schema_1.staff.id],
        relationName: "employeeShifts_updatedBy_staff_id"
    }),
    shiftTemplate: one(schema_1.shiftTemplates, {
        fields: [schema_1.employeeShifts.templateId],
        references: [schema_1.shiftTemplates.id]
    }),
    timeclockSessions: many(schema_1.timeclockSessions),
}));
exports.shiftTemplatesRelations = (0, relations_1.relations)(schema_1.shiftTemplates, ({ one, many }) => ({
    employeeShifts: many(schema_1.employeeShifts),
    staff: one(schema_1.staff, {
        fields: [schema_1.shiftTemplates.createdBy],
        references: [schema_1.staff.id]
    }),
    schedulePatterns: many(schema_1.schedulePatterns),
}));
exports.staffWebauthnCredentialsRelations = (0, relations_1.relations)(schema_1.staffWebauthnCredentials, ({ one }) => ({
    staff: one(schema_1.staff, {
        fields: [schema_1.staffWebauthnCredentials.staffId],
        references: [schema_1.staff.id]
    }),
}));
exports.timeOffRequestsRelations = (0, relations_1.relations)(schema_1.timeOffRequests, ({ one }) => ({
    staff_decidedBy: one(schema_1.staff, {
        fields: [schema_1.timeOffRequests.decidedBy],
        references: [schema_1.staff.id],
        relationName: "timeOffRequests_decidedBy_staff_id"
    }),
    staff_employeeId: one(schema_1.staff, {
        fields: [schema_1.timeOffRequests.employeeId],
        references: [schema_1.staff.id],
        relationName: "timeOffRequests_employeeId_staff_id"
    }),
}));
exports.timeclockSessionsRelations = (0, relations_1.relations)(schema_1.timeclockSessions, ({ one, many }) => ({
    staff_createdBy: one(schema_1.staff, {
        fields: [schema_1.timeclockSessions.createdBy],
        references: [schema_1.staff.id],
        relationName: "timeclockSessions_createdBy_staff_id"
    }),
    staff_employeeId: one(schema_1.staff, {
        fields: [schema_1.timeclockSessions.employeeId],
        references: [schema_1.staff.id],
        relationName: "timeclockSessions_employeeId_staff_id"
    }),
    employeeShift: one(schema_1.employeeShifts, {
        fields: [schema_1.timeclockSessions.shiftId],
        references: [schema_1.employeeShifts.id]
    }),
    staffBreakSessions: many(schema_1.staffBreakSessions),
}));
exports.webauthnChallengesRelations = (0, relations_1.relations)(schema_1.webauthnChallenges, ({ one }) => ({
    staff: one(schema_1.staff, {
        fields: [schema_1.webauthnChallenges.staffId],
        references: [schema_1.staff.id]
    }),
}));
exports.lockersRelations = (0, relations_1.relations)(schema_1.lockers, ({ one, many }) => ({
    customer: one(schema_1.customers, {
        fields: [schema_1.lockers.assignedToCustomerId],
        references: [schema_1.customers.id]
    }),
    keyTags: many(schema_1.keyTags),
    checkinBlocks: many(schema_1.checkinBlocks),
}));
exports.roomsRelations = (0, relations_1.relations)(schema_1.rooms, ({ one, many }) => ({
    customer: one(schema_1.customers, {
        fields: [schema_1.rooms.assignedToCustomerId],
        references: [schema_1.customers.id]
    }),
    keyTags: many(schema_1.keyTags),
    waitlists: many(schema_1.waitlist),
    checkinBlocks: many(schema_1.checkinBlocks),
    cleaningBatchRooms: many(schema_1.cleaningBatchRooms),
    cleaningEvents: many(schema_1.cleaningEvents),
}));
exports.keyTagsRelations = (0, relations_1.relations)(schema_1.keyTags, ({ one, many }) => ({
    locker: one(schema_1.lockers, {
        fields: [schema_1.keyTags.lockerId],
        references: [schema_1.lockers.id]
    }),
    room: one(schema_1.rooms, {
        fields: [schema_1.keyTags.roomId],
        references: [schema_1.rooms.id]
    }),
    checkoutRequests: many(schema_1.checkoutRequests),
}));
exports.waitlistRelations = (0, relations_1.relations)(schema_1.waitlist, ({ one, many }) => ({
    staff: one(schema_1.staff, {
        fields: [schema_1.waitlist.cancelledByStaffId],
        references: [schema_1.staff.id]
    }),
    checkinBlock: one(schema_1.checkinBlocks, {
        fields: [schema_1.waitlist.checkinBlockId],
        references: [schema_1.checkinBlocks.id],
        relationName: "waitlist_checkinBlockId_checkinBlocks_id"
    }),
    room: one(schema_1.rooms, {
        fields: [schema_1.waitlist.roomId],
        references: [schema_1.rooms.id]
    }),
    visit: one(schema_1.visits, {
        fields: [schema_1.waitlist.visitId],
        references: [schema_1.visits.id]
    }),
    checkinBlocks: many(schema_1.checkinBlocks, {
        relationName: "checkinBlocks_waitlistId_waitlist_id"
    }),
    inventoryReservations: many(schema_1.inventoryReservations),
}));
exports.checkinBlocksRelations = (0, relations_1.relations)(schema_1.checkinBlocks, ({ one, many }) => ({
    waitlists: many(schema_1.waitlist, {
        relationName: "waitlist_checkinBlockId_checkinBlocks_id"
    }),
    agreementSignatures: many(schema_1.agreementSignatures),
    locker: one(schema_1.lockers, {
        fields: [schema_1.checkinBlocks.lockerId],
        references: [schema_1.lockers.id]
    }),
    room: one(schema_1.rooms, {
        fields: [schema_1.checkinBlocks.roomId],
        references: [schema_1.rooms.id]
    }),
    laneSession: one(schema_1.laneSessions, {
        fields: [schema_1.checkinBlocks.sessionId],
        references: [schema_1.laneSessions.id]
    }),
    visit: one(schema_1.visits, {
        fields: [schema_1.checkinBlocks.visitId],
        references: [schema_1.visits.id]
    }),
    waitlist: one(schema_1.waitlist, {
        fields: [schema_1.checkinBlocks.waitlistId],
        references: [schema_1.waitlist.id],
        relationName: "checkinBlocks_waitlistId_waitlist_id"
    }),
    charges: many(schema_1.charges),
    lateCheckoutBanAlerts: many(schema_1.lateCheckoutBanAlerts),
}));
exports.agreementSignaturesRelations = (0, relations_1.relations)(schema_1.agreementSignatures, ({ one }) => ({
    agreement: one(schema_1.agreements, {
        fields: [schema_1.agreementSignatures.agreementId],
        references: [schema_1.agreements.id]
    }),
    checkinBlock: one(schema_1.checkinBlocks, {
        fields: [schema_1.agreementSignatures.checkinBlockId],
        references: [schema_1.checkinBlocks.id]
    }),
}));
exports.agreementsRelations = (0, relations_1.relations)(schema_1.agreements, ({ many }) => ({
    agreementSignatures: many(schema_1.agreementSignatures),
}));
exports.laneSessionsRelations = (0, relations_1.relations)(schema_1.laneSessions, ({ one, many }) => ({
    checkinBlocks: many(schema_1.checkinBlocks),
    inventoryReservations: many(schema_1.inventoryReservations),
    paymentIntents: many(schema_1.paymentIntents, {
        relationName: "paymentIntents_laneSessionId_laneSessions_id"
    }),
    paymentIntent: one(schema_1.paymentIntents, {
        fields: [schema_1.laneSessions.paymentIntentId],
        references: [schema_1.paymentIntents.id],
        relationName: "laneSessions_paymentIntentId_paymentIntents_id"
    }),
    customer: one(schema_1.customers, {
        fields: [schema_1.laneSessions.customerId],
        references: [schema_1.customers.id]
    }),
    staff_staffId: one(schema_1.staff, {
        fields: [schema_1.laneSessions.staffId],
        references: [schema_1.staff.id],
        relationName: "laneSessions_staffId_staff_id"
    }),
    staff_pastDueBypassedByStaffId: one(schema_1.staff, {
        fields: [schema_1.laneSessions.pastDueBypassedByStaffId],
        references: [schema_1.staff.id],
        relationName: "laneSessions_pastDueBypassedByStaffId_staff_id"
    }),
    laneSessionCommands: many(schema_1.laneSessionCommands),
}));
exports.inventoryReservationsRelations = (0, relations_1.relations)(schema_1.inventoryReservations, ({ one }) => ({
    laneSession: one(schema_1.laneSessions, {
        fields: [schema_1.inventoryReservations.laneSessionId],
        references: [schema_1.laneSessions.id]
    }),
    waitlist: one(schema_1.waitlist, {
        fields: [schema_1.inventoryReservations.waitlistId],
        references: [schema_1.waitlist.id]
    }),
}));
exports.chargesRelations = (0, relations_1.relations)(schema_1.charges, ({ one }) => ({
    checkinBlock: one(schema_1.checkinBlocks, {
        fields: [schema_1.charges.checkinBlockId],
        references: [schema_1.checkinBlocks.id]
    }),
    paymentIntent: one(schema_1.paymentIntents, {
        fields: [schema_1.charges.paymentIntentId],
        references: [schema_1.paymentIntents.id]
    }),
    visit: one(schema_1.visits, {
        fields: [schema_1.charges.visitId],
        references: [schema_1.visits.id]
    }),
}));
exports.paymentIntentsRelations = (0, relations_1.relations)(schema_1.paymentIntents, ({ one, many }) => ({
    charges: many(schema_1.charges),
    laneSession: one(schema_1.laneSessions, {
        fields: [schema_1.paymentIntents.laneSessionId],
        references: [schema_1.laneSessions.id],
        relationName: "paymentIntents_laneSessionId_laneSessions_id"
    }),
    staff: one(schema_1.staff, {
        fields: [schema_1.paymentIntents.paidByStaffId],
        references: [schema_1.staff.id]
    }),
    laneSessions: many(schema_1.laneSessions, {
        relationName: "laneSessions_paymentIntentId_paymentIntents_id"
    }),
}));
exports.registerSessionsRelations = (0, relations_1.relations)(schema_1.registerSessions, ({ one, many }) => ({
    staff: one(schema_1.staff, {
        fields: [schema_1.registerSessions.employeeId],
        references: [schema_1.staff.id]
    }),
    cashDrawerSessions: many(schema_1.cashDrawerSessions),
    orders: many(schema_1.orders),
}));
exports.checkoutRequestsRelations = (0, relations_1.relations)(schema_1.checkoutRequests, ({ one, many }) => ({
    staff: one(schema_1.staff, {
        fields: [schema_1.checkoutRequests.claimedByStaffId],
        references: [schema_1.staff.id]
    }),
    customer: one(schema_1.customers, {
        fields: [schema_1.checkoutRequests.customerId],
        references: [schema_1.customers.id]
    }),
    keyTag: one(schema_1.keyTags, {
        fields: [schema_1.checkoutRequests.keyTagId],
        references: [schema_1.keyTags.id]
    }),
    lateCheckoutEvents: many(schema_1.lateCheckoutEvents),
    lateCheckoutBanAlerts: many(schema_1.lateCheckoutBanAlerts),
}));
exports.cleaningBatchRoomsRelations = (0, relations_1.relations)(schema_1.cleaningBatchRooms, ({ one }) => ({
    cleaningBatch: one(schema_1.cleaningBatches, {
        fields: [schema_1.cleaningBatchRooms.batchId],
        references: [schema_1.cleaningBatches.id]
    }),
    room: one(schema_1.rooms, {
        fields: [schema_1.cleaningBatchRooms.roomId],
        references: [schema_1.rooms.id]
    }),
}));
exports.cleaningBatchesRelations = (0, relations_1.relations)(schema_1.cleaningBatches, ({ many }) => ({
    cleaningBatchRooms: many(schema_1.cleaningBatchRooms),
}));
exports.cleaningEventsRelations = (0, relations_1.relations)(schema_1.cleaningEvents, ({ one }) => ({
    room: one(schema_1.rooms, {
        fields: [schema_1.cleaningEvents.roomId],
        references: [schema_1.rooms.id]
    }),
    staff: one(schema_1.staff, {
        fields: [schema_1.cleaningEvents.staffId],
        references: [schema_1.staff.id]
    }),
}));
exports.lateCheckoutEventsRelations = (0, relations_1.relations)(schema_1.lateCheckoutEvents, ({ one }) => ({
    checkoutRequest: one(schema_1.checkoutRequests, {
        fields: [schema_1.lateCheckoutEvents.checkoutRequestId],
        references: [schema_1.checkoutRequests.id]
    }),
    customer: one(schema_1.customers, {
        fields: [schema_1.lateCheckoutEvents.customerId],
        references: [schema_1.customers.id]
    }),
}));
exports.auditLogRelations = (0, relations_1.relations)(schema_1.auditLog, ({ one }) => ({
    staff: one(schema_1.staff, {
        fields: [schema_1.auditLog.staffId],
        references: [schema_1.staff.id]
    }),
}));
exports.cashDrawerSessionsRelations = (0, relations_1.relations)(schema_1.cashDrawerSessions, ({ one, many }) => ({
    registerSession: one(schema_1.registerSessions, {
        fields: [schema_1.cashDrawerSessions.registerSessionId],
        references: [schema_1.registerSessions.id]
    }),
    staff_openedByStaffId: one(schema_1.staff, {
        fields: [schema_1.cashDrawerSessions.openedByStaffId],
        references: [schema_1.staff.id],
        relationName: "cashDrawerSessions_openedByStaffId_staff_id"
    }),
    staff_closedByStaffId: one(schema_1.staff, {
        fields: [schema_1.cashDrawerSessions.closedByStaffId],
        references: [schema_1.staff.id],
        relationName: "cashDrawerSessions_closedByStaffId_staff_id"
    }),
    cashDrawerEvents: many(schema_1.cashDrawerEvents),
}));
exports.cashDrawerEventsRelations = (0, relations_1.relations)(schema_1.cashDrawerEvents, ({ one }) => ({
    cashDrawerSession: one(schema_1.cashDrawerSessions, {
        fields: [schema_1.cashDrawerEvents.cashDrawerSessionId],
        references: [schema_1.cashDrawerSessions.id]
    }),
    staff: one(schema_1.staff, {
        fields: [schema_1.cashDrawerEvents.createdByStaffId],
        references: [schema_1.staff.id]
    }),
}));
exports.staffBreakSessionsRelations = (0, relations_1.relations)(schema_1.staffBreakSessions, ({ one }) => ({
    staff: one(schema_1.staff, {
        fields: [schema_1.staffBreakSessions.staffId],
        references: [schema_1.staff.id]
    }),
    timeclockSession: one(schema_1.timeclockSessions, {
        fields: [schema_1.staffBreakSessions.timeclockSessionId],
        references: [schema_1.timeclockSessions.id]
    }),
}));
exports.ordersRelations = (0, relations_1.relations)(schema_1.orders, ({ one, many }) => ({
    customer: one(schema_1.customers, {
        fields: [schema_1.orders.customerId],
        references: [schema_1.customers.id]
    }),
    registerSession: one(schema_1.registerSessions, {
        fields: [schema_1.orders.registerSessionId],
        references: [schema_1.registerSessions.id]
    }),
    staff: one(schema_1.staff, {
        fields: [schema_1.orders.createdByStaffId],
        references: [schema_1.staff.id]
    }),
    orderLineItems: many(schema_1.orderLineItems),
    receipts: many(schema_1.receipts),
}));
exports.orderLineItemsRelations = (0, relations_1.relations)(schema_1.orderLineItems, ({ one }) => ({
    order: one(schema_1.orders, {
        fields: [schema_1.orderLineItems.orderId],
        references: [schema_1.orders.id]
    }),
}));
exports.receiptsRelations = (0, relations_1.relations)(schema_1.receipts, ({ one }) => ({
    order: one(schema_1.orders, {
        fields: [schema_1.receipts.orderId],
        references: [schema_1.orders.id]
    }),
}));
exports.customerNotesRelations = (0, relations_1.relations)(schema_1.customerNotes, ({ one }) => ({
    customer: one(schema_1.customers, {
        fields: [schema_1.customerNotes.customerId],
        references: [schema_1.customers.id]
    }),
    staff: one(schema_1.staff, {
        fields: [schema_1.customerNotes.createdByStaffId],
        references: [schema_1.staff.id]
    }),
}));
exports.customerActivityEventsRelations = (0, relations_1.relations)(schema_1.customerActivityEvents, ({ one }) => ({
    customer: one(schema_1.customers, {
        fields: [schema_1.customerActivityEvents.customerId],
        references: [schema_1.customers.id]
    }),
    staff: one(schema_1.staff, {
        fields: [schema_1.customerActivityEvents.actorStaffId],
        references: [schema_1.staff.id]
    }),
}));
exports.customerSpendLedgerEntriesRelations = (0, relations_1.relations)(schema_1.customerSpendLedgerEntries, ({ one }) => ({
    customer: one(schema_1.customers, {
        fields: [schema_1.customerSpendLedgerEntries.customerId],
        references: [schema_1.customers.id]
    }),
    visit: one(schema_1.visits, {
        fields: [schema_1.customerSpendLedgerEntries.visitId],
        references: [schema_1.visits.id]
    }),
    staff: one(schema_1.staff, {
        fields: [schema_1.customerSpendLedgerEntries.actorStaffId],
        references: [schema_1.staff.id]
    }),
}));
exports.lateCheckoutBanAlertsRelations = (0, relations_1.relations)(schema_1.lateCheckoutBanAlerts, ({ one }) => ({
    customer: one(schema_1.customers, {
        fields: [schema_1.lateCheckoutBanAlerts.customerId],
        references: [schema_1.customers.id]
    }),
    checkoutRequest: one(schema_1.checkoutRequests, {
        fields: [schema_1.lateCheckoutBanAlerts.checkoutRequestId],
        references: [schema_1.checkoutRequests.id]
    }),
    checkinBlock: one(schema_1.checkinBlocks, {
        fields: [schema_1.lateCheckoutBanAlerts.occupancyId],
        references: [schema_1.checkinBlocks.id]
    }),
    visit: one(schema_1.visits, {
        fields: [schema_1.lateCheckoutBanAlerts.visitId],
        references: [schema_1.visits.id]
    }),
    staff_createdByStaffId: one(schema_1.staff, {
        fields: [schema_1.lateCheckoutBanAlerts.createdByStaffId],
        references: [schema_1.staff.id],
        relationName: "lateCheckoutBanAlerts_createdByStaffId_staff_id"
    }),
    staff_decidedByStaffId: one(schema_1.staff, {
        fields: [schema_1.lateCheckoutBanAlerts.decidedByStaffId],
        references: [schema_1.staff.id],
        relationName: "lateCheckoutBanAlerts_decidedByStaffId_staff_id"
    }),
}));
exports.schedulePatternsRelations = (0, relations_1.relations)(schema_1.schedulePatterns, ({ one }) => ({
    staff_employeeId: one(schema_1.staff, {
        fields: [schema_1.schedulePatterns.employeeId],
        references: [schema_1.staff.id],
        relationName: "schedulePatterns_employeeId_staff_id"
    }),
    shiftTemplate: one(schema_1.shiftTemplates, {
        fields: [schema_1.schedulePatterns.templateId],
        references: [schema_1.shiftTemplates.id]
    }),
    staff_createdBy: one(schema_1.staff, {
        fields: [schema_1.schedulePatterns.createdBy],
        references: [schema_1.staff.id],
        relationName: "schedulePatterns_createdBy_staff_id"
    }),
}));
exports.clubEventsRelations = (0, relations_1.relations)(schema_1.clubEvents, ({ one }) => ({
    staff: one(schema_1.staff, {
        fields: [schema_1.clubEvents.staffId],
        references: [schema_1.staff.id]
    }),
    customer: one(schema_1.customers, {
        fields: [schema_1.clubEvents.customerId],
        references: [schema_1.customers.id]
    }),
}));
exports.laneSessionCommandsRelations = (0, relations_1.relations)(schema_1.laneSessionCommands, ({ one }) => ({
    laneSession: one(schema_1.laneSessions, {
        fields: [schema_1.laneSessionCommands.sessionId],
        references: [schema_1.laneSessions.id]
    }),
}));
