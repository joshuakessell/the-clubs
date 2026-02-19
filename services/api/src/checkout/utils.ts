export function calculateLateFee(lateMinutes: number): { feeAmount: number; banApplied: boolean } {
  if (lateMinutes < 30) {
    return { feeAmount: 0, banApplied: false };
  } else if (lateMinutes < 60) {
    return { feeAmount: 15, banApplied: false };
  } else if (lateMinutes < 90) {
    return { feeAmount: 30, banApplied: false };
  } else {
    // Ban is now approval-based; we still *flag* that the ban is recommended.
    return { feeAmount: 30, banApplied: true };
  }
}

export function looksLikeUuid(value: string): boolean {
  // Good enough for deciding whether to write staff_id; DB will still enforce UUID shape.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
