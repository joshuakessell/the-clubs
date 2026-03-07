import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { DashboardHeader } from './DashboardHeader';

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--color-surface-base)' }}>
      {/* Skip link for keyboard/screen-reader users */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-lg focus:bg-[var(--color-surface-raised)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold" style={{ color: 'var(--color-accent-primary)' }}>
        Skip to main content
      </a>

      {/* Permanent static sidebar */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex flex-1 flex-col min-w-0">
        <DashboardHeader />
        <main id="main-content" className="flex-1 min-h-0 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
