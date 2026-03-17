/**
 * BrandingHeader — Shared logo + glow + brand text for idle and active states.
 * Parameterized by `isActive` to control size, position, and animation timing.
 */
interface BrandingHeaderProps {
  isActive: boolean;
  isLightTheme: boolean;
  brandName: string;
  transition: string;
}

export function BrandingHeader({ isActive, isLightTheme, brandName, transition }: Readonly<BrandingHeaderProps>) {
  const logoSrc = isLightTheme ? '/club-dallas-logo-black.svg' : '/club-dallas-logo.svg';

  if (!isActive) {
    return (
      <div className="relative">
        <div
          className="absolute inset-6 rounded-full animate-pulse opacity-50 shadow-[0_0_80px_30px_var(--color-accent-glow)]"
        />
        <div className="relative flex items-center justify-center">
          <img
            src={logoSrc}
            alt={brandName}
            width="240"
            height="240"
            className="w-[240px] h-[240px] object-contain -translate-y-1 drop-shadow-[0_0_20px_var(--color-accent-glow)]"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center pt-7 origin-top scale-[0.65]"
      style={{ transition }}
    >
      <div className="relative">
        <div
          className="absolute inset-4 rounded-full animate-pulse opacity-55 shadow-[0_0_100px_40px_var(--color-accent-glow)]"
        />
        <div className="relative flex items-center justify-center">
          <img
            src={logoSrc}
            alt={brandName}
            className="kiosk-logo w-[240px] h-[240px] -translate-y-[7px] drop-shadow-[0_0_20px_var(--color-accent-glow)]"
            width="240"
            height="240"
            style={{ transition }}
          />
        </div>
      </div>

      <h1
        className="mt-6 text-5xl font-extrabold tracking-tight uppercase font-[var(--font-brand)] text-[var(--color-text-primary)]"
        style={{ transition }}
      >
        {brandName}
      </h1>
    </div>
  );
}
