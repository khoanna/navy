'use client';
import dynamic from 'next/dynamic';
import { colors } from '@/ui/theme';
import { resolveLinks } from '@/lib/landing/links';
import { useCapableDevice } from './useCapableDevice';
import { Nav } from './Nav';
import { Hero } from './Hero';
import { SceneCopy } from './SceneCopy';
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
    // Static path: poster hero + plain stacked sections, no canvas/scroll rig.
    return (
      <main>
        <Nav links={links} />
        <div
          style={{
            minHeight: '100vh',
            backgroundImage: `linear-gradient(180deg, rgba(6,11,23,0.2), ${colors.bg}), url(/navy-poster.webp)`,
            backgroundSize: 'cover', backgroundPosition: 'center',
          }}
        >
          <Hero links={links} />
        </div>
        <FeatureGrid />
        <FinalCta links={links} />
        <Footer links={links} />
      </main>
    );
  }

  // Full path: pinned canvas behind the four beats, then normal flow.
  return (
    <main>
      <LoadingScreen />
      <VoyageCanvas />
      <Nav links={links} />
      <div id="voyage-pin" style={{ position: 'relative', zIndex: 1, height: '400vh' }}>
        <div style={{ position: 'sticky', top: 0 }}>
          <Hero links={links} />
        </div>
        <SceneCopy />
      </div>
      <FeatureGrid />
      <FinalCta links={links} />
      <Footer links={links} />
    </main>
  );
}
