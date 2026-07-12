'use client';
import { useEffect, useState } from 'react';

/** Returns true only when the device should run the full 3D/scroll experience:
 *  a wide-enough viewport, no reduced-motion preference, and working WebGL.
 *  Returns false during SSR/first paint so the static path renders first, then
 *  upgrades on the client if capable (avoids shipping the heavy canvas to
 *  phones / reduced-motion users). */
export function useCapableDevice(): boolean {
  const [capable, setCapable] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wide = window.matchMedia('(min-width: 900px)').matches;
    let webgl = false;
    try {
      const c = document.createElement('canvas');
      webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      webgl = false;
    }
    setCapable(wide && !reduced && webgl);
  }, []);

  return capable;
}
