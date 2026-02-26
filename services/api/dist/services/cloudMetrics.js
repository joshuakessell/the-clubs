"use strict";
/**
 * Cloud Metrics Publisher (stub)
 *
 * Previously published to AWS CloudWatch. AWS services were torn down 2026-02-18.
 * All calls are now no-ops. The interface is preserved so callers don't break.
 *
 * To re-enable: install @aws-sdk/client-cloudwatch and restore the CloudWatch client.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessMetrics = void 0;
exports.publishMetric = publishMetric;
exports.publishMetrics = publishMetrics;
/**
 * Publish a single metric data point.
 * Currently a no-op — AWS CloudWatch removed.
 */
async function publishMetric(_metricName, _value, _unit = 'Count', _dimensions) {
    // no-op
}
/**
 * Publish multiple metric data points in a single call.
 * Currently a no-op — AWS CloudWatch removed.
 */
async function publishMetrics(_metrics) {
    // no-op
}
// ── Convenience helpers for common business events ──
exports.BusinessMetrics = {
    checkIn: (_registerId) => publishMetric('CheckInCount', 1),
    checkOut: () => publishMetric('CheckOutCount', 1),
    payment: (_amountCents, _method) => publishMetrics([]),
    override: (_action) => publishMetric('OverrideCount', 1),
    occupancy: (_occupied, _total) => publishMetric('OccupancyRate', 0),
    clockIn: () => publishMetric('StaffClockInCount', 1),
    apiError: (_endpoint) => publishMetric('ApiErrorCount', 1),
};
