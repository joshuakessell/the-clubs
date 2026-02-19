import type { NavTab } from './AppLayout';

interface NavItem {
  tab: NavTab;
  label: string;
  fKey: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { tab: 'scan',         label: 'Scan',       fKey: 'F1',  icon: <ScanIcon /> },
  { tab: 'search',       label: 'Search',     fKey: 'F2',  icon: <SearchIcon /> },
  { tab: 'inventory',    label: 'Rentals',    fKey: 'F3',  icon: <KeyIcon /> },
  { tab: 'upgrades',     label: 'Upgrades',   fKey: 'F4',  icon: <UpgradeIcon /> },
  { tab: 'retail',       label: 'Retail',     fKey: 'F5',  icon: <CartIcon /> },
  { tab: 'checkout',     label: 'Checkout',   fKey: 'F6',  icon: <CheckIcon /> },
  { tab: 'account',      label: 'Account',    fKey: 'F7',  icon: <UserIcon /> },
  { tab: 'clubLog',      label: 'Log',        fKey: 'F8',  icon: <LogIcon /> },
  { tab: 'firstTime',    label: 'Manual',     fKey: 'F9',  icon: <PenIcon /> },
  { tab: 'roomCleaning', label: 'Cleaning',   fKey: 'F10', icon: <CleanIcon /> },
];

interface TopNavbarProps {
  activeTab: NavTab;
  onNavigate: (tab: NavTab) => void;
  employeeName: string;
  onSignOut: () => void;
}

export function TopNavbar({ activeTab, onNavigate, employeeName, onSignOut }: TopNavbarProps) {
  return (
    <header
      className="flex items-center border-b px-4"
      style={{
        backgroundColor: 'var(--color-surface-raised)',
        borderColor: 'var(--color-border-default)',
        height: '56px',
        minHeight: '56px',
      }}
    >
      {/* Brand */}
      <div className="mr-6 flex items-center gap-2 shrink-0">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-md"
          style={{ backgroundColor: 'var(--color-accent-glow)', border: '1px solid var(--color-border-accent)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
          Register
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.tab;
          return (
            <button
              key={item.tab}
              onClick={() => onNavigate(item.tab)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-150 whitespace-nowrap shrink-0"
              style={{
                backgroundColor: isActive ? 'var(--color-accent-glow)' : 'transparent',
                color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                border: isActive ? '1px solid var(--color-border-accent)' : '1px solid transparent',
              }}
              title={`${item.label} (${item.fKey})`}
            >
              <span className="w-4 h-4 shrink-0">{item.icon}</span>
              <span>{item.label}</span>
              <span className="text-[9px] opacity-40 hidden xl:inline">{item.fKey}</span>
            </button>
          );
        })}
      </nav>

      {/* Right: session info + sign out */}
      <div className="ml-4 flex items-center gap-3 shrink-0">
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {employeeName}
        </span>
        <button
          onClick={onSignOut}
          className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
          style={{
            color: 'var(--color-status-error)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            backgroundColor: 'rgba(239, 68, 68, 0.05)',
          }}
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}

/* ── Inline SVG icons (small, single-purpose) ──────── */

function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="7" y1="12" x2="17" y2="12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function UpgradeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 8 4-4 4 4" /><path d="M7 4v16" /><path d="M21 12H11" /><path d="M21 16H11" /><path d="M21 20H11" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LogIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function CleanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H2v7l6.29 6.29c.94.94 2.48.94 3.42 0l3.58-3.58c.94-.94.94-2.48 0-3.42L9 5Z" />
      <path d="M6 9.01V9" /><path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19" />
    </svg>
  );
}
