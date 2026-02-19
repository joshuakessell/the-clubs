"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProviderIdFromEnv = getProviderIdFromEnv;
exports.createIntegrationProviders = createIntegrationProviders;
const mock_1 = require("./mock");
const squarePaymentsProvider_1 = require("./square/squarePaymentsProvider");
function getProviderIdFromEnv(env = process.env) {
    const raw = env.INTEGRATIONS_PROVIDER?.toLowerCase();
    if (!raw)
        return 'mock';
    if (raw === 'mock' || raw === 'square')
        return raw;
    throw new Error(`Unsupported INTEGRATIONS_PROVIDER: ${env.INTEGRATIONS_PROVIDER}`);
}
function createIntegrationProviders(providerId = getProviderIdFromEnv()) {
    if (providerId === 'mock') {
        const providers = (0, mock_1.createMockProviders)();
        return { providerId, ...providers };
    }
    if (providerId === 'square') {
        const providers = (0, mock_1.createMockProviders)();
        return {
            providerId,
            customers: providers.customers,
            orders: providers.orders,
            labor: providers.labor,
            payments: new squarePaymentsProvider_1.SquarePaymentsProvider(),
        };
    }
    throw new Error(`Unsupported INTEGRATIONS_PROVIDER: ${providerId}`);
}
