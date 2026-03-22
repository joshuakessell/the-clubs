import { getApiUrl } from '@the-clubs/shared';

export type LateFeeResolution = {
  lateMinutes: number;
  fee: number;
  banApplied: boolean;
};

/**
 * Resolve late fee details for an occupancy before completing checkout.
 * Returns null if the resolve call fails (caller should fall through to direct checkout).
 */
export async function resolveLateFee(
  occupancyId: string,
  token: string | undefined,
): Promise<LateFeeResolution | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(getApiUrl('/api/v1/checkout/manual-resolve'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ occupancyId }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const fee = data?.fee ?? 0;
    if (fee <= 0) return null;

    return {
      lateMinutes: data.lateMinutes ?? 0,
      fee,
      banApplied: !!data.banApplied,
    };
  } catch {
    return null;
  }
}

/**
 * Execute the manual-complete checkout API call.
 * Throws on failure.
 */
export async function executeManualCheckout(
  occupancyId: string,
  token: string | undefined,
  payAtCheckout = false,
  paymentMethod?: 'CREDIT' | 'CASH',
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(getApiUrl('/api/v1/checkout/manual-complete'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ occupancyId, payAtCheckout, paymentMethod }),
  });

  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error((d as Record<string, string>).error ?? `HTTP ${res.status}`);
  }
}

/**
 * Creates a Square POS Order for the current checkout lane session.
 */
export async function createSquareOrder(
  laneId: string,
  token: string | undefined,
): Promise<{ squareOrderId: string; orderId: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/square-order`), {
    method: 'POST',
    headers,
  });

  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error((d as Record<string, string>).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
