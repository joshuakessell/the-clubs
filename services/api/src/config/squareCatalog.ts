import mappingJson from './square-catalog-mapping.json';

/**
 * Provides strongly typed access to the Square Catalog Item Variations 
 * created by the services/api/scripts/seed-square-catalog.cjs script.
 */
export const SquareCatalogMap: Record<string, string> = mappingJson;

/**
 * Helper to match an internal database line item name to a Square Catalog object ID.
 * Falls back to undefined if no exact match is found.
 */
export function getCatalogIdForLineItem(name: string): string | undefined {
  const matchers = [
    { rules: ['Renewal (2 Hours)'], target: 'Renewal - 2 Hours' },
    { rules: ['Renewal (6 Hours)'], target: 'Renewal - 6 Hours' },
    { rules: ['One Time Membership', 'Check-in fee'], target: 'One Time Membership' },
    { rules: ['6-Month Membership'], target: '6 Month Membership' },
    { rules: ['Youth', 'Double Room'], target: 'Youth Double Room', requiresAll: true },
    { rules: ['Youth', 'Room'], target: 'Youth Room', requiresAll: true },
    { rules: ['Youth', 'Locker'], target: 'Youth Locker', requiresAll: true },
    { rules: ['Double Room'], target: 'Double Room' },
    { rules: ['Special Room'], target: 'Special Room' },
    { rules: ['Room'], target: 'Room' },
    { rules: ['Gym Locker'], target: 'Gym Locker' },
    { rules: ['Locker'], target: 'Locker' },
    { rules: ['30 Min'], target: 'Late Fee - 30 Min' },
    { rules: ['60 Min'], target: 'Late Fee - 60 Min' },
    { rules: ['90 Min'], target: 'Late Fee - 90 Min' },
    { rules: ['Lost Key'], target: 'Lost Key Fee' }
  ];

  for (const match of matchers) {
    const hits = match.rules.filter(r => name.includes(r));
    if (match.requiresAll) {
      if (hits.length === match.rules.length) return SquareCatalogMap[match.target];
    } else if (hits.length > 0) {
      return SquareCatalogMap[match.target];
    }
  }

  return undefined;
}
