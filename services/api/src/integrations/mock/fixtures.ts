import fs from 'node:fs';
import path from 'node:path';
import type {
  BreakRecord,
  CustomerSearchResult,
  OrderLineItemDTO,
  OrderRecord,
  PaymentRecord,
  ShiftRecord,
  TimeclockSessionRecord,
} from '../contracts/providers';

export type MockOrder = OrderRecord & {
  lineItems: OrderLineItemDTO[];
};

export type MockStore = {
  customers: CustomerSearchResult[];
  payments: PaymentRecord[];
  refunds: PaymentRecord[];
  orders: MockOrder[];
  shifts: ShiftRecord[];
  timeclockSessions: TimeclockSessionRecord[];
  breaks: BreakRecord[];
  counters: {
    customer: number;
    payment: number;
    refund: number;
    order: number;
  };
};

type OrdersFixture = {
  orders: Array<MockOrder & { lineItems?: OrderLineItemDTO[] }>;
};

type ShiftsFixture = {
  shifts: ShiftRecord[];
  timeclockSessions?: TimeclockSessionRecord[];
};

type CustomersFixture = {
  customers: CustomerSearchResult[];
};

type PaymentsFixture = {
  payments: PaymentRecord[];
};

type RefundsFixture = {
  refunds: PaymentRecord[];
};

type BreaksFixture = {
  breaks: BreakRecord[];
};

function resolveFixturePath(fileName: string): string {
  const localPath = path.resolve(__dirname, 'fixtures', fileName);
  if (fs.existsSync(localPath)) return localPath;

  const sourcePath = path.resolve(
    process.cwd(),
    'services',
    'api',
    'src',
    'integrations',
    'mock',
    'fixtures',
    fileName
  );
  if (fs.existsSync(sourcePath)) return sourcePath;

  throw new Error(`Mock fixtures not found: ${fileName}`);
}

function loadJson<T>(fileName: string): T {
  const filePath = resolveFixturePath(fileName);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

function findNextSequence(ids: string[], prefix: string): number {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const suffix = id.slice(prefix.length);
    const num = Number(suffix);
    if (Number.isFinite(num)) {
      max = Math.max(max, Math.trunc(num));
    }
  }
  return max + 1;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createMockStore(): MockStore {
  const customers = loadJson<CustomersFixture>('customers.json').customers ?? [];
  const payments = loadJson<PaymentsFixture>('payments.json').payments ?? [];
  const refunds = loadJson<RefundsFixture>('refunds.json').refunds ?? [];
  const ordersFixture = loadJson<OrdersFixture>('orders.json');
  const shiftsFixture = loadJson<ShiftsFixture>('shifts.json');
  const breaks = loadJson<BreaksFixture>('breaks.json').breaks ?? [];

  const orders: MockOrder[] = (ordersFixture.orders ?? []).map((order) => ({
    ...order,
    lineItems: order.lineItems ?? [],
  }));

  const store: MockStore = {
    customers: clone(customers),
    payments: clone(payments),
    refunds: clone(refunds),
    orders: clone(orders),
    shifts: clone(shiftsFixture.shifts ?? []),
    timeclockSessions: clone(shiftsFixture.timeclockSessions ?? []),
    breaks: clone(breaks),
    counters: {
      customer: findNextSequence(
        customers.map((item) => item.externalId),
        'mock-cust-'
      ),
      payment: findNextSequence(
        payments.map((item) => item.externalId),
        'mock-pay-'
      ),
      refund: findNextSequence(
        refunds.map((item) => item.externalId),
        'mock-refund-'
      ),
      order: findNextSequence(
        orders.map((item) => item.externalId),
        'mock-order-'
      ),
    },
  };

  return store;
}
