import { useEffect, useRef } from "react";

export function HiddenScannerInput() {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;

    const focus = () => el?.focus();

    focus();
    globalThis.addEventListener("click", focus);
    globalThis.addEventListener("focus", focus);

    return () => {
      globalThis.removeEventListener("click", focus);
      globalThis.removeEventListener("focus", focus);
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
