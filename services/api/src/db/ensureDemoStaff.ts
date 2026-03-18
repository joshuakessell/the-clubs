/**
 * ensureDemoStaff — idempotent staff upsert for demo environments.
 *
 * Called from the DEMO_MODE startup path to guarantee staff with
 * valid PIN hashes exist. Uses the already-initialized `db` singleton.
 */
import { db } from './index';
import { sql } from 'drizzle-orm';
import { hashQrToken, hashPin } from '../auth/utils';

const DEMO_STAFF = [
  { name: 'John Erikson',    role: 'STAFF', qrToken: 'STAFF-001', pin: '111111' },
  { name: 'Marcus Rivera',   role: 'STAFF', qrToken: 'STAFF-002', pin: '222222' },
  { name: 'Tyler Brooks',    role: 'STAFF', qrToken: 'STAFF-003', pin: '333333' },
  { name: 'Ryan Mitchell',   role: 'STAFF', qrToken: 'STAFF-004', pin: '444444' },
  { name: 'Derek Nguyen',    role: 'STAFF', qrToken: 'STAFF-005', pin: '555555' },
  { name: 'Chris Patterson', role: 'STAFF', qrToken: 'STAFF-006', pin: '666666' },
  { name: 'Jason Morales',   role: 'STAFF', qrToken: 'STAFF-007', pin: '777777' },
  { name: 'Brandon Reyes',   role: 'STAFF', qrToken: 'STAFF-008', pin: '888888' },
  { name: 'Kyle Foster',     role: 'STAFF', qrToken: 'STAFF-009', pin: '999999' },
  { name: 'Sean Caldwell',   role: 'STAFF', qrToken: 'STAFF-010', pin: '101010' },
  { name: 'Manager Club',    role: 'ADMIN', qrToken: 'STAFF-011', pin: '123456' },
  { name: 'Manager Dallas',  role: 'ADMIN', qrToken: 'STAFF-012', pin: '654321' },
] as const;

const DEMO_NAMES = DEMO_STAFF.map((m) => m.name);

/** Upsert a single staff member by name. */
async function upsertStaffMember(member: typeof DEMO_STAFF[number]): Promise<void> {
  const qrTokenHash = hashQrToken(member.qrToken);
  const pinHash = await hashPin(member.pin);

  const updated = await db.execute(
    sql`UPDATE staff
        SET role = ${member.role},
            qr_token_hash = ${qrTokenHash},
            pin_hash = ${pinHash},
            active = true
        WHERE LOWER(name) = LOWER(${member.name})`
  );

  if ((updated.rowCount ?? 0) === 0) {
    await db.execute(
      sql`INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
          VALUES (${member.name}, ${member.role}, ${qrTokenHash}, ${pinHash}, true)`
    );
  }
}

/** Deactivate staff whose names are NOT in the demo list. */
async function deactivateNonDemoStaff(): Promise<void> {
  // Build a PostgreSQL array literal for the IN clause
  await db.execute(
    sql`UPDATE staff SET active = false
        WHERE name != ALL(${DEMO_NAMES})`
  );
}

/**
 * Ensure all demo staff exist with valid PIN hashes.
 * Safe to call on every startup.
 */
export async function ensureDemoStaff(): Promise<number> {
  for (const member of DEMO_STAFF) {
    await upsertStaffMember(member);
  }

  await deactivateNonDemoStaff();

  return DEMO_STAFF.length;
}

export { DEMO_STAFF };
