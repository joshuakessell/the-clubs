import { useState } from 'react';
import { ErrorBoundary } from '@the-clubs/ui';
import { IdleScreen } from './screens/IdleScreen';
import { SelectionScreen } from './screens/SelectionScreen';
import { AgreementScreen } from './screens/AgreementScreen';
import { PaymentScreen } from './screens/PaymentScreen';
import { CompleteScreen } from './screens/CompleteScreen';

export type KioskView = 'idle' | 'selection' | 'agreement' | 'payment' | 'complete';

export default function App() {
  const [view, setView] = useState<KioskView>('idle');

  const navigate = (next: KioskView) => setView(next);
  const reset = () => setView('idle');

  return (
    <ErrorBoundary>
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: 'var(--color-surface-base)' }}
      >
        {view === 'idle' && <IdleScreen onStart={() => navigate('selection')} />}
        {view === 'selection' && <SelectionScreen onNext={() => navigate('agreement')} onCancel={reset} />}
        {view === 'agreement' && <AgreementScreen onAccept={() => navigate('payment')} onCancel={reset} />}
        {view === 'payment' && <PaymentScreen onComplete={() => navigate('complete')} onCancel={reset} />}
        {view === 'complete' && <CompleteScreen onDone={reset} />}
      </div>
    </ErrorBoundary>
  );
}
