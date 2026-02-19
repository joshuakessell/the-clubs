import type { ProviderId } from './contracts/capabilities';
import type {
  CustomersProvider,
  LaborProvider,
  OrdersProvider,
  PaymentsProvider,
} from './contracts/providers';
import { createMockProviders } from './mock';
import { SquarePaymentsProvider } from './square/squarePaymentsProvider';

export type IntegrationProviders = {
  providerId: ProviderId;
  customers: CustomersProvider;
  payments: PaymentsProvider;
  orders: OrdersProvider;
  labor: LaborProvider;
};

export function getProviderIdFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderId {
  const raw = env.INTEGRATIONS_PROVIDER?.toLowerCase();
  if (!raw) return 'mock';
  if (raw === 'mock' || raw === 'square') return raw;
  throw new Error(`Unsupported INTEGRATIONS_PROVIDER: ${env.INTEGRATIONS_PROVIDER}`);
}

export function createIntegrationProviders(
  providerId = getProviderIdFromEnv()
): IntegrationProviders {
  if (providerId === 'mock') {
    const providers = createMockProviders();
    return { providerId, ...providers };
  }
  if (providerId === 'square') {
    const providers = createMockProviders();
    return {
      providerId,
      customers: providers.customers,
      orders: providers.orders,
      labor: providers.labor,
      payments: new SquarePaymentsProvider(),
    };
  }

  throw new Error(`Unsupported INTEGRATIONS_PROVIDER: ${providerId}`);
}
