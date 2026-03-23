import { Component, type ReactNode, type ErrorInfo } from 'react';
import { getApiUrl } from '@the-clubs/shared';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('App error:', error);
    try {
      const err = error instanceof Error ? error : new Error(String(error));
      void fetch(getApiUrl('/api/v1/telemetry/crash'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: err.message,
          stack: err.stack,
          componentStack: info.componentStack,
          url: globalThis.window?.location?.href,
          userAgent: globalThis.navigator?.userAgent
        })
      }).catch(console.error);
    } catch (e) {
      console.error('Failed to report telemetry', e);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div
            className="flex min-h-screen flex-col items-center justify-center gap-4 p-8"
            style={{ backgroundColor: 'var(--color-surface-base)', color: 'var(--color-text-primary)' }}
          >
            <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              Something went wrong
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Please reload the page. If the issue persists, contact support.
            </p>
            <button
              onClick={() => globalThis.location.reload()}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: 'var(--color-accent-primary)',
                color: 'var(--color-text-inverse)',
              }}
            >
              Reload
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
