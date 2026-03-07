import { useState, useCallback } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

interface Product {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  category: string;
  isActive: boolean;
  sortOrder: number;
}

export function ProductsView() {
  const [filter, setFilter] = useState('');
  const { data, loading, error, refetch } = useDashboardFetch<{ products: Product[] }>(
    '/api/v1/admin/products?includeInactive=true',
  );
  const products = data?.products ?? [];
  const filtered = products.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));

  /* ── Create product form state ── */
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');

  /** Auto-generate SKU from name: lowercase, dashes between words */
  const autoSku = (name: string) =>
    name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const handleCreate = useCallback(async () => {
    if (!newName || !newPrice) return;
    try {
      await dashboardMutate('/api/v1/admin/products', 'POST', {
        name: newName,
        price: parseFloat(newPrice),
        sku: autoSku(newName),
        category: 'RETAIL',
      });
      setNewName(''); setNewPrice('');
      setShowCreate(false);
      refetch();
    } catch { /* ignore */ }
  }, [newName, newPrice, refetch]);

  const handleToggle = useCallback(async (id: string, isActive: boolean) => {
    try {
      await dashboardMutate(`/api/v1/admin/products/${id}`, 'PATCH', { isActive: !isActive });
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Products</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{products.length} items</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>+ Add Product</Button>
        </div>

        {showCreate && (
          <div className="mt-4 flex items-end gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-input)' }}>
            <div className="flex-1">
              <label htmlFor="productName" className="mb-1 block text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Name</label>
              <input id="productName" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
                style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
                placeholder="e.g. Energy Drink" value={newName} onChange={(e) => setNewName(e.target.value)} />
              {newName && (
                <p className="mt-1 text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
                  SKU: {autoSku(newName)}
                </p>
              )}
            </div>
            <div className="w-28">
              <label htmlFor="productPrice" className="mb-1 block text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Price ($)</label>
              <input id="productPrice" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
                style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
                placeholder="0.00" type="number" step="0.01" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
            </div>
            <Button size="sm" onClick={handleCreate}>Create</Button>
          </div>
        )}

        <input
          className="mt-4 w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
          style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
          placeholder="Filter products…"
          aria-label="Filter products"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {loading && products.length === 0 ? (
        <ViewSpinner />
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                {['Name', 'SKU', 'Category', 'Price', 'Status', ''].map((h) => (
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
                  <td className="px-4 py-3 text-sm font-mono" style={{ color: 'var(--color-text-muted)' }}>{p.sku ?? '—'}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{p.category}</td>
                  <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>${p.price.toFixed(2)}</td>
                  <td className="px-4 py-3"><Badge color={p.isActive ? 'success' : 'gray'} variant="light" size="sm">{p.isActive ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="ghost" onClick={() => handleToggle(p.id, p.isActive)}>
                      {p.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    No products found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
