import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import type { SessionUpdatedPayload } from '@the-clubs/shared';
import { ScreenShell } from '../components/ScreenShell';
import { useI18n } from '../i18n';

interface Props {
  laneId: string;
  kioskToken?: string | null;
  sessionPayload?: SessionUpdatedPayload | null;
  onNext: () => void;
  onSkip: () => void;
}

interface Product {
  id: string;
  name: string;
  priceCents: number;
  category: string;
}

/**
 * AddOnsScreen — Shows available add-on products during kiosk check-in.
 * Customer can pick towels, drinks, etc. before proceeding to agreement/payment.
 */
export function AddOnsScreen({ laneId, kioskToken, sessionPayload, onNext, onSkip }: Props) {
  const { t } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  /* ── Fetch available add-on products ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h: Record<string, string> = {};
        if (kioskToken) h['x-kiosk-token'] = kioskToken;
        const res = await fetch(getApiUrl('/api/v1/admin/products?category=ADDON'), { headers: h });
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        if (!cancelled) {
          setProducts(data.products ?? []);
        }
      } catch {
        // Silently fail — customer can still skip
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kioskToken]);

  /* ── Quantity helpers ── */
  const increment = (id: string) =>
    setQuantities((prev) => ({ ...prev, [id]: Math.min((prev[id] ?? 0) + 1, 10) }));
  const decrement = (id: string) =>
    setQuantities((prev) => {
      const next = (prev[id] ?? 0) - 1;
      if (next <= 0) {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      }
      return { ...prev, [id]: next };
    });

  const selectedItems = products
    .filter((p) => (quantities[p.id] ?? 0) > 0)
    .map((p) => ({
      product: p,
      qty: quantities[p.id]!,
      total: quantities[p.id]! * p.priceCents,
    }));

  const addOnTotal = selectedItems.reduce((sum, it) => sum + it.total, 0);

  /* ── Submit add-ons to API ── */
  const handleContinue = useCallback(async () => {
    if (selectedItems.length === 0) {
      onSkip();
      return;
    }
    setSubmitting(true);
    try {
      const h: Record<string, string> = { 'Content-Type': 'application/json' };
      if (kioskToken) h['x-kiosk-token'] = kioskToken;
      const res = await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/add-ons`),
        {
          method: 'POST',
          headers: h,
          body: JSON.stringify({
            sessionId: sessionPayload?.sessionId,
            items: selectedItems.map((it) => ({
              label: it.product.name,
              quantity: it.qty,
              unitPrice: it.product.priceCents / 100,
            })),
          }),
        }
      );
      if (!res.ok) {
        console.error('[AddOnsScreen] Failed to submit add-ons', await res.text());
      }
      onNext();
    } catch (err) {
      console.error('[AddOnsScreen] Error submitting add-ons', err);
      onNext(); // continue anyway so the customer isn't stuck
    } finally {
      setSubmitting(false);
    }
  }, [selectedItems, kioskToken, laneId, sessionPayload?.sessionId, onNext, onSkip]);

  /* ── Render ── */
  return (
    <ScreenShell showWatermark >
    <div className= "flex w-full max-w-lg flex-col items-center gap-6 px-6 py-10" >
    {/* Header */ }
    < div className = "text-center" >
      <h1
            className="text-3xl font-extrabold tracking-tight"
  style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }
}
          >
  { t('addons.title') }
  </h1>
  < p className = "mt-2 text-sm" style = {{ color: 'var(--color-text-muted)' }}>
    { t('addons.subtitle') }
    </p>
    </div>

{/* Product grid */ }
{
  loading ? (
    <div className= "flex items-center justify-center py-12" >
    <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
  style = {{ borderColor: 'var(--color-accent-primary)', borderTopColor: 'transparent' }
}
            />
  </div>
        ) : products.length === 0 ? (
  <p className= "py-8 text-center text-sm" style = {{ color: 'var(--color-text-muted)' }}>
    { t('addons.noneAvailable') }
    </p>
        ) : (
  <div className= "grid w-full grid-cols-2 gap-3" >
  {
    products.map((p) => {
      const qty = quantities[p.id] ?? 0;
      const isSelected = qty > 0;
      return (
        <div
                  key= { p.id }
      className = "flex flex-col items-center rounded-xl border p-4 transition-all"
      style = {{
        backgroundColor: isSelected
          ? 'rgba(0, 212, 255, 0.06)'
          : 'var(--color-surface-raised)',
          borderColor: isSelected
            ? 'var(--color-border-accent)'
            : 'var(--color-border-default)',
                  }
    }
                >
      {/* Product icon placeholder */ }
      < div
                    className = "mb-2 flex h-10 w-10 items-center justify-center rounded-full"
                    style = {{ backgroundColor: 'rgba(0, 212, 255, 0.08)' }}
  >
  <svg width="20" height = "20" viewBox = "0 0 24 24" fill = "none" stroke = "var(--color-accent-primary)" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1 = "6" x2 = "21" y2 = "6" />
        <path d="M16 10a4 4 0 01-8 0" />
          </svg>
          </div>

          < span
className = "text-sm font-semibold text-center"
style = {{ color: 'var(--color-text-primary)' }}
                  >
  { p.name }
  </span>
  < span
className = "mt-0.5 text-xs tabular-nums"
style = {{ color: 'var(--color-text-muted)' }}
                  >
  ${ (p.priceCents / 100).toFixed(2) }
</span>

{/* Quantity controls */ }
<div className="mt-3 flex items-center gap-3" >
  <button
                      type="button"
className = "flex h-8 w-8 items-center justify-center rounded-full border text-lg font-bold transition"
style = {{
  borderColor: 'var(--color-border-default)',
    color: qty > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
      opacity: qty > 0 ? 1 : 0.4,
                      }}
disabled = { qty <= 0}
onClick = {() => decrement(p.id)}
                    >
                      −
</button>
  < span
className = "w-5 text-center text-sm font-bold tabular-nums"
style = {{ color: 'var(--color-text-primary)' }}
                    >
  { qty }
  </span>
  < button
type = "button"
className = "flex h-8 w-8 items-center justify-center rounded-full border text-lg font-bold transition"
style = {{
  borderColor: 'var(--color-border-accent)',
    color: 'var(--color-accent-primary)',
                      }}
onClick = {() => increment(p.id)}
                    >
  +
  </button>
  </div>
  </div>
              );
            })}
</div>
        )}

{/* Running total */ }
{
  addOnTotal > 0 && (
    <div
            className="flex w-full items-center justify-between rounded-lg border px-4 py-3"
  style = {{
    backgroundColor: 'rgba(0, 212, 255, 0.04)',
      borderColor: 'var(--color-border-accent)',
            }
}
          >
  <span className="text-sm font-semibold" style = {{ color: 'var(--color-text-secondary)' }}>
    { t('addons.total') }
    </span>
    < span
className = "text-lg font-extrabold tabular-nums"
style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-accent-primary)' }}
            >
  ${ (addOnTotal / 100).toFixed(2) }
</span>
  </div>
        )}

{/* Actions */ }
<div className="flex w-full gap-3" >
  <button
            type="button"
className = "flex-1 rounded-lg border px-6 py-4 text-base font-semibold transition"
style = {{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
onClick = { onSkip }
disabled = { submitting }
  >
  { t('addons.noThanks') }
  </button>
  < button
type = "button"
className = "flex-1 rounded-lg px-6 py-4 text-base font-bold transition"
style = {{
  backgroundColor: selectedItems.length > 0
    ? 'var(--color-accent-primary)'
    : 'var(--color-surface-raised)',
    color: selectedItems.length > 0 ? 'white' : 'var(--color-text-muted)',
            }}
disabled = { submitting || selectedItems.length === 0}
onClick = { handleContinue }
  >
  { submitting? t('addons.adding'): t('addons.addAndContinue')}
</button>
  </div>
  </div>
  </ScreenShell>
  );
}
