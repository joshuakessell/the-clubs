/**
 * Deterministic customer fixture for Club Dallas demo.
 *
 * Generates 200 fixed male customers using a seeded PRNG so every run
 * produces the same list. Names reflect the Dallas TX metro demographics.
 *
 * - ~5% name repeats (different DOBs)
 * - Ages 18–60
 * - 20% have active 6-month memberships (expiring 2 days to 5 months out)
 * - No past-due balances or bans
 */

// ---------------------------------------------------------------------------
// Deterministic PRNG (Mulberry32) — same algorithm as simulator.ts
// ---------------------------------------------------------------------------

function seededRng(seed: number): () => number {
  return () => {
    seed = Math.trunc(seed + 0x6d2b79f5);
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Name pools — Dallas TX metro demographics
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  // Anglo
  'James', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas',
  'Christopher', 'Daniel', 'Matthew', 'Andrew', 'Joshua', 'Anthony', 'Kevin',
  'Brian', 'George', 'Edward', 'Timothy', 'Jason', 'Jeffrey', 'Ryan',
  'Jacob', 'Nicholas', 'Eric', 'Stephen', 'Justin', 'Scott', 'Brandon',
  'Benjamin', 'Samuel', 'Patrick', 'Alexander', 'Jack', 'Tyler', 'Aaron',
  'Nathan', 'Henry', 'Peter', 'Kyle', 'Noah', 'Ethan', 'Christian', 'Austin',
  'Sean', 'Dylan', 'Jordan', 'Jesse', 'Gabriel', 'Caleb', 'Logan', 'Blake',
  'Trevor', 'Spencer', 'Colton', 'Wyatt', 'Chase', 'Liam', 'Mason',
  // Hispanic
  'Carlos', 'Miguel', 'Luis', 'Jose', 'Juan', 'Alejandro', 'Diego', 'Ricardo',
  'Fernando', 'Rafael', 'Eduardo', 'Sergio', 'Andres', 'Marco', 'Javier',
  'Arturo', 'Hector', 'Raul', 'Emilio', 'Xavier', 'Mateo', 'Adrian',
  // Black
  'Marcus', 'Darius', 'Terrence', 'DeAndre', 'Malik', 'Jamal', 'Tyrone',
  'Isaiah', 'Elijah', 'Darnell', 'Cedric', 'Lamar', 'Quinton', 'Donovan',
  // Asian / other
  'Kevin', 'Derek', 'Victor', 'Raymond', 'Wesley', 'Lawrence', 'Russell',
  'Tran', 'Jin', 'Wei', 'Kenji',
];

const LAST_NAMES = [
  // Anglo
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis',
  'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Thompson', 'White', 'Harris', 'Clark', 'Lewis', 'Robinson',
  'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Baker', 'Hall',
  'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Phillips', 'Evans', 'Turner',
  'Parker', 'Edwards', 'Collins', 'Stewart', 'Morris', 'Reed', 'Cook',
  'Morgan', 'Bell', 'Murphy', 'Bailey', 'Cooper', 'Richardson', 'Cox',
  // Hispanic
  'Garcia', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
  'Perez', 'Sanchez', 'Ramirez', 'Torres', 'Flores', 'Rivera',
  'Gomez', 'Diaz', 'Cruz', 'Reyes', 'Morales', 'Ortiz', 'Gutierrez',
  'Chavez', 'Mendoza', 'Castillo', 'Delgado', 'Vargas',
  // Black
  'Washington', 'Jefferson', 'Freeman', 'Banks', 'Grant',
  // Asian / other
  'Nguyen', 'Lee', 'Kim', 'Chen', 'Patel', 'Singh',
];

const ID_STATES = ['TX', 'TX', 'TX', 'TX', 'TX', 'TX', 'OK', 'LA', 'NM', 'AR', 'CA', 'FL', 'NY'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FixedCustomer {
  firstName: string;
  lastName: string;
  name: string;
  dob: Date;
  membershipNumber: string | null;
  membershipCardType: 'SIX_MONTH' | null;
  membershipValidUntil: Date | null;
  idNumber: string;
  idType: string;
  idState: string;
  idExpirationDate: Date;
  primaryLanguage: 'EN' | 'ES';
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

const CUSTOMER_COUNT = 200;
const MEMBERSHIP_PERCENT = 0.20;
const REPEAT_COUNT = 10;
const SEED = 0x44414C4C; // "DALL" in hex

export function generateFixedCustomers(now: Date): FixedCustomer[] {
  const rng = seededRng(SEED);

  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

  // Step 1: Generate unique name combinations
  const uniqueTarget = CUSTOMER_COUNT - REPEAT_COUNT;
  const usedNames = new Set<string>();
  const customers: FixedCustomer[] = [];

  while (customers.length < uniqueTarget) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const name = `${firstName} ${lastName}`;
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    customers.push(buildCustomer(rng, firstName, lastName, now, customers.length));
  }

  // Step 2: Add repeated names with different DOBs (each name repeats exactly once)
  const repeatPool = customers.slice(0, REPEAT_COUNT * 4);
  const usedRepeatNames = new Set<string>();
  let repeatAdded = 0;
  while (repeatAdded < REPEAT_COUNT) {
    const source = repeatPool[Math.floor(rng() * repeatPool.length)];
    if (usedRepeatNames.has(source.name)) continue;
    usedRepeatNames.add(source.name);
    customers.push(buildCustomer(rng, source.firstName, source.lastName, now, customers.length));
    repeatAdded++;
  }

  // Step 3: Shuffle with PRNG for natural ordering
  for (let i = customers.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [customers[i], customers[j]] = [customers[j], customers[i]];
  }

  // Step 4: Assign memberships to 20% of customers
  const memberCount = Math.round(CUSTOMER_COUNT * MEMBERSHIP_PERCENT);
  const memberIndices = new Set<number>();
  while (memberIndices.size < memberCount) {
    memberIndices.add(Math.floor(rng() * CUSTOMER_COUNT));
  }

  let memberSeq = 1;
  for (const idx of memberIndices) {
    const c = customers[idx];
    c.membershipNumber = String(memberSeq++).padStart(6, '0');
    c.membershipCardType = 'SIX_MONTH';
    // Expiration: 2 days to 5 months from now
    const minDays = 2;
    const maxDays = 150;
    const daysOut = minDays + Math.floor(rng() * (maxDays - minDays));
    c.membershipValidUntil = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysOut);
  }

  return customers;
}

function buildCustomer(
  rng: () => number,
  firstName: string,
  lastName: string,
  now: Date,
  seq: number,
): FixedCustomer {
  // Age 18–60 guaranteed: subtract an extra year then add random days within 42 years
  // This ensures even if the birthday hasn't passed yet, they're at least 18
  const maxAgeDays = 42 * 365;
  const daysBack = (18 * 365) + Math.floor(rng() * maxAgeDays);
  const birthDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const birthYear = birthDate.getFullYear();
  const birthMonth = birthDate.getMonth();
  const birthDay = birthDate.getDate();

  const idState = ID_STATES[Math.floor(rng() * ID_STATES.length)];
  const idExpYear = now.getFullYear() + 2 + Math.floor(rng() * 4);

  // ~15% Spanish speakers (matching Dallas demographics)
  const primaryLanguage: 'EN' | 'ES' = rng() < 0.15 ? 'ES' : 'EN';

  return {
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    dob: new Date(birthYear, birthMonth, birthDay),
    membershipNumber: null,
    membershipCardType: null,
    membershipValidUntil: null,
    idNumber: `D${String(seq + 10000000).padStart(8, '0')}`,
    idType: 'DRIVERS_LICENSE',
    idState,
    idExpirationDate: new Date(idExpYear, Math.floor(rng() * 12), 1 + Math.floor(rng() * 28)),
    primaryLanguage,
  };
}
