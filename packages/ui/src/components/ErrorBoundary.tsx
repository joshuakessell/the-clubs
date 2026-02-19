import { Component, type ReactNode } from 'react';

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

  componentDidCatch(error: unknown) {
    console.error('App error:', error);
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
              onClick={() => window.location.reload()}
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
