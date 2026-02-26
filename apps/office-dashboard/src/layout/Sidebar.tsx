import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@the-clubs/ui';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

/** Nav items visible only to ADMIN users */
const ADMIN_NAV: NavItem[] = [
  { to: '/overview', label: 'Overview', icon: <MapPinIcon /> },
  { to: '/monitor', label: 'Monitor', icon: <MonitorIcon /> },
  { to: '/waitlist', label: 'Waitlist', icon: <ListIcon /> },
  { to: '/reports', label: 'Reports', icon: <BarChartIcon /> },
  { to: '/analytics', label: 'Analytics', icon: <TrendIcon /> },
  { to: '/products', label: 'Products', icon: <PackageIcon /> },
  { to: '/customers', label: 'Customers', icon: <UsersIcon /> },
  { to: '/logs', label: 'Logs', icon: <FilesIcon /> },
  { to: '/late-alerts', label: 'Late Alerts', icon: <AlertIcon /> },
  { to: '/staff', label: 'Staff', icon: <StaffIcon /> },
  { to: '/timeclock', label: 'Timeclock', icon: <ClockIcon /> },
  { to: '/devices', label: 'Devices', icon: <DeviceIcon /> },
];

/** Nav items visible to all roles */
const SHARED_NAV: NavItem[] = [
  { to: '/schedule', label: 'Schedule', icon: <CalendarIcon /> },
  { to: '/messages', label: 'Messages', icon: <ChatIcon /> },
];

export function Sidebar() {
  const session = useAuthStore((s) => s.session);
  const role = session?.role ?? 'STAFF';

  const visibleItems = role === 'ADMIN'
    ? [...ADMIN_NAV, ...SHARED_NAV]
    : SHARED_NAV;

  const [activeTheme, setActiveTheme] = useState(() => document.documentElement.getAttribute('data-theme') ?? '');
  useEffect(() => {
    const obs = new MutationObserver(() => setActiveTheme(document.documentElement.getAttribute('data-theme') ?? ''));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  const isLightTheme = ['theme-arctic-bloom', 'theme-solar-flare'].includes(activeTheme);

  return (
    <aside
      className= "flex w-56 shrink-0 flex-col border-r"
  style = {{
    backgroundColor: 'var(--color-surface-raised)',
      borderColor: 'var(--color-border-default)',
      }
}
    >
  {/* Brand */ }
  < div className = "flex items-center gap-2.5 border-b px-5 py-4"
style = {{ borderColor: 'var(--color-border-default)' }}
      >
  <div
          className="flex h-8 w-8 items-center justify-center overflow-hidden shrink-0"
  >
  <img src={ isLightTheme ? '/club-dallas-logo-black.svg' : '/club-dallas-logo.svg' } alt = "Club Dallas" width = "32" height = "32" />
    </div>
    < div >
    <span className="text-sm font-bold block uppercase" style={{ fontFamily: 'var(--font-brand)', color: 'var(--color-text-primary)' }}>
      Club Dallas
        </span>
        < span className = "text-[10px] uppercase tracking-wider" style = {{ color: 'var(--color-text-muted)' }}>
          Dashboard
          </span>
          </div>
          </div>

{/* Nav items */ }
<nav className="flex-1 overflow-y-auto px-3 py-3" >
  <ul className="flex flex-col gap-0.5" >
  {
    visibleItems.map((item) => (
      <li key= { item.to } >
      <NavLink
                to={ item.to }
                className = {({ isActive }) =>
      `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150 ${isActive ? 'nav-active' : 'nav-inactive'
      }`
                }
style = {({ isActive }) => ({
  backgroundColor: isActive ? 'var(--color-accent-glow)' : 'transparent',
  color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
  border: isActive ? '1px solid var(--color-border-accent)' : '1px solid transparent',
})}
              >
  <span className="w-4 h-4 shrink-0" > { item.icon } </span>
{ item.label }
</NavLink>
  </li>
          ))}
</ul>
  </nav>

{/* Footer: session info */ }
<div className="border-t px-4 py-3" style = {{ borderColor: 'var(--color-border-default)' }}>
  <div className="text-[11px]" style = {{ color: 'var(--color-text-muted)' }}>
    Signed in as
    </div>
    < div className = "mt-0.5 text-xs font-medium" style = {{ color: 'var(--color-text-secondary)' }}>
      { session?.name ?? 'Unknown'}
</div>
  < div className = "mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
style = {{
  backgroundColor: role === 'ADMIN' ? 'rgba(0, 212, 255, 0.1)' : 'rgba(59, 130, 246, 0.1)',
    color: role === 'ADMIN' ? 'var(--color-accent-primary)' : 'var(--color-accent-secondary)',
          }}
        >
  { role }
  </div>
  </div>
  </aside>
  );
}

/* ── Inline SVG icons ──────────────────────────────── */
function MapPinIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /> <circle cx="12" cy = "10" r = "3" />
        </svg>
  );
}
function MonitorIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <rect x="2" y = "3" width = "20" height = "14" rx = "2" /> <line x1="8" y1 = "21" x2 = "16" y2 = "21" /> <line x1="12" y1 = "17" x2 = "12" y2 = "21" />
        </svg>
  );
}
function ListIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <line x1="8" y1 = "6" x2 = "21" y2 = "6" /> <line x1="8" y1 = "12" x2 = "21" y2 = "12" /> <line x1="8" y1 = "18" x2 = "21" y2 = "18" />
        <line x1="3" y1 = "6" x2 = "3.01" y2 = "6" /> <line x1="3" y1 = "12" x2 = "3.01" y2 = "12" /> <line x1="3" y1 = "18" x2 = "3.01" y2 = "18" />
          </svg>
  );
}
function BarChartIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <line x1="12" y1 = "20" x2 = "12" y2 = "10" /> <line x1="18" y1 = "20" x2 = "18" y2 = "4" /> <line x1="6" y1 = "20" x2 = "6" y2 = "16" />
        </svg>
  );
}
function TrendIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /> <polyline points="17 6 23 6 23 12" />
        </svg>
  );
}
function PackageIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <path d="m16.5 9.4-9-5.19" /> <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.29 7 12 12 20.71 7" /> <line x1="12" y1 = "22" x2 = "12" y2 = "12" />
          </svg>
  );
}
function UsersIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /> <circle cx="9" cy = "7" r = "4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /> <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
  );
}
function FilesIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" /> <line x1="16" y1 = "13" x2 = "8" y2 = "13" /> <line x1="16" y1 = "17" x2 = "8" y2 = "17" />
          </svg>
  );
}
function AlertIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1 = "9" x2 = "12" y2 = "13" /> <line x1="12" y1 = "17" x2 = "12.01" y2 = "17" />
          </svg>
  );
}
function CalendarIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <rect x="3" y = "4" width = "18" height = "18" rx = "2" /> <line x1="16" y1 = "2" x2 = "16" y2 = "6" /> <line x1="8" y1 = "2" x2 = "8" y2 = "6" />
        <line x1="3" y1 = "10" x2 = "21" y2 = "10" />
          </svg>
  );
}
function ChatIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
  );
}
function StaffIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /> <circle cx="8.5" cy = "7" r = "4" />
        <path d="M20 8v6" /> <path d="M23 11h-6" />
          </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <circle cx="12" cy = "12" r = "10" /> <polyline points="12 6 12 12 16 14" />
        </svg>
  );
}
function DeviceIcon() {
  return (
    <svg viewBox= "0 0 24 24" fill = "none" stroke = "currentColor" strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round" >
      <rect x="5" y = "2" width = "14" height = "20" rx = "2" /> <line x1="12" y1 = "18" x2 = "12.01" y2 = "18" />
        </svg>
  );
}
