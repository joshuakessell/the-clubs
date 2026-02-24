/**
 * BarcodeIcon — SVG barcode icon for the Scan screen.
 * White strokes on transparent background.
 */
export function BarcodeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="200"
      height="120"
      viewBox="0 0 200 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Barcode bars — varying widths for realistic look */}
      <rect x="10" y="10" width="4" height="80" rx="1" fill="white" opacity="0.9" />
      <rect x="18" y="10" width="2" height="80" rx="1" fill="white" opacity="0.7" />
      <rect x="24" y="10" width="5" height="80" rx="1" fill="white" opacity="0.9" />
      <rect x="33" y="10" width="2" height="80" rx="1" fill="white" opacity="0.6" />
      <rect x="39" y="10" width="3" height="80" rx="1" fill="white" opacity="0.8" />
      <rect x="46" y="10" width="6" height="80" rx="1" fill="white" opacity="0.9" />
      <rect x="56" y="10" width="2" height="80" rx="1" fill="white" opacity="0.5" />
      <rect x="62" y="10" width="4" height="80" rx="1" fill="white" opacity="0.8" />
      <rect x="70" y="10" width="3" height="80" rx="1" fill="white" opacity="0.7" />
      <rect x="77" y="10" width="5" height="80" rx="1" fill="white" opacity="0.9" />
      <rect x="86" y="10" width="2" height="80" rx="1" fill="white" opacity="0.6" />
      <rect x="92" y="10" width="4" height="80" rx="1" fill="white" opacity="0.8" />
      <rect x="100" y="10" width="3" height="80" rx="1" fill="white" opacity="0.9" />
      <rect x="107" y="10" width="2" height="80" rx="1" fill="white" opacity="0.5" />
      <rect x="113" y="10" width="6" height="80" rx="1" fill="white" opacity="0.9" />
      <rect x="123" y="10" width="3" height="80" rx="1" fill="white" opacity="0.7" />
      <rect x="130" y="10" width="2" height="80" rx="1" fill="white" opacity="0.8" />
      <rect x="136" y="10" width="5" height="80" rx="1" fill="white" opacity="0.9" />
      <rect x="145" y="10" width="2" height="80" rx="1" fill="white" opacity="0.6" />
      <rect x="151" y="10" width="4" height="80" rx="1" fill="white" opacity="0.8" />
      <rect x="159" y="10" width="3" height="80" rx="1" fill="white" opacity="0.7" />
      <rect x="166" y="10" width="6" height="80" rx="1" fill="white" opacity="0.9" />
      <rect x="176" y="10" width="2" height="80" rx="1" fill="white" opacity="0.5" />
      <rect x="182" y="10" width="4" height="80" rx="1" fill="white" opacity="0.8" />
      <rect x="190" y="10" width="3" height="80" rx="1" fill="white" opacity="0.9" />

      {/* Scan line */}
      <line x1="5" y1="100" x2="195" y2="100" stroke="white" strokeWidth="1" opacity="0.3" />

      {/* Small scan indicator text */}
      <text x="100" y="115" textAnchor="middle" fill="white" opacity="0.4" fontSize="10" fontFamily="monospace">
        READY TO SCAN
      </text>
    </svg>
  );
}
