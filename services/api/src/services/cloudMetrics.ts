/**
 * Cloud Metrics Publisher (stub)
 *
 * Previously published to AWS CloudWatch. AWS services were torn down 2026-02-18.
 * All calls are now no-ops. The interface is preserved so callers don't break.
 *
 * To re-enable: install @aws-sdk/client-cloudwatch and restore the CloudWatch client.
 */

type StandardUnit = 'Count' | 'None' | 'Percent';

/**
 * Publish a single metric data point.
 * Currently a no-op — AWS CloudWatch removed.
 */
export async function publishMetric(
  _metricName: string,
  _value: number,
  _unit: StandardUnit = 'Count',
  _dimensions?: Record<string, string>
): Promise<void> {
  // no-op
}

/**
 * Publish multiple metric data points in a single call.
 * Currently a no-op — AWS CloudWatch removed.
 */
export async function publishMetrics(
  _metrics: {
    name: string;
    value: number;
    unit?: StandardUnit;
    dimensions?: Record<string, string>;
  }[]
): Promise<void> {
  // no-op
}

// ── Convenience helpers for common business events ──

export const BusinessMetrics = {
  checkIn: (_registerId?: string) => publishMetric('CheckInCount', 1),
  checkOut: () => publishMetric('CheckOutCount', 1),
  payment: (_amountCents: number, _method: string) => publishMetrics([]),
  override: (_action: string) => publishMetric('OverrideCount', 1),
  occupancy: (_occupied: number, _total: number) => publishMetric('OccupancyRate', 0),
  clockIn: () => publishMetric('StaffClockInCount', 1),
  apiError: (_endpoint: string) => publishMetric('ApiErrorCount', 1),
};
