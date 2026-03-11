import { randomUUID } from 'crypto';
import { RoomStatus, RoomType, RentalType, BlockType } from '@the-clubs/shared';

type Lang = 'EN' | 'ES';

export interface DemoRoom {
  id: string;
  number: string;
  type: RoomType;
  status: RoomStatus;
}

export interface DemoLocker {
  id: string;
  number: string;
  status: RoomStatus;
}

export interface DemoCustomer {
  id: string;
  name: string;
  dob?: Date;
  membership_number?: string;
  membership_card_type?: string;
  membership_valid_until?: Date;
  primary_language?: Lang;
  past_due_balance: number;
}

export interface DemoCheckinBlock {
  id: string;
  visit_id: string;
  block_type: BlockType;
  starts_at: Date;
  ends_at: Date;
  rental_type: RentalType;
  resource_id?: string | null;
  has_tv_remote: boolean;
  agreement_signed: boolean;
  waitlist_id?: string | null;
}

export interface DemoVisit {
  id: string;
  customer_id: string;
  started_at: Date;
  ended_at: Date | null;
  blocks: DemoCheckinBlock[];
}

export interface DemoWaitlistEntry {
  id: string;
  visit_id: string;
  checkin_block_id: string;
  desired_tier: RentalType;
  desired_tiers: RentalType[];
  backup_tier: RentalType;
  resource_id: string | null;
  status: 'ACTIVE' | 'OFFERED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
  created_at: Date;
}

export interface DemoData {
  customers: DemoCustomer[];
  visits: DemoVisit[];
  waitlistEntries: DemoWaitlistEntry[];
}

interface GenerateOptions {
  now?: Date;
  rooms: DemoRoom[];
  lockers: DemoLocker[];
  minCustomers?: number;
  maxCustomers?: number;
}

// Curated list of typical male full names (~120) to make demo search reliable.
const MALE_FULL_NAMES = [
  'James Smith',
  'Michael Johnson',
  'Robert Williams',
  'John Brown',
  'David Jones',
  'William Garcia',
  'Richard Miller',
  'Joseph Davis',
  'Thomas Rodriguez',
  'Charles Martinez',
  'Christopher Hernandez',
  'Daniel Lopez',
  'Matthew Gonzalez',
  'Anthony Wilson',
  'Mark Anderson',
  'Donald Thomas',
  'Steven Taylor',
  'Paul Moore',
  'Andrew Jackson',
  'Joshua Martin',
  'Kenneth Lee',
  'Kevin Perez',
  'Brian Thompson',
  'George White',
  'Timothy Harris',
  'Ronald Sanchez',
  'Jason Clark',
  'Jeffrey Ramirez',
  'Ryan Lewis',
  'Jacob Robinson',
  'Gary Walker',
  'Nicholas Young',
  'Eric Allen',
  'Jonathan King',
  'Stephen Wright',
  'Larry Scott',
  'Justin Torres',
  'Scott Nguyen',
  'Brandon Hill',
  'Benjamin Flores',
  'Samuel Green',
  'Gregory Adams',
  'Frank Nelson',
  'Alexander Baker',
  'Raymond Hall',
  'Patrick Rivera',
  'Jack Campbell',
  'Dennis Mitchell',
  'Jerry Carter',
  'Tyler Roberts',
  'Aaron Gomez',
  'Jose Phillips',
  'Adam Evans',
  'Henry Turner',
  'Nathan Diaz',
  'Douglas Parker',
  'Zachary Cruz',
  'Peter Edwards',
  'Kyle Collins',
  'Walter Stewart',
  'Harold Morris',
  'Jeremy Rogers',
  'Ethan Reed',
  'Carl Cook',
  'Keith Morgan',
  'Roger Bell',
  'Arthur Murphy',
  'Terry Bailey',
  'Lawrence Cooper',
  'Sean Richardson',
  'Christian Cox',
  'Albert Howard',
  'Joe Ward',
  'Austin Brooks',
  'Jesse Watson',
  'Willie Kelly',
  'Billy Sanders',
  'Bruce Price',
  'Bryan Bennett',
  'Ralph Wood',
  'Roy Barnes',
  'Jordan Ross',
  'Noah Henderson',
  'Dylan Coleman',
  'Wayne Jenkins',
  'Alan Perry',
  'Juan Powell',
  'Louis Long',
  'Russell Patterson',
  'Philip Hughes',
  'Bobby Flores',
  'Vincent Washington',
  'Logan Butler',
  'Bradley Simmons',
  'Curtis Foster',
  'Corey Bryant',
  'Martin Alexander',
  'Manuel Russell',
  'Leo Griffin',
  'Jay Diaz',
  'Theo Hayes',
  'Caleb Myers',
  'Connor Ford',
  'Owen Hamilton',
  'Gavin Graham',
  'Colin Sullivan',
  'Evan Wallace',
  'Trevor West',
  'Spencer Cole',
  'Ian Powell',
  'Shawn Daniels',
  'Devin Stephens',
  'Miles Fisher',
  'Elliot Bishop',
  'Grant Walsh',
  'Austin Little',
  'Cole Carpenter',
  'Chase Weaver',
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)]!;
}

function getWeekKey(date: Date): string {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 5 || day === 6 || day === 0; // Fri/Sat/Sun
}

function rentalFromRoomType(type: RoomType): RentalType {
  switch (type) {
    case RoomType.STANDARD:
      return RentalType.STANDARD;
    case RoomType.DOUBLE:
      return RentalType.DOUBLE;
    case RoomType.SPECIAL:
      return RentalType.SPECIAL;
    case RoomType.LOCKER:
    default:
      return RentalType.LOCKER;
  }
}

function pickAvailableRoom(rooms: DemoRoom[], preferred?: RentalType): DemoRoom | null {
  const cleanRooms = rooms.filter(
    (r) =>
      r.status === RoomStatus.CLEAN ||
      r.status === RoomStatus.DIRTY ||
      r.status === RoomStatus.CLEANING
  );
  if (preferred) {
    const match = cleanRooms.find((r) => rentalFromRoomType(r.type) === preferred);
    if (match) return match;
  }
  return cleanRooms.length > 0 ? pick(cleanRooms) : null;
}

function pickLocker(lockers: DemoLocker[]): DemoLocker | null {
  return lockers.length > 0 ? pick(lockers) : null;
}

function generateCustomers(count: number, now: Date): DemoCustomer[] {
  const customers: DemoCustomer[] = [];
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    // Cycle through curated male names to ensure stable, typical names for demo search
    const name = MALE_FULL_NAMES[i % MALE_FULL_NAMES.length] || MALE_FULL_NAMES[0]!;
    if (names.has(name)) continue;
    const dobYear = now.getFullYear() - randomInt(22, 48);
    const dobMonth = randomInt(0, 11);
    const dobDay = randomInt(1, 28);
    const membershipNumber = Math.random() < 0.75 ? String(700000 + i) : undefined;
    const hasSixMonth = membershipNumber && Math.random() < 0.4;
    const primaryLanguage: Lang = Math.random() < 0.15 ? 'ES' : 'EN';

    customers.push({
      id: randomUUID(),
      name,
      dob: new Date(Date.UTC(dobYear, dobMonth, dobDay)),
      membership_number: membershipNumber,
      membership_card_type: hasSixMonth ? 'SIX_MONTH' : undefined,
      membership_valid_until: hasSixMonth ? addHours(now, 24 * 90) : undefined,
      primary_language: primaryLanguage,
      past_due_balance: 0,
    });
  }
  return customers;
}

function planVisitsForCustomer(
  customerId: string,
  now: Date,
  rooms: DemoRoom[],
  lockers: DemoLocker[],
  activeSlots: number,
  weekCounts: Map<string, number>,
  overdueMinutes = 0,
  hoursCheckedIn = 0,
): DemoVisit[] {
  const visits: DemoVisit[] = [];
  const visitCount = randomInt(2, 6);
  let cursor = new Date(now.getTime());
  cursor.setDate(cursor.getDate() - randomInt(40, 110)); // start roughly 40-110 days back

  for (let i = 0; i < visitCount; i++) {
    // Enforce non-overlap with a gap of 12-36 hours
    const gapHours = randomInt(12, 72);
    const start = addHours(cursor, gapHours);

    // Respect 3-starts-per-week invariant by moving to next week if needed
    const adjustedStart = new Date(start);
    while (
      weekCounts.get(getWeekKey(adjustedStart)) &&
      weekCounts.get(getWeekKey(adjustedStart))! >= 3
    ) {
      // Move to next Monday 9am
      const day = (adjustedStart.getDay() + 6) % 7;
      adjustedStart.setDate(adjustedStart.getDate() + (7 - day));
      adjustedStart.setHours(9, 0, 0, 0);
    }

    // Stop if we drift too far into the future (leave room for active generation later)
    if (adjustedStart > now) break;

    const baseDurationBlocks = isWeekend(adjustedStart) && Math.random() < 0.5 ? 2 : 1;
    const extraRenewal = isWeekend(adjustedStart) && Math.random() < 0.3 ? 1 : 0;
    const totalBlocks = baseDurationBlocks + extraRenewal;

    const rentalChoice = Math.random();
    let rental: RentalType;
    if (rentalChoice < 0.15) {
      rental = RentalType.GYM_LOCKER;
    } else if (rentalChoice < 0.45) {
      rental = RentalType.LOCKER;
    } else if (rentalChoice < 0.75) {
      rental = RentalType.STANDARD;
    } else if (rentalChoice < 0.92) {
      rental = RentalType.DOUBLE;
    } else {
      rental = RentalType.SPECIAL;
    }

    const blocks: DemoCheckinBlock[] = [];
    let blockStart = adjustedStart;
    for (let b = 0; b < totalBlocks; b++) {
      const blockType = b === 0 ? BlockType.INITIAL : BlockType.RENEWAL;
      const blockEnd = addHours(blockStart, 6);
      blocks.push({
        id: randomUUID(),
        visit_id: '', // backfilled after visit is created
        block_type: blockType,
        starts_at: blockStart,
        ends_at: blockEnd,
        rental_type: rental,
        resource_id: null,
        has_tv_remote:
          rental !== RentalType.LOCKER && rental !== RentalType.GYM_LOCKER
            ? Math.random() < 0.2
            : false,
        agreement_signed: true,
        waitlist_id: null,
      });
      blockStart = blockEnd;
    }

    const visitId = randomUUID();
    blocks.forEach((b) => (b.visit_id = visitId));

    const visitEndedAt = blocks[blocks.length - 1]!.ends_at;
    visits.push({
      id: visitId,
      customer_id: customerId,
      started_at: adjustedStart,
      ended_at: visitEndedAt,
      blocks,
    });

    // Track weekly start count
    const wk = getWeekKey(adjustedStart);
    weekCounts.set(wk, (weekCounts.get(wk) || 0) + 1);

    // Move cursor forward past this visit
    cursor = addHours(visitEndedAt, randomInt(12, 36));
  }

  // Inject an active visit if slots remain
  if (activeSlots > 0) {
    // Use deterministic hoursCheckedIn for staggered checkout times
    const checkedInHours = overdueMinutes ? 6 + overdueMinutes / 60 : (hoursCheckedIn || randomInt(2, 5));
    const activeStart = addHours(now, -checkedInHours);
    // If overdueMinutes is set, shift ends_at into the past so the customer appears overdue
    const blockDurationMs = overdueMinutes
      ? (now.getTime() - activeStart.getTime()) - overdueMinutes * 60_000
      : 6 * 60 * 60_000;
    // Diversify rental types: alternate between rooms and lockers based on stagger position
    const rentalChoices = [RentalType.STANDARD, RentalType.LOCKER, RentalType.DOUBLE, RentalType.STANDARD, RentalType.LOCKER, RentalType.SPECIAL];
    const rentalIdx = Math.floor(checkedInHours * 2) % rentalChoices.length;
    const rental = rentalChoices[rentalIdx] ?? RentalType.STANDARD;
    const activeBlocks = [
      {
        id: randomUUID(),
        visit_id: '', // backfill
        block_type: BlockType.INITIAL,
        starts_at: activeStart,
        ends_at: new Date(activeStart.getTime() + blockDurationMs),
        rental_type: rental,
        resource_id: null,
        has_tv_remote: false,
        agreement_signed: true,
        waitlist_id: null,
      } satisfies DemoCheckinBlock,
    ];
    const activeVisitId = randomUUID();
    activeBlocks.forEach((b) => (b.visit_id = activeVisitId));
    const wk = getWeekKey(activeStart);
    weekCounts.set(wk, (weekCounts.get(wk) || 0) + 1);
    visits.push({
      id: activeVisitId,
      customer_id: customerId,
      started_at: activeStart,
      ended_at: null,
      blocks: activeBlocks,
    });
  }

  // Assign inventory to a subset of blocks (prefer active and recent)
  for (const visit of visits) {
    for (const block of visit.blocks) {
      if (block.rental_type === RentalType.LOCKER || block.rental_type === RentalType.GYM_LOCKER) {
        const locker = pickLocker(lockers);
        if (locker) {
          block.resource_id = locker.id;
        }
      } else {
        const preferredRoom = pickAvailableRoom(rooms, block.rental_type);
        if (preferredRoom) {
          block.resource_id = preferredRoom.id;
        }
      }
    }
  }

  return visits.sort((a, b) => a.started_at.getTime() - b.started_at.getTime());
}

function createWaitlistEntries(visits: DemoVisit[], now: Date): DemoWaitlistEntry[] {
  const entries: DemoWaitlistEntry[] = [];
  const candidates = visits.filter((v) =>
    v.blocks.some((b) => b.rental_type !== RentalType.SPECIAL)
  );

  // Varied upgrade scenarios for demo column-spanning
  const scenarios: { desired: RentalType; tiers: RentalType[] }[] = [
    { desired: RentalType.STANDARD, tiers: [RentalType.STANDARD] },                                     // col 1 only
    { desired: RentalType.STANDARD, tiers: [RentalType.STANDARD, RentalType.DOUBLE] },                  // cols 1-2
    { desired: RentalType.STANDARD, tiers: [RentalType.STANDARD, RentalType.DOUBLE, RentalType.SPECIAL] }, // all cols
    { desired: RentalType.DOUBLE,   tiers: [RentalType.DOUBLE] },                                        // col 2 only
    { desired: RentalType.DOUBLE,   tiers: [RentalType.DOUBLE, RentalType.SPECIAL] },                    // cols 2-3
    { desired: RentalType.SPECIAL,  tiers: [RentalType.SPECIAL] },                                       // col 3 only
    { desired: RentalType.STANDARD, tiers: [RentalType.STANDARD, RentalType.DOUBLE] },                  // cols 1-2
    { desired: RentalType.DOUBLE,   tiers: [RentalType.DOUBLE, RentalType.SPECIAL] },                    // cols 2-3
  ];

  for (let i = 0; i < candidates.length && entries.length < 8; i++) {
    const visit = candidates[i]!;
    const block = visit.blocks[0]!;
    const scenario = scenarios[entries.length % scenarios.length]!;
    const backup_tier = block.rental_type;
    const waitlistId = randomUUID();

    block.waitlist_id = waitlistId;

    entries.push({
      id: waitlistId,
      visit_id: visit.id,
      checkin_block_id: block.id,
      desired_tier: scenario.desired,
      desired_tiers: scenario.tiers,
      backup_tier,
      resource_id: null,
      status: 'ACTIVE',
      created_at: new Date(now.getTime() - randomInt(1, 24) * 60 * 60 * 1000),
    });
  }

  return entries;
}

export function generateDemoData(options: GenerateOptions): DemoData {
  const now = options.now ?? new Date();
  const minCustomers = options.minCustomers ?? 100;
  const maxCustomers = options.maxCustomers ?? 200;
  const customerCount = randomInt(minCustomers, maxCustomers);
  const customers = generateCustomers(customerCount, now);

  const weekCounts = new Map<string, number>();
  const visits: DemoVisit[] = [];
  const activeTarget = Math.min(12, Math.max(6, Math.floor(customerCount * 0.08)));
  let activeRemaining = activeTarget;

  // First two active slots are overdue (30min and 60min respectively)
  const overdueSchedule = [30, 60];
  let overdueIdx = 0;

  // Stagger schedule: hours already checked in → determines time remaining until checkout.
  // With a 6-hour block, hoursCheckedIn=5.5 means 30min left, hoursCheckedIn=0.5 means 5.5h left.
  const staggerSchedule = [5.5, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.75, 0.5];
  let staggerIdx = 0;

  for (const customer of customers) {
    const isOverdueSlot = activeRemaining > 0 && overdueIdx < overdueSchedule.length;
    const overdueMinutes = isOverdueSlot ? (overdueSchedule[overdueIdx] ?? 0) : 0;
    const hoursCheckedIn = (!isOverdueSlot && activeRemaining > 0)
      ? (staggerSchedule[staggerIdx % staggerSchedule.length] ?? 3)
      : 0;
    const customerVisits = planVisitsForCustomer(
      customer.id,
      now,
      options.rooms,
      options.lockers,
      activeRemaining > 0 ? 1 : 0,
      weekCounts,
      overdueMinutes,
      hoursCheckedIn,
    );
    if (activeRemaining > 0) {
      const hasActive = customerVisits.some((v) => v.ended_at === null);
      if (hasActive) {
        activeRemaining--;
        if (isOverdueSlot) overdueIdx++;
        else staggerIdx++;
      }
    }
    visits.push(...customerVisits);
  }

  const waitlistEntries = createWaitlistEntries(visits, now);

  return { customers, visits, waitlistEntries };
}
