'use client';
import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { resolveLinks } from '@/lib/landing/links';
import { useCapableDevice } from './useCapableDevice';
import { Nav } from './Nav';
import { OceanBackdrop } from './OceanBackdrop';
import { TideScrollbar } from './TideScrollbar';
import { VoyageBeats, StaticStory } from './VoyageBeats';
import { FeatureGrid } from './FeatureGrid';
import { FinalCta } from './FinalCta';
import { Footer } from './Footer';
import { LoadingScreen } from './LoadingScreen';
import { VoyageLoader } from './VoyageLoader';

// Canvas is client-only + code-split so the heavy 3D bundle never ships to the
// static path (mobile / reduced-motion / no-WebGL).
const VoyageCanvas = dynamic(() => import('./VoyageCanvas').then((m) => m.VoyageCanvas), { ssr: false });

export function LandingClient() {
  const capable = useCapableDevice();
  const links = resolveLinks({ walletOrigin: process.env.NEXT_PUBLIC_WEB_WALLET_ORIGIN });

  // The full path renders its own TideScrollbar, so suppress the native document
  // scrollbar there (scoped to this page — dashboards keep theirs).
  useEffect(() => {
    if (!capable) return;
    document.documentElement.classList.add('landing-no-scrollbar');
    return () => document.documentElement.classList.remove('landing-no-scrollbar');
  }, [capable]);

  if (capable === null) {
    // Undetermined: device capability can only be probed on the client, so this
    // is what SSR + first paint render. Show the branded loader (not the static
    // page) so there's no flash before we know which path to take.
    return (
      <main>
        <VoyageLoader indeterminate />
      </main>
    );
  }

  if (!capable) {
    // Static path: the story beats stacked as ordinary full-height sections.
    return (
      <main>
        <Nav />
        <StaticStory links={links} />
        <FeatureGrid />
        <FinalCta links={links} />
        <Footer links={links} />
      </main>
    );
  }

  // Full path: one fixed 3D canvas + a single pinned full-screen stage whose six
  // beats (story + ecosystem + finale) all cross-fade in lockstep with the camera
  // as you scroll #voyage-pin — every section uses the same transition. Only the
  // footer resumes normal flow afterwards. #voyage-pin is the scroll runway; the
  // sticky stage holds the viewport while the timeline transforms it.
  return (
    <main>
      <LoadingScreen />
      <OceanBackdrop />
      <VoyageCanvas />
      <Nav />
      <TideScrollbar />
      <section id="voyage-pin" style={{ position: 'relative', zIndex: 1, height: '620vh' }}>
        <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
          <VoyageBeats links={links} />
        </div>
      </section>
      <Footer links={links} />
    </main>
  );
}
