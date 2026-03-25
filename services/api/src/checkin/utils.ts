function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : undefined;
}

export function roundToWhole(value: number): number {
  return Math.round(value);
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

/**
 * Normalizes heavily fragmented Date strings (YYYY-MM-DD, MMDDYYYY, MM/DD/YYYY, etc)
 * into a strict ISO format (`YYYY-MM-DD`) safely detached from timezone drift.
 */
export function normalizeToIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  
  // 1. If it's explicitly ISO compliant already
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  // 2. Identify US Slash/Dash Formats (MM/DD/YYYY or MM-DD-YYYY)
  const usRegex = new RegExp(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const usMatch = usRegex.exec(t);
  if (usMatch?.[1] && usMatch?.[2] && usMatch?.[3]) {
    const mm = usMatch[1].padStart(2, '0');
    const dd = usMatch[2].padStart(2, '0');
    return `${usMatch[3]}-${mm}-${dd}`;
  }

  // 3. Identify dense 8-digit blocks (MMDDYYYY vs YYYYMMDD)
  const denseRegex = new RegExp(/^(\d{8})$/);
  const denseMatch = denseRegex.exec(t);
  if (denseMatch?.[1]) {
    const str = denseMatch[1];
    if (str.startsWith('19') || str.startsWith('20')) {
      return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
    }
    return `${str.slice(4, 8)}-${str.slice(0, 2)}-${str.slice(2, 4)}`;
  }

  // 4. Default to native JS instantiation and cut at ISO literal length
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) {
    // We isolate the date portion exclusively.
    // If the input doesn't carry time, it falls back to native timezone.
    return d.toISOString().split('T')[0] ?? null;
  }
  
  return null;
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
