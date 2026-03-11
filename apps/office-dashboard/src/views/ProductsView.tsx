import { useState, useCallback } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

/* ── Types ─────────────────────────────────────────────────────── */

interface Product {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  category: string;
  isActive: boolean;
  sortOrder: number;
}

type CategoryTab = 'ALL' | 'RETAIL' | 'MEMBERSHIP' | 'RENTAL' | 'ADDON';

const CATEGORIES: { key: CategoryTab; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'RETAIL', label: 'Retail' },
  { key: 'MEMBERSHIP', label: 'Membership' },
  { key: 'RENTAL', label: 'Rental' },
  { key: 'ADDON', label: 'Add-ons' },
];

/* ── Component ─────────────────────────────────────────────────── */

export function ProductsView() {
  const [filter, setFilter] = useState('');
  const [categoryTab, setCategoryTab] = useState<CategoryTab>('ALL');
  const { data, loading, error, refetch } = useDashboardFetch<{ products: Product[] }>(
    '/api/v1/admin/products?includeInactive=true',
  );
  const products = data?.products ?? [];
  const filtered = products
    .filter((p) => categoryTab === 'ALL' || p.category === categoryTab)
    .filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));

  /* ── Create form state ── */
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');

  /* ── Edit state ── */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');

  const autoSku = (name: string) =>
    name.trim().toLowerCase().replaceAll(/\s+/g, '-').replaceAll(/[^a-z0-9-]/g, '');

  const handleCreate = useCallback(async () => {
    if (!newName || !newPrice) return;
    try {
      await dashboardMutate('/api/v1/admin/products', 'POST', {
        name: newName, price: Number.parseFloat(newPrice), sku: autoSku(newName), category: 'RETAIL',
      });
      setNewName(''); setNewPrice(''); setShowCreate(false);
      refetch();
    } catch { /* ignore */ }
  }, [newName, newPrice, refetch]);

  const handleToggle = useCallback(async (id: string, isActive: boolean) => {
    try {
      await dashboardMutate(`/api/v1/admin/products/${id}`, 'PATCH', { isActive: !isActive });
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditPrice(p.price.toString());
  };

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editName || !editPrice) return;
    try {
      await dashboardMutate(`/api/v1/admin/products/${editingId}`, 'PATCH', {
        name: editName, price: Number.parseFloat(editPrice),
      });
      setEditingId(null);
      refetch();
    } catch { /* ignore */ }
  }, [editingId, editName, editPrice, refetch]);

  const categoryCounts = CATEGORIES.map((c) => ({
    ...c,
    count: c.key === 'ALL' ? products.length : products.filter((p) => p.category === c.key).length,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold font-(--font-display) text-(--color-text-primary)">Products</h2>
            <p className="text-sm text-(--color-text-muted)">{products.length} items</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>+ Add Product</Button>
        </div>

        {showCreate && (
          <div className="mt-4 flex items-end gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-input)' }}>
            <div className="flex-1">
              <label htmlFor="productName" className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-(--color-text-muted)">Name</label>
              <input id="productName" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
                style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
                placeholder="e.g. Energy Drink" value={newName} onChange={(e) => setNewName(e.target.value)} />
              {newName && <p className="mt-1 text-[10px] font-mono text-(--color-text-muted)">SKU: {autoSku(newName)}</p>}
            </div>
            <div className="w-28">
              <label htmlFor="productPrice" className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-(--color-text-muted)">Price ($)</label>
              <input id="productPrice" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
                style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
                placeholder="0.00" type="number" step="0.01" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
            </div>
            <Button size="sm" onClick={handleCreate}>Create</Button>
          </div>
        )}

        {/* Category tabs + text filter */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex rounded-lg border" style={{ borderColor: 'var(--color-border-default)' }}>
            {categoryCounts.map((c) => (
              <button key={c.key} type="button"
                className="px-3 py-1.5 text-xs font-medium transition"
                style={{
                  backgroundColor: categoryTab === c.key ? 'var(--color-accent-primary)' : 'transparent',
                  color: categoryTab === c.key ? '#fff' : 'var(--color-text-muted)',
                  borderRadius: 'calc(0.5rem - 1px)',
                }}
                onClick={() => setCategoryTab(c.key)}>
                {c.label} ({c.count})
              </button>
            ))}
          </div>
          <input
            className="flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
            placeholder="Filter by name…" aria-label="Filter products" value={filter} onChange={(e) => setFilter(e.target.value)}
          />
        </div>
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
                {['Name', 'SKU', 'Category', 'Price', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3">
                    {editingId === p.id ? (
                      <input className="w-full rounded border px-2 py-1 text-sm outline-none"
                        style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-accent-primary)', color: 'var(--color-text-primary)' }}
                        value={editName} onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveEdit(); if (e.key === 'Escape') setEditingId(null); }} />
                    ) : (
                      <span className="text-sm font-semibold text-(--color-text-primary)">{p.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-(--color-text-muted)">{p.sku ?? '—'}</td>
                  <td className="px-4 py-3"><Badge color="gray" variant="light" size="sm">{p.category}</Badge></td>
                  <td className="px-4 py-3">
                    {editingId === p.id ? (
                      <input className="w-20 rounded border px-2 py-1 text-sm outline-none"
                        style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-accent-primary)', color: 'var(--color-text-primary)' }}
                        type="number" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveEdit(); if (e.key === 'Escape') setEditingId(null); }} />
                    ) : (
                      <span className="text-sm font-bold tabular-nums text-(--color-accent-primary)">${p.price.toFixed(2)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><Badge color={p.isActive ? 'success' : 'gray'} variant="light" size="sm">{p.isActive ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {editingId === p.id ? (
                        <>
                          <Button size="sm" variant="primary" onClick={() => void handleSaveEdit()}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => startEdit(p)}>Edit</Button>
                          <Button size="sm" variant="ghost" onClick={() => handleToggle(p.id, p.isActive)}>
                            {p.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-(--color-text-muted)">
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
