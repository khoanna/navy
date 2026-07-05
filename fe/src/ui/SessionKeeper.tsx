'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// Access tokens live 15 min; refresh well inside that window while the user is
// active so the session never lapses mid-use. A module-level timestamp throttles
// the mount refresh so rapid navigation between pages doesn't spam rotation.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const THROTTLE_MS = 2 * 60 * 1000;
let lastRefreshAt = 0;

/**
 * Keeps the back-office session alive: silently rotates the token on an interval
 * (and once on mount), and hard-redirects to the area's login when the refresh
 * token is no longer valid (session truly expired / revoked).
 */
export function SessionKeeper() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let alive = true;
    const area = pathname?.startsWith('/admin') ? 'admin' : 'merchant';

    const refresh = async (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastRefreshAt < THROTTLE_MS) return;
      lastRefreshAt = now;
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST' });
        if (alive && res.status === 401) router.replace(`/${area}/login`);
      } catch {
        // transient network error — leave the session as-is and retry next tick
      }
    };

    refresh(false);
    const t = setInterval(() => refresh(true), REFRESH_INTERVAL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [pathname, router]);

  return null;
}
