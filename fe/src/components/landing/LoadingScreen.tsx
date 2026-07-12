'use client';
import { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { colors } from '@/ui/theme';

/** Full-viewport branded loader shown while the GLB downloads/decodes. Wired to
 *  drei useProgress() (read from three's global loading manager, so it works as
 *  a DOM sibling overlay of the Canvas). When the load finishes it fades out and
 *  unmounts, releasing the fixed overlay so the page underneath is interactive. */
export function LoadingScreen() {
  const { active, progress } = useProgress();
  const pct = Math.round(progress);
  const finished = !active && progress >= 100;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!finished) return;
    const t = window.setTimeout(() => setHidden(true), 500); // let the fade finish
    return () => window.clearTimeout(t);
  }, [finished]);

  if (hidden) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        opacity: finished ? 0 : 1,
        pointerEvents: finished ? 'none' : 'auto',
        transition: 'opacity 450ms ease',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background:
          'radial-gradient(120% 80% at 80% -10%, rgba(47,224,194,0.18), transparent 55%),' +
          'radial-gradient(100% 90% at 10% 110%, rgba(79,140,255,0.22), transparent 55%),' +
          colors.bg,
        color: colors.textHi,
      }}
    >
      <svg width="96" height="76" viewBox="0 0 150 120" style={{ filter: 'drop-shadow(0 8px 24px rgba(47,224,194,0.5))' }}>
        <path d="M20 78 L130 78 L112 100 L38 100 Z" fill="#123a5f" stroke={colors.aqua} strokeWidth="1.5" />
        <rect x="70" y="28" width="4" height="52" fill="#8fd8ff" />
        <path d="M74 30 L114 62 L74 68 Z" fill={colors.aqua} />
        <path d="M72 30 L34 60 L72 66 Z" fill={colors.accent} />
        <animateTransform attributeName="transform" type="rotate" from="-2 75 90" to="2 75 90" dur="2.4s" repeatCount="indefinite" additive="sum" />
      </svg>
      <div style={{ marginTop: 22, fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: colors.aqua }}>
        Charting your voyage
      </div>
      <div style={{ marginTop: 14, width: 200, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.10)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})`, transition: 'width 200ms ease' }} />
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: colors.textDim }}>{pct}%</div>
    </div>
  );
}
