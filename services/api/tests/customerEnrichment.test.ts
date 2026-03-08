import { describe, it, expect } from 'vitest';
import { enrichCustomerIdentity, type EnrichmentFields } from '../src/domain/customerEnrichment';

function makeMockClient() {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  return {
    client: {
      async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
        calls.push({ text, params: params ?? [] });
        return { rows: [] };
      },
    },
    calls,
  };
}

describe('enrichCustomerIdentity', () => {
  it('no-ops when all fields are empty', async () => {
    const { client, calls } = makeMockClient();
    await enrichCustomerIdentity(client, 'cust-1', {});
    expect(calls).toHaveLength(0);
  });

  it('no-ops when all fields are null', async () => {
    const { client, calls } = makeMockClient();
    await enrichCustomerIdentity(client, 'cust-1', {
      idExpirationDate: null,
      idNumber: null,
      idState: null,
      idType: null,
      idTypeOther: null,
    });
    expect(calls).toHaveLength(0);
  });

  it('calls query when at least one field is provided', async () => {
    const { client, calls } = makeMockClient();
    await enrichCustomerIdentity(client, 'cust-1', { idNumber: 'DL123' });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('UPDATE customers');
  });

  it('passes customerId as last parameter', async () => {
    const { client, calls } = makeMockClient();
    await enrichCustomerIdentity(client, 'cust-42', { idState: 'NY' });
    expect(calls[0].params[5]).toBe('cust-42');
  });

  it('passes all fields in correct order', async () => {
    const { client, calls } = makeMockClient();
    const fields: EnrichmentFields = {
      idExpirationDate: '2025-12-31',
      idNumber: 'DL456',
      idState: 'CA',
      idType: 'DRIVERS_LICENSE',
      idTypeOther: null,
    };
    await enrichCustomerIdentity(client, 'cust-1', fields);
    expect(calls[0].params[0]).toBe('2025-12-31');
    expect(calls[0].params[1]).toBe('DL456');
    expect(calls[0].params[2]).toBe('CA');
    expect(calls[0].params[3]).toBe('DRIVERS_LICENSE');
    expect(calls[0].params[4]).toBeNull();
    expect(calls[0].params[5]).toBe('cust-1');
  });
});
