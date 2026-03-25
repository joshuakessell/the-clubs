import { describe, it, expect } from 'vitest';
import { enrichCustomerIdentity, type EnrichmentFields } from '../src/domain/customerEnrichment';
import type { DrizzleTx } from '../src/db';

function makeMockClient() {
  let updateCalled = false;
  let setArguments: unknown = null;
  let whereArguments: unknown = null;

  const mockTx = {
    update: (table: unknown) => {
      updateCalled = true;
      return {
        set: (setArgs: unknown) => {
          setArguments = setArgs;
          return {
            where: async (whereArgs: unknown) => {
              whereArguments = whereArgs;
              return [];
            }
          };
        }
      };
    }
  } as unknown as DrizzleTx;

  return {
    client: mockTx,
    isUpdateCalled: () => updateCalled,
    getSetArguments: () => setArguments,
    getWhereArguments: () => whereArguments,
  };
}

describe('enrichCustomerIdentity', () => {
  it('no-ops when all fields are empty', async () => {
    const { client, isUpdateCalled } = makeMockClient();
    await enrichCustomerIdentity(client, 'cust-1', {});
    expect(isUpdateCalled()).toBe(false);
  });

  it('no-ops when all fields are null', async () => {
    const { client, isUpdateCalled } = makeMockClient();
    await enrichCustomerIdentity(client, 'cust-1', {
      idExpirationDate: null,
      idNumber: null,
      idState: null,
      idType: null,
      idTypeOther: null,
    });
    expect(isUpdateCalled()).toBe(false);
  });

  it('calls update when at least one field is provided', async () => {
    const { client, isUpdateCalled, getSetArguments } = makeMockClient();
    await enrichCustomerIdentity(client, 'cust-1', { idNumber: 'DL123' });
    expect(isUpdateCalled()).toBe(true);
    expect(getSetArguments()).not.toBeNull();
  });

  it('calls update with customerId parameter', async () => {
    const { client, isUpdateCalled, getWhereArguments } = makeMockClient();
    await enrichCustomerIdentity(client, 'cust-42', { idState: 'NY' });
    expect(isUpdateCalled()).toBe(true);
    expect(getWhereArguments()).not.toBeNull();
  });

  it('calls update with all enrichment fields', async () => {
    const { client, isUpdateCalled, getSetArguments } = makeMockClient();
    const fields: EnrichmentFields = {
      idExpirationDate: '2025-12-31',
      idNumber: 'DL456',
      idState: 'CA',
      idType: 'DRIVERS_LICENSE',
      idTypeOther: null,
    };
    await enrichCustomerIdentity(client, 'cust-1', fields);
    expect(isUpdateCalled()).toBe(true);
    expect(getSetArguments()).not.toBeNull();
  });
});
