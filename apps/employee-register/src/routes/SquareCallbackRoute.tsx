import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';

export function SquareCallbackRoute() {
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.session?.sessionToken);

  useEffect(() => {
    async function handleCallback() {
      try {
        const laneId = globalThis.sessionStorage.getItem('square_checkout_lane_id') || 'register';
        const searchParams = new URLSearchParams(location.search);
        const dataParam = searchParams.get('data');

        if (!dataParam) {
          setError('No data received from Square POS.');
          setTimeout(() => navigate(laneId.startsWith('lane-') ? `/${laneId}` : '/register'), 3000);
          return;
        }

        let parsed: any;
        try {
          parsed = JSON.parse(decodeURIComponent(dataParam));
        } catch {
          setError('Invalid data received from Square POS.');
          setTimeout(() => navigate(laneId.startsWith('lane-') ? `/${laneId}` : '/register'), 3000);
          return;
        }

        if (parsed.error_code) {
          // Transaction cancelled or failed
          setError(`Square Error: ${parsed.error_code}`);
          setTimeout(() => navigate(laneId.startsWith('lane-') ? `/${laneId}` : '/register'), 3000);
          return;
        }

        // Send to backend to mark paid
        // Assuming the transaction ID is returned in `transaction_id` or similar
        // Square POS App Switch returns: { transaction_id: "...", client_transaction_id: "..." }
        const { transaction_id, client_transaction_id } = parsed;
        
        // Wait, we need the PostgreSQL order ID! We stored it in notes, but notes isn't returned natively in the success payload.
        // We can just store the orderId in sessionStorage along with laneId!
        const orderId = globalThis.sessionStorage.getItem('square_checkout_order_id');

        if (!orderId) {
          setError('Lost order tracking. Please check the checkout tab.');
          setTimeout(() => navigate(laneId.startsWith('lane-') ? `/${laneId}` : '/register'), 3000);
          return;
        }

        // Call the backend endpoint to mark it paid
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(getApiUrl(`/api/v1/payments/${orderId}/mark-paid`), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            squareTransactionId: transaction_id || client_transaction_id || 'manual-square-pos',
            paymentMethod: 'CREDIT', // we don't strictly know if they used cash, Square POS tracks it internally.
          }),
        });

        if (!res.ok) {
          throw new Error('Failed to mark payment complete on our server.');
        }

        // Navigate back to the lane!
        globalThis.sessionStorage.removeItem('square_checkout_lane_id');
        globalThis.sessionStorage.removeItem('square_checkout_order_id');
        navigate(`/${laneId}`);
        
      } catch (err: any) {
        console.error('Square callback error:', err);
        setError(err.message || 'An unexpected error occurred finalizing payment.');
      }
    }
    handleCallback();
  }, [location.search, navigate, token]);

  if (error) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center p-8 text-center bg-(--color-background) text-(--color-text-primary)">
        <div className="rounded-2xl border bg-(--color-surface-overlay) p-8 shadow-xl max-w-md w-full border-(--color-border-default)">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="mb-2 text-xl font-bold">Payment Error</h2>
          <p className="text-(--color-text-muted) mb-6">{error}</p>
          <p className="text-sm font-semibold text-(--color-text-primary)">Returning to register...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-(--color-background)">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-(--color-accent-primary) border-r-transparent shadow-lg text-(--color-accent-primary)"></div>
        <h2 className="text-xl font-bold font-(--font-display) text-(--color-text-primary) tracking-tight">Finalizing Payment...</h2>
        <p className="text-sm font-medium text-(--color-text-muted)">Please wait while we sync with Square.</p>
      </div>
    </div>
  );
}
