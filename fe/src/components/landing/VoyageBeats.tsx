'use client';
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { colors } from '@/ui/theme';
import { SCENE_COPY, FEATURES, type SceneCopyItem } from '@/lib/landing/copy';
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
    <div style={{ maxWidth: 540, display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', textAlign: right ? 'right' : 'left' }}>
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

/** Beat 5: the ecosystem, as a left-aligned vertical list (clears the vessel and
 *  keeps the side-aligned rhythm of the story beats). */
function EcosystemBeat() {
  return (
    <div style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: colors.aqua }}>One ecosystem</span>
      <h2 style={{ margin: '12px 0 24px', fontSize: 'clamp(32px, 4.8vw, 56px)', lineHeight: 1.03, letterSpacing: '-0.025em', color: colors.textHi }}>Everything on board.</h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, width: '100%', border: `1px solid ${colors.border}`, borderRadius: 16, background: 'rgba(10,18,32,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
        {FEATURES.map((f, i) => (
          <li key={f.title} style={{ display: 'flex', gap: 16, padding: '18px 20px', borderTop: i === 0 ? 'none' : `1px solid ${colors.border}` }}>
            <span style={{ flex: 'none', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', color: colors.aqua, fontVariantNumeric: 'tabular-nums', paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, color: colors.textHi }}>{f.title}</h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: colors.textDim }}>{f.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Beat 6: the closing call-to-action. */
function FinaleBeat({ links }: { links: CtaLinks }) {
  return (
    <div style={{ width: '100%', textAlign: 'center' }}>
      <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: colors.aqua }}>Set sail</span>
      <h2 style={{ margin: '12px 0 26px', fontSize: 'clamp(38px, 6vw, 68px)', lineHeight: 1.0, letterSpacing: '-0.03em', color: colors.textHi }}>Set sail with Navy.</h2>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <a href={links.wallet} style={primaryBtn}>Get the wallet</a>
        <a href={links.merchant} style={secondaryBtn}>For merchants</a>
      </div>
    </div>
  );
}

/** Story beats alternate sides so they clear the centred vessel. */
const ALIGN: Array<'left' | 'right'> = ['left', 'right', 'left', 'right'];

/** All slides in order; the 4 story beats then the ecosystem + finale beats.
 *  Count MUST equal SCENES.length so the crossfade lines up with the camera. */
function slideNodes(links: CtaLinks) {
  const story = SCENE_COPY.map((c, i) => ({
    key: c.id,
    justify: ALIGN[i] === 'right' ? 'flex-end' : 'flex-start',
    node: <Beat c={c} align={ALIGN[i]} links={links} hero={i === 0} />,
  }));
  return [
    ...story,
    { key: 'ecosystem', justify: 'flex-start', node: <EcosystemBeat /> },
    { key: 'finale', justify: 'center', node: <FinaleBeat links={links} /> },
  ];
}

/**
 * The pinned storytelling layer. Every slide (story beats + ecosystem + finale)
 * is stacked absolutely inside the sticky full-screen stage; one scrubbed GSAP
 * timeline cross-fades exactly one at a time — the full-screen transform. Each
 * crossfade completes exactly at the matching SCENES camera keyframe (crossfade
 * i ends at timeline position i, and scrub maps position i -> progress i/(n-1)),
 * so copy and 3D camera move together. So the SAME transition style applies to
 * "Everything on board" and the finale as to the story beats.
 */
export function VoyageBeats({ links }: { links: CtaLinks }) {
  const stage = useRef<HTMLDivElement>(null);
  const slides = slideNodes(links);

  useGSAP(
    () => {
      const beats = gsap.utils.toArray<HTMLElement>('.voyage-beat');
      if (beats.length === 0) return;

      gsap.set(beats, { autoAlpha: 0, y: 40 });
      gsap.set(beats[0], { autoAlpha: 1, y: 0 });

      const tl = gsap.timeline({
        scrollTrigger: { trigger: '#voyage-pin', start: 'top top', end: 'bottom bottom', scrub: 1 },
      });

      // Crossfade i finishes at position i (== camera keyframe i). Total timeline
      // length is exactly (n-1) so position i maps to scroll progress i/(n-1).
      for (let i = 1; i < beats.length; i++) {
        const at = i - 0.5;
        tl.to(beats[i - 1], { autoAlpha: 0, y: -40, duration: 0.5, ease: 'power1.inOut' }, at)
          .fromTo(beats[i], { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power1.inOut' }, at);
      }
    },
    { scope: stage },
  );

  return (
    <div ref={stage} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {slides.map((s) => (
        <div
          key={s.key}
          className="voyage-beat"
          style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: s.justify, padding: '0 clamp(28px, 7vw, 120px)' }}
        >
          {s.node}
        </div>
      ))}
    </div>
  );
}

/** Non-animated fallback for reduced-motion / mobile / no-WebGL: the story beats
 *  stacked as ordinary full-height sections (ecosystem + finale are rendered by
 *  the standalone FeatureGrid / FinalCta components on that path). */
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
