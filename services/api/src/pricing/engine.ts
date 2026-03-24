/**
 * Pricing engine for check-in flow.
 * Implements deterministic pricing rules based on rental type, customer age, day/time, and membership status.
 */

export type RentalType = 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';
export type MembershipCardType = 'NONE' | 'SIX_MONTH';

export interface PricingInput {
  rentalType: RentalType;
  customerAge?: number; // Age in years
  checkInTime: Date;
  membershipCardType?: MembershipCardType;
  membershipValidUntil?: Date;
  /**
   * When true, include a 6-month membership purchase/renewal in the quote ($43),
   * and do not charge the daily membership fee for this check-in.
   */
  includeSixMonthMembershipPurchase?: boolean;
  /** Waitlist string constants for $0 item line tracking */
  waitlistDesiredType?: RentalType;
  waitlistDesiredTypesJson?: string;
  pastDueBalance?: number;
}

export interface PriceQuote {
  rentalFee: number;
  membershipFee: number;
  pastDueFee?: number;
  total: number;
  lineItems: Array<{
    description: string;
    amount: number;
  }>;
  messages: string[];
}

/**
 * Check if a date/time falls within weekday discount window.
 * Monday 8am to Friday 4pm (inclusive of 4:00pm, exclusive of 4:01pm).
 */
function isWeekdayDiscountWindow(date: Date): boolean {
  // Demo Override: Weekday discounts disabled to prevent FIXED_PRICING conflicts in Square POS
  return false;
}

/**
 * Check if customer is youth (18-24 inclusive).
 */
function isYouth(age?: number): boolean {
  if (age === undefined) {
    return false;
  }
  return age >= 18 && age <= 24;
}

/**
 * Check if customer has valid 6-month membership.
 */
function hasValidSixMonthMembership(
  now: Date,
  membershipCardType?: MembershipCardType,
  membershipValidUntil?: Date
): boolean {
  if (membershipCardType !== 'SIX_MONTH') {
    return false;
  }

  if (!membershipValidUntil) {
    return false;
  }

  // Membership is valid through the expiration date (inclusive).
  // membership_valid_until is stored as a DATE in Postgres (no time), so treat it as end-of-day.
  const endOfDay = new Date(
    membershipValidUntil.getFullYear(),
    membershipValidUntil.getMonth(),
    membershipValidUntil.getDate(),
    23,
    59,
    59,
    999
  );
  return now.getTime() <= endOfDay.getTime();
}

/**
 * Calculate base room price.
 * Note: Youth pricing overrides this (handled in calculatePriceQuote).
 */
function getBaseRoomPrice(rentalType: RentalType, isWeekdayDiscount: boolean): number {
  switch (rentalType) {
    case 'STANDARD':
      return 30; // Demo Override: Locked to Square items
    case 'DOUBLE':
      return 40;
    case 'SPECIAL':
      return 50;
    case 'LOCKER':
    case 'GYM_LOCKER':
      return 0;
    default:
      return 0;
  }
}

/**
 * Calculate room price for youth (18-24).
 * Youth pricing: Standard $30, Double/Special $50 (any day, no discount).
 */
function getYouthRoomPrice(rentalType: RentalType): number {
  switch (rentalType) {
    case 'STANDARD':
      return 30;
    case 'DOUBLE':
      return 40; // Demo Override: Was 50, changed to 40 to match Square POS FIXED_PRICING
    case 'SPECIAL':
      return 50;
    default:
      return 0;
  }
}

/**
 * Calculate locker price.
 */
function getLockerPrice(rentalType: RentalType, checkInTime: Date, isYouth: boolean): number {
  if (rentalType !== 'LOCKER' && rentalType !== 'GYM_LOCKER') {
    return 0;
  }

  if (rentalType === 'GYM_LOCKER') {
    return 0;
  }

  // Demo Override: All locker pricing fixed to match Square POS $19 FIXED_PRICING
  // Note: if Youth pricing ($0) evaluated to 0, Square bypasses the line item addition completely, so 0 is still allowed.
  if (isYouth) {
    return 0; 
  }

  return 19;
}

/**
 * Calculate membership fee.
 * 25+ must pay $13 unless they have valid 6-month membership.
 */
function getMembershipFee(
  checkInTime: Date,
  customerAge?: number,
  membershipCardType?: MembershipCardType,
  membershipValidUntil?: Date
): number {
  // No fee for youth (under 25)
  if (customerAge !== undefined && customerAge < 25) {
    return 0;
  }

  // No fee if valid 6-month membership
  if (hasValidSixMonthMembership(checkInTime, membershipCardType, membershipValidUntil)) {
    return 0;
  }

  // $13 for 25+ without valid membership
  return 13;
}

/**
 * Calculate price quote for a check-in.
 */
function calculateRentalItems(
  input: PricingInput,
  youth: boolean,
  isWeekdayDiscount: boolean
): { fee: number; items: Array<{ description: string; amount: number }> } {
  let fee = 0;
  const items: Array<{ description: string; amount: number }> = [];

  if (input.rentalType === 'LOCKER' || input.rentalType === 'GYM_LOCKER') {
    fee = getLockerPrice(input.rentalType, input.checkInTime, youth);
    if (fee > 0) {
      items.push({ description: input.rentalType === 'GYM_LOCKER' ? 'Gym Locker' : 'Locker', amount: fee });
    } else if (input.rentalType === 'GYM_LOCKER') {
      items.push({ description: 'Gym Locker (no cost)', amount: 0 });
    }
  } else {
    fee = youth ? getYouthRoomPrice(input.rentalType) : getBaseRoomPrice(input.rentalType, isWeekdayDiscount);
    let roomTypeName = 'Special Room';
    if (input.rentalType === 'STANDARD') roomTypeName = 'Standard Room';
    else if (input.rentalType === 'DOUBLE') roomTypeName = 'Double Room';
    items.push({ description: roomTypeName, amount: fee });
  }

  return { fee, items };
}

function calculateWaitlistItems(input: PricingInput): Array<{ description: string; amount: number }> {
  if (!input.waitlistDesiredType || input.waitlistDesiredType === input.rentalType) {
    return [];
  }

  let description = '';
  const hasMultipleWaitlists =
    input.waitlistDesiredTypesJson &&
    input.waitlistDesiredTypesJson.includes('[') &&
    JSON.parse(input.waitlistDesiredTypesJson).length > 1;

  if (hasMultipleWaitlists) {
    description = 'First Available (Waitlist)';
  } else {
    let typeName = 'Locker';
    if (input.waitlistDesiredType === 'STANDARD') typeName = 'Standard Room';
    else if (input.waitlistDesiredType === 'DOUBLE') typeName = 'Double Room';
    else if (input.waitlistDesiredType === 'SPECIAL') typeName = 'Special Room';
    description = `${typeName} (Waitlist)`;
  }

  return [{ description, amount: 0 }];
}

function calculateMembershipItems(input: PricingInput): { fee: number; items: Array<{ description: string; amount: number }> } {
  const sixMonthFee = input.includeSixMonthMembershipPurchase ? 43 : 0;
  const baseFee = input.includeSixMonthMembershipPurchase
    ? 0
    : getMembershipFee(input.checkInTime, input.customerAge, input.membershipCardType, input.membershipValidUntil);

  const items: Array<{ description: string; amount: number }> = [];
  if (baseFee > 0) items.push({ description: 'Membership Fee', amount: baseFee });
  if (sixMonthFee > 0) items.push({ description: '6 Month Membership', amount: sixMonthFee });

  return { fee: baseFee + sixMonthFee, items };
}

export function calculatePriceQuote(input: PricingInput): PriceQuote {
  const isWeekdayDiscount = isWeekdayDiscountWindow(input.checkInTime);
  const youth = isYouth(input.customerAge);

  const rentalResult = calculateRentalItems(input, youth, isWeekdayDiscount);
  const waitlistItems = calculateWaitlistItems(input);
  const membershipResult = calculateMembershipItems(input);

  const pastDueFee = input.pastDueBalance ?? 0;
  
  const lineItems = [
    ...rentalResult.items,
    ...waitlistItems,
    ...membershipResult.items
  ];

  if (pastDueFee > 0) {
    lineItems.push({ description: 'Past Due Balance', amount: pastDueFee });
  }

  const total = rentalResult.fee + membershipResult.fee + pastDueFee;

  return {
    rentalFee: rentalResult.fee,
    membershipFee: membershipResult.fee,
    pastDueFee,
    total,
    lineItems,
    messages: ['No refunds'],
  };
}

/**
 * Calculate price quote for a renewal (2h or 6h).
 * Demo Override: 6h renewals are flat $43, 2h renewals are flat $20 to match Square POS.
 */
export function calculateRenewalQuote(
  input: PricingInput & { renewalHours: 2 | 6 | null | undefined }
): PriceQuote {
  const hours = input.renewalHours ?? 6;
  
  if (hours === 6) {
    const fee = 43;
    const lineItems = [{ description: 'Renewal (6 Hours)', amount: fee }];
    return {
      rentalFee: fee,
      membershipFee: 0,
      pastDueFee: 0,
      total: fee,
      lineItems,
      messages: ['No refunds'],
    };
  }

  // 2-hour renewal: flat $20
  const renewalFee = 20;
  const lineItems = [{ description: 'Renewal (2 Hours)', amount: renewalFee }];

  return {
    rentalFee: renewalFee,
    membershipFee: 0,
    pastDueFee: 0,
    total: renewalFee,
    lineItems,
    messages: ['No refunds'],
  };
}

/**
 * Get upgrade fee amounts (informational only, charged when upgrade happens).
 */
export function getUpgradeFee(from: RentalType, to: RentalType): number | null {
  const upgradeFees: Record<string, Record<string, number>> = {
    LOCKER: {
      STANDARD: 8,
      DOUBLE: 17,
      SPECIAL: 27,
    },
    STANDARD: {
      DOUBLE: 9,
      SPECIAL: 19,
    },
    DOUBLE: {
      SPECIAL: 9,
    },
  };

  return upgradeFees[from]?.[to] ?? null;
}
