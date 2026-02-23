import { useState, useEffect } from 'react';
import { ScreenShell } from '../components/ScreenShell';
import { useI18n } from '../i18n';

interface Props {
  lanes: { slug: string; label: string }[];
}

/**
 * LaneSelectScreen — Shown at the root URL (`/`) so the operator
 * can pick which lane/register this kiosk instance tracks.
 * Navigates to `/lane-1`, `/lane-2`, etc.
 */
export function LaneSelectScreen({ lanes }: Props) {
  const { t } = useI18n();

  const [activeTheme, setActiveTheme] = useState(() => document.documentElement.getAttribute('data-theme') ?? '');
  useEffect(() => {
    const obs = new MutationObserver(() => setActiveTheme(document.documentElement.getAttribute('data-theme') ?? ''));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  const isLightTheme = ['theme-arctic-bloom', 'theme-solar-flare'].includes(activeTheme);

  return (
    <ScreenShell>
    <div className= "flex flex-col items-center gap-10 text-center p-12" >
    {/* Logo */ }
    < div className = "relative" >
      <div
            className="absolute inset-6 rounded-full animate-pulse"
  style = {{
    boxShadow: '0 0 30px 10px var(--color-accent-glow)',
      opacity: 0.15,
            }
}
          />
  < div className = "relative flex items-center justify-center" >
    <img
              src={ isLightTheme ? '/club-dallas-logo-black.svg' : '/club-dallas-logo.svg' }
alt = { t('brand.clubName') }
width = "160"
height = "160"
style = {{ width: 240, height: 240, filter: 'drop-shadow(0 0 6px var(--color-accent-glow))' }}
            />
  </div>
  </div>

{/* Title */ }
<div>
  <h1
            className="text-4xl font-extrabold tracking-tight"
style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
  { t('lane.selectTitle') }
  </h1>
  < p className = "mt-3 text-base" style = {{ color: 'var(--color-text-muted)' }}>
    { t('lane.selectSubtitle') }
    </p>
    </div>

{/* Lane buttons */ }
<div className="flex flex-col gap-4 w-full max-w-xs" >
{
  lanes.map((lane) => (
    <a
              key= { lane.slug }
              href = {`/${lane.slug}`}
className = "flex items-center justify-center gap-3 rounded-xl border-2 px-8 py-5 text-lg font-bold transition-all duration-200"
style = {{
  borderColor: 'var(--color-border-accent)',
    color: 'var(--color-accent-primary)',
      backgroundColor: 'rgba(0, 212, 255, 0.04)',
              }}
onMouseOver = {(e) => {
  e.currentTarget.style.backgroundColor = 'rgba(0, 212, 255, 0.12)';
  e.currentTarget.style.boxShadow = '0 0 24px var(--color-accent-glow)';
}}
onMouseOut = {(e) => {
  e.currentTarget.style.backgroundColor = 'rgba(0, 212, 255, 0.04)';
  e.currentTarget.style.boxShadow = 'none';
}}
            >
  { lane.label }
  </a>
          ))}
</div>
  </div>
  </ScreenShell>
  );
}
