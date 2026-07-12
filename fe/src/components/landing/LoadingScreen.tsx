'use client';
import { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { VoyageLoader } from './VoyageLoader';

/** Full-viewport branded loader shown while the GLB downloads/decodes. Wired to
 *  drei useProgress() (read from three's global loading manager, so it works as
 *  a DOM sibling overlay of the Canvas). When the load finishes it fades out and
 *  unmounts, releasing the fixed overlay so the page underneath is interactive. */
export function LoadingScreen() {
  const { active, progress } = useProgress();
  const pct = Math.round(progress);
  const finished = !active && progress >= 100;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!finished) return;
    const t = window.setTimeout(() => setHidden(true), 500); // let the fade finish
    return () => window.clearTimeout(t);
  }, [finished]);

  if (hidden) return null;

  return <VoyageLoader pct={pct} finished={finished} />;
}
