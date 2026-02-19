export type CustomerMembershipStatus = 'NONE' | 'ACTIVE' | 'EXPIRED';
export type MembershipStatusInput = {
    membershipNumber?: string | null;
    /**
     * Membership expiration date (YYYY-MM-DD). Membership is valid through this date (inclusive).
     * Becomes expired the day AFTER this date.
     */
    membershipValidUntil?: string | null;
};
/**
 * Canonical membership status rule:
 * - NONE: no membership number on record
 * - ACTIVE: membership number present AND now is on/before valid-until date (inclusive)
 * - EXPIRED: membership number present but valid-until is missing/invalid/past
 */
export declare function getCustomerMembershipStatus(input: MembershipStatusInput, now?: Date): CustomerMembershipStatus;
//# sourceMappingURL=membership.d.ts.map