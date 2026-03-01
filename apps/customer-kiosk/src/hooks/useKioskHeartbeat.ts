import { useEffect, useRef } from 'react';
import { getApiUrl } from '@the-clubs/shared';

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Sends a periodic heartbeat to the API so the server knows this kiosk
 * is alive and which lane it serves.
 *
 * Fires immediately on mount, then every 30 seconds.
 * Silently swallows errors (best-effort telemetry).
 */
export function useKioskHeartbeat(laneId: string | null, kioskToken: string | null) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!laneId || !kioskToken) return;

    const deviceId = `kiosk-${laneId}`;

    async function sendHeartbeat() {
      try {
        await fetch(getApiUrl('/api/v1/kiosk/heartbeat'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-kiosk-token': kioskToken!,
          },
          body: JSON.stringify({ deviceId, laneId }),
        });
      } catch {
        // Best-effort — don't break the kiosk if the API is unreachable
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
  }, [laneId, kioskToken]);
}
