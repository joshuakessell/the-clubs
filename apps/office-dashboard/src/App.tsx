import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary, LockScreen, ChangePinScreen, useAuthStore, useSessionGuard } from '@the-clubs/ui';
import { DashboardLayout } from './layout/DashboardLayout';
import { OverviewView } from './views/OverviewView';
import { MonitorView } from './views/MonitorView';
import { WaitlistView } from './views/WaitlistView';
import { ReportsView } from './views/ReportsView';
import { AnalyticsView } from './views/AnalyticsView';
import { ProductsView } from './views/ProductsView';
import { CustomersView } from './views/CustomersView';
import { LogsView } from './views/LogsView';
import { LateAlertsView } from './views/LateAlertsView';
import { ScheduleView } from './views/ScheduleView';
import { MessagesView } from './views/MessagesView';
import { StaffView } from './views/StaffView';
import { TimeclockView } from './views/TimeclockView';
import { DevicesView } from './views/DevicesView';
import { RoomManagementView } from './views/RoomManagementView';

/**
 * Route guard: renders children only if user has ADMIN role,
 * otherwise redirects to the staff default route.
 */
function AdminOnly({ children }: Readonly<{ children: React.ReactNode }>) {
  const role = useAuthStore((s) => s.session?.role);
  if (role !== 'ADMIN') return <Navigate to="/schedule" replace />;
  return <>{children}</>;
}

export default function App() {
  const session = useAuthStore((s) => s.session);
  const isValidating = useAuthStore((s) => s.isValidating);

  // Validate session on load and intercept 401s to redirect to login
  useSessionGuard();

  // Default landing page depends on role
  const defaultRoute = session?.role === 'ADMIN' ? '/overview' : '/schedule';

  function renderContent() {
    if (isValidating) {
      return (
        <div
          className="flex min-h-screen flex-col items-center justify-center gap-4 p-6"
          style={{ backgroundColor: 'var(--color-surface-base)' }}
        >
          <div
            className="h-8 w-8 animate-spin rounded-full border-[3px]"
            style={{ borderColor: 'var(--color-border-strong)', borderTopColor: 'var(--color-accent-primary)' }}
          />
          <h3
            className="text-lg font-semibold"
            style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
          >
            Validating session…
          </h3>
        </div>
      );
    }

    if (!session) {
      return <LockScreen appTitle="Office Dashboard" />;
    }

    if (session.mustChangePin) {
      return <ChangePinScreen />;
    }

    return (
      <DashboardLayout>
        <Routes>
          {/* Admin-only routes */}
          <Route path="/overview" element={<AdminOnly><OverviewView /></AdminOnly>} />
          <Route path="/monitor" element={<AdminOnly><MonitorView /></AdminOnly>} />
          <Route path="/waitlist" element={<AdminOnly><WaitlistView /></AdminOnly>} />
          <Route path="/reports" element={<AdminOnly><ReportsView /></AdminOnly>} />
          <Route path="/analytics" element={<AdminOnly><AnalyticsView /></AdminOnly>} />
          <Route path="/products" element={<AdminOnly><ProductsView /></AdminOnly>} />
          <Route path="/customers" element={<AdminOnly><CustomersView /></AdminOnly>} />
          <Route path="/logs" element={<AdminOnly><LogsView /></AdminOnly>} />
          <Route path="/late-alerts" element={<AdminOnly><LateAlertsView /></AdminOnly>} />
          <Route path="/staff" element={<AdminOnly><StaffView /></AdminOnly>} />
          <Route path="/timeclock" element={<AdminOnly><TimeclockView /></AdminOnly>} />
          <Route path="/devices" element={<AdminOnly><DevicesView /></AdminOnly>} />
          <Route path="/rooms" element={<AdminOnly><RoomManagementView /></AdminOnly>} />

          {/* Shared routes (ADMIN + STAFF) */}
          <Route path="/schedule" element={<ScheduleView />} />
          <Route path="/messages" element={<MessagesView />} />

          {/* Catch-all: redirect to role-appropriate default */}
          <Route path="*" element={<Navigate to={defaultRoute} replace />} />
        </Routes>
      </DashboardLayout>
    );
  }

  return (
    <ErrorBoundary>
      <BrowserRouter>
        {renderContent()}
      </BrowserRouter>
    </ErrorBoundary>
  );
}
