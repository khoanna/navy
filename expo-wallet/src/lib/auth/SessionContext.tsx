'use client';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { getEnv } from '@/lib/config/env';
import { NavyClient } from '@/lib/api/navyClient';
import { TokenStore, localStorageBackend } from './tokenStore';
import { SessionManager } from './session';
import { NavySession } from './types';

interface SessionContextValue {
  session: NavySession | null;
  initializing: boolean;
  establishFromPrivy: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
  const manager = useMemo(() => {
    const env = getEnv();
    return new SessionManager(new NavyClient(env.navyApiUrl), new TokenStore(localStorageBackend()));
  }, []);

  const [session, setSession] = useState<NavySession | null>(null);
  const [initializing, setInitializing] = useState(true);
  // Latched once we begin/complete an auto-establish for the current Privy auth,
  // so a failed establish does not hot-loop. Reset only when Privy auth drops.
  const establishingRef = useRef(false);

  useEffect(() => {
    let active = true;
    manager.restore().then((s) => { if (active) { setSession(s); setInitializing(false); } });
    return () => { active = false; };
  }, [manager]);

  const establishFromPrivy = useCallback(async () => {
    const privyToken = await getAccessToken();
    if (!privyToken) throw new Error('No Privy access token available');
    const s = await manager.establish(privyToken);
    setSession(s);
  }, [getAccessToken, manager]);

  // Backstop for the OAuth full-page redirect flow: after Google/Apple returns,
  // the user is Privy-authenticated but no code path has called establishFromPrivy.
  // Auto-establish the Navy session once Privy is ready & authenticated but we have none.
  useEffect(() => {
    if (initializing) return; // wait for the localStorage restore to settle
    if (ready && authenticated && !session && !establishingRef.current) {
      establishingRef.current = true; // latch: fires at most once until auth drops
      (async () => {
        try {
          const privyToken = await getAccessToken();
          if (!privyToken) return;
          const s = await manager.establish(privyToken);
          setSession(s);
        } catch {
          // Swallow: ref stays latched so we don't hot-loop on a failed establish.
          // It resets when Privy `authenticated` goes false (see effect below).
        }
      })();
    }
  }, [initializing, ready, authenticated, session, getAccessToken, manager]);

  const signOut = useCallback(async () => {
    await manager.clear();
    await logout();
    setSession(null);
  }, [manager, logout]);

  useEffect(() => {
    if (ready && !authenticated) {
      // Privy logged out (incl. via signOut): reset the latch so a later
      // re-login can auto-establish again, and clear any stale session.
      establishingRef.current = false;
      if (session) { manager.clear().then(() => setSession(null)); }
    }
  }, [ready, authenticated, session, manager]);

  return (
    <Ctx.Provider value={{ session, initializing, establishFromPrivy, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNavySession(): SessionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNavySession must be used within SessionProvider');
  return v;
}
