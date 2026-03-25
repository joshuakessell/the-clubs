/**
 * Event-driven simulation engine for Club Dallas demo data.
 *
 * Replaces the old batch-per-hour approach with a minute-granularity timeline
 * that tracks resource occupancy, 2-lane checkin queues, cleaning cycles,
 * waitlists, renewals, and retail purchases.
 *
 * Key behaviors:
 * - Peak hours (Fri/Sat 11pm–4am): all rooms fill, constant waitlist, lockers fill after
 * - Off-peak (Mon–Thu): ~50% capacity, 50/50 room/locker split
 * - Checkins take 5 minutes per customer across 2 lanes
 * - Checkouts are instant (automated)
 * - Room cleaning takes 10 minutes; waitlist customers get priority
 * - Stays last 3–6 hours; 5% renew 2h, 2% renew 6h (not during peak)
 * - 5% buy retail at checkin, 5% buy during stay
 * - No actual Square API calls for purchases
 */

import { randomUUID } from 'node:crypto';
import type { SeedProgress } from './progress';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SimCustomer = { id: string; name: string; membership_number: string | null; dob: Date | string | null; membership_valid_until: Date | string | null };
type SimRoom = { id: string; number: string; tier: string };
type SimLocker = { id: string; number: number | string };
type SimStaff = { id: string; name: string; role?: string };
type SimRegisterSession = { id: string; register_number: number; employee_id: string; device_id: string };
type SimAgreement = { id: string; version: string; title: string; body_text: string };
type SimShift = { employee_id: string; starts_at: Date; ends_at: Date };

type DbClient = {
  query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

// Occupancy record for a resource
interface Occupancy {
  customerId: string;
  visitId: string;
  blockId: string;
  checkoutAt: Date;
  rentalType: string;
  resourceId: string;
  checkinAt: Date;
  isRenewal?: boolean;
}

// Queued arrival waiting for a lane
interface QueuedArrival {
  customer: SimCustomer;
  desiredType: 'ROOM' | 'LOCKER';
  arrivalTime: Date;
}

// Scheduled event in the timeline
interface ScheduledEvent {
  time: Date;
  type: 'CHECKOUT' | 'CLEANING_DONE' | 'RENEWAL_ELIGIBLE' | 'RETAIL_PURCHASE';
  resourceId?: string;
  occupancy?: Occupancy;
  customerId?: string;
  visitId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHECKIN_DURATION_MS = 5 * 60 * 1000; // 5 minutes per checkin
const CLEANING_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const TICK_MS = 5 * 60 * 1000; // advance 5 minutes at a time
const MIN_STAY_HOURS = 3;
const MAX_STAY_HOURS = 6;
const RENEWAL_2H_RATE = 0.05;
const RENEWAL_6H_RATE = 0.02;
const RETAIL_AT_CHECKIN_RATE = 0.05;
const RETAIL_DURING_STAY_RATE = 0.05;

const DEMO_SIGNATURE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const RETAIL_CATALOG = [
  { name: 'Bottled Water', sku: 'WATER', price: 3 },
  { name: 'Energy Drink', sku: 'ENERGY_DRINK', price: 5 },
  { name: 'Towel Rental', sku: 'TOWEL_RENTAL', price: 5 },
  { name: 'Swiss Navy', sku: 'SWISS_NAVY', price: 12 },
  { name: 'Snack Bar', sku: 'SNACK_BAR', price: 4 },
];

// ---------------------------------------------------------------------------
// Deterministic PRNG (Mulberry32)
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
// Traffic Curve
// ---------------------------------------------------------------------------

function getSimulatedDayHour(realTime: Date, anchorTime: Date): { day: number; hour: number } {
  const TARGET_DAY = 6; // Saturday
  const TARGET_HOUR = 23; // 11pm
  const realDay = anchorTime.getDay();
  const realHour = anchorTime.getHours();
  const realTotalHours = realDay * 24 + realHour;
  const targetTotalHours = TARGET_DAY * 24 + TARGET_HOUR;
  const offsetHours = targetTotalHours - realTotalHours;
  const shiftedTime = new Date(realTime.getTime() + offsetHours * 60 * 60 * 1000);
  return { day: shiftedTime.getDay(), hour: shiftedTime.getHours() };
}

function isPeakHours(day: number, hour: number): boolean {
  // Peak: Fri 11pm–4am, Sat 11pm–4am
  const isFriNight = day === 5 && hour >= 23;
  const isSatEarly = day === 6 && hour <= 4;
  const isSatNight = day === 6 && hour >= 23;
  const isSunEarly = day === 0 && hour <= 4;
  return isFriNight || isSatEarly || isSatNight || isSunEarly;
}

/** Target occupancy rate for a given time slot */
function targetOccupancyRate(day: number, hour: number): number {
  if (isPeakHours(day, hour)) return 1.0; // 100% — overflow to waitlist
  const isWeekend = day === 0 || day === 5 || day === 6;
  // Evening ramp
  if (hour >= 20 && hour <= 22) return isWeekend ? 0.85 : 0.45;
  if (hour >= 17 && hour <= 19) return isWeekend ? 0.6 : 0.3;
  // Daytime
  if (hour >= 12 && hour <= 16) return isWeekend ? 0.35 : 0.15;
  // Early morning wind-down (5am–11am)
  if (hour >= 5 && hour <= 11) return isWeekend ? 0.15 : 0.05;
  // Late night non-peak
  return isWeekend ? 0.7 : 0.4;
}

/**
 * Arrivals per 5-minute tick. Computed from target occupancy and current state.
 * During peak, we want enough arrivals to fill all rooms + overflow to lockers.
 */
function arrivalsPerTick(
  day: number,
  hour: number,
  currentOccupied: number,
  totalCapacity: number,
  rng: () => number,
): number {
  const target = Math.floor(targetOccupancyRate(day, hour) * totalCapacity);
  const gap = target - currentOccupied;
  if (gap <= 0) return rng() < 0.1 ? 1 : 0; // Trickle even when full
  // Spread the gap over ~12 ticks (1 hour) with some noise
  const rate = Math.max(1, Math.ceil(gap / 12));
  return Math.min(rate, 4); // Max 4 per tick (2 lanes × 5min = can process 2 per tick)
}

// ---------------------------------------------------------------------------
// Stay Duration
// ---------------------------------------------------------------------------

function sampleStayHours(rng: () => number): number {
  // Weighted: 3h=10%, 4h=30%, 5h=35%, 6h=25%
  const roll = rng();
  if (roll < 0.10) return 3;
  if (roll < 0.40) return 4;
  if (roll < 0.75) return 5;
  return 6;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

function checkinPrice(rentalType: string): number {
  switch (rentalType) {
    case 'LOCKER': return 19;
    case 'STANDARD': return 30;
    case 'DOUBLE': return 40;
    case 'SPECIAL': return 50;
    default: return 19;
  }
}

function rentalLabel(rentalType: string): string {
  switch (rentalType) {
    case 'LOCKER': return 'Locker Rental';
    case 'DOUBLE': return 'Double Room Rental';
    case 'SPECIAL': return 'Special Room Rental';
    default: return 'Standard Room Rental';
  }
}

// ---------------------------------------------------------------------------
// Staff Resolution
// ---------------------------------------------------------------------------

function getOnShiftStaff(shifts: SimShift[], allStaff: SimStaff[], time: Date, rng: () => number): SimStaff {
  const onShift = shifts
    .filter(s => s.starts_at <= time && s.ends_at > time)
    .map(s => allStaff.find(st => st.id === s.employee_id))
    .filter((s): s is SimStaff => s !== undefined);
  if (onShift.length > 0) return onShift[Math.floor(rng() * onShift.length)];
  return allStaff[Math.floor(rng() * allStaff.length)];
}

// ---------------------------------------------------------------------------
// DB Insert Helpers (match existing schema exactly)
// ---------------------------------------------------------------------------

async function insertVisitAndBlock(client: DbClient, p: {
  visitId: string; blockId: string; customerId: string; start: Date; scheduledEnd: Date;
  resourceId: string; rentalType: string; signedAt: Date; agreement: SimAgreement;
  customerName: string; membershipNumber: string | null;
}): Promise<void> {
  await client.query(
    `INSERT INTO visits (id, started_at, ended_at, customer_id, created_at, updated_at) VALUES ($1,$2,NULL,$3,NOW(),NOW())`,
    [p.visitId, p.start, p.customerId]
  );
  await client.query(
    `INSERT INTO checkin_blocks (id, visit_id, block_type, starts_at, ends_at, resource_id, agreement_signed, agreement_signed_at, rental_type) VALUES ($1,$2,'INITIAL',$3,$4,$5,true,$6,$7)`,
    [p.blockId, p.visitId, p.start, p.scheduledEnd, p.resourceId, p.signedAt, p.rentalType]
  );
  await client.query(
    `INSERT INTO agreement_signatures (id, agreement_id, customer_name, membership_number, signed_at, signature_png_base64, agreement_text_snapshot, agreement_version, checkin_block_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [randomUUID(), p.agreement.id, p.customerName, p.membershipNumber, p.signedAt, DEMO_SIGNATURE_PNG_BASE64, p.agreement.body_text, p.agreement.version, p.blockId]
  );
}

async function insertCheckinEvents(client: DbClient, p: {
  start: Date; customerId: string; visitId: string; blockId: string;
  rentalType: string; emp: SimStaff; reg: SimRegisterSession;
}): Promise<void> {
  const checkinStartedAt = new Date(p.start.getTime() - CHECKIN_DURATION_MS);
  await client.query(
    `INSERT INTO customer_activity_events (occurred_at, customer_id, action_type, action_category, source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
     VALUES ($1,$2::uuid,'CHECKIN_STARTED','CHECKIN','EMPLOYEE_REGISTER','STAFF',$3::uuid,$4,$5,$6::jsonb,$7,$8)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [checkinStartedAt, p.customerId, p.emp.id, p.emp.name,
     `Check-in started`,
     { visitId: p.visitId, rentalType: p.rentalType, registerNumber: p.reg.register_number },
     `Check-in started ${p.rentalType} ${p.emp.name}`,
     `ACT:SIM:CHECKIN_STARTED:${p.visitId}`]
  );
  await client.query(
    `INSERT INTO customer_activity_events (occurred_at, customer_id, action_type, action_category, source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
     VALUES ($1,$2::uuid,'CHECKIN_COMPLETED','CHECKIN','EMPLOYEE_REGISTER','STAFF',$3::uuid,$4,$5,$6::jsonb,$7,$8)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [p.start, p.customerId, p.emp.id, p.emp.name,
     `Checked in`,
     { visitId: p.visitId, blockId: p.blockId, rentalType: p.rentalType, registerNumber: p.reg.register_number },
     `Checked in ${p.rentalType} ${p.emp.name}`,
     `ACT:SIM:CHECKIN_COMPLETED:${p.blockId}`]
  );
}

async function insertCheckinPayment(client: DbClient, p: {
  visitId: string; rentalType: string; price: number; hasMembership: boolean;
  paymentMethod: string; empId: string; regId: string; regNumber: number;
  signedAt: Date; customerId: string;
}): Promise<void> {
  const orderId = randomUUID();
  let total = p.price;
  if (!p.hasMembership) total += 13;

  await client.query(
    `INSERT INTO orders (id, visit_id, subtotal, discount, tax, tip, total, currency, status, payment_method, register_session_id, register_number, created_by_staff_id, paid_by_staff_id, quote_json, paid_at, created_at, updated_at)
     VALUES ($1,$2,$3,0,0,0,$3,'USD','PAID',$4,$5,$6,$7,$7,$8,$9,$9,$9)`,
    [orderId, p.visitId, total, p.paymentMethod, p.regId, p.regNumber, p.empId,
     { type: 'CHECKIN', rentalType: p.rentalType, total }, p.signedAt]
  );
  await client.query(
    `INSERT INTO order_line_items (id, order_id, kind, name, quantity, unit_price, discount, tax, total) VALUES ($1,$2,'CHECKIN_FEE',$3,1,$4,0,0,$4)`,
    [randomUUID(), orderId, rentalLabel(p.rentalType), p.price]
  );
  if (!p.hasMembership) {
    await client.query(
      `INSERT INTO order_line_items (id, order_id, kind, name, quantity, unit_price, discount, tax, total) VALUES ($1,$2,'ADDON','Membership Fee',1,13,0,0,13)`,
      [randomUUID(), orderId]
    );
  }

  // Spend ledger entries
  await client.query(
    `INSERT INTO customer_spend_ledger_entries (occurred_at, customer_id, visit_id, entry_type, amount, currency, source_app, actor_type, actor_staff_id, summary, metadata, dedupe_key)
     VALUES ($1,$2::uuid,$3::uuid,'RENTAL_FEE',$4::bigint,'USD','EMPLOYEE_REGISTER','STAFF',$5::uuid,$6,$7::jsonb,$8)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [p.signedAt, p.customerId, p.visitId, p.price, p.empId, rentalLabel(p.rentalType),
     { rentalType: p.rentalType, price: p.price }, `LEDGER:SIM:RENTAL_FEE:${p.visitId}`]
  );
  if (!p.hasMembership) {
    await client.query(
      `INSERT INTO customer_spend_ledger_entries (occurred_at, customer_id, visit_id, entry_type, amount, currency, source_app, actor_type, actor_staff_id, summary, metadata, dedupe_key)
       VALUES ($1,$2::uuid,$3::uuid,'MEMBERSHIP_FEE',13,'USD','EMPLOYEE_REGISTER','STAFF',$4::uuid,$5,$6::jsonb,$7)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [p.signedAt, p.customerId, p.visitId, p.empId, 'Non-Member Fee',
       { membershipPrice: 13 }, `LEDGER:SIM:MEMBERSHIP_FEE:${p.visitId}`]
    );
  }
}

async function insertCheckoutEvents(client: DbClient, p: {
  at: Date; customerId: string; visitId: string; blockId: string;
  rentalType: string; emp: SimStaff; resourceId: string;
}): Promise<void> {
  // Close visit
  await client.query(
    `UPDATE visits SET ended_at = $1, updated_at = NOW() WHERE id = $2`,
    [p.at, p.visitId]
  );
  // Activity event
  await client.query(
    `INSERT INTO customer_activity_events (occurred_at, customer_id, action_type, action_category, source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
     VALUES ($1,$2::uuid,'CHECKOUT_COMPLETED','CHECKOUT','EMPLOYEE_REGISTER','STAFF',$3::uuid,$4,$5,$6::jsonb,$7,$8)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [p.at, p.customerId, p.emp.id, p.emp.name, 'Checked out',
     { visitId: p.visitId, blockId: p.blockId, rentalType: p.rentalType },
     `Checked out ${p.rentalType} ${p.emp.name}`,
     `ACT:SIM:CHECKOUT_COMPLETED:${p.visitId}`]
  );
  // Checkout request
  await client.query(
    `INSERT INTO checkout_requests (id, occupancy_id, kiosk_device_id, customer_id, status, customer_checklist_json, late_minutes, late_fee_amount, items_confirmed, fee_paid, completed_at, created_at, updated_at)
     VALUES ($1,$2,'demo-kiosk-1',$3,'VERIFIED',$4,0,0,true,true,$5,$5,$5)`,
    [randomUUID(), p.blockId, p.customerId,
     { towelReturned: true, keyReturned: true, personalBelongings: true }, p.at]
  );
}

async function insertCleaningEvents(client: DbClient, p: {
  resourceId: string; staffId: string; startAt: Date; endAt: Date;
}): Promise<void> {
  await client.query(
    `INSERT INTO cleaning_events (id, resource_id, staff_id, started_at, completed_at, from_status, to_status, override_flag, device_id, created_at)
     VALUES ($1,$2::uuid,$3::uuid,$4,NULL,'DIRTY','CLEANING',false,'demo-cleaning',$4),
            ($5,$2::uuid,$3::uuid,$4,$6,'CLEANING','CLEAN',false,'demo-cleaning',$6)`,
    [randomUUID(), p.resourceId, p.staffId, p.startAt, randomUUID(), p.endAt]
  );
}

async function insertRetailOrder(client: DbClient, p: {
  at: Date; customerId: string | null; visitId: string | null;
  empId: string; regId: string; regNumber: number; rng: () => number;
}): Promise<void> {
  const itemCount = 1 + (p.rng() < 0.3 ? 1 : 0);
  let subtotal = 0;
  const lineItems: Array<{ id: string; name: string; sku: string; qty: number; unitPrice: number; lineTotal: number }> = [];

  for (let i = 0; i < itemCount; i++) {
    const product = RETAIL_CATALOG[Math.floor(p.rng() * RETAIL_CATALOG.length)];
    const qty = 1;
    lineItems.push({ id: randomUUID(), name: product.name, sku: product.sku, qty, unitPrice: product.price, lineTotal: product.price });
    subtotal += product.price;
  }

  const orderId = randomUUID();
  const paymentMethod = p.rng() < 0.33 ? 'CASH' : 'CREDIT';

  await client.query(
    `INSERT INTO orders (id, visit_id, customer_id, register_session_id, register_number, created_by_staff_id, paid_by_staff_id, created_at, status, subtotal, discount, tax, tip, total, currency, payment_method, paid_at, metadata_json)
     VALUES ($1,$2,$3,$4,$5,$6,$6,$7,'PAID',$8,0,0,0,$8,'USD',$9,$7,$10)`,
    [orderId, p.visitId, p.customerId, p.regId, p.regNumber, p.empId, p.at, subtotal, paymentMethod, { tender: { paymentMethod, source: 'SIM' } }]
  );
  for (const item of lineItems) {
    await client.query(
      `INSERT INTO order_line_items (id, order_id, kind, sku, name, quantity, unit_price, discount, tax, total) VALUES ($1,$2,'RETAIL',$3,$4,$5,$6,0,0,$7)`,
      [item.id, orderId, item.sku, item.name, item.qty, item.unitPrice, item.lineTotal]
    );
  }
  const receiptId = randomUUID();
  await client.query(
    `INSERT INTO receipts (id, order_id, issued_at, receipt_number, receipt_json) VALUES ($1,$2,$3,$4,$5)`,
    [receiptId, orderId, p.at, `S${p.at.getUTCFullYear()}-${orderId.slice(0, 8)}`, {
      receiptNumber: `S${p.at.getUTCFullYear()}-${orderId.slice(0, 8)}`, orderId,
      issuedAt: p.at.toISOString(), currency: 'USD',
      totals: { subtotal, tax: 0, tip: 0, total: subtotal },
      lineItems: lineItems.map(i => ({ id: i.id, kind: 'RETAIL', sku: i.sku, name: i.name, quantity: i.qty, unitPrice: i.unitPrice, total: i.lineTotal })),
    }]
  );

  if (p.customerId) {
    await client.query(
      `INSERT INTO customer_spend_ledger_entries (occurred_at, customer_id, visit_id, entry_type, amount, currency, source_app, actor_type, actor_staff_id, summary, metadata, dedupe_key)
       VALUES ($1,$2::uuid,$3::uuid,'ORDER_PAID',$4::bigint,'USD','EMPLOYEE_REGISTER','STAFF',$5::uuid,'Order paid',$6::jsonb,$7)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [p.at, p.customerId, p.visitId ?? orderId, subtotal, p.empId,
       { orderId, total: subtotal }, `LEDGER:SIM:ORDER_PAID:${orderId}`]
    );
  }
}

async function insertWaitlistEntry(client: DbClient, p: {
  wlId: string; visitId: string; blockId: string; createdAt: Date;
}): Promise<void> {
  await client.query(
    `INSERT INTO waitlist (id, visit_id, checkin_block_id, desired_tier, desired_tiers, backup_tier, status, created_at, updated_at)
     VALUES ($1,$2,$3,'STANDARD'::rental_type,'["STANDARD","DOUBLE","SPECIAL"]','LOCKER'::rental_type,'ACTIVE',$4,$4)`,
    [p.wlId, p.visitId, p.blockId, p.createdAt]
  );
}

async function fulfillWaitlistEntry(client: DbClient, p: {
  wlId: string; roomId: string; visitId: string; oldBlockId: string;
  customerId: string; roomType: string; fulfillAt: Date; scheduledEnd: Date;
  emp: SimStaff; agreement: SimAgreement; customerName: string; membershipNumber: string | null;
}): Promise<void> {
  const newBlockId = randomUUID();
  const offerExpiresAt = new Date(p.fulfillAt.getTime() + 10 * 60 * 1000);

  // Update waitlist to COMPLETED
  await client.query(
    `UPDATE waitlist SET status = 'COMPLETED', resource_id = $1, offered_at = $2, last_offered_at = $2, offer_expires_at = $3, completed_at = $4, updated_at = $4, offer_attempts = 1 WHERE id = $5`,
    [p.roomId, p.fulfillAt, offerExpiresAt, p.fulfillAt, p.wlId]
  );
  // New checkin block for the room
  await client.query(
    `INSERT INTO checkin_blocks (id, visit_id, block_type, starts_at, ends_at, resource_id, agreement_signed, agreement_signed_at, rental_type, waitlist_id)
     VALUES ($1,$2,'RENEWAL',$3,$4,$5,true,$3,$6::rental_type,$7)`,
    [newBlockId, p.visitId, p.fulfillAt, p.scheduledEnd, p.roomId, p.roomType, p.wlId]
  );
  // Reservation record
  await client.query(
    `INSERT INTO inventory_reservations (id, resource_type, resource_id, kind, waitlist_id, created_at, expires_at, released_at, release_reason)
     VALUES ($1,'room'::inventory_resource_type,$2,'UPGRADE_HOLD'::inventory_reservation_kind,$3,$4,$5,$6,'waitlist_completed')`,
    [randomUUID(), p.roomId, p.wlId, p.fulfillAt, offerExpiresAt, p.fulfillAt]
  );
  // Upgrade payment
  const upgradeFee = checkinPrice(p.roomType) - checkinPrice('LOCKER');
  if (upgradeFee > 0) {
    const orderId = randomUUID();
    await client.query(
      `INSERT INTO orders (id, visit_id, subtotal, discount, tax, tip, total, currency, status, quote_json, paid_at, created_at, updated_at)
       VALUES ($1,$2,$3,0,0,0,$3,'USD','PAID',$4,$5,$5,$5)`,
      [orderId, p.visitId, upgradeFee, { type: 'UPGRADE', from: 'LOCKER', to: p.roomType, price: upgradeFee }, p.fulfillAt]
    );
    await client.query(
      `INSERT INTO order_line_items (id, order_id, kind, name, quantity, unit_price, discount, tax, total) VALUES ($1,$2,'UPGRADE','Upgrade Fee',1,$3,0,0,$3)`,
      [randomUUID(), orderId, upgradeFee]
    );
  }
  // Activity event
  await client.query(
    `INSERT INTO customer_activity_events (occurred_at, customer_id, action_type, action_category, source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
     VALUES ($1,$2::uuid,'UPGRADE_COMPLETED','UPGRADE','EMPLOYEE_REGISTER','STAFF',$3::uuid,$4,$5,$6::jsonb,$7,$8)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [p.fulfillAt, p.customerId, p.emp.id, p.emp.name,
     `Waitlist fulfilled: Locker → ${p.roomType}`,
     { visitId: p.visitId, fromType: 'LOCKER', toType: p.roomType, roomId: p.roomId, waitlistId: p.wlId },
     `Waitlist fulfilled ${p.roomType} ${p.emp.name}`,
     `ACT:SIM:UPGRADE_COMPLETED:${p.wlId}`]
  );
}

async function insertRenewalBlock(client: DbClient, p: {
  visitId: string; resourceId: string; rentalType: string;
  renewAt: Date; newEnd: Date; customerId: string; empId: string; hours: number;
}): Promise<void> {
  const blockId = randomUUID();
  await client.query(
    `INSERT INTO checkin_blocks (id, visit_id, block_type, starts_at, ends_at, resource_id, agreement_signed, agreement_signed_at, rental_type)
     VALUES ($1,$2,'RENEWAL',$3,$4,$5,true,$3,$6)`,
    [blockId, p.visitId, p.renewAt, p.newEnd, p.resourceId, p.rentalType]
  );
  const fee = p.hours === 6 ? 43 : 20;
  const orderId = randomUUID();
  await client.query(
    `INSERT INTO orders (id, visit_id, subtotal, discount, tax, tip, total, currency, status, quote_json, paid_at, created_at, updated_at)
     VALUES ($1,$2,$3,0,0,0,$3,'USD','PAID',$4,$5,$5,$5)`,
    [orderId, p.visitId, fee, { type: 'RENEWAL', hours: p.hours, total: fee }, p.renewAt]
  );
  await client.query(
    `INSERT INTO order_line_items (id, order_id, kind, name, quantity, unit_price, discount, tax, total) VALUES ($1,$2,'RENEWAL_FEE',$3,1,$4,0,0,$4)`,
    [randomUUID(), orderId, `Renewal (${p.hours} Hours)`, fee]
  );
  await client.query(
    `INSERT INTO customer_activity_events (occurred_at, customer_id, action_type, action_category, source_app, actor_type, actor_staff_id, summary, metadata, search_blob, dedupe_key)
     VALUES ($1,$2::uuid,'RENEWAL_COMPLETED','CHECKIN','EMPLOYEE_REGISTER','STAFF',$3::uuid,$4,$5::jsonb,$6,$7)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [p.renewAt, p.customerId, p.empId, `Renewed for ${p.hours} hours`,
     { visitId: p.visitId, hours: p.hours, fee },
     `Renewed ${p.hours}h`, `ACT:SIM:RENEWAL:${p.visitId}:${p.renewAt.getTime()}`]
  );
}

// ---------------------------------------------------------------------------
// Main Simulation Engine
// ---------------------------------------------------------------------------

export interface SimulateParams {
  client: DbClient;
  from: Date;
  to: Date;
  anchor: Date;
  agreement: SimAgreement;
  customers: SimCustomer[];
  lockers: SimLocker[];
  rooms: SimRoom[];
  staff: SimStaff[];
  shifts: SimShift[];
  registerSessions: SimRegisterSession[];
  progress: SeedProgress;
}

export async function simulateVisitsV2(params: SimulateParams): Promise<number> {
  const { client, from, to, anchor, agreement, customers, lockers, rooms, staff, shifts, registerSessions, progress } = params;
  if (to.getTime() <= from.getTime()) return 0;

  const rng = seededRng(Math.floor(from.getTime() / 60000) ^ 0x53494D32);
  const totalCapacity = rooms.length + lockers.length;

  // --------------- State ---------------
  const occupiedRooms = new Map<string, Occupancy>(); // roomId → occupancy
  const occupiedLockers = new Map<string, Occupancy>(); // lockerId → occupancy
  const dirtyRooms = new Map<string, { availableAt: Date; staffId: string }>(); // roomId → cleaning
  const waitlist: Array<{ customerId: string; customerName: string; membershipNumber: string | null; visitId: string; blockId: string; lockerId: string; wlId: string; joinedAt: Date }> = [];
  const pendingRenewals: Array<{ occupancy: Occupancy; renewAt: Date; hours: number }> = [];
  const pendingRetail: Array<{ customerId: string; visitId: string; at: Date }> = [];
  const activeVisitEnd = new Map<string, number>(); // customerId → latest end time

  // Lane state: when each lane becomes free
  const lanes = [from.getTime(), from.getTime()];

  let created = 0;
  let lastLogDay = '';

  const totalTicks = Math.ceil((to.getTime() - from.getTime()) / TICK_MS);
  progress.addTotal(totalTicks);

  for (let tick = 0; tick < totalTicks; tick++) {
    const tickTime = new Date(from.getTime() + tick * TICK_MS);
    if (tickTime > to) break;

    const { day, hour } = getSimulatedDayHour(tickTime, anchor);
    const peak = isPeakHours(day, hour);
    const emp = getOnShiftStaff(shifts, staff, tickTime, rng);

    // Daily progress log
    const dayStr = tickTime.toISOString().slice(0, 10);
    if (dayStr !== lastLogDay) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      progress.log(`  📅 ${dayStr} (sim ${dayNames[day]}) — ${occupiedRooms.size} rooms, ${occupiedLockers.size} lockers occupied, ${waitlist.length} waitlisted, ${created} total visits`);
      lastLogDay = dayStr;
    }

    // ─── 1. Process checkouts ───
    for (const [roomId, occ] of occupiedRooms) {
      if (occ.checkoutAt <= tickTime) {
        await insertCheckoutEvents(client, {
          at: occ.checkoutAt, customerId: occ.customerId, visitId: occ.visitId,
          blockId: occ.blockId, rentalType: occ.rentalType, emp, resourceId: roomId,
        });
        occupiedRooms.delete(roomId);
        // Start cleaning
        const cleanEnd = new Date(occ.checkoutAt.getTime() + CLEANING_DURATION_MS);
        dirtyRooms.set(roomId, { availableAt: cleanEnd, staffId: emp.id });
      }
    }
    for (const [lockerId, occ] of occupiedLockers) {
      if (occ.checkoutAt <= tickTime) {
        await insertCheckoutEvents(client, {
          at: occ.checkoutAt, customerId: occ.customerId, visitId: occ.visitId,
          blockId: occ.blockId, rentalType: 'LOCKER', emp, resourceId: lockerId,
        });
        occupiedLockers.delete(lockerId);
      }
    }

    // ─── 2. Process cleaning completions ───
    for (const [roomId, cleaning] of dirtyRooms) {
      if (cleaning.availableAt <= tickTime) {
        await insertCleaningEvents(client, {
          resourceId: roomId, staffId: cleaning.staffId,
          startAt: new Date(cleaning.availableAt.getTime() - CLEANING_DURATION_MS),
          endAt: cleaning.availableAt,
        });
        dirtyRooms.delete(roomId);

        // ─── 3. Fulfill waitlist with priority ───
        if (waitlist.length > 0) {
          const entry = waitlist.shift()!;
          const room = rooms.find(r => r.id === roomId)!;
          const roomType = ['STANDARD', 'DOUBLE', 'SPECIAL'].includes(room.tier) ? room.tier : 'STANDARD';
          const stayHours = sampleStayHours(rng);
          const scheduledEnd = new Date(tickTime.getTime() + stayHours * 60 * 60 * 1000);

          await fulfillWaitlistEntry(client, {
            wlId: entry.wlId, roomId, visitId: entry.visitId, oldBlockId: entry.blockId,
            customerId: entry.customerId, roomType, fulfillAt: tickTime, scheduledEnd,
            emp, agreement, customerName: entry.customerName, membershipNumber: entry.membershipNumber,
          });

          occupiedRooms.set(roomId, {
            customerId: entry.customerId, visitId: entry.visitId, blockId: randomUUID(),
            checkoutAt: scheduledEnd, rentalType: roomType, resourceId: roomId, checkinAt: tickTime,
          });
          activeVisitEnd.set(entry.customerId, scheduledEnd.getTime());

          // Release the locker
          occupiedLockers.delete(entry.lockerId);
        }
      }
    }

    // ─── 4. Process renewals ───
    for (let i = pendingRenewals.length - 1; i >= 0; i--) {
      const renewal = pendingRenewals[i];
      if (renewal.renewAt <= tickTime) {
        const newEnd = new Date(renewal.occupancy.checkoutAt.getTime() + renewal.hours * 60 * 60 * 1000);
        await insertRenewalBlock(client, {
          visitId: renewal.occupancy.visitId, resourceId: renewal.occupancy.resourceId,
          rentalType: renewal.occupancy.rentalType, renewAt: renewal.renewAt, newEnd,
          customerId: renewal.occupancy.customerId, empId: emp.id, hours: renewal.hours,
        });
        // Update the checkout time
        renewal.occupancy.checkoutAt = newEnd;
        activeVisitEnd.set(renewal.occupancy.customerId, newEnd.getTime());
        pendingRenewals.splice(i, 1);
      }
    }

    // ─── 5. Process retail purchases during stay ───
    for (let i = pendingRetail.length - 1; i >= 0; i--) {
      const retail = pendingRetail[i];
      if (retail.at <= tickTime) {
        const retailReg = registerSessions.find(r => r.register_number === 3) ?? registerSessions[0];
        await insertRetailOrder(client, {
          at: retail.at, customerId: retail.customerId, visitId: retail.visitId,
          empId: emp.id, regId: retailReg.id, regNumber: retailReg.register_number, rng,
        });
        pendingRetail.splice(i, 1);
      }
    }

    // ─── 6. Generate new arrivals ───
    const currentOccupied = occupiedRooms.size + occupiedLockers.size;
    const arrivalCount = arrivalsPerTick(day, hour, currentOccupied, totalCapacity, rng);

    for (let a = 0; a < arrivalCount; a++) {
      // Pick customer (no overlapping visits)
      let customer: SimCustomer | null = null;
      for (let attempt = 0; attempt < 10 && !customer; attempt++) {
        const candidate = customers[Math.floor(rng() * customers.length)];
        const prevEnd = activeVisitEnd.get(candidate.id) ?? 0;
        if (tickTime.getTime() >= prevEnd) customer = candidate;
      }
      if (!customer) continue;

      // Pick lane (whichever is free first)
      const laneIdx = lanes[0] <= lanes[1] ? 0 : 1;
      const laneAvailableAt = Math.max(lanes[laneIdx], tickTime.getTime());
      const checkinCompleteAt = new Date(laneAvailableAt + CHECKIN_DURATION_MS);
      if (checkinCompleteAt > to) continue;

      // Mark lane busy
      lanes[laneIdx] = checkinCompleteAt.getTime();

      // Determine resource type
      let assignedRoom = false;
      let resourceId: string | null = null;
      let rentalType = 'LOCKER';
      let joinWaitlist = false;

      if (peak) {
        // Peak: try room first → if full, try locker → if all full, skip
        const availRoom = rooms.find(r => !occupiedRooms.has(r.id) && !dirtyRooms.has(r.id));
        if (availRoom) {
          resourceId = availRoom.id;
          rentalType = ['STANDARD', 'DOUBLE', 'SPECIAL'].includes(availRoom.tier) ? availRoom.tier : 'STANDARD';
          assignedRoom = true;
        } else {
          // Rooms full — assign locker and join waitlist
          const availLocker = lockers.find(l => !occupiedLockers.has(l.id));
          if (availLocker) {
            resourceId = availLocker.id;
            rentalType = 'LOCKER';
            joinWaitlist = true;
          } else {
            continue; // Completely full — customer turned away
          }
        }
      } else {
        // Off-peak: 50/50 room/locker
        if (rng() < 0.5) {
          const availRoom = rooms.find(r => !occupiedRooms.has(r.id) && !dirtyRooms.has(r.id));
          if (availRoom) {
            resourceId = availRoom.id;
            rentalType = ['STANDARD', 'DOUBLE', 'SPECIAL'].includes(availRoom.tier) ? availRoom.tier : 'STANDARD';
            assignedRoom = true;
          }
        }
        if (!resourceId) {
          const availLocker = lockers.find(l => !occupiedLockers.has(l.id));
          if (availLocker) {
            resourceId = availLocker.id;
            rentalType = 'LOCKER';
          } else {
            // Try room as fallback
            const availRoom = rooms.find(r => !occupiedRooms.has(r.id) && !dirtyRooms.has(r.id));
            if (availRoom) {
              resourceId = availRoom.id;
              rentalType = ['STANDARD', 'DOUBLE', 'SPECIAL'].includes(availRoom.tier) ? availRoom.tier : 'STANDARD';
              assignedRoom = true;
            } else {
              continue; // Full
            }
          }
        }
      }

      // Determine stay duration
      const stayHours = sampleStayHours(rng);
      const scheduledEnd = new Date(checkinCompleteAt.getTime() + stayHours * 60 * 60 * 1000);
      const signedAt = new Date(checkinCompleteAt.getTime() - 1 * 60 * 1000);
      const hasMembership = customer.membership_valid_until != null && new Date(customer.membership_valid_until) >= checkinCompleteAt;
      const paymentMethod = rng() < 0.3 ? 'CASH' : 'CREDIT';
      const checkinRegs = registerSessions.filter(r => r.register_number <= 2);
      const reg = checkinRegs.length > 0 ? checkinRegs[laneIdx % checkinRegs.length] : registerSessions[0];

      const visitId = randomUUID();
      const blockId = randomUUID();

      // ─── Insert visit + block ───
      await insertVisitAndBlock(client, {
        visitId, blockId, customerId: customer.id, start: checkinCompleteAt,
        scheduledEnd, resourceId: resourceId!, rentalType, signedAt, agreement,
        customerName: customer.name, membershipNumber: customer.membership_number,
      });
      await insertCheckinEvents(client, {
        start: checkinCompleteAt, customerId: customer.id, visitId, blockId,
        rentalType, emp, reg,
      });
      await insertCheckinPayment(client, {
        visitId, rentalType, price: checkinPrice(rentalType), hasMembership,
        paymentMethod, empId: emp.id, regId: reg.id, regNumber: reg.register_number,
        signedAt, customerId: customer.id,
      });

      // Track occupancy
      const occ: Occupancy = {
        customerId: customer.id, visitId, blockId, checkoutAt: scheduledEnd,
        rentalType, resourceId: resourceId!, checkinAt: checkinCompleteAt,
      };
      if (assignedRoom) {
        occupiedRooms.set(resourceId!, occ);
      } else {
        occupiedLockers.set(resourceId!, occ);
      }
      activeVisitEnd.set(customer.id, scheduledEnd.getTime());

      // Waitlist for room (during peak, locker customers join waitlist)
      if (joinWaitlist) {
        const wlId = randomUUID();
        await insertWaitlistEntry(client, { wlId, visitId, blockId, createdAt: checkinCompleteAt });
        waitlist.push({
          customerId: customer.id, customerName: customer.name,
          membershipNumber: customer.membership_number,
          visitId, blockId, lockerId: resourceId!, wlId, joinedAt: checkinCompleteAt,
        });
      }

      // Schedule renewal (not during peak)
      if (!peak) {
        const renewRoll = rng();
        if (renewRoll < RENEWAL_2H_RATE) {
          const renewAt = new Date(scheduledEnd.getTime() - 30 * 60 * 1000); // 30 min before checkout
          pendingRenewals.push({ occupancy: occ, renewAt, hours: 2 });
        } else if (renewRoll < RENEWAL_2H_RATE + RENEWAL_6H_RATE) {
          const renewAt = new Date(scheduledEnd.getTime() - 30 * 60 * 1000);
          pendingRenewals.push({ occupancy: occ, renewAt, hours: 6 });
        }
      }

      // Schedule retail purchase at checkin (5%)
      if (rng() < RETAIL_AT_CHECKIN_RATE) {
        pendingRetail.push({ customerId: customer.id, visitId, at: new Date(checkinCompleteAt.getTime() + 2 * 60 * 1000) });
      }
      // Schedule retail purchase during stay (5%)
      if (rng() < RETAIL_DURING_STAY_RATE) {
        const purchaseOffset = 30 + Math.floor(rng() * (stayHours * 60 - 60));
        const purchaseAt = new Date(checkinCompleteAt.getTime() + purchaseOffset * 60 * 1000);
        if (purchaseAt < scheduledEnd) {
          pendingRetail.push({ customerId: customer.id, visitId, at: purchaseAt });
        }
      }

      created++;
    }

    progress.tick();
  }

  progress.log(`  ✅ Simulation complete: ${created} visits, ${occupiedRooms.size} rooms still occupied, ${waitlist.length} still on waitlist`);
  return created;
}
