import type { CheckinBlockRow } from './types';

export function calculateTotalHours(blocks: CheckinBlockRow[]): number {
  return blocks.reduce((sum, block) => {
    const hours = (block.ends_at.getTime() - block.starts_at.getTime()) / (1000 * 60 * 60);
    return sum + hours;
  }, 0);
}

export function calculateTotalHoursWithExtension(
  blocks: CheckinBlockRow[],
  extensionHours: number
): number {
  return calculateTotalHours(blocks) + extensionHours;
}

export function getLatestBlockEnd(blocks: CheckinBlockRow[]): Date | null {
  if (blocks.length === 0) return null;
  return blocks.reduce<Date | null>((latest, block) => {
    if (!latest || block.ends_at > latest) return block.ends_at;
    return latest;
  }, null);
}
