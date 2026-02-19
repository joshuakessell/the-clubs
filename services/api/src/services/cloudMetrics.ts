/**
 * CloudWatch Custom Metrics Publisher
 *
 * Publishes key business metrics to CloudWatch for monitoring and alerting.
 * Only active when `AWS_REGION` is set (deployed environments).
 * In local dev, all calls are no-ops.
 *
 * Usage:
 *   import { publishMetric } from './cloudMetrics';
 *   await publishMetric('CheckInCount', 1, 'Count');
 */

import {
  CloudWatchClient,
  PutMetricDataCommand,
  type StandardUnit,
} from '@aws-sdk/client-cloudwatch';

const NAMESPACE = 'ClubOperations';

// let client: CloudWatchClient | null = null; // AWS deprecated

// DEPRECATED: AWS services torn down 2026-02-18. Always returns null.
// To re-enable: remove the early return and set AWS_REGION env var.
// See docs/AWS_ARCHITECTURE_REFERENCE.md.
function getClient(): CloudWatchClient | null {
  return null; // AWS deprecated
  // if (!process.env.AWS_REGION) return null;
  // if (!client) {
  //   client = new CloudWatchClient({ region: process.env.AWS_REGION });
  // }
  // return client;
}

/**
 * Publish a single metric data point to CloudWatch.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function publishMetric(
  metricName: string,
  value: number,
  unit: StandardUnit = 'Count',
  dimensions?: Record<string, string>
): Promise<void> {
  const cw = getClient();
  if (!cw) return;

  try {
    const dimensionEntries = dimensions
      ? Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value }))
      : [];

    await cw.send(
      new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: [
          {
            MetricName: metricName,
            Value: value,
            Unit: unit,
            Timestamp: new Date(),
            Dimensions: dimensionEntries.length > 0 ? dimensionEntries : undefined,
          },
        ],
      })
    );
  } catch (error) {
    // Non-blocking — never break business logic for metrics
    console.warn(`[CloudWatch] Failed to publish ${metricName}:`, error);
  }
}

/**
 * Publish multiple metric data points in a single API call (batched).
 * CloudWatch supports up to 1000 metric data points per request.
 */
export async function publishMetrics(
  metrics: {
    name: string;
    value: number;
    unit?: StandardUnit;
    dimensions?: Record<string, string>;
  }[]
): Promise<void> {
  const cw = getClient();
  if (!cw || metrics.length === 0) return;

  try {
    // Batch in groups of 1000 (CloudWatch limit)
    for (let i = 0; i < metrics.length; i += 1000) {
      const batch = metrics.slice(i, i + 1000);
      await cw.send(
        new PutMetricDataCommand({
          Namespace: NAMESPACE,
          MetricData: batch.map((m) => ({
            MetricName: m.name,
            Value: m.value,
            Unit: m.unit ?? 'Count',
            Timestamp: new Date(),
            Dimensions: m.dimensions
              ? Object.entries(m.dimensions).map(([Name, Value]) => ({ Name, Value }))
              : undefined,
          })),
        })
      );
    }
  } catch (error) {
    console.warn('[CloudWatch] Failed to publish batch metrics:', error);
  }
}

// ── Convenience helpers for common business events ──

export const BusinessMetrics = {
  /** Customer checked in */
  checkIn: (registerId?: string) =>
    publishMetric('CheckInCount', 1, 'Count', registerId ? { RegisterId: registerId } : undefined),

  /** Customer checked out */
  checkOut: () => publishMetric('CheckOutCount', 1, 'Count'),

  /** Payment completed */
  payment: (amountCents: number, method: string) =>
    publishMetrics([
      { name: 'PaymentCount', value: 1, unit: 'Count', dimensions: { PaymentMethod: method } },
      { name: 'RevenueAmount', value: amountCents / 100, unit: 'None', dimensions: { PaymentMethod: method } },
    ]),

  /** Override action taken */
  override: (action: string) =>
    publishMetric('OverrideCount', 1, 'Count', { Action: action }),

  /** Room occupancy snapshot */
  occupancy: (occupied: number, total: number) =>
    publishMetric('OccupancyRate', total > 0 ? (occupied / total) * 100 : 0, 'Percent'),

  /** Staff clock-in */
  clockIn: () => publishMetric('StaffClockInCount', 1, 'Count'),

  /** API error occurred */
  apiError: (endpoint: string) =>
    publishMetric('ApiErrorCount', 1, 'Count', { Endpoint: endpoint }),
};
