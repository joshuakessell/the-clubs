"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateLateFee = calculateLateFee;
exports.looksLikeUuid = looksLikeUuid;
function calculateLateFee(lateMinutes) {
    if (lateMinutes < 30) {
        return { feeAmount: 0, banApplied: false };
    }
    else if (lateMinutes < 60) {
        return { feeAmount: 15, banApplied: false };
    }
    else if (lateMinutes < 90) {
        return { feeAmount: 30, banApplied: false };
    }
    else {
        // Ban is now approval-based; we still *flag* that the ban is recommended.
        return { feeAmount: 30, banApplied: true };
    }
}
function looksLikeUuid(value) {
    // Good enough for deciding whether to write staff_id; DB will still enforce UUID shape.
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
