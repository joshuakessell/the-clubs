import { randomUUID } from 'crypto';

export type DbClient = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

export type DemoCustomer = {
  id: string;
  name: string;
  membership_number: string | null;
  dob: Date | null;
};

export type DemoLocker = { id: string; number: number };
export type DemoRoom = { id: string; number: string; type: string };
export type DemoStaff = { id: string; name: string };
export type DemoRegisterSession = {
  id: string;
  register_number: number;
  employee_id: string;
  device_id: string;
};

export type DemoAgreement = {
  id: string;
  version: string;
  title: string;
  body_text: string;
};

function seededRng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(rng: () => number, items: Array<{ item: T; weight: number }>): T {
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  const roll = rng() * total;
  let acc = 0;
  for (const it of items) {
    acc += it.weight;
    if (roll <= acc) return it.item;
  }
  return items[items.length - 1]!.item;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function floorTo15Min(d: Date): Date {
  const ms = d.getTime();
  const rounded = Math.floor(ms / (15 * 60 * 1000)) * 15 * 60 * 1000;
  return new Date(rounded);
}

function ceilTo15Min(d: Date): Date {
  const ms = d.getTime();
  const rounded = Math.ceil(ms / (15 * 60 * 1000)) * 15 * 60 * 1000;
  return new Date(rounded);
}

function hourOf(d: Date): number {
  return d.getHours();
}

function isFridayOrSaturdayPeak(d: Date): boolean {
  const day = d.getDay(); // 0=Sun..6=Sat
  const hour = hourOf(d);
  const isFriNight = day === 5 && hour >= 20;
  const isSatEarly = day === 6 && hour <= 4;
  const isSatNight = day === 6 && hour >= 20;
  const isSunEarly = day === 0 && hour <= 4;
  return isFriNight || isSatEarly || isSatNight || isSunEarly;
}

function visitStartRatePerHour(d: Date): number {
  if (isFridayOrSaturdayPeak(d)) return 36;
  const hour = hourOf(d);
  if (hour >= 12 && hour <= 16) return 10;
  if (hour >= 17 && hour <= 19) return 18;
  if (hour >= 20 && hour <= 23) return 22;
  if (hour >= 0 && hour <= 3) return 14;
  return 6;
}

function samplePoisson(rng: () => number, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function sampleStayMinutes(rng: () => number): number {
  return pickWeighted(rng, [
    { item: 120, weight: 0.06 },
    { item: 240, weight: 0.18 },
    { item: 360, weight: 0.62 },
    { item: 480, weight: 0.1 },
    { item: 720, weight: 0.04 },
  ]);
}

function sampleCheckoutDeltaMinutes(rng: () => number): number {
  return pickWeighted(rng, [
    { item: 0, weight: 0.55 },
    { item: 5, weight: 0.18 },
    { item: 10, weight: 0.1 },
    { item: 30, weight: 0.07 },
    { item: 60, weight: 0.04 },
    { item: 120, weight: 0.02 },
    { item: -5, weight: 0.02 },
    { item: -15, weight: 0.01 },
    { item: -30, weight: 0.01 },
  ]);
}

function currencyUSD() {
  return 'USD';
}

/** Tier-based checkin pricing in cents */
function checkinPriceCents(rentalType: string): number {
  switch (rentalType) {
    case 'LOCKER': return 2000;
    case 'STANDARD': return 4000;
    case 'DOUBLE': return 5500;
    case 'SPECIAL': return 6500;
    default: return 2000;
  }
}

/** Get the night key (YYYY-MM-DD) for a date, treating 0:00-5:59 as previous day's night */
function nightKey(d: Date): string {
  const adjusted = new Date(d.getTime());
  if (adjusted.getHours() < 6) {
    adjusted.setDate(adjusted.getDate() - 1);
  }
  return adjusted.toISOString().slice(0, 10);
}

export async function appendIncrementalDemoSimulation(params: {
  client: DbClient;
  from: Date;
  to: Date;
  agreement: DemoAgreement;
  customers: DemoCustomer[];
  lockers: DemoLocker[];
  rooms: DemoRoom[];
  staff: DemoStaff[];
  registerSessions: DemoRegisterSession[];
}): Promise<{ visitsCreated: number }> {
  const windowMs = params.to.getTime() - params.from.getTime();
  if (windowMs <= 0) return { visitsCreated: 0 };

  const rngSeed = Math.floor(params.from.getTime() / 60000) ^ Math.floor(windowMs / 60000);
  const rng = seededRng(rngSeed);

  const intervalMs = 60 * 60 * 1000;
  const intervals = Math.max(1, Math.ceil(windowMs / intervalMs));
  const maxVisits = Math.min(900, intervals * 70);

  const useLockers = params.lockers.length > 0;

  let customerIndex = 0;
  let lockerIndex = 0;
  let roomIndex = 0;
  let created = 0;

  // ---------------------------------------------------------------------------
  // Deferred event queues — populated during visit creation, flushed afterward
  // ---------------------------------------------------------------------------

  const checkoutEvents: Array<{
    occurredAt: Date;
    customer: DemoCustomer;
    visitId: string;
    checkinBlockId: string;
    rentalType: string;
    roomId: string | null;
    lockerId: string | null;
    staffId: string;
    staffName: string;
    checkoutDeltaMinutes: number;
  }> = [];

  const cleaningEvents: Array<{
    roomId: string;
    startedAt: Date;
    completedAt: Date;
    staffId: string;
  }> = [];

  const anonOrders: Array<{ createdAt: Date; staffId: string; registerSessionId: string }> = [];
  const customerOrders: Array<{
    createdAt: Date;
    staffId: string;
    registerSessionId: string;
    customerId: string;
  }> = [];

  // Waitlist entries for rooms (completed flow)
  const waitlistEvents: Array<{
    visitId: string;
    checkinBlockId: string;
    customerId: string;
    desiredTier: string;
    roomId: string;
    createdAt: Date;
    offeredAt: Date;
    completedAt: Date;
  }> = [];

  // Room upgrade events (locker→room mid-stay)
  const upgradeEvents: Array<{
    visitId: string;
    originalBlockId: string;
    customerId: string;
    roomId: string;
    roomType: string;
    lockerId: string;
    upgradeAt: Date;
    upgradeEndAt: Date;
    staffId: string;
  }> = [];

  // Payment intents for checkin fees
  const paymentEvents: Array<{
    visitId: string;
    checkinBlockId: string;
    rentalType: string;
    paidAt: Date;
    laneSessionId: string | null;
    customerId: string;
    staffId: string;
    staffName: string;
  }> = [];

  // Checkout requests for room visits (completed)
  const checkoutRequestEvents: Array<{
    checkinBlockId: string;
    customerId: string;
    lateMinutes: number;
    lateFeeAmount: number;
    completedAt: Date;
  }> = [];

  // Late checkout events (capped at 2 per night)
  const lateCheckoutEvents: Array<{
    checkinBlockId: string;
    customerId: string;
    lateMinutes: number;
    feeAmount: number;
    banApplied: boolean;
    createdAt: Date;
    checkoutRequestId: string | null;
  }> = [];

  // Track late checkouts per night to cap at 2
  const lateCountByNight = new Map<string, number>();

  for (let i = 0; i < intervals && created < maxVisits; i += 1) {
    const slotStart = new Date(params.from.getTime() + i * intervalMs);
    const slotEnd = new Date(Math.min(slotStart.getTime() + intervalMs, params.to.getTime()));

    const slotLambda = visitStartRatePerHour(slotStart);
    const visitsInSlot = clamp(samplePoisson(rng, slotLambda), 0, 70);

    for (let j = 0; j < visitsInSlot && created < maxVisits; j += 1) {
      const offsetMs = Math.floor(rng() * Math.max(1, slotEnd.getTime() - slotStart.getTime()));
      let start = new Date(slotStart.getTime() + offsetMs);
      if (start > params.to) continue;
      start = floorTo15Min(start);

      const stayMinutes = sampleStayMinutes(rng);
      const scheduledEnd = ceilTo15Min(new Date(start.getTime() + stayMinutes * 60 * 1000));
      if (scheduledEnd <= start) continue;

      const checkoutDeltaMinutes = sampleCheckoutDeltaMinutes(rng);
      const end = new Date(scheduledEnd.getTime() - checkoutDeltaMinutes * 60 * 1000);
      if (end <= start) continue;
      if (end > params.to) continue;

      const customer = params.customers[customerIndex++ % params.customers.length]!;
      const register = params.registerSessions[(customerIndex + j) % params.registerSessions.length]!;
      const staffMember = params.staff.find((s) => s.id === register.employee_id) ?? params.staff[0]!;

      const visitId = randomUUID();
      const checkinBlockId = randomUUID();

      let lockerId: string | null = null;
      let roomId: string | null = null;
      let rentalType = 'LOCKER';

      const preferLocker = useLockers && rng() < 0.62;
      if (preferLocker) {
        const locker = params.lockers[lockerIndex++ % params.lockers.length]!;
        lockerId = locker.id;
        rentalType = 'LOCKER';
      } else if (params.rooms.length > 0) {
        const room = params.rooms[roomIndex++ % params.rooms.length]!;
        roomId = room.id;
        rentalType =
          room.type === 'DOUBLE' || room.type === 'SPECIAL' || room.type === 'STANDARD'
            ? room.type
            : 'STANDARD';
      } else if (useLockers) {
        const locker = params.lockers[lockerIndex++ % params.lockers.length]!;
        lockerId = locker.id;
        rentalType = 'LOCKER';
      }

      await params.client.query(
        `INSERT INTO visits (id, started_at, ended_at, customer_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [visitId, start, end, customer.id]
      );

      const signedAt = new Date(start.getTime() + 3 * 60 * 1000);
      await params.client.query(
        `INSERT INTO checkin_blocks
         (id, visit_id, block_type, starts_at, ends_at, locker_id, room_id,
          agreement_signed, agreement_signed_at, rental_type)
         VALUES ($1, $2, 'INITIAL', $3, $4, $5, $6, true, $7, $8)`,
        [checkinBlockId, visitId, start, scheduledEnd, lockerId, roomId, signedAt, rentalType]
      );

      // CHECKIN_STARTED — lane session created ~3 min before checkin
      const checkinStartedAt = new Date(start.getTime() - 3 * 60 * 1000);
      await params.client.query(
        `
        INSERT INTO customer_activity_events
          (occurred_at, customer_id, action_type, action_category, source_app,
           actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
        VALUES
          ($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9, $10::jsonb, $11, $12)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        `,
        [
          checkinStartedAt,
          customer.id,
          'CHECKIN_STARTED',
          'CHECKIN',
          'EMPLOYEE_REGISTER',
          'STAFF',
          staffMember.id,
          staffMember.name,
          `Check-in started`,
          {
            visitId,
            rentalType,
            registerNumber: register.register_number,
            registerSessionId: register.id,
          },
          `Check-in started ${customer.name} ${rentalType} ${visitId} ${staffMember.name}`,
          `ACT:DEMO:CHECKIN_STARTED:${visitId}`,
        ]
      );

      // CHECKIN_COMPLETED — check-in finalized
      await params.client.query(
        `
        INSERT INTO customer_activity_events
          (occurred_at, customer_id, action_type, action_category, source_app,
           actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
        VALUES
          ($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9, $10::jsonb, $11, $12)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        `,
        [
          start,
          customer.id,
          'CHECKIN_COMPLETED',
          'CHECKIN',
          'EMPLOYEE_REGISTER',
          'STAFF',
          staffMember.id,
          staffMember.name,
          `Checked in`,
          {
            visitId,
            checkinBlockId,
            rentalType,
            registerNumber: register.register_number,
            registerSessionId: register.id,
          },
          `Checked in ${customer.name} ${rentalType} ${visitId} ${checkinBlockId} ${staffMember.name}`,
          `ACT:DEMO:CHECKIN_COMPLETED:${checkinBlockId}`,
        ]
      );

      checkoutEvents.push({
        occurredAt: end,
        customer,
        visitId,
        checkinBlockId,
        rentalType,
        roomId,
        lockerId,
        staffId: staffMember.id,
        staffName: staffMember.name,
        checkoutDeltaMinutes,
      });

      if (rng() < 0.24) {
        customerOrders.push({
          createdAt: new Date(start.getTime() + (10 + Math.floor(rng() * 30)) * 60 * 1000),
          staffId: staffMember.id,
          registerSessionId: register.id,
          customerId: customer.id,
        });
      }

      if (rng() < 0.55) {
        anonOrders.push({
          createdAt: new Date(start.getTime() + (45 + Math.floor(rng() * 120)) * 60 * 1000),
          staffId: staffMember.id,
          registerSessionId: register.id,
        });
      }

      // --- Cleaning events (randomized durations) ---
      if (roomId) {
        const isPeak = isFridayOrSaturdayPeak(end);
        const cleaningStartDelay = 3 + Math.floor(rng() * 6); // 3-8 min
        const cleaningDuration = isPeak
          ? 12 + Math.floor(rng() * 9) // 12-20 min on peak
          : 8 + Math.floor(rng() * 8); // 8-15 min off-peak
        const cleaningStart = new Date(end.getTime() + cleaningStartDelay * 60 * 1000);
        const cleaningDone = new Date(cleaningStart.getTime() + cleaningDuration * 60 * 1000);
        const cleaner = params.staff[(roomIndex + j) % params.staff.length]!;
        cleaningEvents.push({ roomId, startedAt: cleaningStart, completedAt: cleaningDone, staffId: cleaner.id });
      }

      // --- Waitlist: ~8% of room visits went through waitlist first ---
      if (roomId && rng() < 0.08) {
        const waitCreatedAt = new Date(start.getTime() - Math.floor(15 + rng() * 30) * 60 * 1000);
        const offeredAt = new Date(waitCreatedAt.getTime() + Math.floor(15 + rng() * 30) * 60 * 1000);
        const completedAt = new Date(offeredAt.getTime() + Math.floor(2 + rng() * 3) * 60 * 1000);
        waitlistEvents.push({
          visitId,
          checkinBlockId,
          customerId: customer.id,
          desiredTier: rentalType,
          roomId,
          createdAt: waitCreatedAt,
          offeredAt,
          completedAt,
        });
      }

      // --- Room upgrades: ~4% of locker visits upgrade to a room mid-stay ---
      if (lockerId && !roomId && params.rooms.length > 0 && rng() < 0.04) {
        const upgradeRoom = params.rooms[Math.floor(rng() * params.rooms.length)]!;
        const upgradeMinutesIn = 30 + Math.floor(rng() * 90); // 30-120 min into stay
        const upgradeAt = new Date(start.getTime() + upgradeMinutesIn * 60 * 1000);
        if (upgradeAt < end) {
          upgradeEvents.push({
            visitId,
            originalBlockId: checkinBlockId,
            customerId: customer.id,
            roomId: upgradeRoom.id,
            roomType: upgradeRoom.type === 'DOUBLE' || upgradeRoom.type === 'SPECIAL' || upgradeRoom.type === 'STANDARD'
              ? upgradeRoom.type : 'STANDARD',
            lockerId,
            upgradeAt,
            upgradeEndAt: scheduledEnd,
            staffId: staffMember.id,
          });
        }
      }

      // --- Payment intents for ~30% of visits ---
      if (rng() < 0.30) {
        paymentEvents.push({
          visitId,
          checkinBlockId,
          rentalType,
          paidAt: signedAt,
          laneSessionId: null,
          customerId: customer.id,
          staffId: staffMember.id,
          staffName: staffMember.name,
        });
      }

      // --- Checkout requests for completed room visits ---
      if (roomId) {
        const isLate = checkoutDeltaMinutes < -15; // actually checked out after scheduled time
        const lateMinutes = isLate ? Math.abs(checkoutDeltaMinutes) - 15 : 0;
        const lateFeePerBlock = 1500; // $15 per 15-min block
        const lateBlocks = Math.ceil(lateMinutes / 15);
        const lateFeeAmount = lateBlocks * lateFeePerBlock / 100; // in dollars for numeric(10,2)

        checkoutRequestEvents.push({
          checkinBlockId,
          customerId: customer.id,
          lateMinutes,
          lateFeeAmount,
          completedAt: end,
        });

        // Late checkout events: only for actually late checkouts, capped at 2/night
        if (isLate && lateMinutes > 0) {
          const night = nightKey(end);
          const currentCount = lateCountByNight.get(night) ?? 0;
          if (currentCount < 2) {
            lateCountByNight.set(night, currentCount + 1);
            lateCheckoutEvents.push({
              checkinBlockId,
              customerId: customer.id,
              lateMinutes,
              feeAmount: lateFeeAmount,
              banApplied: lateMinutes >= 60,
              createdAt: end,
              checkoutRequestId: null, // linked later during insert
            });
          }
        }
      }

      await params.client.query(
        `INSERT INTO agreement_signatures
         (id, agreement_id, customer_name, membership_number, signed_at,
          agreement_text_snapshot, agreement_version, checkin_block_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          params.agreement.id,
          customer.name,
          customer.membership_number,
          signedAt,
          params.agreement.body_text,
          params.agreement.version,
          checkinBlockId,
        ]
      );

      created += 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Flush deferred events
  // ---------------------------------------------------------------------------

  // 1) Checkout activity events + customer notes
  for (const ev of checkoutEvents) {
    if (ev.occurredAt > params.to) continue;

    await params.client.query(
      `
      INSERT INTO customer_activity_events
        (occurred_at, customer_id, action_type, action_category, source_app,
         actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
      VALUES
        ($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9, $10::jsonb, $11, $12)
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      `,
      [
        ev.occurredAt,
        ev.customer.id,
        'CHECKOUT_COMPLETED',
        'CHECKOUT',
        'EMPLOYEE_REGISTER',
        'STAFF',
        ev.staffId,
        ev.staffName,
        `Checked out`,
        { visitId: ev.visitId, checkinBlockId: ev.checkinBlockId, rentalType: ev.rentalType },
        `Checked out ${ev.customer.name} ${ev.visitId} ${ev.checkinBlockId} ${ev.staffName}`,
        `ACT:DEMO:CHECKOUT_COMPLETED:${ev.visitId}`,
      ]
    );

    // NOTE_ADDED for late checkout notes (existing customer_notes insert above)
    if (rng() < 0.06) {
      const noteAt = new Date(ev.occurredAt.getTime() + 2 * 60 * 1000);
      const noteText = `Late checkout noted. Please remind customer to check out on time.`;
      await params.client.query(
        `INSERT INTO customer_notes
           (id, customer_id, created_at, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
         VALUES ($1, $2::uuid, $3, $4::uuid, $5, 'EMPLOYEE_REGISTER', $6, true)`,
        [
          randomUUID(),
          ev.customer.id,
          noteAt,
          ev.staffId,
          ev.staffName,
          noteText,
        ]
      );

      await params.client.query(
        `
        INSERT INTO customer_activity_events
          (occurred_at, customer_id, action_type, action_category, source_app,
           actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
        VALUES
          ($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9, $10::jsonb, $11, $12)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        `,
        [
          noteAt,
          ev.customer.id,
          'NOTE_ADDED',
          'NOTE',
          'EMPLOYEE_REGISTER',
          'STAFF',
          ev.staffId,
          ev.staffName,
          noteText,
          { visitId: ev.visitId, noteType: 'late_checkout' },
          `${noteText} ${ev.customer.name} ${ev.staffName}`,
          `ACT:DEMO:NOTE_ADDED:LATE:${ev.visitId}`,
        ]
      );
    }

    // ~10% additional staff notes for general interactions
    if (rng() < 0.10) {
      const generalNotes = [
        'Guest requested extra towels',
        'Regular customer — VIP treatment',
        'First-time visitor, gave new member orientation',
        'Customer asked about membership upgrade options',
        'Reminded about locker policy',
        'Guest mentioned they were referred by a friend',
        'Customer left personal items — placed in lost and found',
        'Quiet room preference noted for next visit',
      ];
      const noteText = generalNotes[Math.floor(rng() * generalNotes.length)]!;
      const noteAt = new Date(
        ev.occurredAt.getTime() - Math.floor(rng() * 60) * 60 * 1000 // during the visit
      );

      await params.client.query(
        `INSERT INTO customer_notes
           (id, customer_id, created_at, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
         VALUES ($1, $2::uuid, $3, $4::uuid, $5, 'EMPLOYEE_REGISTER', $6, false)`,
        [randomUUID(), ev.customer.id, noteAt, ev.staffId, ev.staffName, noteText]
      );

      await params.client.query(
        `
        INSERT INTO customer_activity_events
          (occurred_at, customer_id, action_type, action_category, source_app,
           actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
        VALUES
          ($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9, $10::jsonb, $11, $12)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        `,
        [
          noteAt,
          ev.customer.id,
          'NOTE_ADDED',
          'NOTE',
          'EMPLOYEE_REGISTER',
          'STAFF',
          ev.staffId,
          ev.staffName,
          noteText,
          { visitId: ev.visitId, noteType: 'general' },
          `${noteText} ${ev.customer.name} ${ev.staffName}`,
          `ACT:DEMO:NOTE_ADDED:GENERAL:${ev.visitId}:${noteAt.getTime()}`,
        ]
      );
    }

    // ~5% customer kiosk feedback notes
    if (rng() < 0.05) {
      const feedbackNotes = [
        'Feedback: Great experience today!',
        'Feedback: Room could use better lighting',
        'Feedback: Staff was very helpful',
        'Feedback: Would love more towels available',
        'Feedback: Clean and comfortable, will return!',
      ];
      const noteText = feedbackNotes[Math.floor(rng() * feedbackNotes.length)]!;
      const noteAt = new Date(ev.occurredAt.getTime() + 1 * 60 * 1000);

      await params.client.query(
        `
        INSERT INTO customer_activity_events
          (occurred_at, customer_id, action_type, action_category, source_app,
           actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
        VALUES
          ($1, $2::uuid, $3, $4, $5, $6, NULL, NULL, $7, $8::jsonb, $9, $10)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        `,
        [
          noteAt,
          ev.customer.id,
          'NOTE_ADDED',
          'NOTE',
          'CUSTOMER_KIOSK',
          'CUSTOMER',
          noteText,
          { visitId: ev.visitId, noteType: 'customer_feedback' },
          `${noteText} ${ev.customer.name}`,
          `ACT:DEMO:NOTE_ADDED:FEEDBACK:${ev.visitId}`,
        ]
      );
    }
  }

  // 2) Cleaning events (randomized durations)
  for (const ce of cleaningEvents) {
    if (ce.completedAt > params.to) continue;
    const eventId1 = randomUUID();
    const eventId2 = randomUUID();
    await params.client.query(
      `INSERT INTO cleaning_events
         (id, room_id, staff_id, started_at, completed_at, from_status, to_status, override_flag, device_id, created_at)
       VALUES
         ($1, $2::uuid, $3::uuid, $4, NULL, 'DIRTY', 'CLEANING', false, 'demo-cleaning', $4),
         ($5, $2::uuid, $3::uuid, $4, $6, 'CLEANING', 'CLEAN', false, 'demo-cleaning', $6)
      `,
      [eventId1, ce.roomId, ce.staffId, ce.startedAt, eventId2, ce.completedAt]
    );
  }

  // 3) Waitlist entries
  for (const wl of waitlistEvents) {
    if (wl.completedAt > params.to) continue;
    const waitlistId = randomUUID();

    await params.client.query(
      `INSERT INTO waitlist
         (id, visit_id, checkin_block_id, desired_tier, backup_tier, room_id,
          status, created_at, updated_at, offered_at, offer_expires_at,
          last_offered_at, offer_attempts, completed_at)
       VALUES ($1, $2, $3, $4::rental_type, 'LOCKER'::rental_type, $5,
               'COMPLETED', $6, $7, $8, $9, $8, 1, $7)`,
      [
        waitlistId,
        wl.visitId,
        wl.checkinBlockId,
        wl.desiredTier,
        wl.roomId,
        wl.createdAt,
        wl.completedAt,
        wl.offeredAt,
        new Date(wl.offeredAt.getTime() + 10 * 60 * 1000), // offer_expires_at = offered + 10 min
      ]
    );

    // Link checkin block to waitlist
    await params.client.query(
      `UPDATE checkin_blocks SET waitlist_id = $1 WHERE id = $2`,
      [waitlistId, wl.checkinBlockId]
    );

    // Inventory reservation (released)
    await params.client.query(
      `INSERT INTO inventory_reservations
         (id, resource_type, resource_id, kind, waitlist_id,
          created_at, expires_at, released_at, release_reason)
       VALUES ($1, 'room'::inventory_resource_type, $2, 'UPGRADE_HOLD'::inventory_reservation_kind,
               $3, $4, $5, $6, 'waitlist_completed')`,
      [
        randomUUID(),
        wl.roomId,
        waitlistId,
        wl.offeredAt,
        new Date(wl.offeredAt.getTime() + 10 * 60 * 1000),
        wl.completedAt,
      ]
    );
  }

  // 4) Room upgrades (locker → room)
  for (const ug of upgradeEvents) {
    if (ug.upgradeAt > params.to) continue;
    const renewalBlockId = randomUUID();
    const waitlistId = randomUUID();
    const paymentIntentId = randomUUID();
    const chargeId = randomUUID();
    const upgradeRentalType = ug.roomType;

    // Waitlist entry for the upgrade — must be inserted BEFORE checkin_blocks
    // because checkin_blocks.waitlist_id references waitlist(id).
    await params.client.query(
      `INSERT INTO waitlist
         (id, visit_id, checkin_block_id, desired_tier, backup_tier,
          locker_or_room_assigned_initially, room_id,
          status, created_at, updated_at, offered_at, offer_expires_at,
          last_offered_at, offer_attempts, completed_at)
       VALUES ($1, $2, $3, $4::rental_type, 'LOCKER'::rental_type,
               $5, $6,
               'COMPLETED', $7, $8, $9, $10, $9, 1, $8)`,
      [
        waitlistId,
        ug.visitId,
        ug.originalBlockId,
        upgradeRentalType,
        ug.lockerId,
        ug.roomId,
        new Date(ug.upgradeAt.getTime() - 5 * 60 * 1000), // created 5 min before upgrade
        ug.upgradeAt, // completed at upgrade time
        new Date(ug.upgradeAt.getTime() - 3 * 60 * 1000), // offered 3 min before upgrade
        new Date(ug.upgradeAt.getTime() + 7 * 60 * 1000), // expires 10 min after offer
      ]
    );

    // Renewal checkin block for the upgrade (waitlist row must already exist)
    await params.client.query(
      `INSERT INTO checkin_blocks
         (id, visit_id, block_type, starts_at, ends_at, locker_id, room_id,
          agreement_signed, agreement_signed_at, rental_type, waitlist_id)
       VALUES ($1, $2, 'RENEWAL', $3, $4, NULL, $5, true, $6, $7::rental_type, $8)`,
      [
        renewalBlockId,
        ug.visitId,
        ug.upgradeAt,
        ug.upgradeEndAt,
        ug.roomId,
        ug.upgradeAt,
        upgradeRentalType,
        waitlistId,
      ]
    );

    // Inventory reservation (released)
    await params.client.query(
      `INSERT INTO inventory_reservations
         (id, resource_type, resource_id, kind, waitlist_id,
          created_at, expires_at, released_at, release_reason)
       VALUES ($1, 'room'::inventory_resource_type, $2, 'UPGRADE_HOLD'::inventory_reservation_kind,
               $3, $4, $5, $6, 'upgrade_completed')`,
      [
        randomUUID(),
        ug.roomId,
        waitlistId,
        new Date(ug.upgradeAt.getTime() - 3 * 60 * 1000),
        new Date(ug.upgradeAt.getTime() + 7 * 60 * 1000),
        ug.upgradeAt,
      ]
    );

    // Payment intent for upgrade fee
    const upgradePriceCents = 2500; // $25
    await params.client.query(
      `INSERT INTO payment_intents
         (id, amount, tip_cents, status, quote_json, paid_at, created_at, updated_at)
       VALUES ($1, $2, 0, 'PAID', $3, $4, $4, $4)`,
      [
        paymentIntentId,
        upgradePriceCents / 100, // numeric(10,2)
        { type: 'UPGRADE', from: 'LOCKER', to: upgradeRentalType, priceCents: upgradePriceCents },
        ug.upgradeAt,
      ]
    );

    // Charge for upgrade
    await params.client.query(
      `INSERT INTO charges
         (id, visit_id, checkin_block_id, type, amount, payment_intent_id, created_at)
       VALUES ($1, $2, $3, 'UPGRADE', $4, $5, $6)`,
      [
        chargeId,
        ug.visitId,
        renewalBlockId,
        upgradePriceCents / 100,
        paymentIntentId,
        ug.upgradeAt,
      ]
    );

    // Resolve staff name for activity events
    const upgradeStaff = params.staff.find((s) => s.id === ug.staffId) ?? params.staff[0]!;

    // UPGRADE_STARTED activity event (5 min before upgrade)
    await params.client.query(
      `
      INSERT INTO customer_activity_events
        (occurred_at, customer_id, action_type, action_category, source_app,
         actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
      VALUES
        ($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9, $10::jsonb, $11, $12)
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      `,
      [
        new Date(ug.upgradeAt.getTime() - 5 * 60 * 1000),
        ug.customerId,
        'UPGRADE_STARTED',
        'UPGRADE',
        'EMPLOYEE_REGISTER',
        'STAFF',
        ug.staffId,
        upgradeStaff.name,
        `Upgrade started: Locker → ${upgradeRentalType}`,
        { visitId: ug.visitId, fromType: 'LOCKER', toType: upgradeRentalType, waitlistId },
        `Upgrade started Locker ${upgradeRentalType} ${ug.visitId} ${upgradeStaff.name}`,
        `ACT:DEMO:UPGRADE_STARTED:${ug.visitId}`,
      ]
    );

    // UPGRADE_COMPLETED activity event
    await params.client.query(
      `
      INSERT INTO customer_activity_events
        (occurred_at, customer_id, action_type, action_category, source_app,
         actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
      VALUES
        ($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9, $10::jsonb, $11, $12)
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      `,
      [
        ug.upgradeAt,
        ug.customerId,
        'UPGRADE_COMPLETED',
        'UPGRADE',
        'EMPLOYEE_REGISTER',
        'STAFF',
        ug.staffId,
        upgradeStaff.name,
        `Upgrade completed: Locker → ${upgradeRentalType}`,
        {
          visitId: ug.visitId,
          fromType: 'LOCKER',
          toType: upgradeRentalType,
          roomId: ug.roomId,
          paymentIntentId,
          priceCents: upgradePriceCents,
        },
        `Upgrade completed Locker ${upgradeRentalType} ${ug.visitId} ${upgradeStaff.name}`,
        `ACT:DEMO:UPGRADE_COMPLETED:${ug.visitId}`,
      ]
    );

    // ROOM_CHANGED resource-change event
    await params.client.query(
      `
      INSERT INTO customer_activity_events
        (occurred_at, customer_id, action_type, action_category, source_app,
         actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
      VALUES
        ($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9, $10::jsonb, $11, $12)
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      `,
      [
        ug.upgradeAt,
        ug.customerId,
        'ROOM_CHANGED',
        'RESOURCE_CHANGE',
        'EMPLOYEE_REGISTER',
        'STAFF',
        ug.staffId,
        upgradeStaff.name,
        `Moved from locker to room (upgrade)`,
        { visitId: ug.visitId, fromLockerId: ug.lockerId, toRoomId: ug.roomId, toRoomType: upgradeRentalType },
        `Room changed locker room ${upgradeRentalType} ${ug.visitId} ${upgradeStaff.name}`,
        `ACT:DEMO:ROOM_CHANGED:${ug.visitId}`,
      ]
    );

    // UPGRADE_FEE spend ledger entry
    await params.client.query(
      `
      INSERT INTO customer_spend_ledger_entries
        (occurred_at, customer_id, visit_id, entry_type, amount_cents, currency,
         source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, dedupe_key)
      VALUES
        ($1, $2::uuid, $3::uuid, 'UPGRADE_FEE', $4::bigint, $5,
         'EMPLOYEE_REGISTER', 'STAFF', $6::uuid, $7, 'Upgrade fee paid', $8::jsonb, $9)
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      `,
      [
        ug.upgradeAt,
        ug.customerId,
        ug.visitId,
        upgradePriceCents,
        currencyUSD(),
        ug.staffId,
        upgradeStaff.name,
        { paymentIntentId, fromType: 'LOCKER', toType: upgradeRentalType, priceCents: upgradePriceCents },
        `LEDGER:DEMO:UPGRADE_FEE:${ug.visitId}`,
      ]
    );
  }

  // 5) Payment intents & charges for initial checkin fees
  for (const pe of paymentEvents) {
    if (pe.paidAt > params.to) continue;
    const paymentIntentId = randomUUID();
    const chargeId = randomUUID();
    const priceCents = checkinPriceCents(pe.rentalType);

    await params.client.query(
      `INSERT INTO payment_intents
         (id, amount, tip_cents, status, quote_json, paid_at, created_at, updated_at)
       VALUES ($1, $2, 0, 'PAID', $3, $4, $4, $4)`,
      [
        paymentIntentId,
        priceCents / 100,
        { type: 'CHECKIN', rentalType: pe.rentalType, priceCents },
        pe.paidAt,
      ]
    );

    await params.client.query(
      `INSERT INTO charges
         (id, visit_id, checkin_block_id, type, amount, payment_intent_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        chargeId,
        pe.visitId,
        pe.checkinBlockId,
        pe.rentalType,
        priceCents / 100,
        paymentIntentId,
        pe.paidAt,
      ]
    );

    // CHECKIN_FEE spend ledger entry
    await params.client.query(
      `
      INSERT INTO customer_spend_ledger_entries
        (occurred_at, customer_id, visit_id, entry_type, amount_cents, currency,
         source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, dedupe_key)
      VALUES
        ($1, $2::uuid, $3::uuid, 'CHECKIN_FEE', $4::bigint, $5,
         'EMPLOYEE_REGISTER', 'STAFF', $6::uuid, $7, 'Check-in fee', $8::jsonb, $9)
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      `,
      [
        pe.paidAt,
        pe.customerId,
        pe.visitId,
        priceCents,
        currencyUSD(),
        pe.staffId,
        pe.staffName,
        { paymentIntentId, rentalType: pe.rentalType, priceCents },
        `LEDGER:DEMO:CHECKIN_FEE:${pe.checkinBlockId}`,
      ]
    );
  }

  // 6) Checkout requests for completed room visits
  for (const cr of checkoutRequestEvents) {
    if (cr.completedAt > params.to) continue;
    const crId = randomUUID();

    await params.client.query(
      `INSERT INTO checkout_requests
         (id, occupancy_id, kiosk_device_id, customer_id, status,
          customer_checklist_json, late_minutes, late_fee_amount,
          items_confirmed, fee_paid, completed_at, created_at, updated_at)
       VALUES ($1, $2, 'demo-kiosk-1', $3, 'VERIFIED',
               $4, $5, $6,
               true, true, $7, $7, $7)`,
      [
        crId,
        cr.checkinBlockId,
        cr.customerId,
        { towelReturned: true, keyReturned: true, personalBelongings: true },
        cr.lateMinutes,
        cr.lateFeeAmount,
        cr.completedAt,
      ]
    );

    // Link any late checkout event to this checkout request
    const matchingLate = lateCheckoutEvents.find(
      (le) => le.checkinBlockId === cr.checkinBlockId && le.checkoutRequestId === null
    );
    if (matchingLate) {
      matchingLate.checkoutRequestId = crId;
    }
  }

  // 7) Late checkout events (capped at 2/night)
  for (const le of lateCheckoutEvents) {
    if (le.createdAt > params.to) continue;

    const lateEventId = randomUUID();
    await params.client.query(
      `INSERT INTO late_checkout_events
         (id, occupancy_id, checkout_request_id, late_minutes, fee_amount,
          ban_applied, created_at, customer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        lateEventId,
        le.checkinBlockId,
        le.checkoutRequestId,
        le.lateMinutes,
        le.feeAmount,
        le.banApplied,
        le.createdAt,
        le.customerId,
      ]
    );

    // Charge + payment intent for late fee
    if (le.feeAmount > 0) {
      const paymentIntentId = randomUUID();
      const chargeId = randomUUID();
      const feeAmountCents = Math.round(le.feeAmount * 100);

      await params.client.query(
        `INSERT INTO payment_intents
           (id, amount, tip_cents, status, quote_json, paid_at, created_at, updated_at)
         VALUES ($1, $2, 0, 'PAID', $3, $4, $4, $4)`,
        [
          paymentIntentId,
          le.feeAmount,
          { type: 'LATE_FEE', lateMinutes: le.lateMinutes, feeAmount: le.feeAmount },
          le.createdAt,
        ]
      );

      await params.client.query(
        `INSERT INTO charges
           (id, visit_id, checkin_block_id, type, amount, payment_intent_id, created_at)
         VALUES ($1, (SELECT visit_id FROM checkin_blocks WHERE id = $2), $2, 'LATE_FEE', $3, $4, $5)`,
        [
          chargeId,
          le.checkinBlockId,
          le.feeAmount,
          paymentIntentId,
          le.createdAt,
        ]
      );

      // Resolve staff for checkout — use first staff member as the checkout staff
      const lateStaff = params.staff[0]!;

      // CHECKOUT_FEE_PAID activity event
      await params.client.query(
        `
        INSERT INTO customer_activity_events
          (occurred_at, customer_id, action_type, action_category, source_app,
           actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
        VALUES
          ($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9, $10::jsonb, $11, $12)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        `,
        [
          le.createdAt,
          le.customerId,
          'CHECKOUT_FEE_PAID',
          'CHECKOUT',
          'EMPLOYEE_REGISTER',
          'STAFF',
          lateStaff.id,
          lateStaff.name,
          `Late fee paid: $${le.feeAmount.toFixed(2)} (${le.lateMinutes} min late)`,
          {
            checkinBlockId: le.checkinBlockId,
            lateMinutes: le.lateMinutes,
            feeAmount: le.feeAmount,
            paymentIntentId,
          },
          `Late fee paid $${le.feeAmount.toFixed(2)} ${le.lateMinutes} min ${le.checkinBlockId} ${lateStaff.name}`,
          `ACT:DEMO:CHECKOUT_FEE_PAID:${le.checkinBlockId}`,
        ]
      );

      // LATE_FEE spend ledger entry
      await params.client.query(
        `
        INSERT INTO customer_spend_ledger_entries
          (occurred_at, customer_id, visit_id, entry_type, amount_cents, currency,
           source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, dedupe_key)
        VALUES
          ($1, $2::uuid,
           (SELECT visit_id FROM checkin_blocks WHERE id = $3),
           'LATE_FEE', $4::bigint, $5,
           'EMPLOYEE_REGISTER', 'STAFF', $6::uuid, $7, 'Late checkout fee', $8::jsonb, $9)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        `,
        [
          le.createdAt,
          le.customerId,
          le.checkinBlockId,
          feeAmountCents,
          currencyUSD(),
          lateStaff.id,
          lateStaff.name,
          { paymentIntentId, lateMinutes: le.lateMinutes, feeAmount: le.feeAmount },
          `LEDGER:DEMO:LATE_FEE:${le.checkinBlockId}`,
        ]
      );
    }

    // BAN_APPROVED / BAN_DENIED activity events (for bans applied due to ≥60 min late)
    if (le.banApplied) {
      const banDecision = rng() < 0.80 ? 'BAN_APPROVED' : 'BAN_DENIED';
      const adminStaff = params.staff.find((s) => s.name.includes('Manager')) ?? params.staff[0]!;
      const banDecisionAt = new Date(le.createdAt.getTime() + (10 + Math.floor(rng() * 30)) * 60 * 1000);
      if (banDecisionAt <= params.to) {
        await params.client.query(
          `
          INSERT INTO customer_activity_events
            (occurred_at, customer_id, action_type, action_category, source_app,
             actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
          VALUES
            ($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9, $10::jsonb, $11, $12)
          ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
          `,
          [
            banDecisionAt,
            le.customerId,
            banDecision,
            'ADMIN',
            'OFFICE_DASHBOARD',
            'STAFF',
            adminStaff.id,
            adminStaff.name,
            banDecision === 'BAN_APPROVED'
              ? `Ban approved: ${le.lateMinutes} min late checkout`
              : `Ban denied: ${le.lateMinutes} min late checkout — warning issued`,
            {
              checkinBlockId: le.checkinBlockId,
              lateMinutes: le.lateMinutes,
              feeAmount: le.feeAmount,
              decision: banDecision === 'BAN_APPROVED' ? 'approve' : 'deny',
            },
            `${banDecision === 'BAN_APPROVED' ? 'Ban approved' : 'Ban denied'} ${le.lateMinutes} min ${le.checkinBlockId} ${adminStaff.name}`,
            `ACT:DEMO:BAN_DECISION:${le.checkinBlockId}`,
          ]
        );
      }
    }
  }

  // 8) Orders (anonymous + customer-linked)
  async function insertOrder(order: {
    createdAt: Date;
    registerSessionId: string;
    staffId: string;
    customerId: string | null;
    seed: number;
  }) {
    const rng2 = rng;
    const subtotalCents = 500 + Math.floor(rng2() * 3500);
    const taxCents = Math.floor(subtotalCents * 0.0825);
    const tipCents = rng2() < 0.12 ? 200 + Math.floor(rng2() * 700) : 0;
    const totalCents = subtotalCents + taxCents + tipCents;
    const orderId = randomUUID();

    await params.client.query(
      `INSERT INTO orders
         (id, customer_id, register_session_id, created_by_staff_id, created_at, status,
          subtotal_cents, discount_cents, tax_cents, tip_cents, total_cents, currency, metadata_json)
       VALUES ($1, $2, $3, $4, $5, 'PAID', $6, 0, $7, $8, $9, $10, $11)`,
      [
        orderId,
        order.customerId,
        order.registerSessionId,
        order.staffId,
        order.createdAt,
        subtotalCents,
        taxCents,
        tipCents,
        totalCents,
        currencyUSD(),
        { tender: { paymentMethod: rng2() < 0.33 ? 'CASH' : 'CREDIT', source: 'DEMO_SIM' } },
      ]
    );

    const itemId = randomUUID();
    const name = rng2() < 0.4 ? 'Water' : rng2() < 0.7 ? 'Energy Drink' : 'Towel';
    const sku = name.toUpperCase().replace(/\s+/g, '_');
    const unitPrice = Math.max(200, Math.floor(subtotalCents / 2));
    const qty = 1 + (rng2() < 0.15 ? 1 : 0);
    const lineTotal = unitPrice * qty;

    await params.client.query(
      `INSERT INTO order_line_items
         (id, order_id, kind, sku, name, quantity, unit_price_cents, discount_cents, tax_cents, total_cents, metadata_json)
       VALUES ($1, $2, 'RETAIL', $3, $4, $5, $6, 0, 0, $7, NULL)`,
      [itemId, orderId, sku, name, qty, unitPrice, lineTotal]
    );

    const receiptId = randomUUID();
    const receiptNumber = `D${order.createdAt.getUTCFullYear()}-${String(order.seed).padStart(6, '0')}`;
    const issuedAt = new Date(order.createdAt.getTime() + 2 * 60 * 1000);
    await params.client.query(
      `INSERT INTO receipts (id, order_id, issued_at, receipt_number, receipt_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        receiptId,
        orderId,
        issuedAt,
        receiptNumber,
        {
          receiptNumber,
          orderId,
          issuedAt: issuedAt.toISOString(),
          currency: currencyUSD(),
          totals: { subtotalCents, taxCents, tipCents, totalCents },
          lineItems: [
            {
              id: itemId,
              kind: 'RETAIL',
              sku,
              name,
              quantity: qty,
              unitPriceCents: unitPrice,
              totalCents: lineTotal,
            },
          ],
        },
      ]
    );

    if (order.customerId) {
      // Seed the customer spend ledger so the UI can show per-visit groupings.
      await params.client.query(
        `
        INSERT INTO customer_spend_ledger_entries
          (occurred_at, customer_id, visit_id, entry_type, amount_cents, currency,
           source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, dedupe_key)
        VALUES
          ($1, $2::uuid, NULL, 'ORDER_PAID', $3::bigint, $4,
           'EMPLOYEE_REGISTER', 'STAFF', $5::uuid, NULL, 'Order paid', $6::jsonb, $7)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        `,
        [
          order.createdAt,
          order.customerId,
          totalCents,
          currencyUSD(),
          order.staffId,
          { orderId, totalCents, currency: currencyUSD() },
          `LEDGER:DEMO:ORDER_PAID:${orderId}`,
        ]
      );

      await params.client.query(
        `
        INSERT INTO customer_activity_events
          (occurred_at, customer_id, action_type, action_category, source_app,
           actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
        VALUES
          ($1, $2::uuid, 'ORDER_PAID', 'PURCHASE', 'EMPLOYEE_REGISTER', 'STAFF', $3::uuid, $4,
           $5, $6::jsonb, $7, $8)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        `,
        [
          order.createdAt,
          order.customerId,
          order.staffId,
          // demo doesn't have names on register sessions in this function; keep staff name null
          null,
          `Order paid`,
          { orderId, totalCents, currency: currencyUSD() },
          `Order paid ${orderId} ${totalCents}`,
          `ACT:DEMO:ORDER_PAID:${orderId}`,
        ]
      );
    }
  }

  let orderSeed = Math.floor(params.from.getTime() / 60000) % 100000;
  for (const o of anonOrders) {
    orderSeed += 1;
    if (o.createdAt > params.to) continue;
    await insertOrder({
      createdAt: o.createdAt,
      registerSessionId: o.registerSessionId,
      staffId: o.staffId,
      customerId: null,
      seed: orderSeed,
    });
  }
  for (const o of customerOrders) {
    orderSeed += 1;
    if (o.createdAt > params.to) continue;
    await insertOrder({
      createdAt: o.createdAt,
      registerSessionId: o.registerSessionId,
      staffId: o.staffId,
      customerId: o.customerId,
      seed: orderSeed,
    });
  }

  return { visitsCreated: created };
}
