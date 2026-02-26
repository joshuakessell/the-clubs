/**
 * Customer Kiosk App — Uses KioskSessionProvider for shared state.
 *
 * Screens consume session payload, view, and navigation from context
 * instead of receiving drilled props.
 */
import { ErrorBoundary } from '@the-clubs/ui';
import { IdleScreen } from './screens/IdleScreen';
import { AgreementScreen } from './screens/AgreementScreen';
import { CompleteScreen } from './screens/CompleteScreen';
import { LaneSelectScreen } from './screens/LaneSelectScreen';
import { I18nProvider } from './i18n';
import {
  KioskSessionProvider,
  useKioskSession,
  parseLaneFromPath,
  LANES,
} from './KioskSessionContext';

export type { KioskView } from './KioskSessionContext';

export default function App() {
  const laneId = parseLaneFromPath();

  // No lane selected → show lane picker
  if (!laneId) {
    return (
      <ErrorBoundary>
        <I18nProvider lang="EN">
          <LaneSelectScreen
            lanes={LANES.map((l) => ({ slug: l.slug, label: l.label }))}
          />
        </I18nProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <KioskSessionProvider laneId={laneId}>
        <KioskContent />
      </KioskSessionProvider>
    </ErrorBoundary>
  );
}

/** Inner content — must be inside provider to use context. */
function KioskContent() {
  const { view, sessionPayload } = useKioskSession();
  const language = sessionPayload?.customerPrimaryLanguage ?? 'EN';

  return (
    <I18nProvider lang={language as 'EN' | 'ES'}>
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: 'var(--color-surface-base)' }}
      >
        {(view === 'idle' || view === 'checkin') && <IdleScreen />}
        {view === 'agreement' && <AgreementScreen />}
        {view === 'complete' && <CompleteScreen />}
      </div>
    </I18nProvider>
  );
}
