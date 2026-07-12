'use client';
import { colors } from '@/ui/theme';

/** Presentational branded splash — the ship + tagline + progress bar. Shared by
 *  the pre-capability splash (rendered on SSR / first paint before we know the
 *  device path) and the GLB LoadingScreen. When `indeterminate`, the bar sweeps
 *  instead of showing a percentage (no load progress to report yet). */
export function VoyageLoader({
  pct = 0,
  finished = false,
  indeterminate = false,
}: {
  pct?: number;
  finished?: boolean;
  indeterminate?: boolean;
}) {
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
        {indeterminate ? (
          <div
            style={{
              width: '40%', height: '100%', borderRadius: 999,
              background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})`,
              animation: 'navy-loader-sweep 1.1s ease-in-out infinite',
            }}
          />
        ) : (
          <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})`, transition: 'width 200ms ease' }} />
        )}
      </div>
      {!indeterminate && <div style={{ marginTop: 10, fontSize: 12, color: colors.textDim }}>{pct}%</div>}
    </div>
  );
}
