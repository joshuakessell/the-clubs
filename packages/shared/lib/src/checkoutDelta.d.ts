export type CheckoutDeltaStatus = 'remaining' | 'late';
export type CheckoutDelta = {
    status: CheckoutDeltaStatus;
    /**
     * Absolute minutes, rounded DOWN to the nearest 15 minutes for display.
     */
    minutesRoundedDownTo15: number;
    hours: number;
    minutes: number;
};
/**
 * Compute the display delta between `now` and an expected checkout time.
 *
 * Rules:
 * - Compute delta between now and expected.
 * - Round DOWN to nearest 15 minutes for display.
 * - Do NOT mutate the expected time (this returns only a display delta).
 */
export declare function computeCheckoutDelta(now: Date, expectedCheckoutAt: Date): CheckoutDelta;
export declare function formatCheckoutDelta(delta: CheckoutDelta): string;
//# sourceMappingURL=checkoutDelta.d.ts.map