import { useAuthStore } from '../stores/authStore';

/**
 * ValidatingScreen — Full-screen session validation spinner.
 * Shared between employee-register and office-dashboard while
 * the auth store is checking a stored session token.
 */
export function ValidatingScreen() {
  const clearSession = useAuthStore((s) => s.clearSession);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 bg-surface-base">
      <div
        className="h-8 w-8 animate-spin rounded-full border-[3px] border-border-strong border-t-accent-primary"
      />
      <h3 className="text-lg font-semibold text-text-primary font-display">
        Validating session…
      </h3>
      <button
        onClick={clearSession}
        className="rounded-lg px-4 py-2 text-sm text-text-secondary border border-border-default hover:opacity-80 transition-opacity"
      >
        Return to Login
      </button>
    </div>
  );
}
