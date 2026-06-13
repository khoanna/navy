import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/expo';
import { getEnv } from '../config/env';
import { NavyClient } from '../api/navyClient';
import { TokenStore, expoSecureBackend } from './tokenStore';
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
  const { isReady, getAccessToken, logout, user } = usePrivy();
  const manager = useMemo(() => {
    const env = getEnv();
    return new SessionManager(new NavyClient(env.navyApiUrl), new TokenStore(expoSecureBackend()));
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
    if (isReady && !user && session) { manager.clear().then(() => setSession(null)); }
  }, [isReady, user, session, manager]);

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
