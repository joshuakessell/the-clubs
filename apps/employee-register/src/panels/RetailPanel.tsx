import { useState } from 'react';
import { Button } from '@the-clubs/ui';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';

interface CartItem {
  id: string;
  name: string;
  price: number;
  qty: number;
}

const CATALOG = [
  { id: 'water', name: 'Water', price: 300 },
  { id: 'energy', name: 'Energy Drink', price: 500 },
  { id: 'snack', name: 'Snack Bar', price: 250 },
  { id: 'towel', name: 'Towel', price: 200 },
  { id: 'flip-flops', name: 'Flip Flops', price: 800 },
  { id: 'lock', name: 'Padlock', price: 600 },
];

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * RetailPanel — POS for retail items (water, snacks, supplies).
 */
export function RetailPanel() {
  const [cart, setCart] = useState<Record<string, number>>({});

  const cartItems: CartItem[] = CATALOG
    .filter((c) => (cart[c.id] ?? 0) > 0)
    .map((c) => ({ ...c, qty: cart[c.id] }));

  const total = cartItems.reduce((sum, i) => sum + i.price * i.qty, 0);

  const addItem = (id: string) => setCart((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }));
  const removeItem = (id: string) => setCart((p) => {
    const next = { ...p };
    if ((next[id] ?? 0) <= 1) delete next[id]; else next[id]--;
    return next;
  });

  return (
    <PanelShell align="top" scroll="hidden">
      <PanelHeader title="Retail" subtitle="Quick sale point of sale" />

      {/* Catalog grid */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {CATALOG.map((item) => (
          <button key={item.id} className="flex flex-col items-center gap-1 rounded-lg border p-3 transition"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-default)'; }}
            onClick={() => addItem(item.id)}
          >
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{item.name}</span>
            <span className="text-xs" style={{ color: 'var(--color-accent-primary)' }}>{formatPrice(item.price)}</span>
            {(cart[item.id] ?? 0) > 0 && (
              <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
                style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-text-inverse)' }}>
                {cart[item.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Cart */}
      {cartItems.length > 0 && (
        <div className="mt-4 rounded-lg border p-3" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex flex-col gap-1">
            {cartItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  {item.name} × {item.qty}
                  <button className="ml-2 text-xs" style={{ color: 'var(--color-status-error)' }} onClick={() => removeItem(item.id)}>✕</button>
                </span>
                <span className="font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                  {formatPrice(item.price * item.qty)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-2" style={{ borderColor: 'var(--color-border-default)' }}>
            <span className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Total</span>
            <span className="text-base font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>
              {formatPrice(total)}
            </span>
          </div>
          <Button fullWidth className="mt-3">Complete Sale</Button>
        </div>
      )}
    </PanelShell>
  );
}
