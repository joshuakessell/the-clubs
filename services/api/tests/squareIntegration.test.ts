import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSquarePOSOrder } from '../src/services/paymentService';
import { db } from '../src/db';

// Mock dependencies
vi.mock('../src/db', () => ({
  db: {
    transaction: vi.fn()
  }
}));
vi.mock('../src/services/squareSyncService', () => ({
  createSquareOrder: vi.fn().mockResolvedValue('mock-square-order-id'),
}));

describe('Square Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('paymentService - createSquarePOSOrder', () => {
    it('should throw HttpError 404 if no active session found', async () => {
      // Mock db.transaction
      vi.mocked(db.transaction).mockImplementation(async (cb) => {
        const mockTx = {
          execute: vi.fn().mockResolvedValue({ rows: [] })
        } as any;
        return cb(mockTx);
      });

      await expect(createSquarePOSOrder('fake-lane-id')).rejects.toThrow('No active session found');
    });

    it('should successfully build the square order with dynamic notes and catalog IDs', async () => {
      // Mock db.transaction
      vi.mocked(db.transaction).mockImplementation(async (cb) => {
        const mockTx = {
          execute: vi.fn()
          // First query: lane session
          .mockResolvedValueOnce({
            rows: [{
              id: 'session-123',
              order_id: 'order-123',
              customer_id: 'cust-123',
              assigned_resource_id: 'res-123',
              assigned_resource_type: 'locker'
            }]
          })
          // Second query: customer
          .mockResolvedValueOnce({
            rows: [{
              square_customer_id: 'sq-cust-123',
              name: 'John Doe',
              dob: '1990-01-01',
              membership_number: 'MEMB-999'
            }]
          })
          // Third query: resource
          .mockResolvedValueOnce({
            rows: [{ number: '42' }]
          })
          // Fourth query: line items
          .mockResolvedValueOnce({
            rows: [
               { name: 'Locker Rental', total: '2.00' },
               { name: 'Water Bottle', total: '1.50' }
            ]
          })
        } as any;
        
        return cb(mockTx);
      });

      const { createSquareOrder } = await import('../src/services/squareSyncService');
      const result = await createSquarePOSOrder('lane-1');

      expect(result).toEqual({ squareOrderId: 'mock-square-order-id', orderId: 'order-123' });
      
      expect(createSquareOrder).toHaveBeenCalledWith(expect.objectContaining({
        squareCustomerId: 'sq-cust-123',
        lineItems: [
          {
            name: 'Locker Rental',
            amountCents: 200,
            note: 'Customer Name: John Doe\nDOB: 01/01/1990\nLocker #: 42\nMember Number: MEMB-999',
            catalogObjectId: 'F3NEPKN5IY7GV2ZSWTTJFMQS'
          },
          {
            name: 'Water Bottle',
            amountCents: 150,
            note: undefined,
            catalogObjectId: undefined
          }
        ]
      }));
    });
  });
});
