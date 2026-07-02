'use client';
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
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

  const signOut = useCallback(async () => {
    await manager.clear();
    await logout();
    setSession(null);
  }, [manager, logout]);

  useEffect(() => {
    if (ready && !authenticated && session) { manager.clear().then(() => setSession(null)); }
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
