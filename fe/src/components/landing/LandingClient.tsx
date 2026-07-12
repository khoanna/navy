'use client';
import dynamic from 'next/dynamic';
import { resolveLinks } from '@/lib/landing/links';
import { useCapableDevice } from './useCapableDevice';
import { Nav } from './Nav';
import { OceanBackdrop } from './OceanBackdrop';
import { VoyageBeats, StaticStory } from './VoyageBeats';
import { FeatureGrid } from './FeatureGrid';
import { FinalCta } from './FinalCta';
import { Footer } from './Footer';
import { LoadingScreen } from './LoadingScreen';

// Canvas is client-only + code-split so the heavy 3D bundle never ships to the
// static path (mobile / reduced-motion / no-WebGL).
const VoyageCanvas = dynamic(() => import('./VoyageCanvas').then((m) => m.VoyageCanvas), { ssr: false });

export function LandingClient() {
  const capable = useCapableDevice();
  const links = resolveLinks({ walletOrigin: process.env.NEXT_PUBLIC_WEB_WALLET_ORIGIN });

  if (!capable) {
    // Static path: the story beats stacked as ordinary full-height sections.
    return (
      <main>
        <Nav links={links} />
        <StaticStory links={links} />
        <FeatureGrid />
        <FinalCta links={links} />
        <Footer links={links} />
      </main>
    );
  }

  // Full path: one fixed 3D canvas + a pinned full-screen stage whose four beats
  // cross-fade in lockstep with the camera as you scroll #voyage-pin, then normal
  // flow resumes. #voyage-pin is the scroll runway; the sticky stage holds the
  // viewport while the timeline transforms it.
  return (
    <main>
      <LoadingScreen />
      <OceanBackdrop />
      <VoyageCanvas />
      <Nav links={links} />
      <section id="voyage-pin" style={{ position: 'relative', zIndex: 1, height: '480vh' }}>
        <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
          <VoyageBeats links={links} />
        </div>
      </section>
      <FeatureGrid />
      <FinalCta links={links} />
      <Footer links={links} />
    </main>
  );
}
