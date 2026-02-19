import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary, LockScreen, useAuthStore } from '@the-clubs/ui';
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

export default function App() {
  const session = useAuthStore((s) => s.session);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        {!session ? (
          <LockScreen appTitle="Office Dashboard" />
        ) : (
          <DashboardLayout>
            <Routes>
              <Route path="/overview" element={<OverviewView />} />
              <Route path="/monitor" element={<MonitorView />} />
              <Route path="/waitlist" element={<WaitlistView />} />
              <Route path="/reports" element={<ReportsView />} />
              <Route path="/analytics" element={<AnalyticsView />} />
              <Route path="/products" element={<ProductsView />} />
              <Route path="/customers" element={<CustomersView />} />
              <Route path="/logs" element={<LogsView />} />
              <Route path="/late-alerts" element={<LateAlertsView />} />
              <Route path="/schedule" element={<ScheduleView />} />
              <Route path="/messages" element={<MessagesView />} />
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </DashboardLayout>
        )}
      </BrowserRouter>
    </ErrorBoundary>
  );
}
