function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : undefined;
}

export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parsePriceQuote(raw: unknown): {
  quote: Record<string, unknown>;
  lineItems: Array<{ description: string; amount: number }>;
  total: number;
  messages: string[];
} | null {
  if (raw === null || raw === undefined) return null;
  let parsed: unknown = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;

  const lineItemsRaw = parsed['lineItems'];
  const lineItems: Array<{ description: string; amount: number }> = [];
  if (Array.isArray(lineItemsRaw)) {
    for (const item of lineItemsRaw) {
      if (!isRecord(item)) continue;
      const description = item['description'];
      const amount = toNumber(item['amount']);
      if (typeof description !== 'string' || amount === undefined) continue;
      lineItems.push({ description, amount });
    }
  }

  const total = toNumber(parsed['total']) ?? 0;
  const messagesRaw = parsed['messages'];
  const messages = Array.isArray(messagesRaw)
    ? messagesRaw.filter((m): m is string => typeof m === 'string')
    : [];

  return { quote: parsed, lineItems, total, messages };
}

export function toDate(value: unknown): Date | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value;
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : undefined;
}

export function getHttpError(
  error: unknown
): { statusCode: number; message?: string; code?: string } | null {
  if (!error || typeof error !== 'object') return null;
  if (!('statusCode' in error)) return null;
  const statusCode = (error as { statusCode: unknown }).statusCode;
  if (typeof statusCode !== 'number') return null;
  const message = (error as { message?: unknown }).message;
  const code = (error as { code?: unknown }).code;
  return {
    statusCode,
    message: typeof message === 'string' ? message : undefined,
    code: typeof code === 'string' ? code : undefined,
  };
}
