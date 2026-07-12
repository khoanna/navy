'use client';
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger);

/**
 * Full-viewport atmospheric backdrop behind the transparent 3D canvas. Four
 * mood layers — night → teal dawn → open blue → golden dusk — are stacked and
 * cross-faded by a single scrubbed timeline tied to #voyage-pin, so the "sky &
 * sea" transform in lockstep with the vessel's voyage. Pure CSS gradients (cheap,
 * GPU-composited); no per-frame JS.
 */
const MOODS: string[] = [
  // sail · deep night
  'radial-gradient(120% 90% at 78% -10%, rgba(47,224,194,0.16), transparent 55%),' +
    'radial-gradient(120% 100% at 15% 115%, rgba(31,64,201,0.30), transparent 55%),' +
    'linear-gradient(180deg, #060B17 0%, #040a14 100%)',
  // port · teal dawn
  'radial-gradient(120% 90% at 20% -10%, rgba(47,224,194,0.28), transparent 55%),' +
    'radial-gradient(130% 100% at 85% 120%, rgba(23,196,168,0.22), transparent 55%),' +
    'linear-gradient(180deg, #071a22 0%, #05121b 100%)',
  // sea · open bright blue
  'radial-gradient(140% 80% at 50% -20%, rgba(79,140,255,0.34), transparent 55%),' +
    'radial-gradient(120% 90% at 50% 120%, rgba(15,90,166,0.30), transparent 55%),' +
    'linear-gradient(180deg, #081a33 0%, #05101f 100%)',
  // treasure · golden dusk
  'radial-gradient(130% 90% at 70% -10%, rgba(255,200,97,0.24), transparent 55%),' +
    'radial-gradient(120% 100% at 20% 120%, rgba(255,107,131,0.16), transparent 55%),' +
    'linear-gradient(180deg, #0d1020 0%, #070a16 100%)',
];

export function OceanBackdrop() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const layers = gsap.utils.toArray<HTMLElement>('.ocean-mood');
      if (layers.length === 0) return;
      gsap.set(layers, { opacity: 0 });
      gsap.set(layers[0], { opacity: 1 });

      const tl = gsap.timeline({
        scrollTrigger: { trigger: '#voyage-pin', start: 'top top', end: 'bottom bottom', scrub: 1 },
      });
      for (let i = 1; i < layers.length; i++) {
        tl.to(layers[i - 1], { opacity: 0, duration: 0.6, ease: 'none' }, i)
          .to(layers[i], { opacity: 1, duration: 0.6, ease: 'none' }, i);
      }
      tl.to({}, { duration: 0.4 });
    },
    { scope: root },
  );

  return (
    <div ref={root} aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      {MOODS.map((bg, i) => (
        <div key={i} className="ocean-mood" style={{ position: 'absolute', inset: 0, background: bg }} />
      ))}
    </div>
  );
}
