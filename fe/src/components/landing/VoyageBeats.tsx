'use client';
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { colors } from '@/ui/theme';
import { SCENE_COPY, type SceneCopyItem } from '@/lib/landing/copy';
import type { CtaLinks } from '@/lib/landing/links';

gsap.registerPlugin(ScrollTrigger);

/** Per-beat call-to-action config (keyed by scene id). */
function beatCta(id: SceneCopyItem['id'], links: CtaLinks) {
  switch (id) {
    case 'sail':
      return [
        { label: 'Get the wallet', href: links.wallet, primary: true },
        { label: 'For merchants', href: links.merchant, primary: false },
      ];
    case 'port':
      return [{ label: 'Start selling', href: links.merchant, primary: true }];
    case 'treasure':
      return [{ label: 'Get the wallet', href: links.wallet, primary: true }];
    default:
      return [];
  }
}

const primaryBtn: React.CSSProperties = {
  fontWeight: 700, color: colors.onAccent,
  background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})`,
  padding: '13px 22px', borderRadius: 12, pointerEvents: 'auto',
};
const secondaryBtn: React.CSSProperties = {
  color: colors.text, border: `1px solid ${colors.borderStrong}`,
  padding: '13px 22px', borderRadius: 12, pointerEvents: 'auto',
};

/** One story beat's copy. `hero` gives the first beat a larger headline. */
function Beat({ c, align, links, hero = false }: { c: SceneCopyItem; align: 'left' | 'right'; links: CtaLinks; hero?: boolean }) {
  const right = align === 'right';
  const ctas = beatCta(c.id, links);
  return (
    <div
      style={{
        maxWidth: 540, display: 'flex', flexDirection: 'column',
        alignItems: right ? 'flex-end' : 'flex-start',
        textAlign: right ? 'right' : 'left',
      }}
    >
      <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: colors.aqua }}>{c.eyebrow}</span>
      {hero ? (
        <h1 style={{ margin: '12px 0 16px', fontSize: 'clamp(40px, 6.4vw, 74px)', lineHeight: 1.0, letterSpacing: '-0.03em', color: colors.textHi }}>{c.title}</h1>
      ) : (
        <h2 style={{ margin: '12px 0 14px', fontSize: 'clamp(32px, 4.8vw, 56px)', lineHeight: 1.03, letterSpacing: '-0.025em', color: colors.textHi }}>{c.title}</h2>
      )}
      <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: colors.text, maxWidth: 460 }}>{c.body}</p>
      {c.points.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '18px 0 0', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: right ? 'flex-end' : 'flex-start' }}>
          {c.points.map((p) => (
            <li key={p} style={{ fontSize: 12.5, color: colors.text, border: `1px solid ${colors.borderStrong}`, background: colors.glassFill, padding: '6px 12px', borderRadius: 999 }}>{p}</li>
          ))}
        </ul>
      )}
      {ctas.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginTop: 26, justifyContent: right ? 'flex-end' : 'flex-start' }}>
          {ctas.map((b) => (
            <a key={b.label} href={b.href} style={b.primary ? primaryBtn : secondaryBtn}>{b.label}</a>
          ))}
        </div>
      )}
      {hero && (
        <div style={{ marginTop: 44, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: colors.textDim }}>Scroll to set sail ↓</div>
      )}
    </div>
  );
}

/** Beats alternate sides so they clear the centred vessel and give scroll rhythm. */
const ALIGN: Array<'left' | 'right'> = ['left', 'right', 'left', 'right'];

/**
 * The pinned storytelling layer. All four beats are stacked absolutely inside a
 * sticky full-screen stage; a single scrubbed GSAP timeline cross-fades exactly
 * one beat visible at a time — the "full-screen transform" as you scroll. Runs
 * in lockstep with VoyageCanvas (both scrub the same #voyage-pin range), so the
 * copy and the 3D camera stay in sync.
 */
export function VoyageBeats({ links }: { links: CtaLinks }) {
  const stage = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const beats = gsap.utils.toArray<HTMLElement>('.voyage-beat');
      if (beats.length === 0) return;

      // Start state: first beat shown, the rest hidden (autoAlpha = opacity + visibility).
      gsap.set(beats, { autoAlpha: 0, y: 40 });
      gsap.set(beats[0], { autoAlpha: 1, y: 0 });

      const tl = gsap.timeline({
        scrollTrigger: { trigger: '#voyage-pin', start: 'top top', end: 'bottom bottom', scrub: 1 },
      });

      // One transition per gap between beats, each on its own integer slot so the
      // active beat gets a clear "hold" before the next crossfade.
      for (let i = 1; i < beats.length; i++) {
        tl.to(beats[i - 1], { autoAlpha: 0, y: -40, duration: 0.6, ease: 'power1.inOut' }, i)
          .fromTo(beats[i], { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power1.inOut' }, i);
      }
      // Fade the final beat out before the pin releases, so no copy lingers over
      // the feature section / nav as the stage scrolls away.
      tl.to(beats[beats.length - 1], { autoAlpha: 0, y: -40, duration: 0.6, ease: 'power1.inOut' }, beats.length);
      tl.to({}, { duration: 0.3 });

      // Scroll progress bar along the bottom.
      gsap.fromTo(
        '.voyage-progress',
        { scaleX: 0 },
        { scaleX: 1, ease: 'none', transformOrigin: 'left', scrollTrigger: { trigger: '#voyage-pin', start: 'top top', end: 'bottom bottom', scrub: true } },
      );
    },
    { scope: stage },
  );

  return (
    <div ref={stage} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {SCENE_COPY.map((c, i) => (
        <div
          key={c.id}
          className="voyage-beat"
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: ALIGN[i] === 'right' ? 'flex-end' : 'flex-start',
            padding: '0 clamp(28px, 7vw, 120px)',
          }}
        >
          <Beat c={c} align={ALIGN[i]} links={links} hero={i === 0} />
        </div>
      ))}
      <div className="voyage-progress" style={{ position: 'absolute', left: 0, bottom: 0, height: 2, width: '100%', transform: 'scaleX(0)', transformOrigin: 'left', background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})` }} />
    </div>
  );
}

/** Non-animated fallback for reduced-motion / mobile / no-WebGL: the same beats
 *  stacked as ordinary full-height sections (no pin, no crossfade). */
export function StaticStory({ links }: { links: CtaLinks }) {
  return (
    <>
      {SCENE_COPY.map((c, i) => (
        <section
          key={c.id}
          style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center',
            justifyContent: ALIGN[i] === 'right' ? 'flex-end' : 'flex-start',
            padding: '0 clamp(28px, 7vw, 120px)',
            ...(i === 0
              ? { backgroundImage: `linear-gradient(180deg, rgba(6,11,23,0.35), ${colors.bg}), url(/navy-poster.webp)`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : { background: colors.bg }),
          }}
        >
          <Beat c={c} align={ALIGN[i]} links={links} hero={i === 0} />
        </section>
      ))}
    </>
  );
}
