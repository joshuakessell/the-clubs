import { useEffect, useRef } from "react";

type ScanHandler = (data: string) => void;
type ScanStartHandler = () => void;
type ScanCancelHandler = () => void;

interface Options {
  timeoutMs?: number;       // time gap to abort if no ## is received (e.g. 1000ms)
  dedupeWindowMs?: number;  // idempotency window
  onStartScan?: ScanStartHandler;
  onCancelScan?: ScanCancelHandler;
}

export function useBarcodeScanner(
  onScan: ScanHandler,
  options: Options = {}
) {
  const {
    timeoutMs = 1000,
    dedupeWindowMs = 2000,
    onStartScan,
    onCancelScan,
  } = options;

  const bufferRef = useRef("");
  const isScanningRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // idempotency tracking
  const lastScanRef = useRef<string | null>(null);
  const lastScanTimeRef = useRef<number>(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier keys alone
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;

      const now = Date.now();
      const char = e.key.length === 1 ? e.key : (e.key === "Enter" ? "\n" : "");

      // 1. If we are actively scanning
      if (isScanningRef.current) {
        e.preventDefault();
        e.stopPropagation();

        bufferRef.current += char;

        // Check for Suffix "##"
        if (bufferRef.current.endsWith("##")) {
          // Complete scan
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          isScanningRef.current = false;

          let finalData = bufferRef.current;
          // Strip the prefix $$ and suffix ##
          if (finalData.startsWith("$$")) {
            finalData = finalData.substring(2);
          }
          finalData = finalData.substring(0, finalData.length - 2);

          bufferRef.current = "";

          // Idempotency check
          if (
            lastScanRef.current === finalData &&
            now - lastScanTimeRef.current < dedupeWindowMs
          ) {
            if (onCancelScan) onCancelScan();
            return;
          }

          lastScanRef.current = finalData;
          lastScanTimeRef.current = now;

          onScan(finalData);
        } else {
          // Restart abort timeout
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => {
            isScanningRef.current = false;
            bufferRef.current = "";
            if (onCancelScan) onCancelScan();
          }, timeoutMs);
        }
        return;
      }

      // 2. If we are NOT actively scanning, we are looking for the "$$" prefix.
      bufferRef.current += char;

      if (bufferRef.current.endsWith("$$")) {
        // We found the prefix! Enter scanning mode.
        isScanningRef.current = true;
        // Keep ONLY the prefix in the buffer to start fresh
        bufferRef.current = "$$";
        
        e.preventDefault();
        e.stopPropagation();

        // Remove focus from any active input (like the Search bar)
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }

        if (onStartScan) onStartScan();

        // Start abort timeout
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          isScanningRef.current = false;
          bufferRef.current = "";
          if (onCancelScan) onCancelScan();
        }, timeoutMs);
      } else {
        // We are not scanning, and we haven't seen "$$".
        // Clean up the buffer if it gets too large for no reason, 
        // but keep the last character just in case they typed the first '$'.
        if (bufferRef.current.length > 2) {
          bufferRef.current = bufferRef.current.slice(-2);
        }
      }
    };

    // Use capture phase to ensure we intercept it BEFORE inputs get the keystroke
    globalThis.addEventListener("keydown", handleKeyDown, true);

    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [timeoutMs, dedupeWindowMs, onScan, onStartScan, onCancelScan]);
}
