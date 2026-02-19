"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockCustomersProvider = void 0;
const helpers_1 = require("./helpers");
function normalize(value) {
    return value.trim().toLowerCase();
}
function nextCustomerId(store) {
    const next = store.counters.customer;
    store.counters.customer += 1;
    return `mock-cust-${String(next).padStart(3, '0')}`;
}
class MockCustomersProvider {
    store;
    constructor(store) {
        this.store = store;
    }
    async searchCustomers(query) {
        const normalized = normalize(query);
        if (!normalized)
            return [...this.store.customers];
        return this.store.customers.filter((customer) => {
            const haystack = [customer.displayName, customer.email ?? '', customer.phone ?? '']
                .join(' ')
                .toLowerCase();
            return haystack.includes(normalized);
        });
    }
    async getCustomerByExternalId(externalId) {
        return this.store.customers.find((customer) => customer.externalId === externalId) ?? null;
    }
    async upsertCustomerMirror(domainCustomer) {
        const existing = this.store.customers.find((customer) => {
            return (0, helpers_1.getMetadataString)(customer.metadata, 'internalId') === domainCustomer.id;
        });
        if (existing) {
            existing.displayName = domainCustomer.name;
            if (domainCustomer.email !== undefined)
                existing.email = domainCustomer.email;
            if (domainCustomer.phone !== undefined)
                existing.phone = domainCustomer.phone;
            existing.metadata = (0, helpers_1.mergeMetadata)(existing.metadata, { internalId: domainCustomer.id });
            return { provider: 'mock', externalId: existing.externalId };
        }
        const created = {
            externalId: nextCustomerId(this.store),
            displayName: domainCustomer.name,
            email: domainCustomer.email ?? null,
            phone: domainCustomer.phone ?? null,
            metadata: (0, helpers_1.mergeMetadata)(domainCustomer.notes ? { notes: domainCustomer.notes } : null, {
                internalId: domainCustomer.id,
                source: 'mirror',
            }),
        };
        this.store.customers.push(created);
        return { provider: 'mock', externalId: created.externalId };
    }
}
exports.MockCustomersProvider = MockCustomersProvider;
