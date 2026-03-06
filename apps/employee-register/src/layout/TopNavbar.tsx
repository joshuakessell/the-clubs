import { useState, useRef, useEffect } from 'react';
import { Spinner, useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../stores/useRegisterStore';
import type { NavTab } from './AppLayout';

interface NavItem {
  tab: NavTab;
  label: string;
  fKey: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { tab: 'scan', label: 'Scan', fKey: 'F1', icon: <ScanIcon /> },
  { tab: 'inventory', label: 'Rentals', fKey: 'F2', icon: <KeyIcon /> },
  { tab: 'upgrades', label: 'Upgrades', fKey: 'F3', icon: <UpgradeIcon /> },
  { tab: 'retail', label: 'Retail', fKey: 'F4', icon: <CartIcon /> },
  { tab: 'checkout', label: 'Checkout', fKey: 'F5', icon: <CheckIcon /> },
  { tab: 'clubLog', label: 'Log', fKey: 'F6', icon: <LogIcon /> },
  { tab: 'firstTime', label: 'Manual', fKey: 'F7', icon: <PenIcon /> },
  { tab: 'roomCleaning', label: 'Cleaning', fKey: 'F8', icon: <CleanIcon /> },
];

interface TopNavbarProps {
  activeTab: NavTab;
  onNavigate: (tab: NavTab) => void;
  employeeName: string;
  onSignOut: () => void;
}

export function TopNavbar({ activeTab, onNavigate, employeeName, onSignOut }: TopNavbarProps) {
  const {
    laneId,
    customerSearch,
    setCustomerSearch,
    customerSearchLoading,
    customerSuggestions,
    setCustomerSuggestions,
    openCustomerAccount,
    isSubmitting,
  } = useRegisterStore();
  const authToken = useAuthStore((s) => s.session?.sessionToken ?? null);

  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const showDropdown = searchFocused && (customerSuggestions.length > 0 || customerSearchLoading);

  // Detect active theme to pick light vs dark logo
  const [activeTheme, setActiveTheme] = useState(() => document.documentElement.getAttribute('data-theme') ?? '');
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setActiveTheme(document.documentElement.getAttribute('data-theme') ?? '');
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  const isLightTheme = ['theme-arctic-bloom', 'theme-solar-flare'].includes(activeTheme);

  return (
    <div className= "flex flex-col shrink-0" >
    {/* ── Top toolbar: Logo + Search + Session ── */ }
    < div
  className = "flex items-center gap-4 border-b px-4"
  style = {{
    backgroundColor: 'var(--color-surface-raised)',
      borderColor: 'var(--color-border-default)',
        height: '48px',
          minHeight: '48px',
        }
}
      >
  {/* Brand */ }
  < div className = "flex items-center gap-2 shrink-0" >
    <div className="flex h-7 w-7 items-center justify-center overflow-hidden shrink-0" >
      <img
              src={ isLightTheme ? '/club-dallas-logo-black.svg' : '/club-dallas-logo.svg' }
alt = "Club Dallas"
width = "28"
height = "28"
  />
  </div>
  <span className="text-sm font-bold uppercase" style={{ fontFamily: 'var(--font-brand)', color: 'var(--color-text-primary)' }}>
    Club Dallas — Register #{laneId.replace(/\D/g, '') || '1'}
</span>
  </div>

{/* Search field */ }
<div ref={ searchRef } className = "relative flex-1 max-w-xs" >
  <div
            className="flex items-center gap-2 rounded-lg border px-3"
style = {{
  backgroundColor: 'var(--color-surface-input)',
    borderColor: searchFocused ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
      transition: 'border-color 150ms',
            }}
          >
  <SearchIcon />
  < input
type = "text"
className = "h-8 flex-1 bg-transparent text-xs outline-none"
style = {{ color: 'var(--color-text-primary)', outline: 'none' }}
placeholder = "Search customer…"
aria-label="Search customer"
autoComplete = "off"
value = { customerSearch }
onChange = {(e) => setCustomerSearch(e.target.value, authToken)}
onFocus = {() => setSearchFocused(true)}
disabled = { isSubmitting }
  />
  { customerSearchLoading && <Spinner size="sm" />}
</div>

{/* Search dropdown */ }
{
  showDropdown && (
    <div
              className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border shadow-lg"
  style = {{
    backgroundColor: 'var(--color-surface-overlay)',
      borderColor: 'var(--color-border-default)',
              }
}
            >
{
  customerSuggestions.map((s) => {
    const label = `${s.lastName}, ${s.firstName}`;
    return (
      <button
                    key= { s.id }
    type = "button"
    className = "flex w-full items-center justify-between gap-3 border-b px-4 py-2.5 text-left transition"
    style = {{ borderColor: 'var(--color-border-subtle)' }
  }
                    onMouseEnter = {(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-raised)';
}}
onMouseLeave = {(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
onClick = {() => {
  openCustomerAccount(s.id, label, {
    authToken,
    summary: {
      name: `${s.firstName} ${s.lastName}`.trim(),
      dobMonthDay: s.dobMonthDay,
      membershipNumber: s.membershipNumber,
    },
  });
  setCustomerSearch('');
  setCustomerSuggestions([]);
  setSearchFocused(false);
}}
                  >
  <span className="text-sm font-semibold" style = {{ color: 'var(--color-text-primary)' }}>
    { label }
    </span>
    < span className = "flex flex-wrap gap-3 text-xs" style = {{ color: 'var(--color-text-muted)' }}>
      { s.dobMonthDay && <span>DOB: { s.dobMonthDay } </span>}
{ s.membershipNumber && <span>#{ s.membershipNumber } </span> }
</span>
  </button>
                );
              })}
</div>
          )}
</div>

{/* Session info + sign out */ }
<div className="ml-auto flex items-center gap-3 shrink-0" >
  <span className="text-xs" style = {{ color: 'var(--color-text-secondary)' }}>
    { employeeName }
    </span>
    < button
onClick = { onSignOut }
className = "rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
style = {{
  color: 'var(--color-status-error)',
    border: '1px solid color-mix(in oklch, var(--color-status-error) 20%, transparent)',
      backgroundColor: 'color-mix(in oklch, var(--color-status-error) 5%, transparent)',
            }}
          >
  Sign Out
    </button>
    <button
      onClick={ onSignOut }
      className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
      style={{
        color: 'var(--color-status-error)',
        border: '1px solid color-mix(in oklch, var(--color-status-error) 20%, transparent)',
        backgroundColor: 'color-mix(in oklch, var(--color-status-error) 5%, transparent)',
      }}
    >
      Close Out
    </button>
    </div>
    </div>

{/* ── Tab bar ── */ }
<nav
        className="flex items-center gap-0.5 border-b px-4 overflow-x-auto"
style = {{
  backgroundColor: 'var(--color-surface-base)',
    borderColor: 'var(--color-border-default)',
      height: '42px',
        minHeight: '42px',
        }}
      >
{
  NAV_ITEMS.map((item) => {
    const isActive = activeTab === item.tab;
    return (
      <button
              key= { item.tab }
    onClick = {() => onNavigate(item.tab)
  }
              className = "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-150 whitespace-nowrap shrink-0"
              style = {{
    backgroundColor: isActive ? 'var(--color-accent-glow)' : 'transparent',
    color: isActive ? '#1a1a2e' : 'var(--color-text-secondary)',
    border: isActive ? '1px solid var(--color-border-accent)' : '1px solid transparent',
  }}
title = {`${item.label} (${item.fKey})`}
            >
  <span className="w-4 h-4 shrink-0" > { item.icon } </span>
    < span > { item.label } </span>
    < span className = "text-[9px] opacity-40" > { item.fKey } </span>
      </button>
          );
        })}
</nav>
  </div>
  );
}

/* ── Inline SVG icons (small, single-purpose) ──────── */

function ScanIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" aria-hidden="true" >
      <path d="M3 7V5a2 2 0 0 1 2-2h2" /> <path d="M17 3h2a2 2 0 0 1 2 2v2" />
        <path d="M21 17v2a2 2 0 0 1-2 2h-2" /> <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          <line x1="7" y1 = "12" x2 = "17" y2 = "12" />
            </svg>
  );
}

function SearchIcon() {
  return (
    <svg className= "w-4 h-4 shrink-0" viewBox = "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" style = {{ color: 'var(--color-text-muted)' }
} aria-hidden="true" >
  <circle cx="11" cy = "11" r = "8" /> <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" aria-hidden="true" >
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
        </svg>
  );
}

function UpgradeIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" aria-hidden="true" >
      <path d="m3 8 4-4 4 4" /> <path d="M7 4v16" /> <path d="M21 12H11" /> <path d="M21 16H11" /> <path d="M21 20H11" />
        </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" aria-hidden="true" >
      <circle cx="8" cy = "21" r = "1" /> <circle cx="19" cy = "21" r = "1" />
        <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
          </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" aria-hidden="true" >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /> <path d="m9 11 3 3L22 4" />
        </svg>
  );
}



function LogIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" aria-hidden="true" >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" /> <line x1="16" y1 = "13" x2 = "8" y2 = "13" /> <line x1="16" y1 = "17" x2 = "8" y2 = "17" />
          </svg>
  );
}

function PenIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" aria-hidden="true" >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
  );
}

function CleanIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" aria-hidden="true" >
      <path d="M9 5H2v7l6.29 6.29c.94.94 2.48.94 3.42 0l3.58-3.58c.94-.94.94-2.48 0-3.42L9 5Z" />
        <path d="M6 9.01V9" /> <path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19" />
          </svg>
  );
}
