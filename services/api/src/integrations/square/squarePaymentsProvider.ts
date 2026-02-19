import crypto from 'node:crypto';
import type {
  CreateCardPaymentParams,
  PaymentFilters,
  PaymentRecord,
  PaymentsProvider,
  RecordCashPaymentParams,
  RefundParams,
} from '../contracts/providers';
import { query } from '../../db';
import { getSquareClient, getSquareLocationId } from './squareClient';
import { logSquareEvent } from './squareLogger';
import { mapSquarePayment } from './squarePaymentMapper';

function buildIdempotencyKey(params: CreateCardPaymentParams, internalPaymentId?: string): string {
  if (internalPaymentId) {
    return `pay_${internalPaymentId}`.slice(0, 45);
  }
  if (params.orderExternalId) {
    return `order_${params.orderExternalId}`.slice(0, 45);
  }
  if (params.metadata && typeof params.metadata['idempotencyKey'] === 'string') {
    return String(params.metadata['idempotencyKey']).slice(0, 45);
  }

  const hash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        amount: params.amount,
        orderExternalId: params.orderExternalId ?? null,
        customerExternalId: params.customerExternalId ?? null,
        internalPaymentId: internalPaymentId ?? null,
      })
    )
    .digest('hex')
    .slice(0, 32);

  return `pay_${hash}`;
}

function extractSquareErrorCodes(error: unknown): string[] {
  if (!error || typeof error !== 'object') return [];
  const err = error as { errors?: Array<{ code?: string; category?: string }> };
  if (!Array.isArray(err.errors)) return [];
  return err.errors
    .map((e) => e?.code || e?.category)
    .filter((value): value is string => typeof value === 'string');
}

async function persistExternalRef(
  internalPaymentId: string | undefined,
  externalId: string
): Promise<void> {
  if (!internalPaymentId) return;

  await query(
    `INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id)
     VALUES ('square', 'payment', $1, $2)
     ON CONFLICT DO NOTHING`,
    [internalPaymentId, externalId]
  );
}

function matchesFilters(record: PaymentRecord, filters?: PaymentFilters): boolean {
  if (!filters) return true;
  if (filters.status && record.status !== filters.status) return false;

  const metadata = record.metadata ?? null;
  const customerExternalId =
    metadata && typeof metadata['customerExternalId'] === 'string'
      ? metadata['customerExternalId']
      : null;
  const orderExternalId =
    metadata && typeof metadata['orderExternalId'] === 'string'
      ? metadata['orderExternalId']
      : null;
  const source = metadata && typeof metadata['source'] === 'string' ? metadata['source'] : null;

  if (filters.customerExternalId && filters.customerExternalId !== customerExternalId) return false;
  if (filters.orderExternalId && filters.orderExternalId !== orderExternalId) return false;
  if (filters.source && filters.source !== source) return false;

  return true;
}

export class SquarePaymentsProvider implements PaymentsProvider {
  async createCardPayment(params: CreateCardPaymentParams): Promise<PaymentRecord> {
    if (!params.sourceToken) {
      throw new Error('Square card payments require a source token');
    }

    const locationId = getSquareLocationId();
    const internalPaymentId =
      params.internalPaymentId ||
      (params.metadata && typeof params.metadata['internalPaymentId'] === 'string'
        ? String(params.metadata['internalPaymentId'])
        : undefined);
    const idempotencyKey = buildIdempotencyKey(params, internalPaymentId);

    logSquareEvent('info', 'payments.create.requested', {
      idempotencyKey,
      amountCents: params.amount.amountCents,
      currency: params.amount.currency,
      orderExternalId: params.orderExternalId ?? null,
      customerExternalId: params.customerExternalId ?? null,
      internalPaymentId: internalPaymentId ?? null,
      locationId,
    });

    try {
      const client = getSquareClient();
      const response = await client.paymentsApi.createPayment({
        idempotencyKey,
        sourceId: params.sourceToken,
        amountMoney: {
          amount: BigInt(Math.trunc(params.amount.amountCents)),
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

      const mapped = mapSquarePayment(payment);
      if (mapped.status === 'PAID' || mapped.status === 'AUTHORIZED') {
        await persistExternalRef(internalPaymentId, payment.id);
      }
      if (!internalPaymentId) {
        logSquareEvent('warn', 'payments.create.missing_internal_id', {
          squarePaymentId: payment.id,
          orderExternalId: params.orderExternalId ?? null,
          customerExternalId: params.customerExternalId ?? null,
        });
      }

      logSquareEvent('info', 'payments.create.succeeded', {
        squarePaymentId: payment.id,
        status: mapped.status,
        orderExternalId: params.orderExternalId ?? null,
        customerExternalId: params.customerExternalId ?? null,
        internalPaymentId: internalPaymentId ?? null,
      });

      return mapped;
    } catch (error) {
      logSquareEvent('error', 'payments.create.failed', {
        orderExternalId: params.orderExternalId ?? null,
        customerExternalId: params.customerExternalId ?? null,
        internalPaymentId: params.internalPaymentId ?? null,
        errorCodes: extractSquareErrorCodes(error),
      });
      throw error;
    }
  }

  async recordCashPayment(_params: RecordCashPaymentParams): Promise<PaymentRecord> {
    throw new Error('UnsupportedOperation: cash payments are handled locally');
  }

  async listPayments(
    range: { from: Date | string; to: Date | string },
    filters?: PaymentFilters
  ): Promise<PaymentRecord[]> {
    const client = getSquareClient();
    const locationId = getSquareLocationId();
    const beginTime = new Date(range.from).toISOString();
    const endTime = new Date(range.to).toISOString();

    const results: PaymentRecord[] = [];
    let cursor: string | undefined;

    do {
      const response = await client.paymentsApi.listPayments(
        beginTime,
        endTime,
        undefined,
        cursor,
        locationId
      );

      const payments = response.result?.payments ?? [];
      for (const payment of payments) {
        const mapped = mapSquarePayment(payment);
        if (matchesFilters(mapped, filters)) {
          results.push(mapped);
        }
      }

      cursor = response.result?.cursor ?? undefined;
    } while (cursor);

    return results;
  }

  async listRefunds(
    _range: { from: Date | string; to: Date | string },
    _filters?: PaymentFilters
  ): Promise<PaymentRecord[]> {
    throw new Error('NotImplemented: Square refunds not wired');
  }

  async refundPayment(_params: RefundParams): Promise<PaymentRecord> {
    throw new Error('NotImplemented: Square refunds not wired');
  }
}
