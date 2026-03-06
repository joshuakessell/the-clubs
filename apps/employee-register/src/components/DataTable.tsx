import { useEffect, useRef, useCallback, type ReactNode } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DataTableColumn<T> {
  /** Unique key for the column */
  key: string;
  /** Column header label */
  header: string;
  /** Render cell content */
  render: (row: T, index: number) => ReactNode;
  /** Column width (CSS value) */
  width?: string;
  /** Right-align the column (e.g. for numbers) */
  align?: 'left' | 'center' | 'right';
  /** Apply tabular-nums to this column */
  numeric?: boolean;
}

export interface DataTableProps<T> {
  /** Column definitions */
  columns: DataTableColumn<T>[];
  /** Row data */
  data: T[];
  /** Unique key extractor */
  rowKey: (row: T) => string;
  /** Called when a row is clicked */
  onRowClick?: (row: T) => void;
  /** Set of selected row keys (enables checkboxes) */
  selectedKeys?: Set<string>;
  /** Called when selection toggles */
  onSelectionChange?: (keys: Set<string>) => void;
  /** Single active row key (highlight without checkbox — for detail panel pattern) */
  activeKey?: string | null;
  /** Sticky header for scrollable containers */
  stickyHeader?: boolean;
  /** Skip outer border wrapper (for embedding in split layouts) */
  bare?: boolean;
  /** Empty state message */
  emptyMessage?: string;
  /** Empty state icon */
  emptyIcon?: string;
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** Select-all checkbox with indeterminate support */
function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label="Select all rows"
      style={{
        cursor: 'pointer',
        accentColor: 'var(--color-accent-primary)',
        width: 16,
        height: 16,
      }}
    />
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  borderBottom: '1px solid var(--color-border-default)',
  letterSpacing: '0.08em',
};

// ── Main Component ───────────────────────────────────────────────────────────

/**
 * DataTable — Shared table with consistent styling across all panels.
 *
 * Features:
 * - Alternating row colors
 * - Hover highlight
 * - Optional row selection with checkboxes (select-all + indeterminate)
 * - Tabular numbers on numeric columns
 * - Clickable rows
 * - Empty state
 *
 * Follows Vercel React patterns:
 * - Extracted sub-components (composition)
 * - Functional setState via useCallback
 * - Ternary conditionals
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  selectedKeys,
  onSelectionChange,
  activeKey,
  stickyHeader = false,
  bare = false,
  emptyMessage = 'No data',
  emptyIcon = '📋',
}: DataTableProps<T>) {
  const hasSelection = selectedKeys !== undefined && onSelectionChange !== undefined;

  // ── Selection handlers ────────────────────────────────────────────────

  const toggleRow = useCallback(
    (key: string) => {
      if (!selectedKeys || !onSelectionChange) return;
      const next = new Set(selectedKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onSelectionChange(next);
    },
    [selectedKeys, onSelectionChange],
  );

  const toggleAll = useCallback(() => {
    if (!onSelectionChange) return;
    const allKeys = data.map(rowKey);
    const allSelected = selectedKeys?.size === allKeys.length;
    onSelectionChange(allSelected ? new Set() : new Set(allKeys));
  }, [data, rowKey, selectedKeys, onSelectionChange]);

  const allSelected = data.length > 0 && selectedKeys?.size === data.length;
  const someSelected = (selectedKeys?.size ?? 0) > 0 && !allSelected;

  // ── Render ────────────────────────────────────────────────────────────

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12">
        <span className="text-3xl">{emptyIcon}</span>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {emptyMessage}
        </p>
      </div>
    );
  }


  return (
    <div
      className={bare ? '' : 'overflow-hidden rounded-xl border'}
      style={bare ? undefined : {
        borderColor: 'var(--color-border-default)',
        boxShadow: '0 1px 3px 0 rgba(0,0,0,0.06)',
      }}
    >
      <table className="w-full text-left text-sm" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr
            style={{
              backgroundColor: 'var(--color-surface-overlay)',
              ...(stickyHeader ? { position: 'sticky' as const, top: 0, zIndex: 1 } : {}),
            }}
          >
            {hasSelection ? (
              <th className="w-12 px-3 py-3 text-center" style={thStyle}>
                <SelectAllCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                />
              </th>
            ) : null}
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-3 py-3 text-xs font-semibold uppercase tracking-wider"
                style={{
                  ...thStyle,
                  width: col.width,
                  textAlign: col.align ?? 'left',
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => {
            const key = rowKey(row);
            const isChecked = selectedKeys?.has(key) ?? false;
            const isActive = activeKey === key;
            const isHighlighted = isChecked || isActive;
            const isOdd = idx % 2 === 1;
            const clickable = onRowClick || hasSelection;

            return (
              <tr
                key={key}
                onClick={() => {
                  if (hasSelection) toggleRow(key);
                  onRowClick?.(row);
                }}
                style={{
                  cursor: clickable ? 'pointer' : undefined,
                  backgroundColor: isHighlighted
                    ? 'color-mix(in oklch, var(--color-accent-primary) 10%, transparent)'
                    : isOdd
                      ? 'var(--color-surface-overlay)'
                      : 'var(--color-surface-card, var(--color-surface-raised))',
                  borderBottom: '1px solid var(--color-border-default)',
                  borderLeft: isActive
                    ? '2px solid var(--color-accent-primary)'
                    : '2px solid transparent',
                  transition: 'background-color 0.12s ease',
                }}
                onMouseEnter={
                  clickable
                    ? (e) => {
                        if (!isHighlighted) {
                          e.currentTarget.style.backgroundColor =
                            'color-mix(in oklch, var(--color-accent-primary) 5%, transparent)';
                        }
                      }
                    : undefined
                }
                onMouseLeave={
                  clickable
                    ? (e) => {
                        if (!isHighlighted) {
                          e.currentTarget.style.backgroundColor = isOdd
                            ? 'var(--color-surface-overlay)'
                            : 'var(--color-surface-card, var(--color-surface-raised))';
                        }
                      }
                    : undefined
                }
              >
                {hasSelection ? (
                  <td className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleRow(key)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select row ${key}`}
                      style={{
                        cursor: 'pointer',
                        accentColor: 'var(--color-accent-primary)',
                        width: 16,
                        height: 16,
                      }}
                    />
                  </td>
                ) : null}
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 py-3 ${col.numeric ? 'tabular-nums' : ''}`}
                    style={{ textAlign: col.align ?? 'left' }}
                  >
                    {col.render(row, idx)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
