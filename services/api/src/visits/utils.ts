import type { CheckinBlockRow } from './types';

type BlockTimeRange = Pick<CheckinBlockRow, 'starts_at' | 'ends_at'>;

export function calculateTotalHours(blocks: BlockTimeRange[]): number {
  return blocks.reduce((sum, block) => {
    const hours = (new Date(block.ends_at).getTime() - new Date(block.starts_at).getTime()) / (1000 * 60 * 60);
    return sum + hours;
  }, 0);
}

export function calculateTotalHoursWithExtension(
  blocks: BlockTimeRange[],
  extensionHours: number
): number {
  return calculateTotalHours(blocks) + extensionHours;
}

export function getLatestBlockEnd(blocks: BlockTimeRange[]): Date | null {
  if (blocks.length === 0) return null;
  return blocks.reduce<Date | null>((latest, block) => {
    if (!latest || block.ends_at > latest) return block.ends_at;
    return latest;
  }, null);
}
