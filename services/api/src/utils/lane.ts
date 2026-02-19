import { z } from 'zod';

/**
 * Canonical lane id format used across kiosk/register apps: "lane-1", "lane-2", ...
 *
 * Notes:
 * - We intentionally avoid enforcing an upper bound here; deployments may have varying lane counts.
 * - This is NOT an authorization check. It's input validation to prevent arbitrary strings.
 */
export const LaneIdSchema = z
  .string()
  .trim()
  .regex(/^lane-[1-9]\d*$/, { message: 'Invalid laneId (expected format lane-<number>)' });

export function parseLaneIdOptional(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = LaneIdSchema.safeParse(trimmed);
  return parsed.success ? parsed.data : undefined;
}
