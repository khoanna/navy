'use client';
import { useEffect, useState } from 'react';

/** Returns whether the device should run the full 3D/scroll experience: a
 *  wide-enough viewport, no reduced-motion preference, and working WebGL.
 *
 *  Returns `null` during SSR/first paint — capability can only be probed on the
 *  client, so callers must render a neutral loader for `null` rather than
 *  assuming the static path. Assuming `false` up front renders the static page
 *  into the SSR HTML, which then flashes before upgrading to the canvas path. */
export function useCapableDevice(): boolean | null {
  const [capable, setCapable] = useState<boolean | null>(null);

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
