import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    buildSearchBlob,
    insertCustomerActivityEvent,
    type InsertCustomerActivityEventInput,
} from '../../src/activity/customerActivityLog';
import type pg from 'pg';

describe('customerActivityLog', () => {
    describe('buildSearchBlob', () => {
        it('should include summary', () => {
            const input: InsertCustomerActivityEventInput = {
                customerId: '123',
                actionType: 'TEST',
                actionCategory: 'TEST',
                sourceApp: 'SYSTEM',
                actorType: 'SYSTEM',
                summary: 'Test Summary',
            };
            expect(buildSearchBlob(input)).toContain('Test Summary');
        });

        it('should include actorStaffName if present', () => {
            const input: InsertCustomerActivityEventInput = {
                customerId: '123',
                actionType: 'TEST',
                actionCategory: 'TEST',
                sourceApp: 'SYSTEM',
                actorType: 'STAFF',
                summary: 'Test Summary',
                actorStaffName: 'John Doe',
            };
            expect(buildSearchBlob(input)).toContain('John Doe');
        });

        it('should include known metadata keys', () => {
            const input: InsertCustomerActivityEventInput = {
                customerId: '123',
                actionType: 'TEST',
                actionCategory: 'TEST',
                sourceApp: 'SYSTEM',
                actorType: 'SYSTEM',
                summary: 'Test Summary',
                metadata: {
                    visitId: 'visit-123',
                    laneId: 'lane-456',
                    unknownKey: 'should-not-be-included',
                },
            };
            const blob = buildSearchBlob(input);
            expect(blob).toContain('visit-123');
            expect(blob).toContain('lane-456');
            expect(blob).not.toContain('should-not-be-included');
        });

        it('should include explicit search parts', () => {
            const input: InsertCustomerActivityEventInput = {
                customerId: '123',
                actionType: 'TEST',
                actionCategory: 'TEST',
                sourceApp: 'SYSTEM',
                actorType: 'SYSTEM',
                summary: 'Test Summary',
                searchParts: ['custom-part', 'another-part'],
            };
            const blob = buildSearchBlob(input);
            expect(blob).toContain('custom-part');
            expect(blob).toContain('another-part');
        });

        it('should combine all parts with single spaces', () => {
            const input: InsertCustomerActivityEventInput = {
                customerId: '123',
                actionType: 'TEST',
                actionCategory: 'TEST',
                sourceApp: 'SYSTEM',
                actorType: 'STAFF',
                summary: '  Test   Summary  ',
                actorStaffName: ' John ',
                metadata: { visitId: ' v1 ' },
                searchParts: [' p1 '],
            };
            // "Test Summary John p1 v1"
            // Note: implementation order matters. summary -> actor -> searchParts -> metadata
            const blob = buildSearchBlob(input);
            expect(blob).toContain('Test Summary');
            expect(blob).toContain('John');
            expect(blob.split(' ').filter(Boolean)).toEqual(
                expect.arrayContaining(['Test', 'Summary', 'John', 'p1', 'v1'])
            );
        });
    });

    describe('insertCustomerActivityEvent', () => {
        // Partial mock of pg.PoolClient
        const mockQuery = vi.fn();
        const mockClient = {
            query: mockQuery,
        } as unknown as pg.PoolClient;

        beforeEach(() => {
            vi.resetAllMocks();
        });

        it('should return new id when insert succeeds', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [{ id: 'new-id' }] });

            const input: InsertCustomerActivityEventInput = {
                customerId: '123',
                actionType: 'TEST',
                actionCategory: 'TEST',
                sourceApp: 'SYSTEM',
                actorType: 'SYSTEM',
                summary: 'Test',
            };

            const result = await insertCustomerActivityEvent(mockClient, input);
            expect(result).toEqual({ id: 'new-id', deduped: false });
            expect(mockQuery).toHaveBeenCalledTimes(1);
            // Verify SQL contains ON CONFLICT
            expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT (dedupe_key)');
            // Ensure ON CONFLICT clause matches implementation
            expect(mockQuery.mock.calls[0][0]).toContain('WHERE dedupe_key IS NOT NULL');
            expect(mockQuery.mock.calls[0][0]).toContain('DO NOTHING');
        });

        it('should return existing id when insert is deduplicated', async () => {
            // First query (INSERT) returns empty rows (conflict)
            mockQuery.mockResolvedValueOnce({ rows: [] });
            // Second query (SELECT) returns existing id
            mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] });

            const input: InsertCustomerActivityEventInput = {
                customerId: '123',
                actionType: 'TEST',
                actionCategory: 'TEST',
                sourceApp: 'SYSTEM',
                actorType: 'SYSTEM',
                summary: 'Test',
                dedupeKey: 'unique-key',
            };

            const result = await insertCustomerActivityEvent(mockClient, input);
            expect(result).toEqual({ id: 'existing-id', deduped: true });
            expect(mockQuery).toHaveBeenCalledTimes(2);
            expect(mockQuery.mock.calls[1][0]).toContain('SELECT id FROM customer_activity_events WHERE dedupe_key');
        });

        it('should throw error if dedupeKey is missing but insert returns no rows', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] });

            const input: InsertCustomerActivityEventInput = {
                customerId: '123',
                actionType: 'TEST',
                actionCategory: 'TEST',
                sourceApp: 'SYSTEM',
                actorType: 'SYSTEM',
                summary: 'Test',
                // No dedupeKey
            };

            await expect(insertCustomerActivityEvent(mockClient, input)).rejects.toThrow(
                'Failed to insert customer activity event'
            );
        });

        it('should throw error if deduped but existing row not found', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] }); // Insert skipped
            mockQuery.mockResolvedValueOnce({ rows: [] }); // Select found nothing (race condition?)

            const input: InsertCustomerActivityEventInput = {
                customerId: '123',
                actionType: 'TEST',
                actionCategory: 'TEST',
                sourceApp: 'SYSTEM',
                actorType: 'SYSTEM',
                summary: 'Test',
                dedupeKey: 'key',
            };

            await expect(insertCustomerActivityEvent(mockClient, input)).rejects.toThrow(
                'Customer activity event insert deduped but row not found'
            );
        });
    });
});
