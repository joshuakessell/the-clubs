"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SquarePaymentsProvider = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("../../db");
const squareClient_1 = require("./squareClient");
const squareLogger_1 = require("./squareLogger");
const squarePaymentMapper_1 = require("./squarePaymentMapper");
function buildIdempotencyKey(params, internalPaymentId) {
    if (internalPaymentId) {
        return `pay_${internalPaymentId}`.slice(0, 45);
    }
    if (params.orderExternalId) {
        return `order_${params.orderExternalId}`.slice(0, 45);
    }
    if (params.metadata && typeof params.metadata['idempotencyKey'] === 'string') {
        return String(params.metadata['idempotencyKey']).slice(0, 45);
    }
    const hash = node_crypto_1.default
        .createHash('sha256')
        .update(JSON.stringify({
        amount: params.amount,
        orderExternalId: params.orderExternalId ?? null,
        customerExternalId: params.customerExternalId ?? null,
        internalPaymentId: internalPaymentId ?? null,
    }))
        .digest('hex')
        .slice(0, 32);
    return `pay_${hash}`;
}
function extractSquareErrorCodes(error) {
    if (!error || typeof error !== 'object')
        return [];
    const err = error;
    if (!Array.isArray(err.errors))
        return [];
    return err.errors
        .map((e) => e?.code || e?.category)
        .filter((value) => typeof value === 'string');
}
async function persistExternalRef(internalPaymentId, externalId) {
    if (!internalPaymentId)
        return;
    await (0, db_1.query)(`INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id)
     VALUES ('square', 'payment', $1, $2)
     ON CONFLICT DO NOTHING`, [internalPaymentId, externalId]);
}
function matchesFilters(record, filters) {
    if (!filters)
        return true;
    if (filters.status && record.status !== filters.status)
        return false;
    const metadata = record.metadata ?? null;
    const customerExternalId = metadata && typeof metadata['customerExternalId'] === 'string'
        ? metadata['customerExternalId']
        : null;
    const orderExternalId = metadata && typeof metadata['orderExternalId'] === 'string'
        ? metadata['orderExternalId']
        : null;
    const source = metadata && typeof metadata['source'] === 'string' ? metadata['source'] : null;
    if (filters.customerExternalId && filters.customerExternalId !== customerExternalId)
        return false;
    if (filters.orderExternalId && filters.orderExternalId !== orderExternalId)
        return false;
    if (filters.source && filters.source !== source)
        return false;
    return true;
}
class SquarePaymentsProvider {
    async createCardPayment(params) {
        if (!params.sourceToken) {
            throw new Error('Square card payments require a source token');
        }
        const locationId = (0, squareClient_1.getSquareLocationId)();
        const internalPaymentId = params.internalPaymentId ||
            (params.metadata && typeof params.metadata['internalPaymentId'] === 'string'
                ? String(params.metadata['internalPaymentId'])
                : undefined);
        const idempotencyKey = buildIdempotencyKey(params, internalPaymentId);
        (0, squareLogger_1.logSquareEvent)('info', 'payments.create.requested', {
            idempotencyKey,
            amount: params.amount.amount,
            currency: params.amount.currency,
            orderExternalId: params.orderExternalId ?? null,
            customerExternalId: params.customerExternalId ?? null,
            internalPaymentId: internalPaymentId ?? null,
            locationId,
        });
        try {
            const client = (0, squareClient_1.getSquareClient)();
            const response = await client.paymentsApi.createPayment({
                idempotencyKey,
                sourceId: params.sourceToken,
                amountMoney: {
                    amount: BigInt(Math.trunc(params.amount.amount)),
                    currency: params.amount.currency,
                },
                locationId,
                orderId: params.orderExternalId ?? undefined,
                customerId: params.customerExternalId ?? undefined,
                autocomplete: true,
            });
            const payment = response.result?.payment;
            if (!payment || !payment.id) {
                throw new Error('Square payment missing from response');
            }
            const mapped = (0, squarePaymentMapper_1.mapSquarePayment)(payment);
            if (mapped.status === 'PAID' || mapped.status === 'AUTHORIZED') {
                await persistExternalRef(internalPaymentId, payment.id);
            }
            if (!internalPaymentId) {
                (0, squareLogger_1.logSquareEvent)('warn', 'payments.create.missing_internal_id', {
                    squarePaymentId: payment.id,
                    orderExternalId: params.orderExternalId ?? null,
                    customerExternalId: params.customerExternalId ?? null,
                });
            }
            (0, squareLogger_1.logSquareEvent)('info', 'payments.create.succeeded', {
                squarePaymentId: payment.id,
                status: mapped.status,
                orderExternalId: params.orderExternalId ?? null,
                customerExternalId: params.customerExternalId ?? null,
                internalPaymentId: internalPaymentId ?? null,
            });
            return mapped;
        }
        catch (error) {
            (0, squareLogger_1.logSquareEvent)('error', 'payments.create.failed', {
                orderExternalId: params.orderExternalId ?? null,
                customerExternalId: params.customerExternalId ?? null,
                internalPaymentId: params.internalPaymentId ?? null,
                errorCodes: extractSquareErrorCodes(error),
            });
            throw error;
        }
    }
    async recordCashPayment(_params) {
        throw new Error('UnsupportedOperation: cash payments are handled locally');
    }
    async listPayments(range, filters) {
        const client = (0, squareClient_1.getSquareClient)();
        const locationId = (0, squareClient_1.getSquareLocationId)();
        const beginTime = new Date(range.from).toISOString();
        const endTime = new Date(range.to).toISOString();
        const results = [];
        let cursor;
        do {
            const response = await client.paymentsApi.listPayments(beginTime, endTime, undefined, cursor, locationId);
            const payments = response.result?.payments ?? [];
            for (const payment of payments) {
                const mapped = (0, squarePaymentMapper_1.mapSquarePayment)(payment);
                if (matchesFilters(mapped, filters)) {
                    results.push(mapped);
                }
            }
            cursor = response.result?.cursor ?? undefined;
        } while (cursor);
        return results;
    }
    async listRefunds(_range, _filters) {
        throw new Error('NotImplemented: Square refunds not wired');
    }
    async refundPayment(_params) {
        throw new Error('NotImplemented: Square refunds not wired');
    }
}
exports.SquarePaymentsProvider = SquarePaymentsProvider;
