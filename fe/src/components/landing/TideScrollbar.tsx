'use client';
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { colors } from '@/ui/theme';

gsap.registerPlugin(ScrollTrigger);

/**
 * Ocean-styled scroll progress indicator: a vertical glass tube on the right edge
 * that fills like a rising tide as you scroll the page, with a live wavy surface
 * (two offset SVG wave layers translating horizontally) and drifting bubbles.
 * Replaces the flat progress line. The fill height is scrubbed to whole-document
 * scroll; the wave/bubbles are cheap GPU-composited CSS transforms. Only mounted
 * on the capable (non-reduced-motion) path.
 */
export function TideScrollbar() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.fromTo(
        '.tide-fill',
        { height: '4%' },
        { height: '100%', ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.6 } },
      );
    },
    { scope: root },
  );

  const wavePath = 'M0 6 Q 10 0 20 6 T 40 6 T 60 6 T 80 6 V 20 H 0 Z';

  return (
    <div
      ref={root}
      aria-hidden
      style={{
        position: 'fixed', right: 22, top: '22vh', height: '56vh', width: 16, zIndex: 30,
        pointerEvents: 'none', borderRadius: 999, overflow: 'hidden',
        border: `1px solid ${colors.borderStrong}`, background: 'rgba(255,255,255,0.04)',
        boxShadow: 'inset 0 0 12px rgba(0,0,0,0.4)',
      }}
    >
      <style>{`
        @keyframes tide-wave { from { transform: translateX(0); } to { transform: translateX(-40px); } }
        @keyframes tide-wave-2 { from { transform: translateX(-40px); } to { transform: translateX(0); } }
        @keyframes tide-bubble { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: .8; } 100% { transform: translateY(-46vh); opacity: 0; } }
      `}</style>

      {/* The rising water */}
      <div
        className="tide-fill"
        style={{
          position: 'absolute', left: 0, bottom: 0, width: '100%', height: '4%',
          background: `linear-gradient(180deg, ${colors.aqua} 0%, ${colors.accent} 55%, ${colors.accentDeep} 100%)`,
          boxShadow: `0 0 14px ${colors.aqua}66`,
        }}
      >
        {/* Wavy surface — two offset layers for parallax ripple */}
        <svg viewBox="0 0 80 20" preserveAspectRatio="none" style={{ position: 'absolute', top: -9, left: 0, width: '250%', height: 12, animation: 'tide-wave 2.6s linear infinite' }}>
          <path d={wavePath} fill={colors.aqua} opacity={0.85} />
        </svg>
        <svg viewBox="0 0 80 20" preserveAspectRatio="none" style={{ position: 'absolute', top: -6, left: 0, width: '250%', height: 12, animation: 'tide-wave-2 3.4s linear infinite' }}>
          <path d={wavePath} fill={colors.accent} opacity={0.6} />
        </svg>
        {/* Bubbles rising through the water */}
        <span style={{ position: 'absolute', left: 4, bottom: 4, width: 3, height: 3, borderRadius: '50%', background: '#dff6ff', animation: 'tide-bubble 4.5s ease-in infinite' }} />
        <span style={{ position: 'absolute', left: 9, bottom: 4, width: 2, height: 2, borderRadius: '50%', background: '#dff6ff', animation: 'tide-bubble 5.8s ease-in infinite 1.2s' }} />
      </div>

      <div
        style={{ position: 'absolute', inset: 0 }}
      />
      <span aria-hidden style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: colors.textMute, opacity: 0.5 }} />
    </div>
  );
}
