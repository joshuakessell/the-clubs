import { useEffect, useRef } from "react";

type ScanHandler = (data: string) => void;

interface Options {
  timeoutMs?: number;       // time gap to consider scan complete
  minLength?: number;       // ignore noise
  dedupeWindowMs?: number;  // idempotency window
}

export function useBarcodeScanner(
  onScan: ScanHandler,
  options: Options = {}
) {
  const {
    timeoutMs = 50,
    minLength = 10,
    dedupeWindowMs = 2000,
  } = options;

  const bufferRef = useRef("");
  const lastKeyTimeRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // idempotency tracking
  const lastScanRef = useRef<string | null>(null);
  const lastScanTimeRef = useRef<number>(0);

  const flush = () => {
    const data = bufferRef.current;

    bufferRef.current = "";

    if (data.length < minLength) return;

    const now = Date.now();

    // Idempotency check
    if (
      lastScanRef.current === data &&
      now - lastScanTimeRef.current < dedupeWindowMs
    ) {
      return; // ignore duplicate
    }

    lastScanRef.current = data;
    lastScanTimeRef.current = now;

    onScan(data);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not intercept if actively typing inside an open form modal or explicit input
      // EXCEPT for our dedicated hidden scanner input.
      if (
        (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) &&
        !e.target.classList.contains("scanner-hidden-input")
      ) {
        return;
      }

      const now = Date.now();
      const delta = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // If large gap → new scan
      if (delta > timeoutMs) {
        bufferRef.current = "";
      }

      if (e.key === "Enter") {
        e.preventDefault();
        bufferRef.current += "\n";
      } else if (e.key.length === 1) {
        bufferRef.current += e.key;
      }

      // fallback timeout flush (in case no Enter suffix, or to wait for scanner burst to finish)
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(flush, timeoutMs);
    };

    globalThis.addEventListener("keydown", handleKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, [timeoutMs, minLength, dedupeWindowMs, onScan]);
}
