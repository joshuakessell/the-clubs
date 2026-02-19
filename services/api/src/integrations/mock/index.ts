import type {
  CustomersProvider,
  LaborProvider,
  OrdersProvider,
  PaymentsProvider,
} from '../contracts/providers';
import { MockCustomersProvider } from './customers';
import { createMockStore } from './fixtures';
import { MockLaborProvider } from './labor';
import { MockOrdersProvider } from './orders';
import { MockPaymentsProvider } from './payments';

export type MockProviders = {
  customers: CustomersProvider;
  payments: PaymentsProvider;
  orders: OrdersProvider;
  labor: LaborProvider;
};

export function createMockProviders(): MockProviders {
  const store = createMockStore();
  return {
    customers: new MockCustomersProvider(store),
    payments: new MockPaymentsProvider(store),
    orders: new MockOrdersProvider(store),
    labor: new MockLaborProvider(store),
  };
}

export { MockCustomersProvider } from './customers';
export { MockPaymentsProvider } from './payments';
export { MockOrdersProvider } from './orders';
export { MockLaborProvider } from './labor';
