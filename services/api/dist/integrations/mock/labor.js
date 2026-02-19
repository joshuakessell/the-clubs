"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockLaborProvider = void 0;
const helpers_1 = require("./helpers");
function matchEmployee(record, filters) {
    if (!filters?.employeeExternalId)
        return true;
    return record.employeeExternalId === filters.employeeExternalId;
}
class MockLaborProvider {
    store;
    constructor(store) {
        this.store = store;
    }
    async listShifts(range, filters) {
        return this.store.shifts.filter((shift) => matchEmployee(shift, filters) && (0, helpers_1.overlapsRange)(shift.startsAt, shift.endsAt, range));
    }
    async listTimeclockSessions(range, filters) {
        return this.store.timeclockSessions.filter((session) => matchEmployee(session, filters) &&
            (0, helpers_1.overlapsRange)(session.clockInAt, session.clockOutAt, range));
    }
    async listBreaks(range, filters) {
        return this.store.breaks.filter((breakRecord) => matchEmployee(breakRecord, filters) &&
            (0, helpers_1.overlapsRange)(breakRecord.startedAt, breakRecord.endedAt, range));
    }
}
exports.MockLaborProvider = MockLaborProvider;
