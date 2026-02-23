import { useCallback, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary, LockScreen, ChangePinScreen, useAuthStore, useSessionGuard } from '@the-clubs/ui';
import { AppLayout } from './layout/AppLayout';
import { useRegisterSSE } from './hooks/useRegisterSSE';
import { useRegisterStore } from './stores/useRegisterStore';

const kioskToken = (import.meta.env.VITE_KIOSK_TOKEN as string) || null;

export default function App() {
  const session = useAuthStore((s) => s.session);
  const isValidating = useAuthStore((s) => s.isValidating);

  // Validate session on load and intercept 401s to redirect to login
  useSessionGuard();

  // Lane ID from store (derived from URL path)
  const laneId = useRegisterStore((s) => s.laneId);
  const setSessionPayload = useRegisterStore((s) => s.setSessionPayload);

  // Bridge: Expose auth token for store-level API calls (Zustand doesn't have React context)
  useEffect(() => {
    (window as any).__authToken = session?.sessionToken ?? null;
  }, [session?.sessionToken]);

  const onSessionUpdated = useCallback((event: any) => {
    if (import.meta.env.DEV) console.log('[register-sse] SESSION_UPDATED', event);
    // Update store with SSE session payload
    if (event?.payload) {
      setSessionPayload(event.payload);
    }
  }, [setSessionPayload]);

  useRegisterSSE({
    laneId,
    staffToken: session?.sessionToken ?? null,
    kioskToken,
    onSessionUpdated,
  });

  return (
    <ErrorBoundary>
    <BrowserRouter>
    {
      isValidating?(
          <ValidatingScreen />
        ) : !session ? (
    <LockScreen appTitle= "Club Dallas" />
        ) : session.mustChangePin ? (
    <ChangePinScreen />
        ) : (
    <AppLayout />
  )
}
</BrowserRouter>
  </ErrorBoundary>
  );
}

function ValidatingScreen() {
  const clearSession = useAuthStore((s) => s.clearSession);

  return (
    <div
      className= "flex min-h-screen flex-col items-center justify-center gap-4 p-6"
  style = {{ backgroundColor: 'var(--color-surface-base)' }
}
    >
  <div className="h-8 w-8 animate-spin rounded-full border-[3px]"
style = {{ borderColor: 'var(--color-border-strong)', borderTopColor: 'var(--color-accent-primary)' }}
      />
  < h3 className = "text-lg font-semibold" style = {{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
    Validating session…
</h3>
  < button
onClick = { clearSession }
className = "rounded-lg px-4 py-2 text-sm"
style = {{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-default)' }}
      >
  Return to Login
    </button>
    </div>
  );
}
