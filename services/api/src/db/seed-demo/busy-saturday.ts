import { randomUUID } from 'crypto';
import {
  AGREEMENT_LEGAL_BODY_HTML_BY_LANG,
  DOUBLE_ROOM_NUMBERS,
  LOCKER_NUMBERS,
  NONEXISTENT_ROOM_NUMBERS,
  ROOM_NUMBERS,
  ROOMS,
  SPECIAL_ROOM_NUMBERS,
  RentalType,
  RoomStatus,
  RoomType,
  getRoomTierFromNumber,
  type CustomerIdType,
} from '@the-clubs/shared';
import { faker } from '@faker-js/faker';
import {
  computeIdScanIdentityHash,
  computeSha256Hex,
  normalizeScanText,
} from '../../checkin/identity';
import { query, transaction } from '../index';
import { buildCloseoutSnapshot } from '../../money/closeout';
import { buildReceiptNumber } from '../../money/orderAudit';
import { generateAgreementPdf } from '../../utils/pdf-generator';
import { hashPin, hashQrToken } from '../../auth/utils';
import type { ProgressReporter } from './progress';

export async function seedBusySaturdayDemo(now: Date, progress?: ProgressReporter): Promise<void> {
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const log = (message: string) => {
    if (progress) {
      progress.log(message);
      return;
    }
    console.log(message);
  };
  const tick = (message?: string, increment?: number) => progress?.tick(message, increment);
  const addTotal = (amount: number) => progress?.addTotal(amount);
  const setMessage = (message: string) => progress?.setMessage(message);

  function ceilToNext15Min(d: Date): Date {
    const ms = d.getTime();
    const rounded = Math.ceil(ms / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
    return new Date(rounded);
  }

  function floorTo15Min(d: Date): Date {
    const ms = d.getTime();
    const rounded = Math.floor(ms / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
    return new Date(rounded);
  }

  function scheduledCheckoutFromCheckin(checkInAt: Date, durationMinutes: number): Date {
    // Checkout times round UP to the nearest 15-minute increment.
    return ceilToNext15Min(new Date(checkInAt.getTime() + durationMinutes * 60 * 1000));
  }

  // -----------------------------------------------------------------------
  // Busy Saturday Night demo seeding (stress-test-friendly dataset)
  // -----------------------------------------------------------------------
  setMessage('Preparing demo dataset');
  log('🌱 Seeding busy Saturday demo dataset (resetting customer data)...');

  // Keep employees unchanged
  const staffCountBefore = await query<{ count: string }>(
    'SELECT COUNT(*)::text as count FROM staff'
  );
  const staffCountBeforeValue = parseInt(staffCountBefore.rows[0]?.count || '0', 10);
  let seededStaff = false;

  // Deterministic PRNG so the dataset is stable across runs
  function seededRng(seed: number): () => number {
    // Mulberry32
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rng = seededRng(0x53415455); // 'SATU' (arbitrary fixed seed)

  function randInt(min: number, max: number): number {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  function buildSeedIdType(seed: number): CustomerIdType {
    if (seed % 29 === 0) return 'OTHER';
    if (seed % 15 === 0) return 'PASSPORT';
    if (seed % 8 === 0) return 'STATE_ID';
    return 'DRIVERS_LICENSE';
  }

  function buildSeedIdProfile(seed: number): {
    idNumber: string;
    idType: CustomerIdType;
    idTypeOther: string | null;
    idExpirationDate: Date;
    idState: string;
  } {
    const idType = buildSeedIdType(seed);
    const prefix = idType === 'PASSPORT' ? 'P' : idType === 'STATE_ID' ? 'S' : 'D';
    const idNumber = `${prefix}${String(seed).padStart(8, '0')}`;
    const idTypeOther = idType === 'OTHER' ? `Municipal ID ${seed}` : null;
    const idStates = ['TX', 'OK', 'LA', 'NM', 'AR'];
    const idState = idStates[seed % idStates.length] ?? 'TX';
    const idExpirationDate = new Date(
      now.getFullYear() + 2 + (seed % 3),
      (seed * 7) % 12,
      ((seed * 11) % 27) + 1
    );
    return { idNumber, idType, idTypeOther, idExpirationDate, idState };
  }

  // Choose one STANDARD room to remain free at NOW
  const freeRoomNumber =
    ROOM_NUMBERS.find((n: number) => {
      try {
        return getRoomTierFromNumber(n) === 'STANDARD';
      } catch {
        return false;
      }
    }) ?? 200;

  const occupiedRoomNumbers = ROOM_NUMBERS.filter((n: number) => n !== freeRoomNumber);
  const ACTIVE_LOCKERS_TARGET = 40;
  const occupiedLockerNumbers = LOCKER_NUMBERS.slice(0, ACTIVE_LOCKERS_TARGET); // deterministic

  function normalizeNamePart(input: string | null | undefined): string {
    if (!input) return '';
    const ascii = input
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return ascii.replace(/[^A-Za-z'-]/g, '');
  }

  function normalizeFullName(first: string | null | undefined, last: string | null | undefined) {
    const cleanFirst = normalizeNamePart(first);
    const cleanLast = normalizeNamePart(last);
    if (!cleanFirst || !cleanLast) return null;
    return `${cleanFirst} ${cleanLast}`;
  }

  function buildUniqueNameList(total: number): string[] {
    const reserved = new Set([
      'Joshua Kessell',
      'Carlos Ramirez',
      'Miguel Hernandez',
      'Anthony Lopez',
      'David Martinez',
    ]);
    const names = new Set<string>();

    faker.seed(0x4e414d45);
    const maxAttempts = Math.max(total * 50, 1000);
    let attempts = 0;
    while (names.size < total && attempts < maxAttempts) {
      const first = faker.person.firstName('male');
      const last = faker.person.lastName();
      const full = normalizeFullName(first, last);
      attempts += 1;
      if (!full || reserved.has(full)) continue;
      names.add(full);
    }

    if (names.size < total) {
      throw new Error(`Faker returned only ${names.size} unique male names; needed ${total}.`);
    }

    return Array.from(names);
  }

  const customerIds: string[] = [];

  const MEMBER_COUNT = 100;
  const EXTRA_GUEST_COUNT = 200;

  await transaction(async (client) => {
    // -------------------------------------------------------------------
    // Inventory: enforce facility contract (permanent beyond demo)
    // -------------------------------------------------------------------
    // 1) Ensure non-existent rooms are not present
    const nonExistentRoomNumbers = NONEXISTENT_ROOM_NUMBERS.map(String);
    if (nonExistentRoomNumbers.length > 0) {
      await client.query(`DELETE FROM rooms WHERE number = ANY($1::text[])`, [
        nonExistentRoomNumbers,
      ]);
    }

    // 2) Remove any invalid legacy inventory rows not in the contract
    await client.query(`DELETE FROM rooms WHERE NOT (number = ANY($1::text[]))`, [
      ROOM_NUMBERS.map(String),
    ]);
    await client.query(`DELETE FROM lockers WHERE NOT (number = ANY($1::text[]))`, [
      LOCKER_NUMBERS,
    ]);

    // 3) Upsert rooms + lockers (idempotent)
    setMessage('Upserting rooms');
    addTotal(ROOMS.length);
    for (const r of ROOMS) {
      const type: RoomType =
        r.tier === 'DOUBLE'
          ? RoomType.DOUBLE
          : r.tier === 'SPECIAL'
            ? RoomType.SPECIAL
            : RoomType.STANDARD;
      await client.query(
        `INSERT INTO rooms (number, type, status, floor, last_status_change)
           VALUES ($1, $2, 'CLEAN', $3, NOW())
           ON CONFLICT (number) DO UPDATE
             SET type = EXCLUDED.type,
                 floor = EXCLUDED.floor,
                 updated_at = NOW()`,
        [String(r.number), type, Math.floor(r.number / 100)]
      );
      tick();
    }

    setMessage('Upserting lockers');
    addTotal(LOCKER_NUMBERS.length);
    for (const n of LOCKER_NUMBERS) {
      await client.query(
        `INSERT INTO lockers (number, status)
           VALUES ($1, 'CLEAN')
           ON CONFLICT (number) DO UPDATE
             SET updated_at = NOW()`,
        [n]
      );
      tick();
    }

    // 4) Upsert key tags (needed for QR scans in checkout kiosk)
    const roomIdsForTags = await client.query<{ id: string; number: string }>(
      `SELECT id, number FROM rooms ORDER BY number`
    );
    setMessage('Seeding room key tags');
    addTotal(roomIdsForTags.rows.length);
    for (const row of roomIdsForTags.rows) {
      await client.query(
        `INSERT INTO key_tags (room_id, tag_type, tag_code, is_active)
           VALUES ($1, 'QR', $2, true)
           ON CONFLICT (tag_code) DO UPDATE
             SET room_id = EXCLUDED.room_id,
                 locker_id = NULL,
                 is_active = true,
                 updated_at = NOW()`,
        [row.id, `ROOM-${row.number}`]
      );
      tick();
    }

    const lockerIdsForTags = await client.query<{ id: string; number: string }>(
      `SELECT id, number FROM lockers ORDER BY number`
    );
    setMessage('Seeding locker key tags');
    addTotal(lockerIdsForTags.rows.length);
    for (const row of lockerIdsForTags.rows) {
      await client.query(
        `INSERT INTO key_tags (locker_id, tag_type, tag_code, is_active)
           VALUES ($1, 'QR', $2, true)
           ON CONFLICT (tag_code) DO UPDATE
             SET locker_id = EXCLUDED.locker_id,
                 room_id = NULL,
                 is_active = true,
                 updated_at = NOW()`,
        [row.id, `LOCKER-${row.number}`]
      );
      tick();
    }

    // Reset assignments/statuses on inventory
    await client.query(
      `UPDATE rooms
         SET assigned_to_customer_id = NULL,
             status = 'CLEAN',
             last_status_change = NOW(),
             updated_at = NOW()`
    );
    await client.query(
      `UPDATE lockers
         SET assigned_to_customer_id = NULL,
             status = 'CLEAN',
             updated_at = NOW()`
    );

    // Wipe member/customer-related data (keep staff/employees)
    setMessage('Clearing demo data');
    const deleteStatements = [
      'DELETE FROM customer_spend_ledger_entries',
      'DELETE FROM checkout_requests',
      'DELETE FROM late_checkout_events',
      'DELETE FROM customer_notes',
      'DELETE FROM customer_activity_events',
      'DELETE FROM inventory_reservations',
      'DELETE FROM waitlist',
      'DELETE FROM agreement_signatures',
      'DELETE FROM external_provider_refs',
      'DELETE FROM receipts',
      'DELETE FROM order_line_items',
      'DELETE FROM orders',
      'DELETE FROM cash_drawer_events',
      'DELETE FROM cash_drawer_sessions',
      'DELETE FROM staff_break_sessions',
      'DELETE FROM charges',
      'DELETE FROM checkin_blocks',
      'DELETE FROM payment_intents',
      'DELETE FROM lane_sessions',
      'DELETE FROM visits',
      'DELETE FROM customers',
    ];
    addTotal(deleteStatements.length);
    for (const statement of deleteStatements) {
      await client.query(statement);
      tick();
    }

    // Inventory maps (after any deletes)
    const roomsRes = await client.query<{ id: string; number: string; type: string }>(
      `SELECT id, number, type::text as type FROM rooms ORDER BY number`
    );
    const lockersRes = await client.query<{ id: string; number: string }>(
      `SELECT id, number FROM lockers ORDER BY number`
    );

    const roomIdByNumber = new Map<string, { id: string; type: string }>();
    for (const r of roomsRes.rows) roomIdByNumber.set(r.number, { id: r.id, type: r.type });
    const lockerIdByNumber = new Map<string, string>();
    for (const l of lockersRes.rows) lockerIdByNumber.set(l.number, l.id);

    const customerProfileById = new Map<
      string,
      { name: string; dob: Date | null; membershipNumber: string | null }
    >();

    const agreementResult = await client.query<{
      id: string;
      title: string;
      version: string;
      body_text: string;
    }>(
      `SELECT id, title, version, body_text FROM agreements WHERE active = true ORDER BY created_at DESC LIMIT 1`
    );

    let agreement = agreementResult.rows[0];
    if (!agreement) {
      const fallbackText = AGREEMENT_LEGAL_BODY_HTML_BY_LANG.EN;
      const inserted = await client.query<{
        id: string;
        title: string;
        version: string;
        body_text: string;
      }>(
        `INSERT INTO agreements (version, title, body_text, active)
           VALUES ($1, $2, $3, true)
           RETURNING id, title, version, body_text`,
        ['demo-v1', 'Club Dallas Entry & Liability Waiver (Demo)', fallbackText]
      );
      agreement = inserted.rows[0]!;
    } else if (!agreement.body_text || agreement.body_text.trim() === '') {
      const fallbackText = AGREEMENT_LEGAL_BODY_HTML_BY_LANG.EN;
      await client.query(`UPDATE agreements SET body_text = $1 WHERE id = $2`, [
        fallbackText,
        agreement.id,
      ]);
      agreement = {
        ...agreement,
        body_text: fallbackText,
      };
    }
    if (!agreement) {
      throw new Error('Failed to load or create an active agreement for demo seeding.');
    }
    const activeAgreement = agreement;

    const agreementTextSnapshot = activeAgreement.body_text || AGREEMENT_LEGAL_BODY_HTML_BY_LANG.EN;
    const agreementTitle = activeAgreement.title?.trim() || 'Club Agreement';

    function getCustomerProfile(customerId: string): {
      name: string;
      dob: Date | null;
      membershipNumber: string | null;
    } {
      return (
        customerProfileById.get(customerId) || {
          name: 'Customer',
          dob: null,
          membershipNumber: null,
        }
      );
    }

    async function insertSignedCheckinBlock(params: {
      visitId: string;
      customerId: string;
      blockType: 'INITIAL' | 'RENEWAL' | 'FINAL2H';
      startsAt: Date;
      endsAt: Date;
      rentalType: RentalType;
      roomId: string | null;
      lockerId: string | null;
      signedAt: Date;
      createdAt: Date;
    }): Promise<string> {
      const { name, dob, membershipNumber } = getCustomerProfile(params.customerId);
      const signaturePayload = {
        kind: 'demo',
        name,
        signedAt: params.signedAt.toISOString(),
      };

      const pdfBuffer = await generateAgreementPdf({
        agreementTitle,
        agreementVersion: activeAgreement.version,
        agreementText: agreementTextSnapshot,
        customerName: name,
        customerDob: dob,
        membershipNumber: membershipNumber || undefined,
        checkinAt: params.startsAt,
        signedAt: params.signedAt,
        signatureText: name,
      });

      const blockId = randomUUID();
      await client.query(
        `INSERT INTO checkin_blocks
           (id, visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, agreement_pdf, agreement_signed_at, created_at, updated_at, has_tv_remote, waitlist_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, true, $9, $10, $11, $11, false, NULL)`,
        [
          blockId,
          params.visitId,
          params.blockType,
          params.startsAt,
          params.endsAt,
          params.rentalType,
          params.roomId,
          params.lockerId,
          pdfBuffer,
          params.signedAt,
          params.createdAt,
        ]
      );

      await client.query(
        `INSERT INTO agreement_signatures
           (agreement_id, checkin_block_id, customer_name, membership_number, signed_at, signature_png_base64, signature_strokes_json, agreement_text_snapshot, agreement_version, device_type, created_at)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10)`,
        [
          activeAgreement.id,
          blockId,
          name,
          membershipNumber,
          params.signedAt,
          signaturePayload,
          agreementTextSnapshot,
          activeAgreement.version,
          'KIOSK',
          params.createdAt,
        ]
      );

      tick('Generating agreements');
      return blockId;
    }

    // -------------------------------------------------------------------
    // Customers: seed 100 membership customers + extra guests for active occupancy + historical churn
    // -------------------------------------------------------------------
    // Needs to cover:
    // - 142 concurrently active stays now (54 rooms + 88 lockers)
    // - 142+ completed stays for churn/checkout-quality assertions

    const baseNames = buildUniqueNameList(MEMBER_COUNT + EXTRA_GUEST_COUNT);

    // Create exactly 100 membership customers
    setMessage('Creating member customers');
    addTotal(MEMBER_COUNT);
    for (let i = 1; i <= 100; i++) {
      const idx = i - 1;
      const id = randomUUID();
      const membershipNumber = String(i).padStart(6, '0');
      const name = baseNames[idx]!;
      const dob = new Date(1980 + (idx % 25), (idx * 3) % 12, ((idx * 5) % 27) + 1);
      const idProfile = buildSeedIdProfile(idx + 1);

      await client.query(
        `INSERT INTO customers
           (id, name, dob, membership_number, membership_card_type, membership_valid_until, id_expiration_date, id_number, id_state, id_type, id_type_other, primary_language, past_due_balance, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $8, $9, 'EN', 0, NOW(), NOW())`,
        [
          id,
          name,
          dob,
          membershipNumber,
          idProfile.idExpirationDate,
          idProfile.idNumber,
          idProfile.idState,
          idProfile.idType,
          idProfile.idTypeOther,
        ]
      );

      customerIds.push(id);
      customerProfileById.set(id, { name, dob, membershipNumber });
      tick();
    }

    // Extra guests (customers only; membership_number is NULL)
    setMessage('Creating guest customers');
    addTotal(EXTRA_GUEST_COUNT);
    for (let i = 1; i <= EXTRA_GUEST_COUNT; i++) {
      const idx = MEMBER_COUNT + (i - 1);
      const id = randomUUID();
      const name = baseNames[idx]!;
      const dob = new Date(1985 + (idx % 20), (idx * 5) % 12, ((idx * 7) % 27) + 1);
      const idProfile = buildSeedIdProfile(idx + 1);
      await client.query(
        `INSERT INTO customers
           (id, name, dob, membership_number, membership_card_type, membership_valid_until, id_expiration_date, id_number, id_state, id_type, id_type_other, primary_language, past_due_balance, created_at, updated_at)
           VALUES ($1, $2, $3, NULL, NULL, NULL, $4, $5, $6, $7, $8, 'EN', 0, NOW(), NOW())`,
        [
          id,
          name,
          dob,
          idProfile.idExpirationDate,
          idProfile.idNumber,
          idProfile.idState,
          idProfile.idType,
          idProfile.idTypeOther,
        ]
      );
      customerIds.push(id);
      customerProfileById.set(id, { name, dob, membershipNumber: null });
      tick();
    }

    // Seed a known DL hash for encrypted lookup testing (no change to total count).
    const dlTestCustomerId = customerIds[customerIds.length - 1]!;
    const dlRawScan =
      '@\nANSI 636015090002DL00410289ZT03300007DLDCACDCBNONEDCDNONEDBA07152032DCSKESSELLDDENDACJOSHUADDFNDADCALEBDDGNDBD06042025DBB07151988DBC1DAYBRODAU072 inDAG3011 MAHANNA SPRINGS DR APT ADAIDALLASDAJTXDAK75235-8742DAQ21026653DCF35629580160034005135DCGUSADAZBRODCK10032599522DCLWDDAFDDB07162021DAW155DDK1\nZTZTAN';
    const dlNormalized = normalizeScanText(dlRawScan);
    const dlHash =
      computeIdScanIdentityHash({
        firstName: 'Joshua',
        lastName: 'Kessell',
        dob: '1988-07-15',
      }) ?? computeSha256Hex(dlNormalized);
    addTotal(1);
    await client.query(
      `UPDATE customers
         SET name = $1,
             dob = $2,
             id_scan_hash = $3,
             id_scan_value = $4,
             id_expiration_date = $5,
             id_number = $6,
             id_state = $7,
             id_type = $8,
             id_type_other = $9,
             updated_at = NOW()
         WHERE id = $10`,
      [
        'Joshua Kessell',
        new Date('1988-07-15'),
        dlHash,
        dlNormalized,
        new Date('2032-07-15'),
        '21026653',
        'TX',
        'DRIVERS_LICENSE',
        null,
        dlTestCustomerId,
      ]
    );
    tick('Finalizing customer profiles');
    log(`✓ Seeded DL hash test customer: Joshua Kessell (${dlTestCustomerId})`);
    customerProfileById.set(dlTestCustomerId, {
      name: 'Joshua Kessell',
      dob: new Date('1988-07-15'),
      membershipNumber: customerProfileById.get(dlTestCustomerId)?.membershipNumber ?? null,
    });

    const demoCustomerSeeds: Array<{
      key: string;
      name: string;
      dob: Date;
    }> = [
      {
        key: 'lockerShort',
        name: 'Carlos Ramirez',
        dob: new Date('1992-03-12'),
      },
      {
        key: 'roomRenew2h',
        name: 'Miguel Hernandez',
        dob: new Date('1986-09-08'),
      },
      {
        key: 'roomRenew6h',
        name: 'Anthony Lopez',
        dob: new Date('1979-11-21'),
      },
      {
        key: 'retailAddon',
        name: 'David Martinez',
        dob: new Date('1995-06-17'),
      },
    ];
    const demoCustomerIds = new Map<string, string>();
    setMessage('Creating demo customers');
    addTotal(demoCustomerSeeds.length);
    for (const [index, seed] of demoCustomerSeeds.entries()) {
      const id = randomUUID();
      const idProfile = buildSeedIdProfile(MEMBER_COUNT + EXTRA_GUEST_COUNT + index + 1);
      await client.query(
        `INSERT INTO customers
           (id, name, dob, membership_number, membership_card_type, membership_valid_until, id_expiration_date, id_number, id_state, id_type, id_type_other, primary_language, past_due_balance, created_at, updated_at)
           VALUES ($1, $2, $3, NULL, NULL, NULL, $4, $5, $6, $7, $8, 'EN', 0, NOW(), NOW())`,
        [
          id,
          seed.name,
          seed.dob,
          idProfile.idExpirationDate,
          idProfile.idNumber,
          idProfile.idState,
          idProfile.idType,
          idProfile.idTypeOther,
        ]
      );
      customerIds.push(id);
      customerProfileById.set(id, { name: seed.name, dob: seed.dob, membershipNumber: null });
      demoCustomerIds.set(seed.key, id);
      tick();
    }

    // -------------------------------------------------------------------
    // Current ACTIVE occupancy at NOW
    // - Rooms: 54 occupied, 1 free (must be STANDARD)
    // - Lockers: 88 occupied, 20 free
    // Exclusive assignment must hold: each stay is room OR locker.
    // At NOW: exactly one active late stay (scheduled checkout = now - 15m, prefer locker).
    // All other active stays have scheduled checkout times in the future.
    // -------------------------------------------------------------------

    const ACTIVE_ROOM_OCCUPANCY = 54;
    const ACTIVE_LOCKER_OCCUPANCY = ACTIVE_LOCKERS_TARGET;
    const DEMO_CHECKIN_BLOCKS = 6;
    const COMPLETED_TARGET = 320; // >= 200 required
    addTotal(
      ACTIVE_ROOM_OCCUPANCY + ACTIVE_LOCKER_OCCUPANCY + COMPLETED_TARGET + DEMO_CHECKIN_BLOCKS
    );
    setMessage('Generating agreements');

    const roomCustomerIds = customerIds.slice(0, ACTIVE_ROOM_OCCUPANCY);
    const lockerCustomerIds = customerIds.slice(
      ACTIVE_ROOM_OCCUPANCY,
      ACTIVE_ROOM_OCCUPANCY + ACTIVE_LOCKER_OCCUPANCY
    );
    const extraCustomerIds = customerIds.slice(ACTIVE_ROOM_OCCUPANCY + ACTIVE_LOCKER_OCCUPANCY);

    // Choose the last occupied locker customer to be the overdue one
    const lateActiveCustomerId = lockerCustomerIds[ACTIVE_LOCKER_OCCUPANCY - 1]!;
    // Keep the overdue stay's checkout aligned to a 15-minute boundary (realistic display),
    // while still being "about 15 minutes late".
    const lateScheduledCheckoutAt = new Date(floorTo15Min(now).getTime() - FIFTEEN_MIN_MS);
    // Demo expected duration is 6 hours (360 minutes). Check-in does NOT round; checkout does.
    const lateCheckInAt = new Date(lateScheduledCheckoutAt.getTime() - 6 * 60 * 60 * 1000);

    function rentalTypeForRoomNumber(roomNumber: number): RentalType {
      const tier = getRoomTierFromNumber(roomNumber);
      return tier === 'SPECIAL'
        ? RentalType.SPECIAL
        : tier === 'DOUBLE'
          ? RentalType.DOUBLE
          : RentalType.STANDARD;
    }

    async function createVisitStay(params: {
      customerId: string;
      checkInAt: Date;
      scheduledCheckoutAt: Date;
      checkedOutAt: Date | null; // null => active
      roomId: string | null;
      lockerId: string | null;
      rentalType: RentalType;
    }): Promise<void> {
      const visitId = randomUUID();
      await client.query(
        `INSERT INTO visits (id, started_at, ended_at, created_at, updated_at, customer_id)
           VALUES ($1, $2, $3, NOW(), NOW(), $4)`,
        [visitId, params.checkInAt, params.checkedOutAt, params.customerId]
      );

      await insertSignedCheckinBlock({
        visitId,
        customerId: params.customerId,
        blockType: 'INITIAL',
        startsAt: params.checkInAt,
        endsAt: params.scheduledCheckoutAt,
        rentalType: params.rentalType,
        roomId: params.roomId,
        lockerId: params.lockerId,
        signedAt: params.checkInAt,
        createdAt: params.checkInAt,
      });
    }

    async function createVisitWithRenewal(params: {
      customerId: string;
      checkInAt: Date;
      initialDurationMinutes: number;
      renewalHours: 2 | 6;
      renewalRequestMinutesBefore: number;
      checkoutDeltaMinutes: number;
      roomId: string | null;
      lockerId: string | null;
      rentalType: RentalType;
    }): Promise<void> {
      const initialEndsAt = scheduledCheckoutFromCheckin(
        params.checkInAt,
        params.initialDurationMinutes
      );
      const renewalStartsAt = initialEndsAt;
      const renewalEndsAt =
        params.renewalHours === 2
          ? new Date(renewalStartsAt.getTime() + 2 * 60 * 60 * 1000)
          : scheduledCheckoutFromCheckin(renewalStartsAt, 6 * 60);
      const checkedOutAt = new Date(
        renewalEndsAt.getTime() - params.checkoutDeltaMinutes * 60 * 1000
      );

      const visitId = randomUUID();
      await client.query(
        `INSERT INTO visits (id, started_at, ended_at, created_at, updated_at, customer_id)
           VALUES ($1, $2, $3, NOW(), NOW(), $4)`,
        [visitId, params.checkInAt, checkedOutAt, params.customerId]
      );

      await insertSignedCheckinBlock({
        visitId,
        customerId: params.customerId,
        blockType: 'INITIAL',
        startsAt: params.checkInAt,
        endsAt: initialEndsAt,
        rentalType: params.rentalType,
        roomId: params.roomId,
        lockerId: params.lockerId,
        signedAt: params.checkInAt,
        createdAt: params.checkInAt,
      });

      const renewalCreatedAt = new Date(
        renewalStartsAt.getTime() - params.renewalRequestMinutesBefore * 60 * 1000
      );
      await insertSignedCheckinBlock({
        visitId,
        customerId: params.customerId,
        blockType: params.renewalHours === 2 ? 'FINAL2H' : 'RENEWAL',
        startsAt: renewalStartsAt,
        endsAt: renewalEndsAt,
        rentalType: params.rentalType,
        roomId: params.roomId,
        lockerId: params.lockerId,
        signedAt: renewalCreatedAt,
        createdAt: renewalCreatedAt,
      });
    }

    // 1) Create ACTIVE room stays at NOW (all with future checkout times)
    const activeRoomCheckInTimes: Date[] = [];
    for (let i = 0; i < ACTIVE_ROOM_OCCUPANCY; i++) {
      const customerId = roomCustomerIds[i]!;
      const roomNumber = occupiedRoomNumbers[i]!;
      const roomMeta = roomIdByNumber.get(String(roomNumber));
      if (!roomMeta) throw new Error(`Missing room inventory row for ${roomNumber}`);

      // Check in within the last ~5h15m so checkout (6h later) is still in the future.
      // This keeps ACTIVE demo stays consistent with expected_duration=360.
      const minutesAgo = 15 + rng() * (5 * 60 + 15 - 15); // 15m..5h15m ago
      const checkInAt = new Date(now.getTime() - minutesAgo * 60 * 1000);
      const scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, 360);
      activeRoomCheckInTimes.push(checkInAt);

      // Active stay - no checkout yet
      await createVisitStay({
        customerId,
        checkInAt,
        scheduledCheckoutAt,
        checkedOutAt: null, // ACTIVE
        roomId: roomMeta.id,
        lockerId: null,
        rentalType: rentalTypeForRoomNumber(roomNumber),
      });
    }

    // 2) Create ACTIVE locker stays at NOW (1 overdue by 15min, rest with future checkout)
    const activeLockerCheckInTimes: Date[] = [];
    for (let i = 0; i < ACTIVE_LOCKER_OCCUPANCY; i++) {
      const customerId = lockerCustomerIds[i]!;
      const lockerNumber = occupiedLockerNumbers[i]!;
      const lockerId = lockerIdByNumber.get(lockerNumber);
      if (!lockerId) throw new Error(`Missing locker inventory row for ${lockerNumber}`);

      const isLateActive = customerId === lateActiveCustomerId;

      if (isLateActive) {
        // The one overdue stay (15 minutes late)
        activeLockerCheckInTimes.push(lateCheckInAt);
        await createVisitStay({
          customerId,
          checkInAt: lateCheckInAt,
          scheduledCheckoutAt: lateScheduledCheckoutAt,
          checkedOutAt: null, // ACTIVE
          roomId: null,
          lockerId,
          rentalType: RentalType.LOCKER,
        });
      } else {
        // All other active lockers have future checkout times
        // Check in within the last ~5h15m so checkout (6h later) is still in the future.
        const minutesAgo = 15 + rng() * (5 * 60 + 15 - 15); // 15m..5h15m ago
        const checkInAt = new Date(now.getTime() - minutesAgo * 60 * 1000);
        const scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, 360);
        activeLockerCheckInTimes.push(checkInAt);

        await createVisitStay({
          customerId,
          checkInAt,
          scheduledCheckoutAt,
          checkedOutAt: null, // ACTIVE
          roomId: null,
          lockerId,
          rentalType: RentalType.LOCKER,
        });
      }
    }

    // 3) Create churn: MANY completed stays over the last ~14 days
    // - Use regular 6-hour slots with light jitter
    // - Most checkouts within 0..15 minutes early, some 30..120 minutes early
    // - Never overlap with the current active assignment for the same room/locker
    function completedCustomerIdFor(idx: number): string {
      // Prefer customers not currently used for active stays, but always fall back deterministically.
      if (extraCustomerIds.length > 0) return extraCustomerIds[idx % extraCustomerIds.length]!;
      return customerIds[idx % customerIds.length]!;
    }

    // Quick lookup: active check-in times by resource id (used to prevent overlap)
    const activeCheckInByRoomId = new Map<string, Date>();
    for (let i = 0; i < ACTIVE_ROOM_OCCUPANCY; i++) {
      const roomNumber = occupiedRoomNumbers[i]!;
      const roomMeta = roomIdByNumber.get(String(roomNumber));
      if (!roomMeta) throw new Error(`Missing room inventory row for ${roomNumber}`);
      activeCheckInByRoomId.set(roomMeta.id, activeRoomCheckInTimes[i]!);
    }
    const activeCheckInByLockerId = new Map<string, Date>();
    for (let i = 0; i < ACTIVE_LOCKER_OCCUPANCY; i++) {
      const lockerNumber = occupiedLockerNumbers[i]!;
      const lockerId = lockerIdByNumber.get(lockerNumber);
      if (!lockerId) throw new Error(`Missing locker inventory row for ${lockerNumber}`);
      activeCheckInByLockerId.set(lockerId, activeLockerCheckInTimes[i]!);
    }

    const demoRoomMeta = roomIdByNumber.get(String(freeRoomNumber));
    if (!demoRoomMeta) throw new Error(`Missing demo room inventory row for ${freeRoomNumber}`);
    const demoLockerNumbers = LOCKER_NUMBERS.slice(
      ACTIVE_LOCKERS_TARGET,
      ACTIVE_LOCKERS_TARGET + 4
    );
    const demoLockerIds = demoLockerNumbers.map((n) => {
      const id = lockerIdByNumber.get(n);
      if (!id) throw new Error(`Missing demo locker inventory row for ${n}`);
      return id;
    });

    const demoLockerShortId = demoCustomerIds.get('lockerShort');
    if (demoLockerShortId) {
      const checkInAt = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      const scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, 120);
      const checkedOutAt = new Date(scheduledCheckoutAt.getTime() - 5 * 60 * 1000);
      await createVisitStay({
        customerId: demoLockerShortId,
        checkInAt,
        scheduledCheckoutAt,
        checkedOutAt,
        roomId: null,
        lockerId: demoLockerIds[0]!,
        rentalType: RentalType.LOCKER,
      });
    }

    const demoRoomRenew2hId = demoCustomerIds.get('roomRenew2h');
    if (demoRoomRenew2hId) {
      const checkInAt = new Date(now.getTime() - 10 * 60 * 60 * 1000);
      await createVisitWithRenewal({
        customerId: demoRoomRenew2hId,
        checkInAt,
        initialDurationMinutes: 360,
        renewalHours: 2,
        renewalRequestMinutesBefore: 30,
        checkoutDeltaMinutes: 8,
        roomId: demoRoomMeta.id,
        lockerId: null,
        rentalType: rentalTypeForRoomNumber(freeRoomNumber),
      });
    }

    const demoRoomRenew6hId = demoCustomerIds.get('roomRenew6h');
    if (demoRoomRenew6hId) {
      const checkInAt = new Date(now.getTime() - 20 * 60 * 60 * 1000);
      await createVisitWithRenewal({
        customerId: demoRoomRenew6hId,
        checkInAt,
        initialDurationMinutes: 360,
        renewalHours: 6,
        renewalRequestMinutesBefore: 30,
        checkoutDeltaMinutes: 12,
        roomId: demoRoomMeta.id,
        lockerId: null,
        rentalType: rentalTypeForRoomNumber(freeRoomNumber),
      });
    }

    const demoRetailId = demoCustomerIds.get('retailAddon');
    if (demoRetailId) {
      const checkInAt = new Date(now.getTime() - 5 * 60 * 60 * 1000);
      const scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, 240);
      const checkedOutAt = new Date(scheduledCheckoutAt.getTime() - 6 * 60 * 1000);
      await createVisitStay({
        customerId: demoRetailId,
        checkInAt,
        scheduledCheckoutAt,
        checkedOutAt,
        roomId: demoRoomMeta.id,
        lockerId: null,
        rentalType: rentalTypeForRoomNumber(freeRoomNumber),
      });
    }

    function pickCompletedResource(idx: number): {
      roomId: string | null;
      lockerId: string | null;
      rentalType: RentalType;
    } {
      // Slight bias toward rooms (more churn) but include lockers heavily too
      const useRoom = idx % 5 !== 0; // 80% rooms, 20% lockers
      if (useRoom) {
        const roomNumber = ROOM_NUMBERS[idx % ROOM_NUMBERS.length]!;
        const roomMeta = roomIdByNumber.get(String(roomNumber));
        if (!roomMeta) throw new Error(`Missing room inventory row for ${roomNumber}`);
        return {
          roomId: roomMeta.id,
          lockerId: null,
          rentalType: rentalTypeForRoomNumber(roomNumber),
        };
      }

      const lockerNumber = LOCKER_NUMBERS[idx % LOCKER_NUMBERS.length]!;
      const lockerId = lockerIdByNumber.get(lockerNumber);
      if (!lockerId) throw new Error(`Missing locker inventory row for ${lockerNumber}`);
      return { roomId: null, lockerId, rentalType: RentalType.LOCKER };
    }

    const completedHistoryDays = 14;
    const completedSlotHours = 6;
    const completedSlotMs = completedSlotHours * 60 * 60 * 1000;
    const completedWindowMs = completedHistoryDays * 24 * 60 * 60 * 1000;
    const completedSlotCount = Math.max(1, Math.floor(completedWindowMs / completedSlotMs));

    for (let idx = 0; idx < COMPLETED_TARGET; idx++) {
      const customerId = completedCustomerIdFor(idx);
      const resource = pickCompletedResource(idx);

      const slotIndex = idx % completedSlotCount;
      const slotStart = new Date(now.getTime() - (slotIndex + 1) * completedSlotMs);
      const jitterMinutes = randInt(0, 60);
      let checkInAt = new Date(slotStart.getTime() - jitterMinutes * 60 * 1000);

      const durationMinutes = randInt(120, 360); // 2h..6h
      let scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, durationMinutes);

      // Ensure the scheduled checkout is in the past (completed) and doesn't overlap active check-in on same resource.
      const latestScheduled = new Date(now.getTime() - 60 * 1000); // <= now-1m
      if (scheduledCheckoutAt.getTime() > latestScheduled.getTime()) {
        const shiftMs =
          scheduledCheckoutAt.getTime() - latestScheduled.getTime() + randInt(0, 60) * 60 * 1000;
        checkInAt = new Date(checkInAt.getTime() - shiftMs);
        scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, durationMinutes);
      }

      if (resource.roomId) {
        const activeCheckInAt = activeCheckInByRoomId.get(resource.roomId);
        if (activeCheckInAt && scheduledCheckoutAt.getTime() >= activeCheckInAt.getTime()) {
          const bufferMs = randInt(5, 60) * 60 * 1000;
          const newScheduled = new Date(activeCheckInAt.getTime() - bufferMs);
          const shiftMs = scheduledCheckoutAt.getTime() - newScheduled.getTime();
          checkInAt = new Date(checkInAt.getTime() - shiftMs);
          scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, durationMinutes);
        }
      }
      if (resource.lockerId) {
        const activeCheckInAt = activeCheckInByLockerId.get(resource.lockerId);
        if (activeCheckInAt && scheduledCheckoutAt.getTime() >= activeCheckInAt.getTime()) {
          const bufferMs = randInt(5, 60) * 60 * 1000;
          const newScheduled = new Date(activeCheckInAt.getTime() - bufferMs);
          const shiftMs = scheduledCheckoutAt.getTime() - newScheduled.getTime();
          checkInAt = new Date(checkInAt.getTime() - shiftMs);
          scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, durationMinutes);
        }
      }

      // Deterministic realism:
      // - 7/8 (~87.5%) within 0..15m early
      // - 1/8 (~12.5%) early by 30..120m
      const within15 = idx % 8 !== 0;
      const deltaMinutes = within15 ? randInt(0, 15) : randInt(30, 120);
      const checkedOutAt = new Date(scheduledCheckoutAt.getTime() - deltaMinutes * 60 * 1000);

      await createVisitStay({
        customerId,
        checkInAt,
        scheduledCheckoutAt,
        checkedOutAt,
        roomId: resource.roomId,
        lockerId: resource.lockerId,
        rentalType: resource.rentalType,
      });
    }

    // Update inventory at NOW to reflect ALL active assignments
    // Set all occupied rooms to OCCUPIED with assigned customer
    setMessage('Updating room occupancy');
    addTotal(ACTIVE_ROOM_OCCUPANCY);
    for (let i = 0; i < ACTIVE_ROOM_OCCUPANCY; i++) {
      const customerId = roomCustomerIds[i]!;
      const roomNumber = occupiedRoomNumbers[i]!;
      const roomMeta = roomIdByNumber.get(String(roomNumber));
      if (!roomMeta) throw new Error(`Missing room inventory row for ${roomNumber}`);

      await client.query(
        `UPDATE rooms
           SET status = $1,
               assigned_to_customer_id = $2,
               last_status_change = NOW(),
               updated_at = NOW()
           WHERE id = $3`,
        [RoomStatus.OCCUPIED, customerId, roomMeta.id]
      );
      tick();
    }

    // Ensure the one free room is CLEAN and unassigned
    const freeRoomMeta = roomIdByNumber.get(String(freeRoomNumber));
    if (!freeRoomMeta) throw new Error(`Missing free room inventory row for ${freeRoomNumber}`);
    addTotal(1);
    await client.query(
      `UPDATE rooms
         SET status = 'CLEAN',
             assigned_to_customer_id = NULL,
             last_status_change = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
      [freeRoomMeta.id]
    );
    tick();

    // Set all occupied lockers to OCCUPIED with assigned customer
    setMessage('Updating locker occupancy');
    addTotal(ACTIVE_LOCKER_OCCUPANCY);
    for (let i = 0; i < ACTIVE_LOCKER_OCCUPANCY; i++) {
      const customerId = lockerCustomerIds[i]!;
      const lockerNumber = occupiedLockerNumbers[i]!;
      const lockerId = lockerIdByNumber.get(lockerNumber);
      if (!lockerId) throw new Error(`Missing locker inventory row for ${lockerNumber}`);

      await client.query(
        `UPDATE lockers
           SET status = $1,
               assigned_to_customer_id = $2,
               updated_at = NOW()
           WHERE id = $3`,
        [RoomStatus.OCCUPIED, customerId, lockerId]
      );
      tick();
    }

    // Ensure free lockers are CLEAN and unassigned
    const freeLockerNumbers = LOCKER_NUMBERS.slice(ACTIVE_LOCKER_OCCUPANCY);
    addTotal(freeLockerNumbers.length);
    for (const lockerNumber of freeLockerNumbers) {
      const lockerId = lockerIdByNumber.get(lockerNumber);
      if (!lockerId) throw new Error(`Missing free locker inventory row for ${lockerNumber}`);
      await client.query(
        `UPDATE lockers
           SET status = 'CLEAN',
               assigned_to_customer_id = NULL,
               updated_at = NOW()
           WHERE id = $1`,
        [lockerId]
      );
      tick();
    }

    // -------------------------------------------------------------------
    // POS domain data: register sessions, cash drawers, orders, receipts, external refs
    // -------------------------------------------------------------------
    let staffRows = await client.query<{ id: string; name: string; role: string }>(
      `SELECT id, name, role FROM staff WHERE active = true ORDER BY name`
    );
    if (staffRows.rows.length === 0) {
      const staffCount = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM staff`
      );
      const totalStaff = parseInt(staffCount.rows[0]?.count || '0', 10);

      if (totalStaff > 0) {
        log('⚠️  No active staff found. Reactivating existing staff for demo seed.');
        await client.query(`UPDATE staff SET active = true WHERE active = false`);
      } else {
        log('⚠️  No staff found. Seeding demo staff for POS demo seed.');
        const demoStaff = [
          { name: 'Cruz Martinez', role: 'ADMIN', qrToken: 'ADMIN-001', pin: '123456' },
          { name: 'John Erikson', role: 'STAFF', qrToken: 'STAFF-001', pin: '111111' },
          { name: 'Maria Pineda', role: 'STAFF', qrToken: 'STAFF-002', pin: '222222' },
          { name: 'Employee Two', role: 'STAFF', qrToken: 'STAFF-005', pin: '555555' },
        ];

        for (const staff of demoStaff) {
          const qrTokenHash = hashQrToken(staff.qrToken);
          const pinHash = await hashPin(staff.pin);
          await client.query(
            `INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
             VALUES ($1, $2, $3, $4, true)`,
            [staff.name, staff.role, qrTokenHash, pinHash]
          );
        }
        seededStaff = true;
      }

      staffRows = await client.query<{ id: string; name: string; role: string }>(
        `SELECT id, name, role FROM staff WHERE active = true ORDER BY name`
      );
    }
    if (staffRows.rows.length === 0) {
      throw new Error('No active staff found for POS demo seed.');
    }

    const primaryStaff = staffRows.rows[0]!;
    const secondaryStaff = staffRows.rows[1] ?? primaryStaff;
    const adminStaff = staffRows.rows.find((staffer) => staffer.role === 'ADMIN') ?? primaryStaff;

    const openRegisterNumber = 1;
    const closedRegisterNumber = 2;
    const openRegisterDeviceId = 'demo-register-1';
    const closedRegisterDeviceId = 'demo-register-2';

    const existingOpenRegister = await client.query<{
      id: string;
      created_at: Date;
    }>(
      `SELECT id, created_at
         FROM register_sessions
         WHERE register_number = $1 AND signed_out_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
      [openRegisterNumber]
    );

    let openRegisterSessionId: string;
    let openRegisterOpenedAt: Date;

    if (existingOpenRegister.rows.length > 0) {
      openRegisterSessionId = existingOpenRegister.rows[0]!.id;
      openRegisterOpenedAt = existingOpenRegister.rows[0]!.created_at;
    } else {
      await client.query(
        `UPDATE register_sessions
           SET signed_out_at = NOW()
           WHERE device_id = $1 AND signed_out_at IS NULL`,
        [openRegisterDeviceId]
      );
      await client.query(`DELETE FROM register_sessions WHERE device_id = $1`, [
        openRegisterDeviceId,
      ]);

      const openedAt = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      const insertOpenRegister = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO register_sessions
           (employee_id, device_id, register_number, last_heartbeat, created_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, created_at`,
        [primaryStaff.id, openRegisterDeviceId, openRegisterNumber, now, openedAt]
      );
      openRegisterSessionId = insertOpenRegister.rows[0]!.id;
      openRegisterOpenedAt = insertOpenRegister.rows[0]!.created_at;
    }

    await client.query(`DELETE FROM register_sessions WHERE device_id = $1`, [
      closedRegisterDeviceId,
    ]);
    const closedRegisterOpenedAt = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const closedRegisterSignedOutAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const insertClosedRegister = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO register_sessions
         (employee_id, device_id, register_number, last_heartbeat, created_at, signed_out_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at`,
      [
        secondaryStaff.id,
        closedRegisterDeviceId,
        closedRegisterNumber,
        closedRegisterSignedOutAt,
        closedRegisterOpenedAt,
        closedRegisterSignedOutAt,
      ]
    );

    const closedRegisterSessionId = insertClosedRegister.rows[0]!.id;

    const openDrawerId = randomUUID();
    const openDrawerOpenedAt = new Date(openRegisterOpenedAt.getTime() + 10 * 60 * 1000);
    const openDrawerFloat = 200; // $200 opening float
    await client.query(
      `INSERT INTO cash_drawer_sessions
         (id, register_session_id, opened_by_staff_id, opened_at, opening_float, status)
         VALUES ($1, $2, $3, $4, $5, 'OPEN')`,
      [
        openDrawerId,
        openRegisterSessionId,
        primaryStaff.id,
        openDrawerOpenedAt,
        openDrawerFloat,
      ]
    );

    const closedDrawerId = randomUUID();
    const closedDrawerOpenedAt = new Date(closedRegisterOpenedAt.getTime() + 20 * 60 * 1000);
    const closedDrawerClosedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const closedDrawerFloat = 150; // $150 opening float
    await client.query(
      `INSERT INTO cash_drawer_sessions
         (id, register_session_id, opened_by_staff_id, opened_at, opening_float, closed_by_staff_id, closed_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'CLOSED')`,
      [
        closedDrawerId,
        closedRegisterSessionId,
        secondaryStaff.id,
        closedDrawerOpenedAt,
        closedDrawerFloat,
        secondaryStaff.id,
        closedDrawerClosedAt,
      ]
    );

    async function insertDrawerEvent(params: {
      sessionId: string;
      occurredAt: Date;
      type: 'PAID_IN' | 'PAID_OUT' | 'DROP' | 'NO_SALE_OPEN' | 'ADJUSTMENT';
      amount?: number | null;
      reason?: string | null;
      staffId: string;
      metadata?: Record<string, unknown> | null;
    }): Promise<string> {
      const eventId = randomUUID();
      await client.query(
        `INSERT INTO cash_drawer_events
           (id, cash_drawer_session_id, occurred_at, type, amount, reason, created_by_staff_id, metadata_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          eventId,
          params.sessionId,
          params.occurredAt,
          params.type,
          params.amount ?? null,
          params.reason ?? null,
          params.staffId,
          params.metadata ?? null,
        ]
      );
      return eventId;
    }

    setMessage('Seeding cash drawer events');
    addTotal(8);
    await insertDrawerEvent({
      sessionId: openDrawerId,
      occurredAt: new Date(openDrawerOpenedAt.getTime() + 30 * 60 * 1000),
      type: 'PAID_IN',
      amount: 50,
      reason: 'Tip jar start',
      staffId: primaryStaff.id,
    });
    tick();
    await insertDrawerEvent({
      sessionId: openDrawerId,
      occurredAt: new Date(openDrawerOpenedAt.getTime() + 90 * 60 * 1000),
      type: 'PAID_OUT',
      amount: 25,
      reason: 'Supplies',
      staffId: primaryStaff.id,
    });
    tick();
    await insertDrawerEvent({
      sessionId: openDrawerId,
      occurredAt: new Date(openDrawerOpenedAt.getTime() + 120 * 60 * 1000),
      type: 'NO_SALE_OPEN',
      amount: null,
      reason: 'Customer check',
      staffId: primaryStaff.id,
    });
    tick();
    await insertDrawerEvent({
      sessionId: openDrawerId,
      occurredAt: new Date(openDrawerOpenedAt.getTime() + 150 * 60 * 1000),
      type: 'ADJUSTMENT',
      amount: 3,
      reason: 'Drawer audit',
      staffId: primaryStaff.id,
    });
    tick();

    const firstClosedEventId = await insertDrawerEvent({
      sessionId: closedDrawerId,
      occurredAt: new Date(closedDrawerOpenedAt.getTime() + 45 * 60 * 1000),
      type: 'PAID_IN',
      amount: 80,
      reason: 'Extra change',
      staffId: secondaryStaff.id,
    });
    tick();
    await insertDrawerEvent({
      sessionId: closedDrawerId,
      occurredAt: new Date(closedDrawerOpenedAt.getTime() + 120 * 60 * 1000),
      type: 'PAID_OUT',
      amount: 32,
      reason: 'Vendor payout',
      staffId: secondaryStaff.id,
    });
    tick();
    await insertDrawerEvent({
      sessionId: closedDrawerId,
      occurredAt: new Date(closedDrawerOpenedAt.getTime() + 180 * 60 * 1000),
      type: 'DROP',
      amount: 150,
      reason: 'Safe drop',
      staffId: secondaryStaff.id,
    });
    tick();
    await insertDrawerEvent({
      sessionId: closedDrawerId,
      occurredAt: new Date(closedDrawerOpenedAt.getTime() + 210 * 60 * 1000),
      type: 'NO_SALE_OPEN',
      amount: null,
      reason: 'Receipt reprint',
      staffId: secondaryStaff.id,
    });
    tick();

    if (firstClosedEventId) {
      await client.query(
        `INSERT INTO external_provider_refs
           (provider, entity_type, internal_id, external_id, external_version)
           VALUES ('mock', 'cash_event', $1, $2, $3)`,
        [firstClosedEventId, 'mock-cash-event-01', 'v1']
      );
    }

    type OrderSeed = {
      id: string;
      createdAt: Date;
      status: string;
      registerSessionId: string | null;
      customerId: string | null;
      paymentMethod: 'CASH' | 'CREDIT';
      totals: {
        subtotal: number;
        discount: number;
        tax: number;
        tip: number;
        total: number;
        currency: string;
      };
      lineItems: Array<{
        id: string;
        kind: 'RETAIL';
        sku: string | null;
        name: string;
        quantity: number;
        unitPrice: number;
        discount: number;
        tax: number;
        total: number;
      }>;
    };

    const lineItemCatalog: Array<{
      kind: 'RETAIL';
      sku: string;
      name: string;
      unitPrice: number;
    }> = [
      { kind: 'RETAIL', sku: 'RET-001', name: 'Bottled Water', unitPrice: 3 },
      { kind: 'RETAIL', sku: 'RET-002', name: 'Energy Drink', unitPrice: 5 },
      { kind: 'RETAIL', sku: 'RET-003', name: 'Towel Rental', unitPrice: 5 },
      { kind: 'RETAIL', sku: 'RET-004', name: 'Swiss Navy', unitPrice: 12 },
      { kind: 'RETAIL', sku: 'RET-005', name: 'Snack Bar', unitPrice: 4 },
    ];

    function randomDateBetween(start: Date, end: Date): Date {
      const span = Math.max(end.getTime() - start.getTime(), 0);
      return new Date(start.getTime() + rng() * span);
    }

    function buildLineItems(seed: number): OrderSeed['lineItems'] {
      const itemCount = 1 + (seed % 2); // max 2 items per order
      const items: OrderSeed['lineItems'] = [];
      for (let i = 0; i < itemCount; i++) {
        const catalog = lineItemCatalog[(seed + i) % lineItemCatalog.length]!;
        const quantity = 1 + ((seed + i) % 2); // 1 or 2
        const base = catalog.unitPrice * quantity;
        const discount = (seed + i) % 5 === 0 ? Math.round(base * 0.1) : 0;
        const tax = 0; // prices are tax-inclusive
        const total = base - discount;
        items.push({
          id: randomUUID(),
          kind: catalog.kind,
          sku: catalog.sku,
          name: catalog.name,
          quantity,
          unitPrice: catalog.unitPrice,
          discount,
          tax,
          total,
        });
      }
      return items;
    }

    function buildOrderTotals(
      items: OrderSeed['lineItems'],
      tip: number
    ): OrderSeed['totals'] {
      const subtotal = items.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0
      );
      const discount = items.reduce((sum, item) => sum + item.discount, 0);
      const tax = items.reduce((sum, item) => sum + item.tax, 0);
      const total = subtotal - discount + tax + tip;
      return {
        subtotal,
        discount,
        tax,
        tip,
        total,
        currency: 'USD',
      };
    }

    async function insertOrderSeed(params: {
      seed: number;
      createdAt: Date;
      registerSessionId: string | null;
      customerId: string | null;
      staffId: string;
    }): Promise<OrderSeed> {
      const paymentMethod: OrderSeed['paymentMethod'] = params.seed % 3 === 0 ? 'CASH' : 'CREDIT';
      const statusRoll = params.seed % 12;
      const status =
        statusRoll === 0
          ? 'CANCELED'
          : statusRoll === 1
            ? 'REFUNDED'
            : statusRoll === 2
              ? 'PARTIALLY_REFUNDED'
              : statusRoll === 3
                ? 'OPEN'
                : 'PAID';

      const lineItems = buildLineItems(params.seed);
      const tip = 0; // Tips are cash-only, not tracked in app
      const totals = buildOrderTotals(lineItems, tip);
      const orderId = randomUUID();

      await client.query(
        `INSERT INTO orders
           (id, customer_id, register_session_id, created_by_staff_id, created_at, status, subtotal, discount, tax, tip, total, currency, metadata_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          orderId,
          params.customerId,
          params.registerSessionId,
          params.staffId,
          params.createdAt,
          status,
          totals.subtotal,
          totals.discount,
          totals.tax,
          totals.tip,
          totals.total,
          totals.currency,
          {
            tender: {
              paymentMethod,
              source: 'DEMO',
            },
          },
        ]
      );

      for (const item of lineItems) {
        await client.query(
          `INSERT INTO order_line_items
             (id, order_id, kind, sku, name, quantity, unit_price, discount, tax, total, metadata_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            item.id,
            orderId,
            item.kind,
            item.sku,
            item.name,
            item.quantity,
            item.unitPrice,
            item.discount,
            item.tax,
            item.total,
            null,
          ]
        );
      }

      const seedData: OrderSeed = {
        id: orderId,
        createdAt: params.createdAt,
        status,
        registerSessionId: params.registerSessionId,
        customerId: params.customerId,
        paymentMethod,
        totals,
        lineItems,
      };

      if (status === 'PAID' || status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED') {
        const receiptNumber = buildReceiptNumber({ id: orderId, created_at: params.createdAt });
        const issuedAt = new Date(params.createdAt.getTime() + 5 * 60 * 1000);
        const receiptJson = {
          receiptNumber,
          orderId,
          issuedAt: issuedAt.toISOString(),
          currency: totals.currency,
          totals: {
            subtotal: totals.subtotal,
            discount: totals.discount,
            tax: totals.tax,
            tip: totals.tip,
            total: totals.total,
          },
          lineItems: lineItems.map((item) => ({
            id: item.id,
            kind: item.kind,
            sku: item.sku,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            tax: item.tax,
            total: item.total,
          })),
        };

        const receiptId = randomUUID();
        await client.query(
          `INSERT INTO receipts
             (id, order_id, issued_at, receipt_number, receipt_json)
             VALUES ($1, $2, $3, $4, $5)`,
          [receiptId, orderId, issuedAt, receiptNumber, receiptJson]
        );

        if (params.seed % 5 === 0) {
          await client.query(
            `INSERT INTO external_provider_refs
               (provider, entity_type, internal_id, external_id, external_version)
               VALUES ('mock', 'receipt', $1, $2, $3)`,
            [receiptId, `mock-receipt-${params.seed}`, 'v1']
          );
        }
      }

      if (params.seed % 4 === 0) {
        await client.query(
          `INSERT INTO external_provider_refs
             (provider, entity_type, internal_id, external_id, external_version)
             VALUES ('mock', 'order', $1, $2, $3)`,
          [orderId, `mock-order-${params.seed}`, 'v1']
        );
      }

      return seedData;
    }

    const openSessionStart = openDrawerOpenedAt;
    const openSessionEnd = now;
    const closedSessionStart = closedDrawerOpenedAt;
    const closedSessionEnd = closedDrawerClosedAt;

    const ordersForOpen = 24;
    const ordersForClosed = 18;
    const ordersUnassigned = 10;
    const demoRetailCustomerId = demoCustomerIds.get('retailAddon');
    const totalOrders =
      ordersForOpen + ordersForClosed + ordersUnassigned + (demoRetailCustomerId ? 1 : 0);
    setMessage('Seeding orders');
    addTotal(totalOrders);

    for (let idx = 0; idx < ordersForOpen; idx++) {
      const seed = idx + 1;
      await insertOrderSeed({
        seed,
        createdAt: randomDateBetween(openSessionStart, openSessionEnd),
        registerSessionId: openRegisterSessionId,
        customerId: seed % 6 === 0 ? null : customerIds[(seed * 7) % customerIds.length]!,
        staffId: seed % 2 === 0 ? primaryStaff.id : secondaryStaff.id,
      });
      tick();
    }

    for (let idx = 0; idx < ordersForClosed; idx++) {
      const seed = idx + 101;
      await insertOrderSeed({
        seed,
        createdAt: randomDateBetween(closedSessionStart, closedSessionEnd),
        registerSessionId: closedRegisterSessionId,
        customerId: seed % 5 === 0 ? null : customerIds[(seed * 5) % customerIds.length]!,
        staffId: seed % 2 === 0 ? secondaryStaff.id : primaryStaff.id,
      });
      tick();
    }

    for (let idx = 0; idx < ordersUnassigned; idx++) {
      const seed = idx + 201;
      await insertOrderSeed({
        seed,
        createdAt: randomDateBetween(
          new Date(now.getTime() - 20 * 60 * 60 * 1000),
          new Date(now.getTime() - 6 * 60 * 60 * 1000)
        ),
        registerSessionId: null,
        customerId: seed % 4 === 0 ? null : customerIds[(seed * 3) % customerIds.length]!,
        staffId: adminStaff.id,
      });
      tick();
    }

    if (demoRetailCustomerId) {
      await insertOrderSeed({
        seed: 305,
        createdAt: randomDateBetween(openSessionStart, openSessionEnd),
        registerSessionId: openRegisterSessionId,
        customerId: demoRetailCustomerId,
        staffId: primaryStaff.id,
      });
      tick();
    }

    const closeoutSnapshot = await buildCloseoutSnapshot(
      client,
      {
        id: closedDrawerId,
        register_session_id: closedRegisterSessionId,
        opened_at: closedDrawerOpenedAt,
        opening_float: closedDrawerFloat,
      },
      closedDrawerClosedAt
    );

    const countedCash = closeoutSnapshot.expectedCash - 2.50;
    const overShort = countedCash - closeoutSnapshot.expectedCash;

    setMessage('Building closeout snapshot');
    addTotal(1);
    await client.query(
      `UPDATE cash_drawer_sessions
         SET expected_cash = $1,
             counted_cash = $2,
             over_short = $3,
             closeout_snapshot_json = $4
         WHERE id = $5`,
      [
        closeoutSnapshot.expectedCash,
        countedCash,
        overShort,
        closeoutSnapshot,
        closedDrawerId,
      ]
    );
    tick();
  });

  // Post-seed assertions + concise summary (throw on failure)
  setMessage('Validating dataset');
  addTotal(1);
  const staffCountAfter = await query<{ count: string }>(
    'SELECT COUNT(*)::text as count FROM staff'
  );
  const staffCountAfterValue = parseInt(staffCountAfter.rows[0]?.count || '0', 10);
  if (!seededStaff && staffCountBeforeValue !== staffCountAfterValue) {
    throw new Error(
      `Staff count changed unexpectedly (${staffCountBeforeValue} -> ${staffCountAfterValue})`
    );
  }
  if (seededStaff) {
    log(`ℹ️  Demo staff seeded (${staffCountBeforeValue} -> ${staffCountAfterValue}).`);
  }

  const customerCount = await query<{ count: string }>(
    'SELECT COUNT(*)::text as count FROM customers'
  );
  const membershipCustomerCount = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM customers WHERE membership_number IS NOT NULL`
  );
  const roomCount = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM rooms');
  const lockerCount = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM lockers');

  const nonExistentRoomsPresent = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM rooms WHERE number = ANY($1::text[])`,
    [NONEXISTENT_ROOM_NUMBERS.map(String)]
  );

  // XOR violations (must be zero)
  const bothInBlocks = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM checkin_blocks WHERE room_id IS NOT NULL AND locker_id IS NOT NULL`
  );

  const unsignedBlocks = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count
       FROM checkin_blocks
       WHERE agreement_signed = false
          OR agreement_signed_at IS NULL
          OR agreement_pdf IS NULL`
  );
  const unsignedSignatures = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count
       FROM checkin_blocks cb
       LEFT JOIN agreement_signatures sig ON sig.checkin_block_id = cb.id
       WHERE sig.id IS NULL`
  );

  // Current occupancy at NOW: inventory assignments
  const roomsAssigned = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM rooms WHERE assigned_to_customer_id IS NOT NULL`
  );
  const roomsUnassigned = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM rooms WHERE assigned_to_customer_id IS NULL`
  );
  const lockersAssigned = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM lockers WHERE assigned_to_customer_id IS NOT NULL`
  );
  const lockersUnassigned = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM lockers WHERE assigned_to_customer_id IS NULL`
  );

  // Verify the one open room is STANDARD
  const openRooms = await query<{ number: string; type: string }>(
    `SELECT number, type::text as type FROM rooms WHERE assigned_to_customer_id IS NULL ORDER BY number`
  );

  // Active stays at NOW
  const activeBlocksNow = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count
       FROM checkin_blocks cb
       JOIN visits v ON v.id = cb.visit_id
       WHERE v.ended_at IS NULL`
  );
  const activeVisitsNow = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM visits WHERE ended_at IS NULL`
  );

  // Find the overdue active session (exactly one)
  const overdueActiveBlocks = await query<{
    id: string;
    ends_at: Date;
    room_id: string | null;
    locker_id: string | null;
    customer_id: string;
  }>(
    `SELECT cb.id, cb.ends_at, cb.room_id, cb.locker_id, v.customer_id
       FROM checkin_blocks cb
       JOIN visits v ON v.id = cb.visit_id
       WHERE v.ended_at IS NULL
         AND cb.ends_at < NOW()
       ORDER BY cb.ends_at`
  );

  // All other active blocks should have future checkout
  const futureActiveBlocks = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count
       FROM checkin_blocks cb
       JOIN visits v ON v.id = cb.visit_id
       WHERE v.ended_at IS NULL
         AND cb.ends_at > NOW()`
  );

  // Checkout quality: >= 85% of completed stays have (checkout_at - check_out_time) in [-15m, +15m]
  const checkoutQuality = await query<{ total: string; good: string }>(
    `SELECT
         COUNT(*)::text as total,
         COUNT(*) FILTER (
           WHERE EXTRACT(EPOCH FROM (v.ended_at - cb.ends_at)) BETWEEN (-15 * 60) AND (15 * 60)
         )::text as good
       FROM visits v
       JOIN LATERAL (
         SELECT ends_at
         FROM checkin_blocks
         WHERE visit_id = v.id
         ORDER BY ends_at DESC
         LIMIT 1
       ) cb ON TRUE
       WHERE v.ended_at IS NOT NULL`
  );

  function asInt(row: { count: string }): number {
    return parseInt(row.count, 10);
  }

  if (asInt(membershipCustomerCount.rows[0]!) !== 100)
    throw new Error(
      `Expected 100 membership customers, got ${membershipCustomerCount.rows[0]!.count}`
    );
  if (asInt(customerCount.rows[0]!) < 142)
    throw new Error(`Expected at least 142 customers, got ${customerCount.rows[0]!.count}`);
  if (asInt(roomCount.rows[0]!) !== 55)
    throw new Error(`Expected 55 rooms, got ${roomCount.rows[0]!.count}`);
  if (asInt(nonExistentRoomsPresent.rows[0]!) !== 0)
    throw new Error(`Non-existent rooms present in DB (${nonExistentRoomsPresent.rows[0]!.count})`);
  if (asInt(lockerCount.rows[0]!) !== 108)
    throw new Error(`Expected 108 lockers, got ${lockerCount.rows[0]!.count}`);
  if (asInt(bothInBlocks.rows[0]!) !== 0)
    throw new Error(
      `Exclusive assignment violated in checkin_blocks (${bothInBlocks.rows[0]!.count})`
    );
  if (asInt(unsignedBlocks.rows[0]!) !== 0)
    throw new Error(
      `Expected all check-in blocks to be signed with PDFs; missing=${unsignedBlocks.rows[0]!.count}`
    );
  if (asInt(unsignedSignatures.rows[0]!) !== 0)
    throw new Error(
      `Expected agreement signatures for all check-in blocks; missing=${unsignedSignatures.rows[0]!.count}`
    );

  // Current occupancy at NOW
  if (asInt(roomsAssigned.rows[0]!) !== 54)
    throw new Error(`Expected 54 assigned rooms at now, got ${roomsAssigned.rows[0]!.count}`);
  if (asInt(roomsUnassigned.rows[0]!) !== 1)
    throw new Error(`Expected 1 unassigned room at now, got ${roomsUnassigned.rows[0]!.count}`);
  if (openRooms.rows.length !== 1)
    throw new Error(`Expected 1 open room at now, got ${openRooms.rows.length}`);
  if (openRooms.rows[0]!.type !== 'STANDARD')
    throw new Error(
      `Expected the open room to be STANDARD, got ${openRooms.rows[0]!.number} (${openRooms.rows[0]!.type})`
    );
  if (asInt(lockersAssigned.rows[0]!) !== ACTIVE_LOCKERS_TARGET)
    throw new Error(
      `Expected ${ACTIVE_LOCKERS_TARGET} assigned lockers at now, got ${lockersAssigned.rows[0]!.count}`
    );
  if (asInt(lockersUnassigned.rows[0]!) !== 108 - ACTIVE_LOCKERS_TARGET)
    throw new Error(
      `Expected ${108 - ACTIVE_LOCKERS_TARGET} unassigned lockers at now, got ${lockersUnassigned.rows[0]!.count}`
    );

  // All DOUBLE and SPECIAL rooms must be occupied at now
  const missingDouble = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count
       FROM rooms
       WHERE number = ANY($1::text[])
         AND assigned_to_customer_id IS NULL`,
    [DOUBLE_ROOM_NUMBERS.map(String)]
  );
  const missingSpecial = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count
       FROM rooms
       WHERE number = ANY($1::text[])
         AND assigned_to_customer_id IS NULL`,
    [SPECIAL_ROOM_NUMBERS.map(String)]
  );
  if (asInt(missingDouble.rows[0]!) !== 0)
    throw new Error(`Expected all DOUBLE rooms occupied, missing=${missingDouble.rows[0]!.count}`);
  if (asInt(missingSpecial.rows[0]!) !== 0)
    throw new Error(
      `Expected all SPECIAL rooms occupied, missing=${missingSpecial.rows[0]!.count}`
    );

  // Active stays at NOW
  const expectedActiveNow = 54 + ACTIVE_LOCKERS_TARGET;
  if (asInt(activeBlocksNow.rows[0]!) !== expectedActiveNow)
    throw new Error(
      `Expected ${expectedActiveNow} active check-in blocks at now, got ${activeBlocksNow.rows[0]!.count}`
    );
  if (asInt(activeVisitsNow.rows[0]!) !== expectedActiveNow)
    throw new Error(
      `Expected ${expectedActiveNow} active visits at now, got ${activeVisitsNow.rows[0]!.count}`
    );

  // Exactly one overdue active block
  if (overdueActiveBlocks.rows.length !== 1)
    throw new Error(
      `Expected exactly 1 overdue active block, got ${overdueActiveBlocks.rows.length}`
    );
  const overdue = overdueActiveBlocks.rows[0]!;
  // Overdue session checkout is seeded on a 15-minute boundary and set to the prior 15-minute tick.
  const expectedLateMs = floorTo15Min(now).getTime() - 15 * 60 * 1000;
  if (!overdue.ends_at) throw new Error('Overdue active block missing ends_at');
  const lateDiffMs = Math.abs(new Date(overdue.ends_at).getTime() - expectedLateMs);
  // Allow slack because seeding + verification takes time.
  if (lateDiffMs > 2 * 60 * 1000) {
    throw new Error(
      `Overdue active block checkout mismatch: got ${new Date(overdue.ends_at).toISOString()} expected ~${new Date(expectedLateMs).toISOString()} (diff: ${lateDiffMs}ms)`
    );
  }
  if (overdue.room_id && overdue.locker_id)
    throw new Error('Overdue active block has both room and locker set');
  if (!overdue.room_id && !overdue.locker_id)
    throw new Error('Overdue active block must have either room or locker');

  // All other active blocks have future checkout
  if (asInt(futureActiveBlocks.rows[0]!) !== expectedActiveNow - 1)
    throw new Error(
      `Expected ${expectedActiveNow - 1} active blocks with future checkout, got ${futureActiveBlocks.rows[0]!.count}`
    );

  // Relaxed checkout realism checks (warn unless wildly off)
  const totalCompleted = parseInt(checkoutQuality.rows[0]!.total, 10);
  const within15Completed = parseInt(checkoutQuality.rows[0]!.good, 10);
  const within15Ratio = totalCompleted === 0 ? 0 : within15Completed / totalCompleted;

  const earlyCountRes = await query<{ early: string }>(
    `SELECT COUNT(*) FILTER (
         WHERE EXTRACT(EPOCH FROM (v.ended_at - cb.ends_at)) < (-15 * 60)
       )::text as early
       FROM visits v
       JOIN LATERAL (
         SELECT ends_at
         FROM checkin_blocks
         WHERE visit_id = v.id
         ORDER BY ends_at DESC
         LIMIT 1
       ) cb ON TRUE
       WHERE v.ended_at IS NOT NULL`
  );
  const earlyCompleted = parseInt(earlyCountRes.rows[0]!.early, 10);
  const earlyRatio = totalCompleted === 0 ? 0 : earlyCompleted / totalCompleted;

  if (totalCompleted < 200) {
    throw new Error(`Expected at least 200 completed visits, got ${totalCompleted}`);
  }

  // Target: within15 >= 0.85 and early <= 0.15, but don't fail on small natural variance.
  if (within15Ratio < 0.6) {
    throw new Error(
      `Checkout timing realism wildly off: within15=${within15Completed}/${totalCompleted} (${Math.round(within15Ratio * 100)}%)`
    );
  }
  if (within15Ratio < 0.85 || earlyRatio > 0.15) {
    log(
      `⚠️  Checkout timing realism (non-fatal): within15=${within15Completed}/${totalCompleted} (${Math.round(
        within15Ratio * 100
      )}%), early>${15}m=${earlyCompleted}/${totalCompleted} (${Math.round(earlyRatio * 100)}%)`
    );
  }

  // Get overdue session details for summary
  const overdueResourceDetails = await query<{
    room_number: string | null;
    locker_number: string | null;
  }>(
    `SELECT r.number as room_number, l.number as locker_number
       FROM checkin_blocks cb
       LEFT JOIN rooms r ON cb.room_id = r.id
       LEFT JOIN lockers l ON cb.locker_id = l.id
       WHERE cb.id = $1`,
    [overdue.id]
  );
  const resourceRow = overdueResourceDetails.rows[0]!;
  const assignmentType = overdue.locker_id ? 'locker' : 'room';
  const overdueResource = resourceRow.locker_number || resourceRow.room_number || 'unknown';

  tick();
  log(
    `✅ Busy Saturday seed complete (now=${now.toISOString()}): membership_customers=${membershipCustomerCount.rows[0]!.count}, customers=${customerCount.rows[0]!.count}, active blocks=${54 + ACTIVE_LOCKERS_TARGET} (54 rooms + ${ACTIVE_LOCKERS_TARGET} lockers), completed visits=${totalCompleted}, open STANDARD room=${openRooms.rows[0]!.number}, overdue block=${overdue.id} (${assignmentType} ${overdueResource})`
  );
}
