'use client';
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { colors } from '@/ui/theme';
import { FEATURES } from '@/lib/landing/copy';

gsap.registerPlugin(ScrollTrigger);

export function FeatureGrid() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      ScrollTrigger.batch('.feature-card', {
        start: 'top 85%',
        onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, stagger: 0.12, duration: 0.6, ease: 'power2.out', overwrite: true }),
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} style={{ position: 'relative', zIndex: 1, background: 'linear-gradient(180deg, rgba(6,11,23,0.45) 0%, rgba(6,11,23,0.85) 50%, rgba(6,11,23,0.72) 100%)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', padding: '110px 28px' }}>
      <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: colors.aqua }}>One ecosystem</span>
      <h2 style={{ margin: '10px 0 40px', fontSize: 'clamp(28px, 4vw, 44px)', color: colors.textHi, letterSpacing: '-0.02em' }}>Everything on board.</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16, maxWidth: 1040 }}>
        {FEATURES.map((f) => (
          <div key={f.title} className="feature-card" style={{ opacity: 0, transform: 'translateY(40px)', border: `1px solid ${colors.border}`, background: colors.glassFill, borderRadius: 16, padding: '22px 20px' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, color: colors.textHi }}>{f.title}</h3>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: colors.textDim }}>{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
