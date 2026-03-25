import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, useAuthStore } from '@the-clubs/ui';
import { getApiUrl } from '@the-clubs/shared';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';
import { useRegisterStore } from '../stores/useRegisterStore';

/* ─── Types ─────────────────────────────────────────── */

interface CatalogItem {
  id: string;
  name: string;
  price: number;
  category: string;
  imageUrl?: string;
}

interface ActiveGuest {
  customerId: string;
  customerName: string;
  resourceType: 'ROOM' | 'LOCKER' | 'CHECKING_IN';
  number: string;
  visitId: string;
  laneSessionId?: string;
}

/* ─── Helpers ───────────────────────────────────────── */

function formatPrice(dollars: number) {
  return `$${dollars.toFixed(2)}`;
}

function triggerAppSwitch(squareOrderId: string, orderId: string, cartTotal: number) {
  globalThis.sessionStorage.setItem('square_checkout_order_id', orderId);
  const amountCents = Math.round(cartTotal * 100);
  const appSwitchData = {
    amount_money: { amount: amountCents.toString(), currency_code: 'USD' },
    callback_url: `${globalThis.location.origin}/checkout/square-callback`,
    client_id: import.meta.env.VITE_SQUARE_APPLICATION_ID || 'sq0idp-undefined',
    version: '1.3',
    notes: `ORDER_ID:${squareOrderId}`,
    options: { supported_tender_types: ['CREDIT_CARD', 'CASH', 'SQUARE_GIFT_CARD', 'CARD_ON_FILE'] }
  };
  globalThis.location.href = `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify(appSwitchData))}`;
}

function useGuestsFilters(guests: ActiveGuest[], guestFilter: string, currentSessionId: string | null) {
  const filteredGuests = useMemo(() => {
    if (!guestFilter.trim()) return guests;
    const q = guestFilter.toLowerCase();
    return guests.filter((g) => g.number.toLowerCase().includes(q) || g.customerName.toLowerCase().includes(q));
  }, [guests, guestFilter]);

  const checkingInGuests = useMemo(() => filteredGuests.filter((g) => g.resourceType === 'CHECKING_IN' && g.laneSessionId === currentSessionId), [filteredGuests, currentSessionId]);
  const roomGuests = useMemo(() => filteredGuests.filter((g) => g.resourceType === 'ROOM'), [filteredGuests]);
  const lockerGuests = useMemo(() => filteredGuests.filter((g) => g.resourceType === 'LOCKER'), [filteredGuests]);

  return { filteredGuests, checkingInGuests, roomGuests, lockerGuests };
}

function useRetailData(token: string | undefined) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [guests, setGuests] = useState<ActiveGuest[]>([]);
  const [guestsLoading, setGuestsLoading] = useState(false);

  const fetchCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(getApiUrl('/api/v1/admin/products'), { headers });
      if (res.ok) {
        const data = await res.json();
        const items: CatalogItem[] = (data.products ?? [])
          .filter((p: { isActive?: boolean }) => p.isActive !== false)
          .map((p: { id: string; name: string; price: number; category?: string; imageUrl?: string }) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            category: (p.category ?? 'RETAIL').toLowerCase(),
            imageUrl: p.imageUrl ?? undefined,
          }));
        setCatalog(items);
      }
    } catch {
      // Silently fail
    } finally {
      setCatalogLoading(false);
    }
  }, [token]);

  const fetchGuests = useCallback(async () => {
    setGuestsLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(getApiUrl('/api/v1/retail/active-guests'), { headers });
      if (res.ok) {
        const data = await res.json();
        setGuests(data.guests ?? []);
      }
    } catch {
      // Silently fail
    } finally {
      setGuestsLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchCatalog(); void fetchGuests(); }, [fetchCatalog, fetchGuests]);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of catalog) {
      if (!seen.has(item.category)) {
        seen.set(item.category, item.category.charAt(0).toUpperCase() + item.category.slice(1));
      }
    }
    return Array.from(seen.entries()).map(([key, label]) => ({ key, label }));
  }, [catalog]);

  return { catalog, catalogLoading, categories, guests, guestsLoading };
}


/* ─── Sub-components ────────────────────────────────── */

function GuestSection({
  title,
  titleColor,
  guests,
  badgeLabel,
  badgeBg,
  onSelect,
}: Readonly<{
  title: string;
  titleColor: string;
  guests: ActiveGuest[];
  badgeLabel?: string;
  badgeBg?: string;
  onSelect: (g: ActiveGuest) => void;
}>) {
  if (guests.length === 0) return null;
  return (
    <>
      <div
        className="sticky top-0 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest"
        style={{ color: titleColor, backgroundColor: 'var(--color-surface-raised)' }}
      >
        {title}
      </div>
      {guests.map((g) => (
        <button
          key={`${title}-${g.customerId}`}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors text-(--color-text-primary)"
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
          onClick={() => onSelect(g)}
        >
          {badgeLabel ? (
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
              style={{ backgroundColor: badgeBg ?? titleColor, color: '#fff' }}
            >
              {badgeLabel}
            </span>
          ) : (
            <span className="font-bold tabular-nums text-(--color-accent-primary)">
              {g.number}
            </span>
          )}
          {!badgeLabel && <span className="text-(--color-text-muted)">—</span>}
          <span className="truncate">{g.customerName}</span>
        </button>
      ))}
    </>
  );
}

/* ─── Component ─────────────────────────────────────── */

export function RetailPanel() {
  const token = useAuthStore((s) => s.session?.sessionToken);
  const laneId = useRegisterStore((s) => s.laneId);

  const { catalog, catalogLoading, categories, guests, guestsLoading } = useRetailData(token);

  /* Cart state */
  const [cart, setCart] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Guest lookup state */
  const [selectedGuest, setSelectedGuest] = useState<ActiveGuest | null>(null);
  const [guestFilter, setGuestFilter] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /* Close dropdown on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentSessionId = useRegisterStore((s) => s.currentSessionId);
  const { filteredGuests, checkingInGuests, roomGuests, lockerGuests } = useGuestsFilters(guests, guestFilter, currentSessionId);

  /* Cart helpers */
  const addItem = (id: string) => setCart((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }));
  const removeItem = (id: string) => setCart((p) => {
    const next = { ...p };
    if ((next[id] ?? 0) <= 1) delete next[id]; else next[id]--;
    return next;
  });
  const clearCart = () => { setCart({}); setSelectedGuest(null); setGuestFilter(''); };

  const cartLines = useMemo(
    () => catalog.filter((c) => (cart[c.id] ?? 0) > 0).map((c) => ({ ...c, qty: cart[c.id] })),
    [cart, catalog]
  );
  const cartTotal = cartLines.reduce((sum: number, i) => sum + i.price * i.qty, 0);
  const cartCount = cartLines.reduce((sum: number, i) => sum + i.qty, 0);

  const handleAddToLedger = async () => {
    if (!selectedGuest?.laneSessionId || !laneId) return;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(
      getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/add-retail-items`),
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          items: cartLines.map((i) => ({
            sku: i.id,
            name: i.name,
            quantity: i.qty,
            unitPrice: i.price,
          })),
        }),
      }
    );
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error ?? `Add to ledger failed: HTTP ${res.status}`);
    }
    clearCart();
    setSuccess(`Items added to ${selectedGuest.customerName}'s ledger!`);
    setTimeout(() => setSuccess(null), 4000);
  };

  const processStandaloneSale = async (headers: Record<string, string>) => {
    if (!selectedGuest?.customerId) {
      throw new Error('A customer must be selected to complete a standalone sale.');
    }
    const createRes = await fetch(getApiUrl('/api/v1/orders'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ customerId: selectedGuest.customerId, metadataJson: { visitId: selectedGuest.visitId, isStandaloneRetail: true } }),
    });
    if (!createRes.ok) {
      const d = await createRes.json().catch(() => ({}));
      throw new Error(d.error ?? `Create order failed: HTTP ${createRes.status}`);
    }
    const { orderId } = await createRes.json();

    const itemsRes = await fetch(getApiUrl(`/api/v1/orders/${orderId}/line-items`), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: cartLines.map((i) => ({ kind: 'RETAIL', sku: i.id, name: i.name, quantity: i.qty, unitPrice: i.price })),
      }),
    });
    if (!itemsRes.ok) {
      const d = await itemsRes.json().catch(() => ({}));
      throw new Error(d.error ?? `Add items failed: HTTP ${itemsRes.status}`);
    }

    const sqOrderRes = await fetch(getApiUrl(`/api/v1/orders/${orderId}/square-order`), { method: 'POST', headers });
    if (!sqOrderRes.ok) {
      const d = await sqOrderRes.json().catch(() => ({}));
      throw new Error(d.error ?? `Square POS init failed: HTTP ${sqOrderRes.status}`);
    }

    const { squareOrderId } = await sqOrderRes.json();
    if (squareOrderId) {
      triggerAppSwitch(squareOrderId, orderId, cartTotal);
      return true;
    }
    return false;
  };

  /* Complete sale — 3-step order flow, or add-to-ledger for checking-in guests */
  const handleCompleteSale = async () => {
    if (cartLines.length === 0) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      if (selectedGuest?.laneSessionId && laneId) {
        await handleAddToLedger();
        return;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const backgrounded = await processStandaloneSale(headers);
      if (backgrounded) return;



      clearCart();
      const label = selectedGuest
        ? `Sale completed for ${selectedGuest.customerName}!`
        : 'Sale completed!';
      setSuccess(label);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to complete sale');
    } finally {
      setSubmitting(false);
    }
  };

  /* ─── Render ────────────────────────────────────────── */

  return (
      <PanelShell align="top" scroll="hidden" card={false} className="w-full">
      <PanelHeader
        title="Retail"
        subtitle="Point of sale"
        layout="inline"
        spacing="sm"
      />

      <div className="mt-3 flex flex-1 min-h-0 gap-4 w-full">
        {/* ── Left: Product Grid ──────────────────────── */}
        <div className="flex-[3] min-w-0 overflow-y-auto overflow-x-hidden pr-1">
          {catalogLoading && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-(--color-text-muted)">Loading products…</p>
            </div>
          )}
          {!catalogLoading && catalog.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-(--color-text-muted)">No products available. Add products in the Office Dashboard.</p>
            </div>
          )}
          {!catalogLoading && catalog.length > 0 && categories.map((cat) => {
            const items = catalog.filter((i) => i.category === cat.key);
            return (
              <div key={cat.key} className="mb-4">
                <h3
                  className="mb-2 text-[10px] font-bold uppercase tracking-widest text-(--color-text-muted)"
                >
                  {cat.label}
                </h3>
                <div className="grid grid-cols-5 gap-2">
                  {items.map((item) => {
                    const qty = cart[item.id] ?? 0;
                    return (
                      <button
                        key={item.id}
                        className="group relative flex flex-col rounded-lg border p-2 text-left transition-all"
                        style={{
                          backgroundColor: 'var(--color-surface-input)',
                          borderColor: qty > 0 ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
                        }}
                        onMouseEnter={(e) => {
                          if (qty === 0) (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-strong)';
                        }}
                        onMouseLeave={(e) => {
                          if (qty === 0) (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-default)';
                        }}
                        onClick={() => addItem(item.id)}
                        aria-label={`Add ${item.name} to cart`}
                      >
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="mb-2 h-16 w-full rounded object-contain bg-(--color-surface-overlay)"
                          />
                        ) : (
                          <div
                            className="mb-2 flex h-16 w-full items-center justify-center rounded text-2xl bg-(--color-surface-overlay)"
                          >
                            🛍
                          </div>
                        )}
                        <span className="text-xs font-semibold leading-snug text-(--color-text-primary)">
                          {item.name}
                        </span>
                        <span className="text-xs tabular-nums text-(--color-accent-primary)">
                          {formatPrice(item.price)}
                        </span>
                        {qty > 0 ? (
                          <span
                            className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold bg-(--color-accent-primary) text-(--color-text-inverse)"
                          >
                            {qty}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Right: Cart & Checkout ──────────────────── */}
        <div
          className="flex-[2] flex flex-col min-h-0 rounded-lg border bg-(--color-surface-overlay) border-(--color-border-default)"
        >
          {/* Customer lookup */}
          <div className="border-b p-3 border-(--color-border-subtle)">
            <label
              className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-(--color-text-muted)"
              htmlFor="guest-lookup"
            >
              Attribute to Guest{' '}
              <span className="ml-1 font-normal normal-case tracking-normal">(optional)</span>
            </label>

            <div ref={dropdownRef} className="relative">
              {selectedGuest ? (
                <div
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                  style={{
                    backgroundColor: 'var(--color-surface-input)',
                    borderColor: 'var(--color-accent-primary)',
                  }}
                >
                  <div>
                    <span className="text-xs font-bold tabular-nums text-(--color-accent-primary)">
                      {selectedGuest.resourceType === 'ROOM' ? 'Room' : 'Locker'} {selectedGuest.number}
                    </span>
                    <span className="mx-1.5 text-xs text-(--color-text-muted)">—</span>
                    <span className="text-xs font-medium text-(--color-text-primary)">
                      {selectedGuest.customerName}
                    </span>
                  </div>
                  <button
                    className="ml-2 text-xs font-bold text-(--color-text-muted)"
                    onClick={() => { setSelectedGuest(null); setGuestFilter(''); }}
                    aria-label="Clear guest selection"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <input
                  id="guest-lookup"
                  type="text"
                  className="h-9 w-full rounded-lg border px-3 text-sm"
                  style={{
                    backgroundColor: 'var(--color-surface-input)',
                    borderColor: 'var(--color-border-default)',
                    color: 'var(--color-text-primary)',
                  }}
                  placeholder={guestsLoading ? 'Loading guests…' : 'Search by room/locker # or name…'}
                  value={guestFilter}
                  onChange={(e) => { setGuestFilter(e.target.value); setDropdownOpen(true); }}
                  onFocus={() => setDropdownOpen(true)}
                  autoComplete="off"
                  disabled={guestsLoading}
                />
              )}

              {/* Dropdown */}
              {dropdownOpen && !selectedGuest && (checkingInGuests.length > 0 || roomGuests.length > 0 || lockerGuests.length > 0) ? (
                <div
                  className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border shadow-lg bg-(--color-surface-raised) border-(--color-border-default)"
                >
                  <GuestSection
                    title="Checking In"
                    titleColor="var(--color-status-warning)"
                    guests={checkingInGuests}
                    badgeLabel="Ledger"
                    badgeBg="var(--color-status-warning)"
                    onSelect={(g) => { setSelectedGuest(g); setDropdownOpen(false); setGuestFilter(''); }}
                  />
                  <GuestSection
                    title="Rooms"
                    titleColor="var(--color-text-muted)"
                    guests={roomGuests}
                    onSelect={(g) => { setSelectedGuest(g); setDropdownOpen(false); setGuestFilter(''); }}
                  />
                  <GuestSection
                    title="Lockers"
                    titleColor="var(--color-text-muted)"
                    guests={lockerGuests}
                    onSelect={(g) => { setSelectedGuest(g); setDropdownOpen(false); setGuestFilter(''); }}
                  />
                </div>
              ) : null}

              {/* Empty state */}
              {dropdownOpen && !selectedGuest && filteredGuests.length === 0 && !guestsLoading ? (
                <div
                  className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border px-3 py-3 text-center text-xs bg-(--color-surface-raised) border-(--color-border-default) text-(--color-text-muted)"
                >
                  {guestFilter ? 'No matching guests' : 'No guests currently checked in'}
                </div>
              ) : null}
            </div>
          </div>

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: 'none' }}>
            {cartLines.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-center text-xs text-(--color-text-muted)">
                  Tap items to add to cart
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {cartLines.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-md border p-2 bg-(--color-surface-input) border-(--color-border-subtle)"
                  >

                    <div className="flex-1 min-w-0">
                      <span className="block text-xs font-semibold truncate text-(--color-text-primary)">
                        {item.name}
                      </span>
                      <span className="text-[10px] tabular-nums text-(--color-text-muted)">
                        {formatPrice(item.price)} each
                      </span>
                    </div>

                    {/* Qty controls */}
                    <div className="flex items-center gap-1">
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded text-xs font-bold transition-colors"
                        style={{
                          backgroundColor: 'var(--color-surface-overlay)',
                          color: 'var(--color-text-secondary)',
                          border: '1px solid var(--color-border-default)',
                        }}
                        onClick={() => removeItem(item.id)}
                        aria-label={`Remove one ${item.name}`}
                      >
                        −
                      </button>
                      <span
                        className="w-5 text-center text-xs font-bold tabular-nums text-(--color-text-primary)"
                      >
                        {item.qty}
                      </span>
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded text-xs font-bold transition-colors"
                        style={{
                          backgroundColor: 'var(--color-surface-overlay)',
                          color: 'var(--color-text-secondary)',
                          border: '1px solid var(--color-border-default)',
                        }}
                        onClick={() => addItem(item.id)}
                        aria-label={`Add one more ${item.name}`}
                      >
                        +
                      </button>
                    </div>

                    <span
                      className="ml-1 text-xs font-bold tabular-nums text-(--color-text-primary)"
                    >
                      {formatPrice(item.price * item.qty)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t p-3 border-(--color-border-subtle)">
            {/* Status messages */}
            {success ? (
              <p className="mb-2 text-center text-xs font-medium text-(--color-status-success)">
                {success}
              </p>
            ) : null}
            {error ? (
              <p className="mb-2 text-center text-xs font-medium text-(--color-status-error)">
                {error}
              </p>
            ) : null}

            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-(--color-text-muted)">
                Total ({cartCount} {cartCount === 1 ? 'item' : 'items'})
              </span>
              <span className="text-base font-bold tabular-nums text-(--color-accent-primary)">
                {formatPrice(cartTotal)}
              </span>
            </div>

            <Button
              fullWidth
              disabled={cartLines.length === 0 || submitting || (!selectedGuest?.laneSessionId && !selectedGuest?.customerId)}
              onClick={() => void handleCompleteSale()}
            >
              {(() => {
                if (submitting) return 'Processing…';
                if (selectedGuest?.laneSessionId) return '📋 Add to Ledger';
                if (!selectedGuest?.customerId) return 'Select Customer First';
                return 'Charge with Square POS';
              })()}
            </Button>

            {cartLines.length > 0 ? (
              <button
                className="mt-2 w-full text-center text-xs font-medium transition-colors text-(--color-text-muted)"
                onClick={clearCart}
              >
                Clear Cart
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </PanelShell>
  );
}
