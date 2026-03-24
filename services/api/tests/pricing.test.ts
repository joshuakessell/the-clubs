import { describe, it, expect } from 'vitest';
import { calculatePriceQuote, getUpgradeFee, type PricingInput } from '../src/pricing/engine.js';

describe('Pricing Engine', () => {
  describe('calculatePriceQuote', () => {
    describe('Locker pricing', () => {
      it('should charge $16 for non-youth locker during weekday discount window (Mon 8am-Fri 4pm)', () => {
        const input: PricingInput = {
          rentalType: 'LOCKER',
          customerAge: 25,
          checkInTime: new Date('2024-01-15T10:00:00'), // Monday 10am
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(1900);
        expect(quote.membershipFee).toBe(1300); // 25+ without membership
        expect(quote.total).toBe(3200);
      });

      it('should charge $19 for non-youth locker during weekday evening (Mon-Thu 4pm-8am)', () => {
        const input: PricingInput = {
          rentalType: 'LOCKER',
          customerAge: 25,
          checkInTime: new Date('2024-01-15T18:00:00'), // Monday 6pm
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(1900);
        expect(quote.membershipFee).toBe(1300);
        expect(quote.total).toBe(3200);
      });

      it('should charge $24 for non-youth locker on weekends', () => {
        const input: PricingInput = {
          rentalType: 'LOCKER',
          customerAge: 25,
          checkInTime: new Date('2024-01-13T12:00:00'), // Saturday noon
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(1900);
        expect(quote.membershipFee).toBe(1300);
        expect(quote.total).toBe(3200);
      });

      it('should charge $0 for youth locker during weekday discount window', () => {
        const input: PricingInput = {
          rentalType: 'LOCKER',
          customerAge: 20,
          checkInTime: new Date('2024-01-15T10:00:00'), // Monday 10am
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(0);
        expect(quote.membershipFee).toBe(0); // Youth doesn't pay membership
        expect(quote.total).toBe(0);
      });

      it('should charge $7 for youth locker outside weekday discount window', () => {
        const input: PricingInput = {
          rentalType: 'LOCKER',
          customerAge: 20,
          checkInTime: new Date('2024-01-13T12:00:00'), // Saturday noon
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(0);
        expect(quote.membershipFee).toBe(0);
        expect(quote.total).toBe(0);
      });

      it('should charge $0 for gym locker (always free)', () => {
        const input: PricingInput = {
          rentalType: 'GYM_LOCKER',
          customerAge: 25,
          checkInTime: new Date('2024-01-13T12:00:00'), // Saturday noon
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(0);
        expect(quote.membershipFee).toBe(1300);
        expect(quote.total).toBe(1300);
      });
    });

    describe('Room pricing', () => {
      it('should charge $30 for standard room outside discount window', () => {
        const input: PricingInput = {
          rentalType: 'STANDARD',
          customerAge: 25,
          checkInTime: new Date('2024-01-13T12:00:00'), // Saturday noon
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(3000);
        expect(quote.membershipFee).toBe(1300);
        expect(quote.total).toBe(4300);
      });

      it('should charge $27 for standard room during weekday discount window', () => {
        const input: PricingInput = {
          rentalType: 'STANDARD',
          customerAge: 25,
          checkInTime: new Date('2024-01-15T10:00:00'), // Monday 10am
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(3000);
        expect(quote.membershipFee).toBe(1300);
        expect(quote.total).toBe(4300);
      });

      it('should charge $40 for double room outside discount window', () => {
        const input: PricingInput = {
          rentalType: 'DOUBLE',
          customerAge: 25,
          checkInTime: new Date('2024-01-13T12:00:00'), // Saturday noon
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(4000);
        expect(quote.membershipFee).toBe(1300);
        expect(quote.total).toBe(5300);
      });

      it('should charge $37 for double room during weekday discount window', () => {
        const input: PricingInput = {
          rentalType: 'DOUBLE',
          customerAge: 25,
          checkInTime: new Date('2024-01-15T10:00:00'), // Monday 10am
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(4000);
        expect(quote.membershipFee).toBe(1300);
        expect(quote.total).toBe(5300);
      });

      it('should charge $50 for special room outside discount window', () => {
        const input: PricingInput = {
          rentalType: 'SPECIAL',
          customerAge: 25,
          checkInTime: new Date('2024-01-13T12:00:00'), // Saturday noon
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(5000);
        expect(quote.membershipFee).toBe(1300);
        expect(quote.total).toBe(6300);
      });

      it('should charge $47 for special room during weekday discount window', () => {
        const input: PricingInput = {
          rentalType: 'SPECIAL',
          customerAge: 25,
          checkInTime: new Date('2024-01-15T10:00:00'), // Monday 10am
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(5000);
        expect(quote.membershipFee).toBe(1300);
        expect(quote.total).toBe(6300);
      });

      it('should charge $30 for youth standard room any day', () => {
        const input: PricingInput = {
          rentalType: 'STANDARD',
          customerAge: 20,
          checkInTime: new Date('2024-01-13T12:00:00'), // Saturday noon
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(3000);
        expect(quote.membershipFee).toBe(0);
        expect(quote.total).toBe(3000);
      });

      it('should charge $50 for youth double or special room any day', () => {
        const input: PricingInput = {
          rentalType: 'DOUBLE',
          customerAge: 20,
          checkInTime: new Date('2024-01-13T12:00:00'), // Saturday noon
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(4000);
        expect(quote.membershipFee).toBe(0);
        expect(quote.total).toBe(4000);
      });
    });

    describe('Membership fee', () => {
      it('should charge $13 for 25+ without valid 6-month membership', () => {
        const input: PricingInput = {
          rentalType: 'LOCKER',
          customerAge: 25,
          checkInTime: new Date('2024-01-15T10:00:00'),
          membershipCardType: 'NONE',
        };
        const quote = calculatePriceQuote(input);
        expect(quote.membershipFee).toBe(1300);
      });

      it('should charge $0 for 25+ with valid 6-month membership', () => {
        const checkInTime = new Date('2024-01-15T10:00:00');
        const futureDate = new Date(checkInTime);
        futureDate.setMonth(futureDate.getMonth() + 3);
        const input: PricingInput = {
          rentalType: 'LOCKER',
          customerAge: 25,
          checkInTime,
          membershipCardType: 'SIX_MONTH',
          membershipValidUntil: futureDate,
        };
        const quote = calculatePriceQuote(input);
        expect(quote.membershipFee).toBe(0);
      });

      it('should charge $13 for 25+ with expired 6-month membership', () => {
        const checkInTime = new Date('2024-01-15T10:00:00');
        const pastDate = new Date(checkInTime);
        pastDate.setMonth(pastDate.getMonth() - 1);
        const input: PricingInput = {
          rentalType: 'LOCKER',
          customerAge: 25,
          checkInTime,
          membershipCardType: 'SIX_MONTH',
          membershipValidUntil: pastDate,
        };
        const quote = calculatePriceQuote(input);
        expect(quote.membershipFee).toBe(1300);
      });

      it('should charge $0 for youth (under 25)', () => {
        const input: PricingInput = {
          rentalType: 'LOCKER',
          customerAge: 24,
          checkInTime: new Date('2024-01-15T10:00:00'),
        };
        const quote = calculatePriceQuote(input);
        expect(quote.membershipFee).toBe(0);
      });
    });

    describe('Boundary conditions', () => {
      it('should handle Monday 8am (start of discount window)', () => {
        const input: PricingInput = {
          rentalType: 'STANDARD',
          customerAge: 25,
          checkInTime: new Date('2024-01-15T08:00:00'), // Monday 8am
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(3000); // Discount applies
      });

      it('should handle Friday 4pm (end of discount window)', () => {
        const input: PricingInput = {
          rentalType: 'STANDARD',
          customerAge: 25,
          checkInTime: new Date('2024-01-19T16:00:00'), // Friday 4pm
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(3000); // Discount applies (4pm is still in window)
      });

      it('should handle Friday 4:01pm (outside discount window)', () => {
        const input: PricingInput = {
          rentalType: 'STANDARD',
          customerAge: 25,
          checkInTime: new Date('2024-01-19T16:01:00'), // Friday 4:01pm
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(3000); // No discount
      });

      it('should handle age 18 (youth boundary)', () => {
        const input: PricingInput = {
          rentalType: 'LOCKER',
          customerAge: 18,
          checkInTime: new Date('2024-01-15T10:00:00'),
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(0); // Youth pricing
        expect(quote.membershipFee).toBe(0);
      });

      it('should handle age 24 (youth boundary)', () => {
        const input: PricingInput = {
          rentalType: 'LOCKER',
          customerAge: 24,
          checkInTime: new Date('2024-01-15T10:00:00'),
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(0); // Youth pricing
        expect(quote.membershipFee).toBe(0);
      });

      it('should handle age 25 (non-youth boundary)', () => {
        const input: PricingInput = {
          rentalType: 'LOCKER',
          customerAge: 25,
          checkInTime: new Date('2024-01-15T10:00:00'),
        };
        const quote = calculatePriceQuote(input);
        expect(quote.rentalFee).toBe(1900); // Non-youth pricing
        expect(quote.membershipFee).toBe(1300);
      });
    });
  });

  describe('getUpgradeFee', () => {
    it('should return $8 for Locker -> Standard upgrade', () => {
      expect(getUpgradeFee('LOCKER', 'STANDARD')).toBe(800);
    });

    it('should return $17 for Locker -> Double upgrade', () => {
      expect(getUpgradeFee('LOCKER', 'DOUBLE')).toBe(1700);
    });

    it('should return $27 for Locker -> Special upgrade', () => {
      expect(getUpgradeFee('LOCKER', 'SPECIAL')).toBe(2700);
    });

    it('should return $9 for Standard -> Double upgrade', () => {
      expect(getUpgradeFee('STANDARD', 'DOUBLE')).toBe(900);
    });

    it('should return $19 for Standard -> Special upgrade', () => {
      expect(getUpgradeFee('STANDARD', 'SPECIAL')).toBe(1900);
    });

    it('should return $9 for Double -> Special upgrade', () => {
      expect(getUpgradeFee('DOUBLE', 'SPECIAL')).toBe(900);
    });

    it('should return null for invalid upgrade paths', () => {
      expect(getUpgradeFee('STANDARD', 'LOCKER')).toBeNull();
      expect(getUpgradeFee('DOUBLE', 'STANDARD')).toBeNull();
      expect(getUpgradeFee('SPECIAL', 'DOUBLE')).toBeNull();
    });
  });
});
