import { useEffect, useRef } from 'react';
import { getApiUrl } from '@the-clubs/shared';

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Sends a periodic heartbeat to the API so the server knows this kiosk
 * is alive and which lane it serves.
 *
 * Fires immediately on mount, then every 30 seconds.
 * If the server returns 401/403 (invalid or revoked kiosk token, e.g. after
 * a server restart), calls `onAuthError` so the caller can boot the kiosk
 * back to the setup/idle screen.
 */
export function useKioskHeartbeat(
  laneId: string | null,
  kioskToken: string | null,
  onAuthError?: () => void,
) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!laneId || !kioskToken) return;

    const deviceId = `kiosk-${laneId}`;

    async function sendHeartbeat() {
      try {
        const res = await fetch(getApiUrl('/api/v1/kiosk/heartbeat'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-kiosk-token': kioskToken!,
          },
          body: JSON.stringify({ deviceId, laneId }),
        });
        // If the API rejects the kiosk token, boot back to the setup screen
        if (res.status === 401 || res.status === 403) {
          onAuthError?.();
        }
      } catch {
        // Network error — best-effort, don't break the kiosk if API is unreachable
      }
    }

    // Fire immediately, then every 30s
    sendHeartbeat();
    timerRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [laneId, kioskToken, onAuthError]);
}
