import { useEffect, useRef } from "react";

export function HiddenScannerInput() {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;

    const focus = (e?: Event) => {
      // Do not steal focus if the user explicitly clicked/focused another text input
      if (e?.target instanceof HTMLElement) {
        if (e.target.tagName === 'INPUT' && e.target !== el) return;
        if (e.target.tagName === 'TEXTAREA') return;
        if (e.target.tagName === 'SELECT') return;
      }
      el?.focus();
    };

    focus();
    // Use capture phase for focus so we can intercept it reliably
    globalThis.addEventListener("click", focus);
    globalThis.addEventListener("focus", focus, true);

    return () => {
      globalThis.removeEventListener("click", focus);
      globalThis.removeEventListener("focus", focus, true);
    };
  }, []);

  return (
    <input
      ref={ref}
      className="scanner-hidden-input sr-only"
      style={{
        position: "absolute",
        opacity: 0,
        pointerEvents: "none",
      }}
      autoFocus
    />
  );
}
