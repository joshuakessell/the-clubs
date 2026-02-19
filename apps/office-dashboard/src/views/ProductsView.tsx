import { useState } from 'react';
import { Badge, Button } from '@the-clubs/ui';

interface Product {
  id: string;
  name: string;
  sku: string;
  priceCents: number;
  category: string;
  isActive: boolean;
}

const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'Water Bottle', sku: 'WTR-001', priceCents: 300, category: 'Beverages', isActive: true },
  { id: '2', name: 'Energy Drink', sku: 'NRG-001', priceCents: 500, category: 'Beverages', isActive: true },
  { id: '3', name: 'Towel', sku: 'TWL-001', priceCents: 200, category: 'Supplies', isActive: true },
  { id: '4', name: 'Flip Flops', sku: 'FLP-001', priceCents: 800, category: 'Supplies', isActive: false },
  { id: '5', name: 'Padlock', sku: 'LCK-001', priceCents: 600, category: 'Supplies', isActive: true },
  { id: '6', name: 'Snack Bar', sku: 'SNK-001', priceCents: 250, category: 'Food', isActive: true },
];

export function ProductsView() {
  const [filter, setFilter] = useState('');
  const filtered = MOCK_PRODUCTS.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Products</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{MOCK_PRODUCTS.length} items</p>
          </div>
          <Button size="sm">+ Add Product</Button>
        </div>
        <input
          className="mt-4 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
          placeholder="Filter products..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
              {['Name', 'SKU', 'Category', 'Price', 'Status'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{p.name}</td>
                <td className="px-4 py-3 text-sm font-mono" style={{ color: 'var(--color-text-muted)' }}>{p.sku}</td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{p.category}</td>
                <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>${(p.priceCents / 100).toFixed(2)}</td>
                <td className="px-4 py-3"><Badge color={p.isActive ? 'success' : 'gray'} variant="light" size="sm">{p.isActive ? 'Active' : 'Inactive'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
