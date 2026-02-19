import type { LaborFilters, LaborProvider } from '../contracts/providers';
import type { MockStore } from './fixtures';
import { overlapsRange } from './helpers';

function matchEmployee(record: { employeeExternalId: string }, filters?: LaborFilters): boolean {
  if (!filters?.employeeExternalId) return true;
  return record.employeeExternalId === filters.employeeExternalId;
}

export class MockLaborProvider implements LaborProvider {
  constructor(private readonly store: MockStore) {}

  async listShifts(range: { from: Date | string; to: Date | string }, filters?: LaborFilters) {
    return this.store.shifts.filter(
      (shift) => matchEmployee(shift, filters) && overlapsRange(shift.startsAt, shift.endsAt, range)
    );
  }

  async listTimeclockSessions(
    range: { from: Date | string; to: Date | string },
    filters?: LaborFilters
  ) {
    return this.store.timeclockSessions.filter(
      (session) =>
        matchEmployee(session, filters) &&
        overlapsRange(session.clockInAt, session.clockOutAt, range)
    );
  }

  async listBreaks(range: { from: Date | string; to: Date | string }, filters?: LaborFilters) {
    return this.store.breaks.filter(
      (breakRecord) =>
        matchEmployee(breakRecord, filters) &&
        overlapsRange(breakRecord.startedAt, breakRecord.endedAt, range)
    );
  }
}
