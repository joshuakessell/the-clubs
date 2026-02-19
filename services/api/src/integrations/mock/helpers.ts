import type { DateRange } from '../contracts/providers';

export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function isWithinRange(value: Date | string, range: DateRange): boolean {
  const target = toDate(value).getTime();
  const from = toDate(range.from).getTime();
  const to = toDate(range.to).getTime();
  return target >= from && target <= to;
}

export function overlapsRange(
  start: Date | string,
  end: Date | string | null | undefined,
  range: DateRange
): boolean {
  const startTime = toDate(start).getTime();
  const endTime = end ? toDate(end).getTime() : startTime;
  const from = toDate(range.from).getTime();
  const to = toDate(range.to).getTime();
  return startTime <= to && endTime >= from;
}

export function getMetadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string
): string | undefined {
  if (!metadata) return undefined;
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
}

export function getMetadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string
): number | undefined {
  if (!metadata) return undefined;
  const value = metadata[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export function mergeMetadata(
  metadata: Record<string, unknown> | null | undefined,
  extra: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!metadata && !extra) return null;
  return {
    ...(metadata ?? {}),
    ...(extra ?? {}),
  };
}
