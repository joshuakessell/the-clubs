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
}

export interface PriceQuote {
  rentalFee: number;
  membershipFee: number;
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
  const day = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday
  const hour = date.getHours();
  const minute = date.getMinutes();

  // Monday (1) through Friday (5)
  if (day >= 1 && day <= 5) {
    // 8am (8) to 4pm (16)
    if (hour >= 8 && hour < 16) {
      return true;
    }
    // Exactly 4pm (hour 16, minute 0) is included
    if (hour === 16 && minute === 0) {
      return true;
    }
  }

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
      return isWeekdayDiscount ? 27 : 30; // $3 discount during weekday window
    case 'DOUBLE':
      return isWeekdayDiscount ? 37 : 40;
    case 'SPECIAL':
      return isWeekdayDiscount ? 47 : 50;
    case 'LOCKER':
    case 'GYM_LOCKER':
      // Locker pricing handled separately
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

  // Gym locker is always free
  if (rentalType === 'GYM_LOCKER') {
    return 0;
  }

  // Youth lockers
  if (isYouth) {
    const isWeekdayDiscount = isWeekdayDiscountWindow(checkInTime);
    return isWeekdayDiscount ? 0 : 7; // Free during weekday window, $7 otherwise
  }

  // Non-youth lockers
  const day = checkInTime.getDay();
  const hour = checkInTime.getHours();
  const isWeekdayDiscount = isWeekdayDiscountWindow(checkInTime);

  if (isWeekdayDiscount) {
    // Monday 8am to Friday 4pm
    return 16;
  }

  // Check if weekend (Saturday = 6, Sunday = 0)
  if (day === 0 || day === 6) {
    return 24;
  }

  // Weekday 4pm to 8am Monday-Thursday
  // Friday 4pm to Monday 8am counts as weekend pricing
  if (day === 5 && hour >= 16) {
    // Friday after 4pm
    return 24;
  }

  if (day === 0 || (day === 1 && hour < 8)) {
    // Sunday or Monday before 8am
    return 24;
  }

  // Monday-Thursday 4pm to 8am next day
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
export function calculatePriceQuote(input: PricingInput): PriceQuote {
  const isWeekdayDiscount = isWeekdayDiscountWindow(input.checkInTime);
  const youth = isYouth(input.customerAge);

  const lineItems: Array<{ description: string; amount: number }> = [];
  let rentalFee = 0;

  // Calculate rental fee
  if (input.rentalType === 'LOCKER' || input.rentalType === 'GYM_LOCKER') {
    rentalFee = getLockerPrice(input.rentalType, input.checkInTime, youth);
    if (rentalFee > 0) {
      lineItems.push({
        description: input.rentalType === 'GYM_LOCKER' ? 'Gym Locker' : 'Locker',
        amount: rentalFee,
      });
    } else if (input.rentalType === 'GYM_LOCKER') {
      lineItems.push({
        description: 'Gym Locker (no cost)',
        amount: 0,
      });
    }
  } else {
    // For rooms, check if youth pricing applies
    if (youth) {
      rentalFee = getYouthRoomPrice(input.rentalType);
    } else {
      rentalFee = getBaseRoomPrice(input.rentalType, isWeekdayDiscount);
    }
    const roomTypeName =
      input.rentalType === 'STANDARD'
        ? 'Standard Room'
        : input.rentalType === 'DOUBLE'
          ? 'Double Room'
          : 'Special Room';
    lineItems.push({
      description: roomTypeName,
      amount: rentalFee,
    });
  }

  // Calculate membership fee
  const sixMonthMembershipPurchaseFee = input.includeSixMonthMembershipPurchase ? 43 : 0;
  const membershipFee = input.includeSixMonthMembershipPurchase
    ? 0
    : getMembershipFee(
        input.checkInTime,
        input.customerAge,
        input.membershipCardType,
        input.membershipValidUntil
      );

  if (membershipFee > 0) {
    lineItems.push({
      description: 'Membership Fee',
      amount: membershipFee,
    });
  }

  if (sixMonthMembershipPurchaseFee > 0) {
    lineItems.push({
      description: '6 Month Membership',
      amount: sixMonthMembershipPurchaseFee,
    });
  }

  const total = rentalFee + membershipFee + sixMonthMembershipPurchaseFee;

  const messages: string[] = ['No refunds'];

  return {
    rentalFee,
    membershipFee,
    total,
    lineItems,
    messages,
  };
}

/**
 * Calculate price quote for a renewal (2h or 6h).
 * - 2h renewals: flat $20 + daily membership fee (if applicable)
 * - 6h renewals: full base pricing (same as initial check-in)
 */
export function calculateRenewalQuote(
  input: PricingInput & { renewalHours: 2 | 6 | null | undefined }
): PriceQuote {
  const hours = input.renewalHours ?? 6;
  if (hours === 6) {
    return calculatePriceQuote(input);
  }

  const lineItems: Array<{ description: string; amount: number }> = [];
  const renewalFee = 20;
  lineItems.push({ description: 'Renewal (2 Hours)', amount: renewalFee });

  const sixMonthMembershipPurchaseFee = input.includeSixMonthMembershipPurchase ? 43 : 0;
  const membershipFee = input.includeSixMonthMembershipPurchase
    ? 0
    : getMembershipFee(
        input.checkInTime,
        input.customerAge,
        input.membershipCardType,
        input.membershipValidUntil
      );

  if (membershipFee > 0) {
    lineItems.push({ description: 'Membership Fee', amount: membershipFee });
  }

  if (sixMonthMembershipPurchaseFee > 0) {
    lineItems.push({ description: '6 Month Membership', amount: sixMonthMembershipPurchaseFee });
  }

  const total = renewalFee + membershipFee + sixMonthMembershipPurchaseFee;

  return {
    rentalFee: renewalFee,
    membershipFee,
    total,
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
