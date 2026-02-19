export type DateRange = {
  from: Date | string;
  to: Date | string;
};

export type MoneyAmount = {
  amountCents: number;
  currency: string;
};

export type ExternalRef = {
  provider: string;
  externalId: string;
  externalVersion?: string | null;
};

// Note: external_provider_refs writes are handled by adapters, not core domain logic.

export type DomainCustomerDTO = {
  id: string;
  name: string;
  dob?: string | null;
  membershipNumber?: string | null;
  primaryLanguage?: 'EN' | 'ES' | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
};

export type CustomerSearchResult = {
  externalId: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  metadata?: Record<string, unknown> | null;
};

export interface CustomersProvider {
  searchCustomers(query: string): Promise<CustomerSearchResult[]>;
  getCustomerByExternalId(externalId: string): Promise<CustomerSearchResult | null>;
  upsertCustomerMirror(domainCustomer: DomainCustomerDTO): Promise<ExternalRef | null>;
}

export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'PAID'
  | 'FAILED'
  | 'CANCELED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type PaymentRecord = {
  provider: string;
  externalId: string;
  status: PaymentStatus;
  amount: MoneyAmount;
  tipAmount?: MoneyAmount | null;
  taxAmount?: MoneyAmount | null;
  createdAt: Date | string;
  metadata?: Record<string, unknown> | null;
};

export type PaymentFilters = {
  customerExternalId?: string;
  orderExternalId?: string;
  status?: PaymentStatus;
  source?: 'CARD' | 'CASH' | 'OTHER';
};

export type CreateCardPaymentParams = {
  amount: MoneyAmount;
  orderExternalId?: string;
  customerExternalId?: string;
  internalPaymentId?: string;
  sourceToken?: string;
  metadata?: Record<string, unknown> | null;
};

export type RecordCashPaymentParams = {
  amount: MoneyAmount;
  orderExternalId?: string;
  customerExternalId?: string;
  metadata?: Record<string, unknown> | null;
};

export type RefundParams = {
  paymentExternalId: string;
  amount?: MoneyAmount;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

export interface PaymentsProvider {
  createCardPayment(params: CreateCardPaymentParams): Promise<PaymentRecord>;
  recordCashPayment(params: RecordCashPaymentParams): Promise<PaymentRecord>;
  listPayments(range: DateRange, filters?: PaymentFilters): Promise<PaymentRecord[]>;
  listRefunds(range: DateRange, filters?: PaymentFilters): Promise<PaymentRecord[]>;
  refundPayment(params: RefundParams): Promise<PaymentRecord>;
}

export type OrderStatus = 'OPEN' | 'PAID' | 'CANCELED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

export type OrderLineItemDTO = {
  kind?: 'RETAIL' | 'ADDON' | 'UPGRADE' | 'LATE_FEE' | 'MANUAL';
  sku?: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  discountCents?: number | null;
  taxCents?: number | null;
  totalCents?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type OrderRecord = {
  externalId: string;
  status: OrderStatus;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  currency: string;
  createdAt: Date | string;
  metadata?: Record<string, unknown> | null;
};

export type CreateOrderParams = {
  internalOrderId?: string;
  customerExternalId?: string;
  currency: string;
  metadata?: Record<string, unknown> | null;
};

export type AddLineItemParams = {
  orderExternalId: string;
  item: OrderLineItemDTO;
};

export type FinalizeOrderPaidParams = {
  orderExternalId: string;
  paymentExternalId?: string;
  metadata?: Record<string, unknown> | null;
};

export interface OrdersProvider {
  createOrder(params: CreateOrderParams): Promise<OrderRecord>;
  addLineItem(params: AddLineItemParams): Promise<OrderRecord>;
  finalizeOrderPaid(params: FinalizeOrderPaidParams): Promise<OrderRecord>;
  getOrderByExternalId(externalId: string): Promise<OrderRecord | null>;
}

export type ShiftRecord = {
  externalId: string;
  employeeExternalId: string;
  startsAt: Date | string;
  endsAt: Date | string;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type TimeclockSessionRecord = {
  externalId: string;
  employeeExternalId: string;
  clockInAt: Date | string;
  clockOutAt?: Date | string | null;
  metadata?: Record<string, unknown> | null;
};

export type BreakRecord = {
  externalId: string;
  employeeExternalId: string;
  startedAt: Date | string;
  endedAt?: Date | string | null;
  breakType?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type LaborFilters = {
  employeeExternalId?: string;
};

export interface LaborProvider {
  listShifts(range: DateRange, filters?: LaborFilters): Promise<ShiftRecord[]>;
  listTimeclockSessions(
    range: DateRange,
    filters?: LaborFilters
  ): Promise<TimeclockSessionRecord[]>;
  listBreaks(range: DateRange, filters?: LaborFilters): Promise<BreakRecord[]>;
}
