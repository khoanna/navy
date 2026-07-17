import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/expo';
import { getEnv } from '@/lib/config/env';
import { NavyClient } from '@/lib/api/navyClient';
import { makeAuthedFetch } from '@/lib/api/authedFetch';
import { TokenStore, secureStoreBackend } from './tokenStore';
import { SessionManager } from './session';
import { NavySession } from './types';

interface SessionContextValue {
  session: NavySession | null;
  initializing: boolean;
  establishFromPrivy: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * A bound fetch function that automatically attaches the Navy bearer token
   * and retries with a refreshed token on 401.  Pass this (as `authedFetchFn`)
   * to `NavyPayClient` and `FarmingClient` constructors for session-aware clients.
   *
   * `null` when there is no active session (no tokens yet).
   */
  authedFetch: ((url: string, init?: RequestInit) => Promise<Response>) | null;
}

const Ctx = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // @privy-io/expo exposes `isReady` (not `ready`) and no `authenticated` flag —
  // authentication is derived from `user != null` (UsePrivy: { user, isReady, getAccessToken, logout }).
  const { isReady, user, getAccessToken, logout } = usePrivy();
  const authenticated = !!user;

  const env = useMemo(() => getEnv(), []);

  const manager = useMemo(() => {
    return new SessionManager(new NavyClient(env.navyApiUrl), new TokenStore(secureStoreBackend()));
  }, [env]);

  const store = useMemo(() => new TokenStore(secureStoreBackend()), []);

  const [session, setSession] = useState<NavySession | null>(null);
  const [initializing, setInitializing] = useState(true);
  // Latched once we begin/complete an auto-establish for the current Privy auth,
  // so a failed establish does not hot-loop. Reset only when Privy auth drops.
  const establishingRef = useRef(false);

  // Stable ref to the latest session tokens so the authed-fetch callbacks always
  // read the current value without needing the session in their dependency arrays.
  const sessionRef = useRef<NavySession | null>(null);
  sessionRef.current = session;

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
    if (initializing) return; // wait for the secure-storage restore to settle
    if (isReady && authenticated && !session && !establishingRef.current) {
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
  }, [initializing, isReady, authenticated, session, getAccessToken, manager]);

  const signOut = useCallback(async () => {
    await manager.clear();
    await logout();
    setSession(null);
  }, [manager, logout]);

  useEffect(() => {
    if (isReady && !authenticated) {
      // Privy logged out (incl. via signOut): reset the latch so a later
      // re-login can auto-establish again, and clear any stale session.
      establishingRef.current = false;
      if (session) { manager.clear().then(() => setSession(null)); }
    }
  }, [isReady, authenticated, session, manager]);

  /**
   * A bound authed-fetch helper that:
   *  1. Reads the CURRENT access/refresh tokens from the session ref (not a stale closure).
   *  2. On 401, calls POST /auth/refresh to rotate tokens.
   *  3. Persists the new tokens to SecureStore and updates the in-memory session state.
   *  4. Retries the original request with the new access token.
   *  5. On refresh failure, signs the user out.
   *
   * Recreated only when the env changes (stable across re-renders).
   */
  const authedFetchFn = useMemo<((url: string, init?: RequestInit) => Promise<Response>) | null>(() => {
    return makeAuthedFetch({
      fetchImpl: globalThis.fetch.bind(globalThis),
      baseUrl: env.navyApiUrl,
      getAccessToken: () => sessionRef.current?.tokens.accessToken ?? '',
      getRefreshToken: () => sessionRef.current?.tokens.refreshToken ?? '',
      onTokens: async (accessToken, refreshToken) => {
        const newSession: NavySession = { tokens: { accessToken, refreshToken } };
        await store.save(newSession.tokens);
        setSession(newSession);
      },
      onSignOut: async () => {
        await manager.clear();
        await logout();
        setSession(null);
      },
    });
  }, [env, store, manager, logout]);

  return (
    <Ctx.Provider value={{ session, initializing, establishFromPrivy, signOut, authedFetch: authedFetchFn }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNavySession(): SessionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNavySession must be used within SessionProvider');
  return v;
}
