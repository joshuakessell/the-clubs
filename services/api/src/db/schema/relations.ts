import { relations } from "drizzle-orm/relations";
import { customers, visits, staff, employeeDocuments, staffSessions, employeeShifts, shiftTemplates, staffWebauthnCredentials, timeOffRequests, timeclockSessions, webauthnChallenges, inventoryResources, keyTags, waitlist, checkinBlocks, agreements, agreementSignatures, laneSessions, inventoryReservations, registerSessions, checkoutRequests, cleaningBatches, cleaningBatchRooms, cleaningEvents, lateCheckoutEvents, auditLog, cashDrawerSessions, cashDrawerEvents, staffBreakSessions, orders, orderLineItems, receipts, customerNotes, customerActivityEvents, customerSpendLedgerEntries, lateCheckoutBanAlerts, schedulePatterns, clubEvents, laneSessionCommands } from "./index";

export const visitsRelations = relations(visits, ({one, many}) => ({
	customer: one(customers, {
		fields: [visits.customerId],
		references: [customers.id]
	}),
	waitlists: many(waitlist),
	checkinBlocks: many(checkinBlocks),
	orders: many(orders),
	customerSpendLedgerEntries: many(customerSpendLedgerEntries),
	lateCheckoutBanAlerts: many(lateCheckoutBanAlerts),
}));

export const customersRelations = relations(customers, ({many}) => ({
	visits: many(visits),
	inventoryResources: many(inventoryResources),
	checkoutRequests: many(checkoutRequests),
	lateCheckoutEvents: many(lateCheckoutEvents),
	orders: many(orders),
	customerNotes: many(customerNotes),
	customerActivityEvents: many(customerActivityEvents),
	customerSpendLedgerEntries: many(customerSpendLedgerEntries),
	lateCheckoutBanAlerts: many(lateCheckoutBanAlerts),
	laneSessions: many(laneSessions),
	clubEvents: many(clubEvents),
}));

export const employeeDocumentsRelations = relations(employeeDocuments, ({one}) => ({
	staff_employeeId: one(staff, {
		fields: [employeeDocuments.employeeId],
		references: [staff.id],
		relationName: "employeeDocuments_employeeId_staff_id"
	}),
	staff_uploadedBy: one(staff, {
		fields: [employeeDocuments.uploadedBy],
		references: [staff.id],
		relationName: "employeeDocuments_uploadedBy_staff_id"
	}),
}));

export const staffRelations = relations(staff, ({many}) => ({
	employeeDocuments_employeeId: many(employeeDocuments, {
		relationName: "employeeDocuments_employeeId_staff_id"
	}),
	employeeDocuments_uploadedBy: many(employeeDocuments, {
		relationName: "employeeDocuments_uploadedBy_staff_id"
	}),
	staffSessions: many(staffSessions),
	employeeShifts_createdBy: many(employeeShifts, {
		relationName: "employeeShifts_createdBy_staff_id"
	}),
	employeeShifts_employeeId: many(employeeShifts, {
		relationName: "employeeShifts_employeeId_staff_id"
	}),
	employeeShifts_updatedBy: many(employeeShifts, {
		relationName: "employeeShifts_updatedBy_staff_id"
	}),
	staffWebauthnCredentials: many(staffWebauthnCredentials),
	timeOffRequests_decidedBy: many(timeOffRequests, {
		relationName: "timeOffRequests_decidedBy_staff_id"
	}),
	timeOffRequests_employeeId: many(timeOffRequests, {
		relationName: "timeOffRequests_employeeId_staff_id"
	}),
	timeclockSessions_createdBy: many(timeclockSessions, {
		relationName: "timeclockSessions_createdBy_staff_id"
	}),
	timeclockSessions_employeeId: many(timeclockSessions, {
		relationName: "timeclockSessions_employeeId_staff_id"
	}),
	webauthnChallenges: many(webauthnChallenges),
	waitlists: many(waitlist),
	registerSessions: many(registerSessions),
	checkoutRequests: many(checkoutRequests),
	cleaningEvents: many(cleaningEvents),
	auditLogs: many(auditLog),
	cashDrawerSessions_openedByStaffId: many(cashDrawerSessions, {
		relationName: "cashDrawerSessions_openedByStaffId_staff_id"
	}),
	cashDrawerSessions_closedByStaffId: many(cashDrawerSessions, {
		relationName: "cashDrawerSessions_closedByStaffId_staff_id"
	}),
	cashDrawerEvents: many(cashDrawerEvents),
	staffBreakSessions: many(staffBreakSessions),
	orders: many(orders),
	customerNotes: many(customerNotes),
	customerActivityEvents: many(customerActivityEvents),
	customerSpendLedgerEntries: many(customerSpendLedgerEntries),
	shiftTemplates: many(shiftTemplates),
	lateCheckoutBanAlerts_createdByStaffId: many(lateCheckoutBanAlerts, {
		relationName: "lateCheckoutBanAlerts_createdByStaffId_staff_id"
	}),
	lateCheckoutBanAlerts_decidedByStaffId: many(lateCheckoutBanAlerts, {
		relationName: "lateCheckoutBanAlerts_decidedByStaffId_staff_id"
	}),
	schedulePatterns_employeeId: many(schedulePatterns, {
		relationName: "schedulePatterns_employeeId_staff_id"
	}),
	schedulePatterns_createdBy: many(schedulePatterns, {
		relationName: "schedulePatterns_createdBy_staff_id"
	}),
	laneSessions_staffId: many(laneSessions, {
		relationName: "laneSessions_staffId_staff_id"
	}),
	laneSessions_pastDueBypassedByStaffId: many(laneSessions, {
		relationName: "laneSessions_pastDueBypassedByStaffId_staff_id"
	}),
	clubEvents: many(clubEvents),
}));

export const staffSessionsRelations = relations(staffSessions, ({one}) => ({
	staff: one(staff, {
		fields: [staffSessions.staffId],
		references: [staff.id]
	}),
}));

export const employeeShiftsRelations = relations(employeeShifts, ({one, many}) => ({
	staff_createdBy: one(staff, {
		fields: [employeeShifts.createdBy],
		references: [staff.id],
		relationName: "employeeShifts_createdBy_staff_id"
	}),
	staff_employeeId: one(staff, {
		fields: [employeeShifts.employeeId],
		references: [staff.id],
		relationName: "employeeShifts_employeeId_staff_id"
	}),
	staff_updatedBy: one(staff, {
		fields: [employeeShifts.updatedBy],
		references: [staff.id],
		relationName: "employeeShifts_updatedBy_staff_id"
	}),
	shiftTemplate: one(shiftTemplates, {
		fields: [employeeShifts.templateId],
		references: [shiftTemplates.id]
	}),
	timeclockSessions: many(timeclockSessions),
}));

export const shiftTemplatesRelations = relations(shiftTemplates, ({one, many}) => ({
	employeeShifts: many(employeeShifts),
	staff: one(staff, {
		fields: [shiftTemplates.createdBy],
		references: [staff.id]
	}),
	schedulePatterns: many(schedulePatterns),
}));

export const staffWebauthnCredentialsRelations = relations(staffWebauthnCredentials, ({one}) => ({
	staff: one(staff, {
		fields: [staffWebauthnCredentials.staffId],
		references: [staff.id]
	}),
}));

export const timeOffRequestsRelations = relations(timeOffRequests, ({one}) => ({
	staff_decidedBy: one(staff, {
		fields: [timeOffRequests.decidedBy],
		references: [staff.id],
		relationName: "timeOffRequests_decidedBy_staff_id"
	}),
	staff_employeeId: one(staff, {
		fields: [timeOffRequests.employeeId],
		references: [staff.id],
		relationName: "timeOffRequests_employeeId_staff_id"
	}),
}));

export const timeclockSessionsRelations = relations(timeclockSessions, ({one, many}) => ({
	staff_createdBy: one(staff, {
		fields: [timeclockSessions.createdBy],
		references: [staff.id],
		relationName: "timeclockSessions_createdBy_staff_id"
	}),
	staff_employeeId: one(staff, {
		fields: [timeclockSessions.employeeId],
		references: [staff.id],
		relationName: "timeclockSessions_employeeId_staff_id"
	}),
	employeeShift: one(employeeShifts, {
		fields: [timeclockSessions.shiftId],
		references: [employeeShifts.id]
	}),
	staffBreakSessions: many(staffBreakSessions),
}));

export const webauthnChallengesRelations = relations(webauthnChallenges, ({one}) => ({
	staff: one(staff, {
		fields: [webauthnChallenges.staffId],
		references: [staff.id]
	}),
}));

export const inventoryResourcesRelations = relations(inventoryResources, ({one, many}) => ({
	customer: one(customers, {
		fields: [inventoryResources.assignedToCustomerId],
		references: [customers.id]
	}),
	keyTags: many(keyTags),
	waitlists: many(waitlist),
	checkinBlocks: many(checkinBlocks),
	cleaningBatchRooms: many(cleaningBatchRooms),
	cleaningEvents: many(cleaningEvents),
}));

export const keyTagsRelations = relations(keyTags, ({one, many}) => ({
	resource: one(inventoryResources, {
		fields: [keyTags.resourceId],
		references: [inventoryResources.id]
	}),
	checkoutRequests: many(checkoutRequests),
}));

export const waitlistRelations = relations(waitlist, ({one, many}) => ({
	staff: one(staff, {
		fields: [waitlist.cancelledByStaffId],
		references: [staff.id]
	}),
	checkinBlock: one(checkinBlocks, {
		fields: [waitlist.checkinBlockId],
		references: [checkinBlocks.id],
		relationName: "waitlist_checkinBlockId_checkinBlocks_id"
	}),
	resource: one(inventoryResources, {
		fields: [waitlist.resourceId],
		references: [inventoryResources.id]
	}),
	visit: one(visits, {
		fields: [waitlist.visitId],
		references: [visits.id]
	}),
	checkinBlocks: many(checkinBlocks, {
		relationName: "checkinBlocks_waitlistId_waitlist_id"
	}),
	inventoryReservations: many(inventoryReservations),
}));

export const checkinBlocksRelations = relations(checkinBlocks, ({one, many}) => ({
	waitlists: many(waitlist, {
		relationName: "waitlist_checkinBlockId_checkinBlocks_id"
	}),
	agreementSignatures: many(agreementSignatures),
	resource: one(inventoryResources, {
		fields: [checkinBlocks.resourceId],
		references: [inventoryResources.id]
	}),
	laneSession: one(laneSessions, {
		fields: [checkinBlocks.sessionId],
		references: [laneSessions.id]
	}),
	visit: one(visits, {
		fields: [checkinBlocks.visitId],
		references: [visits.id]
	}),
	waitlist: one(waitlist, {
		fields: [checkinBlocks.waitlistId],
		references: [waitlist.id],
		relationName: "checkinBlocks_waitlistId_waitlist_id"
	}),
	lateCheckoutBanAlerts: many(lateCheckoutBanAlerts),
}));

export const agreementSignaturesRelations = relations(agreementSignatures, ({one}) => ({
	agreement: one(agreements, {
		fields: [agreementSignatures.agreementId],
		references: [agreements.id]
	}),
	checkinBlock: one(checkinBlocks, {
		fields: [agreementSignatures.checkinBlockId],
		references: [checkinBlocks.id]
	}),
}));

export const agreementsRelations = relations(agreements, ({many}) => ({
	agreementSignatures: many(agreementSignatures),
}));

export const laneSessionsRelations = relations(laneSessions, ({one, many}) => ({
	checkinBlocks: many(checkinBlocks),
	inventoryReservations: many(inventoryReservations),
	order: one(orders, {
		fields: [laneSessions.orderId],
		references: [orders.id],
	}),
	customer: one(customers, {
		fields: [laneSessions.customerId],
		references: [customers.id]
	}),
	staff_staffId: one(staff, {
		fields: [laneSessions.staffId],
		references: [staff.id],
		relationName: "laneSessions_staffId_staff_id"
	}),
	staff_pastDueBypassedByStaffId: one(staff, {
		fields: [laneSessions.pastDueBypassedByStaffId],
		references: [staff.id],
		relationName: "laneSessions_pastDueBypassedByStaffId_staff_id"
	}),
	laneSessionCommands: many(laneSessionCommands),
}));

export const inventoryReservationsRelations = relations(inventoryReservations, ({one}) => ({
	laneSession: one(laneSessions, {
		fields: [inventoryReservations.laneSessionId],
		references: [laneSessions.id]
	}),
	waitlist: one(waitlist, {
		fields: [inventoryReservations.waitlistId],
		references: [waitlist.id]
	}),
}));



export const registerSessionsRelations = relations(registerSessions, ({one, many}) => ({
	staff: one(staff, {
		fields: [registerSessions.employeeId],
		references: [staff.id]
	}),
	cashDrawerSessions: many(cashDrawerSessions),
	orders: many(orders),
}));

export const checkoutRequestsRelations = relations(checkoutRequests, ({one, many}) => ({
	staff: one(staff, {
		fields: [checkoutRequests.claimedByStaffId],
		references: [staff.id]
	}),
	customer: one(customers, {
		fields: [checkoutRequests.customerId],
		references: [customers.id]
	}),
	keyTag: one(keyTags, {
		fields: [checkoutRequests.keyTagId],
		references: [keyTags.id]
	}),
	lateCheckoutEvents: many(lateCheckoutEvents),
	lateCheckoutBanAlerts: many(lateCheckoutBanAlerts),
}));

export const cleaningBatchRoomsRelations = relations(cleaningBatchRooms, ({one}) => ({
	cleaningBatch: one(cleaningBatches, {
		fields: [cleaningBatchRooms.batchId],
		references: [cleaningBatches.id]
	}),
	resource: one(inventoryResources, {
		fields: [cleaningBatchRooms.resourceId],
		references: [inventoryResources.id]
	}),
}));

export const cleaningBatchesRelations = relations(cleaningBatches, ({many}) => ({
	cleaningBatchRooms: many(cleaningBatchRooms),
}));

export const cleaningEventsRelations = relations(cleaningEvents, ({one}) => ({
	resource: one(inventoryResources, {
		fields: [cleaningEvents.resourceId],
		references: [inventoryResources.id]
	}),
	staff: one(staff, {
		fields: [cleaningEvents.staffId],
		references: [staff.id]
	}),
}));

export const lateCheckoutEventsRelations = relations(lateCheckoutEvents, ({one}) => ({
	checkoutRequest: one(checkoutRequests, {
		fields: [lateCheckoutEvents.checkoutRequestId],
		references: [checkoutRequests.id]
	}),
	customer: one(customers, {
		fields: [lateCheckoutEvents.customerId],
		references: [customers.id]
	}),
}));

export const auditLogRelations = relations(auditLog, ({one}) => ({
	staff: one(staff, {
		fields: [auditLog.staffId],
		references: [staff.id]
	}),
}));

export const cashDrawerSessionsRelations = relations(cashDrawerSessions, ({one, many}) => ({
	registerSession: one(registerSessions, {
		fields: [cashDrawerSessions.registerSessionId],
		references: [registerSessions.id]
	}),
	staff_openedByStaffId: one(staff, {
		fields: [cashDrawerSessions.openedByStaffId],
		references: [staff.id],
		relationName: "cashDrawerSessions_openedByStaffId_staff_id"
	}),
	staff_closedByStaffId: one(staff, {
		fields: [cashDrawerSessions.closedByStaffId],
		references: [staff.id],
		relationName: "cashDrawerSessions_closedByStaffId_staff_id"
	}),
	cashDrawerEvents: many(cashDrawerEvents),
}));

export const cashDrawerEventsRelations = relations(cashDrawerEvents, ({one}) => ({
	cashDrawerSession: one(cashDrawerSessions, {
		fields: [cashDrawerEvents.cashDrawerSessionId],
		references: [cashDrawerSessions.id]
	}),
	staff: one(staff, {
		fields: [cashDrawerEvents.createdByStaffId],
		references: [staff.id]
	}),
}));

export const staffBreakSessionsRelations = relations(staffBreakSessions, ({one}) => ({
	staff: one(staff, {
		fields: [staffBreakSessions.staffId],
		references: [staff.id]
	}),
	timeclockSession: one(timeclockSessions, {
		fields: [staffBreakSessions.timeclockSessionId],
		references: [timeclockSessions.id]
	}),
}));

export const ordersRelations = relations(orders, ({one, many}) => ({
	customer: one(customers, {
		fields: [orders.customerId],
		references: [customers.id]
	}),
	visit: one(visits, {
		fields: [orders.visitId],
		references: [visits.id]
	}),
	registerSession: one(registerSessions, {
		fields: [orders.registerSessionId],
		references: [registerSessions.id]
	}),
	staff_createdBy: one(staff, {
		fields: [orders.createdByStaffId],
		references: [staff.id],
		relationName: "orders_createdByStaffId_staff_id"
	}),
	staff_paidBy: one(staff, {
		fields: [orders.paidByStaffId],
		references: [staff.id],
		relationName: "orders_paidByStaffId_staff_id"
	}),
	orderLineItems: many(orderLineItems),
	receipts: many(receipts),
	laneSessions: many(laneSessions),
}));

export const orderLineItemsRelations = relations(orderLineItems, ({one}) => ({
	order: one(orders, {
		fields: [orderLineItems.orderId],
		references: [orders.id]
	}),
}));

export const receiptsRelations = relations(receipts, ({one}) => ({
	order: one(orders, {
		fields: [receipts.orderId],
		references: [orders.id]
	}),
}));

export const customerNotesRelations = relations(customerNotes, ({one}) => ({
	customer: one(customers, {
		fields: [customerNotes.customerId],
		references: [customers.id]
	}),
	staff: one(staff, {
		fields: [customerNotes.createdByStaffId],
		references: [staff.id]
	}),
}));

export const customerActivityEventsRelations = relations(customerActivityEvents, ({one}) => ({
	customer: one(customers, {
		fields: [customerActivityEvents.customerId],
		references: [customers.id]
	}),
	staff: one(staff, {
		fields: [customerActivityEvents.actorStaffId],
		references: [staff.id]
	}),
}));

export const customerSpendLedgerEntriesRelations = relations(customerSpendLedgerEntries, ({one}) => ({
	customer: one(customers, {
		fields: [customerSpendLedgerEntries.customerId],
		references: [customers.id]
	}),
	visit: one(visits, {
		fields: [customerSpendLedgerEntries.visitId],
		references: [visits.id]
	}),
	staff: one(staff, {
		fields: [customerSpendLedgerEntries.actorStaffId],
		references: [staff.id]
	}),
}));

export const lateCheckoutBanAlertsRelations = relations(lateCheckoutBanAlerts, ({one}) => ({
	customer: one(customers, {
		fields: [lateCheckoutBanAlerts.customerId],
		references: [customers.id]
	}),
	checkoutRequest: one(checkoutRequests, {
		fields: [lateCheckoutBanAlerts.checkoutRequestId],
		references: [checkoutRequests.id]
	}),
	checkinBlock: one(checkinBlocks, {
		fields: [lateCheckoutBanAlerts.occupancyId],
		references: [checkinBlocks.id]
	}),
	visit: one(visits, {
		fields: [lateCheckoutBanAlerts.visitId],
		references: [visits.id]
	}),
	staff_createdByStaffId: one(staff, {
		fields: [lateCheckoutBanAlerts.createdByStaffId],
		references: [staff.id],
		relationName: "lateCheckoutBanAlerts_createdByStaffId_staff_id"
	}),
	staff_decidedByStaffId: one(staff, {
		fields: [lateCheckoutBanAlerts.decidedByStaffId],
		references: [staff.id],
		relationName: "lateCheckoutBanAlerts_decidedByStaffId_staff_id"
	}),
}));

export const schedulePatternsRelations = relations(schedulePatterns, ({one}) => ({
	staff_employeeId: one(staff, {
		fields: [schedulePatterns.employeeId],
		references: [staff.id],
		relationName: "schedulePatterns_employeeId_staff_id"
	}),
	shiftTemplate: one(shiftTemplates, {
		fields: [schedulePatterns.templateId],
		references: [shiftTemplates.id]
	}),
	staff_createdBy: one(staff, {
		fields: [schedulePatterns.createdBy],
		references: [staff.id],
		relationName: "schedulePatterns_createdBy_staff_id"
	}),
}));

export const clubEventsRelations = relations(clubEvents, ({one}) => ({
	staff: one(staff, {
		fields: [clubEvents.staffId],
		references: [staff.id]
	}),
	customer: one(customers, {
		fields: [clubEvents.customerId],
		references: [customers.id]
	}),
}));

export const laneSessionCommandsRelations = relations(laneSessionCommands, ({one}) => ({
	laneSession: one(laneSessions, {
		fields: [laneSessionCommands.sessionId],
		references: [laneSessions.id]
	}),
}));