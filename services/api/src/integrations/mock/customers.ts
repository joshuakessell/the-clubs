import type {
  CustomersProvider,
  CustomerSearchResult,
  DomainCustomerDTO,
  ExternalRef,
} from '../contracts/providers';
import type { MockStore } from './fixtures';
import { getMetadataString, mergeMetadata } from './helpers';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function nextCustomerId(store: MockStore): string {
  const next = store.counters.customer;
  store.counters.customer += 1;
  return `mock-cust-${String(next).padStart(3, '0')}`;
}

export class MockCustomersProvider implements CustomersProvider {
  constructor(private readonly store: MockStore) {}

  async searchCustomers(query: string): Promise<CustomerSearchResult[]> {
    const normalized = normalize(query);
    if (!normalized) return [...this.store.customers];

    return this.store.customers.filter((customer) => {
      const haystack = [customer.displayName, customer.email ?? '', customer.phone ?? '']
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }

  async getCustomerByExternalId(externalId: string): Promise<CustomerSearchResult | null> {
    return this.store.customers.find((customer) => customer.externalId === externalId) ?? null;
  }

  async upsertCustomerMirror(domainCustomer: DomainCustomerDTO): Promise<ExternalRef | null> {
    const existing = this.store.customers.find((customer) => {
      return getMetadataString(customer.metadata, 'internalId') === domainCustomer.id;
    });

    if (existing) {
      existing.displayName = domainCustomer.name;
      if (domainCustomer.email !== undefined) existing.email = domainCustomer.email;
      if (domainCustomer.phone !== undefined) existing.phone = domainCustomer.phone;
      existing.metadata = mergeMetadata(existing.metadata, { internalId: domainCustomer.id });
      return { provider: 'mock', externalId: existing.externalId };
    }

    const created: CustomerSearchResult = {
      externalId: nextCustomerId(this.store),
      displayName: domainCustomer.name,
      email: domainCustomer.email ?? null,
      phone: domainCustomer.phone ?? null,
      metadata: mergeMetadata(domainCustomer.notes ? { notes: domainCustomer.notes } : null, {
        internalId: domainCustomer.id,
        source: 'mirror',
      }),
    };

    this.store.customers.push(created);
    return { provider: 'mock', externalId: created.externalId };
  }
}
