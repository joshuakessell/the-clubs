/**
 * ensureDemoStaff — idempotent staff upsert for demo environments.
 *
 * Called from the DEMO_MODE startup path to guarantee staff with
 * valid PIN hashes exist. Uses the already-initialized `db` singleton.
 */
import { db } from './index';
import { sql, notInArray } from 'drizzle-orm';
import { hashQrToken, hashPin } from '../auth/utils';
import { staff as staffTable } from './schema/schema';

const DEMO_STAFF = [
  { name: 'John Erikson',    role: 'STAFF', qrToken: 'STAFF-001', pin: '000000' },
  { name: 'Marcus Rivera',   role: 'STAFF', qrToken: 'STAFF-002', pin: '000000' },
  { name: 'Tyler Brooks',    role: 'STAFF', qrToken: 'STAFF-003', pin: '000000' },
  { name: 'Ryan Mitchell',   role: 'STAFF', qrToken: 'STAFF-004', pin: '000000' },
  { name: 'Derek Nguyen',    role: 'STAFF', qrToken: 'STAFF-005', pin: '000000' },
  { name: 'Chris Patterson', role: 'STAFF', qrToken: 'STAFF-006', pin: '000000' },
  { name: 'Jason Morales',   role: 'STAFF', qrToken: 'STAFF-007', pin: '000000' },
  { name: 'Manager Club',    role: 'ADMIN', qrToken: 'STAFF-011', pin: '000000' },
  { name: 'Manager Dallas',  role: 'ADMIN', qrToken: 'STAFF-012', pin: '000000' },
] as const;

const DEMO_NAMES: string[] = DEMO_STAFF.map((m) => m.name);

/** Upsert a single staff member by qr_token_hash (unique constraint). */
async function upsertStaffMember(member: typeof DEMO_STAFF[number]): Promise<void> {
  const qrTokenHash = hashQrToken(member.qrToken);
  const pinHash = await hashPin(member.pin);

  await db.execute(
    sql`INSERT INTO staff (name, role, qr_token_hash, pin_hash, active, force_pin_change)
        VALUES (${member.name}, ${member.role}, ${qrTokenHash}, ${pinHash}, true, true)
        ON CONFLICT (qr_token_hash) DO UPDATE SET
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          active = true`
  );
}

/** Deactivate staff whose names are NOT in the demo list. */
async function deactivateNonDemoStaff(): Promise<void> {
  await db.update(staffTable)
    .set({ active: false })
    .where(notInArray(staffTable.name, DEMO_NAMES));
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
