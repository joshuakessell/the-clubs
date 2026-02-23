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

export default function App() {
  const session = useAuthStore((s) => s.session);
  const isValidating = useAuthStore((s) => s.isValidating);

  // Validate session on load and intercept 401s to redirect to login
  useSessionGuard();

  return (
    <ErrorBoundary>
    <BrowserRouter>
    {
      isValidating?(
          <div
            className = "flex min-h-screen flex-col items-center justify-center gap-4 p-6"
            style = {{ backgroundColor: 'var(--color-surface-base)' }}
    >
    <div className= "h-8 w-8 animate-spin rounded-full border-[3px]"
  style = {{ borderColor: 'var(--color-border-strong)', borderTopColor: 'var(--color-accent-primary)' }
}
            />
  < h3 className = "text-lg font-semibold" style = {{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
    Validating session…
</h3>
  </div>
        ) : !session ? (
  <LockScreen appTitle= "Office Dashboard" />
        ) : session.mustChangePin ? (
  <ChangePinScreen />
        ) : (
  <DashboardLayout>
  <Routes>
  <Route path= "/overview" element = {< OverviewView />} />
    < Route path = "/monitor" element = {< MonitorView />} />
      < Route path = "/waitlist" element = {< WaitlistView />} />
        < Route path = "/reports" element = {< ReportsView />} />
          < Route path = "/analytics" element = {< AnalyticsView />} />
            < Route path = "/products" element = {< ProductsView />} />
              < Route path = "/customers" element = {< CustomersView />} />
                < Route path = "/logs" element = {< LogsView />} />
                  < Route path = "/late-alerts" element = {< LateAlertsView />} />
                    < Route path = "/schedule" element = {< ScheduleView />} />
                      < Route path = "/messages" element = {< MessagesView />} />
                        < Route path = "/staff" element = {< StaffView />} />
                          < Route path = "/timeclock" element = {< TimeclockView />} />
                            < Route path = "/devices" element = {< DevicesView />} />
                              < Route path = "*" element = {< Navigate to = "/overview" replace />} />
                                </Routes>
                                </DashboardLayout>
        )}
</BrowserRouter>
  </ErrorBoundary>
  );
}
