'use client';
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { colors } from '@/ui/theme';
import { SCENE_COPY } from '@/lib/landing/copy';

gsap.registerPlugin(ScrollTrigger);

/** Renders beats 2..4 (index 1..3). Each panel is full-height and aligned so the
 *  pinned canvas behind it shows the matching camera framing. Copy fades/rises in. */
export function SceneCopy() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const panels = gsap.utils.toArray<HTMLElement>('.voyage-panel');
      panels.forEach((panel) => {
        gsap.from(panel.querySelectorAll('.reveal'), {
          y: 40, opacity: 0, duration: 0.7, stagger: 0.08, ease: 'power2.out',
          scrollTrigger: { trigger: panel, start: 'top 65%', toggleActions: 'play none none reverse' },
        });
      });
    },
    { scope: root },
  );

  return (
    <div ref={root}>
      {SCENE_COPY.slice(1).map((c, i) => (
        <section
          key={c.id}
          className="voyage-panel"
          style={{
            minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center',
            padding: '0 28px', maxWidth: 560,
            marginLeft: i % 2 === 1 ? 'auto' : undefined,
            textAlign: i % 2 === 1 ? 'right' : 'left',
          }}
        >
          <span className="reveal" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: colors.aqua }}>{c.eyebrow}</span>
          <h2 className="reveal" style={{ margin: '10px 0 12px', fontSize: 'clamp(30px, 4.5vw, 50px)', lineHeight: 1.05, letterSpacing: '-0.02em', color: colors.textHi }}>{c.title}</h2>
          <p className="reveal" style={{ fontSize: 16, lineHeight: 1.5, color: colors.text, alignSelf: i % 2 === 1 ? 'flex-end' : 'flex-start', maxWidth: 420 }}>{c.body}</p>
          {c.points.length > 0 && (
            <ul className="reveal" style={{ listStyle: 'none', padding: 0, margin: '16px 0 0', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: i % 2 === 1 ? 'flex-end' : 'flex-start' }}>
              {c.points.map((p) => (
                <li key={p} style={{ fontSize: 12.5, color: colors.text, border: `1px solid ${colors.borderStrong}`, background: colors.glassFill, padding: '6px 11px', borderRadius: 999 }}>{p}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
