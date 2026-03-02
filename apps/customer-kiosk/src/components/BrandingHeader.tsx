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

export function BrandingHeader({ isActive, isLightTheme, brandName, transition }: BrandingHeaderProps) {
  const logoSrc = isLightTheme ? '/club-dallas-logo-black.svg' : '/club-dallas-logo.svg';

  if (!isActive) {
    return (
      <div className="relative">
        <div
          className="absolute inset-6 rounded-full animate-pulse"
          style={{
            boxShadow: '0 0 80px 30px var(--color-accent-glow)',
            opacity: 0.5,
          }}
        />
        <div className="relative flex items-center justify-center">
          <img
            src={logoSrc}
            alt={brandName}
            width="240"
            height="240"
            style={{
              width: 240,
              height: 240,
              objectFit: 'contain',
              filter: 'drop-shadow(0 0 20px var(--color-accent-glow))',
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 28,
        transform: 'scale(0.65)',
        transformOrigin: 'top center',
        transition,
      }}
    >
      <div className="relative">
        <div
          className="absolute inset-4 rounded-full animate-pulse"
          style={{
            boxShadow: '0 0 100px 40px var(--color-accent-glow)',
            opacity: 0.55,
          }}
        />
        <div className="relative flex items-center justify-center">
          <img
            src={logoSrc}
            alt={brandName}
            className="kiosk-logo"
            width="240"
            height="240"
            style={{
              width: 240,
              height: 240,
              filter: 'drop-shadow(0 0 20px var(--color-accent-glow))',
              transform: 'translateY(-12px)',
              transition,
            }}
          />
        </div>
      </div>

      <h1
        className="mt-6 text-5xl font-extrabold tracking-tight uppercase"
        style={{
          fontFamily: 'var(--font-brand)',
          color: 'var(--color-text-primary)',
          transition,
        }}
      >
        {brandName}
      </h1>
    </div>
  );
}
