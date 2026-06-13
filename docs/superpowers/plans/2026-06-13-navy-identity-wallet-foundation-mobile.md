# Navy Identity & Wallet Foundation — Mobile (Expo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Expo React Native mobile app's authentication + non-custodial embedded Solana wallet: users log in with Google/Apple, email OTP, SMS OTP, or passkey via Privy, get an auto-provisioned Solana wallet, then exchange the Privy token at the backend `POST /auth/privy` for a Navy JWT held in secure storage.

**Architecture:** All non-UI logic lives in plain-TS modules with no React Native imports — a typed `NavyClient` (token exchange over fetch), a `TokenStore` (secure storage behind an injected backend), and a `session` state machine — so they are unit-tested with Jest + mocks. Privy is wired at the root via `PrivyProvider`; thin screens call Privy hooks and delegate to the logic modules. A `useNavySession` hook binds Privy's `getAccessToken` to the session module and exposes auth state to the router.

**Tech Stack:** Expo SDK 52+ (expo-router) · TypeScript · `@privy-io/expo` + `expo-secure-store`/`expo-application`/`expo-constants`/`expo-linking`/`react-native-webview` · `@solana/web3.js` · Jest (`jest-expo`).

**Scope:** This is **Plan 2 of 3** for the foundation (Mobile auth). Plan 1 = Backend (done). Plan 3 = Web auth (admin+merchant). Implements spec §3.1 (user/Privy auth) and §4 (user main wallet) of `docs/superpowers/specs/2026-06-13-navy-identity-wallet-foundation-design.md`. It depends on the backend's `POST /auth/privy` endpoint (already built and tested).

---

## File Structure

All paths under `/home/khoa/Desktop/uni/mobile/`.

```
mobile/
├── app.json                      # Expo config: scheme (deep links), plugins, extra (public config)
├── package.json
├── tsconfig.json
├── jest.config.js                # jest-expo preset
├── .env.example / .env           # PRIVY_APP_ID, PRIVY_CLIENT_ID, NAVY_API_URL
├── app/                          # expo-router routes
│   ├── _layout.tsx               # wraps app in PrivyProvider + SessionProvider; route guard
│   ├── index.tsx                 # redirects based on session (login vs home)
│   ├── login.tsx                 # social + email/SMS OTP + passkey entry
│   └── home.tsx                  # authed: shows Solana wallet address + logout
├── src/
│   ├── config/env.ts             # typed read of expo-constants extra
│   ├── config/env.test.ts
│   ├── api/navyClient.ts         # exchangePrivyToken(privyToken) -> NavySession; typed errors
│   ├── api/navyClient.test.ts
│   ├── auth/tokenStore.ts        # save/load/clear Navy tokens behind injected SecureBackend
│   ├── auth/tokenStore.test.ts
│   ├── auth/session.ts           # establish/restore/clear session (pure; takes client+store)
│   ├── auth/session.test.ts
│   ├── auth/SessionContext.tsx   # React context + useNavySession hook (thin RN binding)
│   └── auth/types.ts             # shared types: NavySession, NavyTokens
└── assets/                       # expo defaults
```

Each logic module avoids React Native imports so Jest runs it without a native runtime. `tokenStore` depends on an injected `SecureBackend` interface (default = `expo-secure-store`), so tests pass a mock.

---

## Conventions for every task

- Run from `/home/khoa/Desktop/uni/mobile`. Package manager: **pnpm**.
- Tests: `pnpm test <pattern>` (Jest). Typecheck: `pnpm exec tsc --noEmit`.
- Commit after each task with the message in its final step. If git complains about identity, prefix: `git -c user.name=Navy -c user.email=capydata.xyz@gmail.com commit ...`.
- The backend must be reachable for the manual integration smoke (Task 10); unit tests never hit the network.

---

### Task 1: Scaffold Expo app, Privy, Jest

**Files:**
- Create: `mobile/` (Expo scaffold), `mobile/jest.config.js`, `mobile/.env.example`, `mobile/.env`, `mobile/.gitignore` (append)

- [ ] **Step 1: Scaffold the Expo app (TypeScript, expo-router)**

```bash
cd /home/khoa/Desktop/uni
pnpm dlx create-expo-app@latest mobile --template expo-template-blank-typescript
cd mobile
```

- [ ] **Step 2: Install Privy + required Expo modules + Solana + test deps**

```bash
npx expo install expo-application expo-constants expo-linking expo-secure-store react-native-webview @privy-io/expo expo-router react-native-safe-area-context react-native-screens
npx expo install @solana/web3.js
pnpm add -D jest jest-expo @types/jest ts-jest
```

- [ ] **Step 3: Create `mobile/jest.config.js`**

```js
module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@privy-io/.*|@solana/.*))',
  ],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
```

- [ ] **Step 4: Create `mobile/.env.example` and copy to `.env`**

```bash
# .env.example
PRIVY_APP_ID=replace_me
PRIVY_CLIENT_ID=replace_me
# Backend base URL. iOS sim: http://localhost:3000 · Android emulator: http://10.0.2.2:3000
# Physical device: http://<your-LAN-ip>:3000
NAVY_API_URL=http://localhost:3000
```

Run: `cp .env.example .env`

- [ ] **Step 5: Append to `mobile/.gitignore`**

Ensure these lines exist: `.env`, `node_modules`, `.expo`, `dist`.

- [ ] **Step 6: Verify the app typechecks and Jest runs**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.
Run: `pnpm exec jest --version`
Expected: prints a Jest version (config loads).

- [ ] **Step 7: Commit**

```bash
cd /home/khoa/Desktop/uni
git add mobile
git commit -m "chore(mobile): scaffold Expo app, Privy SDK, Jest"
```

---

### Task 2: Typed config (env) module

**Files:**
- Create: `mobile/src/config/env.ts`, `mobile/src/config/env.test.ts`
- Modify: `mobile/app.json` (expose public config via `extra`)

- [ ] **Step 1: Add `extra` to `mobile/app.json`** (inside the existing `"expo"` object)

```json
"extra": {
  "privyAppId": "PRIVY_APP_ID_PLACEHOLDER",
  "privyClientId": "PRIVY_CLIENT_ID_PLACEHOLDER",
  "navyApiUrl": "http://localhost:3000"
},
"scheme": "navy"
```

> The placeholders are replaced at build time from `.env` via `app.config.ts` in a later iteration; for now the values can be edited directly for dev. `scheme` is required for Privy OAuth deep-link redirects.

- [ ] **Step 2: Write the failing test** — `mobile/src/config/env.test.ts`

```ts
import { readEnv } from './env';

describe('readEnv', () => {
  it('maps expo extra into a typed config', () => {
    const cfg = readEnv({ privyAppId: 'app', privyClientId: 'client', navyApiUrl: 'http://x:3000' });
    expect(cfg).toEqual({ privyAppId: 'app', privyClientId: 'client', navyApiUrl: 'http://x:3000' });
  });

  it('throws when a required value is missing', () => {
    expect(() => readEnv({ privyAppId: '', privyClientId: 'c', navyApiUrl: 'u' })).toThrow(/privyAppId/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test env.test`
Expected: FAIL — cannot find `./env`.

- [ ] **Step 4: Implement `mobile/src/config/env.ts`**

```ts
export interface NavyEnv {
  privyAppId: string;
  privyClientId: string;
  navyApiUrl: string;
}

type RawExtra = Partial<Record<keyof NavyEnv, string>>;

export function readEnv(extra: RawExtra): NavyEnv {
  const req = (k: keyof NavyEnv): string => {
    const v = extra[k];
    if (!v) throw new Error(`Missing required config: ${k}`);
    return v;
  };
  return {
    privyAppId: req('privyAppId'),
    privyClientId: req('privyClientId'),
    navyApiUrl: req('navyApiUrl'),
  };
}

// Runtime accessor used by the app (not by unit tests, which call readEnv directly).
// Lazily import expo-constants so Jest never loads native modules through this file.
export function getEnv(): NavyEnv {
  const Constants = require('expo-constants').default;
  return readEnv((Constants?.expoConfig?.extra ?? {}) as RawExtra);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test env.test`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/config mobile/app.json
git commit -m "feat(mobile): typed env/config from expo extra"
```

---

### Task 3: NavyClient (Privy→Navy token exchange)

**Files:**
- Create: `mobile/src/auth/types.ts`, `mobile/src/api/navyClient.ts`, `mobile/src/api/navyClient.test.ts`

- [ ] **Step 1: Write `mobile/src/auth/types.ts`**

```ts
export interface NavyTokens {
  accessToken: string;
  refreshToken: string;
}

export interface NavySession {
  tokens: NavyTokens;
}
```

- [ ] **Step 2: Write the failing test** — `mobile/src/api/navyClient.test.ts`

```ts
import { NavyClient, NavyAuthError } from './navyClient';

function mockFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe('NavyClient.exchangePrivyToken', () => {
  it('POSTs the privy token and returns Navy tokens', async () => {
    const fetchImpl = mockFetch(201, { accessToken: 'a', refreshToken: 'r' });
    const client = new NavyClient('http://api', fetchImpl);
    const tokens = await client.exchangePrivyToken('privy-jwt');
    expect(fetchImpl).toHaveBeenCalledWith('http://api/auth/privy', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: 'privy-jwt' }),
    }));
    expect(tokens).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('throws NavyAuthError on a 401 from the backend', async () => {
    const client = new NavyClient('http://api', mockFetch(401, { message: 'Invalid Privy token' }));
    await expect(client.exchangePrivyToken('bad')).rejects.toBeInstanceOf(NavyAuthError);
  });

  it('throws NavyAuthError if the response is missing tokens', async () => {
    const client = new NavyClient('http://api', mockFetch(201, { accessToken: 'a' }));
    await expect(client.exchangePrivyToken('x')).rejects.toThrow(/token/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test navyClient`
Expected: FAIL — cannot find `./navyClient`.

- [ ] **Step 4: Implement `mobile/src/api/navyClient.ts`**

```ts
import { NavyTokens } from '../auth/types';

export class NavyAuthError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'NavyAuthError';
  }
}

export class NavyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async exchangePrivyToken(privyAccessToken: string): Promise<NavyTokens> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/auth/privy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: privyAccessToken }),
      });
    } catch (e) {
      throw new NavyAuthError(`Network error contacting Navy backend: ${(e as Error).message}`);
    }
    if (!res.ok) {
      throw new NavyAuthError(`Navy auth failed (HTTP ${res.status})`, res.status);
    }
    const body = (await res.json()) as Partial<NavyTokens>;
    if (!body.accessToken || !body.refreshToken) {
      throw new NavyAuthError('Navy response missing tokens');
    }
    return { accessToken: body.accessToken, refreshToken: body.refreshToken };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test navyClient`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/api mobile/src/auth/types.ts
git commit -m "feat(mobile): NavyClient for Privy->Navy token exchange"
```

---

### Task 4: Secure TokenStore

**Files:**
- Create: `mobile/src/auth/tokenStore.ts`, `mobile/src/auth/tokenStore.test.ts`

- [ ] **Step 1: Write the failing test** — `mobile/src/auth/tokenStore.test.ts`

```ts
import { TokenStore, SecureBackend } from './tokenStore';

function memoryBackend(): SecureBackend {
  const m = new Map<string, string>();
  return {
    getItemAsync: async (k) => m.get(k) ?? null,
    setItemAsync: async (k, v) => { m.set(k, v); },
    deleteItemAsync: async (k) => { m.delete(k); },
  };
}

describe('TokenStore', () => {
  it('saves and loads Navy tokens', async () => {
    const store = new TokenStore(memoryBackend());
    await store.save({ accessToken: 'a', refreshToken: 'r' });
    expect(await store.load()).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('returns null when nothing is stored', async () => {
    const store = new TokenStore(memoryBackend());
    expect(await store.load()).toBeNull();
  });

  it('clears stored tokens', async () => {
    const backend = memoryBackend();
    const store = new TokenStore(backend);
    await store.save({ accessToken: 'a', refreshToken: 'r' });
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('returns null if stored data is corrupt JSON', async () => {
    const backend = memoryBackend();
    await backend.setItemAsync('navy.tokens', '{not json');
    const store = new TokenStore(backend);
    expect(await store.load()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tokenStore`
Expected: FAIL — cannot find `./tokenStore`.

- [ ] **Step 3: Implement `mobile/src/auth/tokenStore.ts`**

```ts
import { NavyTokens } from './types';

export interface SecureBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const KEY = 'navy.tokens';

export class TokenStore {
  constructor(private readonly backend: SecureBackend) {}

  async save(tokens: NavyTokens): Promise<void> {
    await this.backend.setItemAsync(KEY, JSON.stringify(tokens));
  }

  async load(): Promise<NavyTokens | null> {
    const raw = await this.backend.getItemAsync(KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<NavyTokens>;
      if (!parsed.accessToken || !parsed.refreshToken) return null;
      return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    await this.backend.deleteItemAsync(KEY);
  }
}

// Default backend bound to expo-secure-store (lazy require so Jest never loads native).
export function expoSecureBackend(): SecureBackend {
  const SecureStore = require('expo-secure-store');
  return {
    getItemAsync: SecureStore.getItemAsync,
    setItemAsync: SecureStore.setItemAsync,
    deleteItemAsync: SecureStore.deleteItemAsync,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tokenStore`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/auth/tokenStore.ts mobile/src/auth/tokenStore.test.ts
git commit -m "feat(mobile): secure TokenStore behind injected backend"
```

---

### Task 5: Session state machine

**Files:**
- Create: `mobile/src/auth/session.ts`, `mobile/src/auth/session.test.ts`

- [ ] **Step 1: Write the failing test** — `mobile/src/auth/session.test.ts`

```ts
import { SessionManager } from './session';
import { NavyClient } from '../api/navyClient';
import { TokenStore, SecureBackend } from './tokenStore';

function memoryBackend(): SecureBackend {
  const m = new Map<string, string>();
  return {
    getItemAsync: async (k) => m.get(k) ?? null,
    setItemAsync: async (k, v) => { m.set(k, v); },
    deleteItemAsync: async (k) => { m.delete(k); },
  };
}

describe('SessionManager', () => {
  it('establishes a session: exchanges the privy token and persists Navy tokens', async () => {
    const client = { exchangePrivyToken: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }) } as unknown as NavyClient;
    const store = new TokenStore(memoryBackend());
    const mgr = new SessionManager(client, store);

    const session = await mgr.establish('privy-jwt');

    expect(client.exchangePrivyToken).toHaveBeenCalledWith('privy-jwt');
    expect(session.tokens).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(await store.load()).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('restores a session from storage when tokens exist', async () => {
    const store = new TokenStore(memoryBackend());
    await store.save({ accessToken: 'a', refreshToken: 'r' });
    const mgr = new SessionManager({} as NavyClient, store);
    expect(await mgr.restore()).toEqual({ tokens: { accessToken: 'a', refreshToken: 'r' } });
  });

  it('restore returns null when nothing is stored', async () => {
    const mgr = new SessionManager({} as NavyClient, new TokenStore(memoryBackend()));
    expect(await mgr.restore()).toBeNull();
  });

  it('clear wipes the stored session', async () => {
    const store = new TokenStore(memoryBackend());
    await store.save({ accessToken: 'a', refreshToken: 'r' });
    const mgr = new SessionManager({} as NavyClient, store);
    await mgr.clear();
    expect(await mgr.restore()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test session.test`
Expected: FAIL — cannot find `./session`.

- [ ] **Step 3: Implement `mobile/src/auth/session.ts`**

```ts
import { NavyClient } from '../api/navyClient';
import { TokenStore } from './tokenStore';
import { NavySession } from './types';

export class SessionManager {
  constructor(
    private readonly client: NavyClient,
    private readonly store: TokenStore,
  ) {}

  /** Exchange a Privy access token for Navy tokens and persist them. */
  async establish(privyAccessToken: string): Promise<NavySession> {
    const tokens = await this.client.exchangePrivyToken(privyAccessToken);
    await this.store.save(tokens);
    return { tokens };
  }

  /** Rehydrate a session from secure storage, or null if none. */
  async restore(): Promise<NavySession | null> {
    const tokens = await this.store.load();
    return tokens ? { tokens } : null;
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test session.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/auth/session.ts mobile/src/auth/session.test.ts
git commit -m "feat(mobile): SessionManager (establish/restore/clear)"
```

---

### Task 6: SessionContext + useNavySession hook

**Files:**
- Create: `mobile/src/auth/SessionContext.tsx`

- [ ] **Step 1: Implement `mobile/src/auth/SessionContext.tsx`**

This is a thin React binding (no new unit test — its logic delegates to the already-tested `SessionManager`; it is exercised by manual smoke in Task 10). It builds a `SessionManager` from real env + Privy, and exposes session state.

```tsx
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
  /** Call after Privy login completes to exchange the Privy token for a Navy session. */
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

  // On boot, rehydrate any persisted Navy session.
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

  // If Privy logs the user out underneath us, drop the Navy session too.
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

> If `usePrivy()` does not expose `getAccessToken`, `logout`, or `user` under these names in the installed `@privy-io/expo` version, inspect `node_modules/@privy-io/expo` types and adjust the destructuring to the real API (the surrounding logic is unchanged). Document any rename.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/auth/SessionContext.tsx
git commit -m "feat(mobile): SessionProvider + useNavySession hook"
```

---

### Task 7: Root layout — PrivyProvider + SessionProvider + route guard

**Files:**
- Create: `mobile/app/_layout.tsx`, `mobile/app/index.tsx`
- Modify: `mobile/package.json` (set expo-router entry), `mobile/app.json` (router plugin)

- [ ] **Step 1: Configure expo-router entry**

In `mobile/package.json`, set `"main": "expo-router/entry"`.
In `mobile/app.json` `expo` object, ensure `"plugins": ["expo-router"]` is present (merge with any existing plugins).

- [ ] **Step 2: Implement `mobile/app/_layout.tsx`**

```tsx
import React from 'react';
import { Slot } from 'expo-router';
import { PrivyProvider } from '@privy-io/expo';
import { getEnv } from '../src/config/env';
import { SessionProvider } from '../src/auth/SessionContext';

export default function RootLayout() {
  const env = getEnv();
  return (
    <PrivyProvider
      appId={env.privyAppId}
      clientId={env.privyClientId}
      config={{ embedded: { solana: { createOnLogin: 'users-without-wallets' } } }}
    >
      <SessionProvider>
        <Slot />
      </SessionProvider>
    </PrivyProvider>
  );
}
```

> The `config.embedded.solana.createOnLogin` shape auto-provisions a non-custodial Solana wallet at login (spec §4). Confirm the exact `config` prop shape against the installed `@privy-io/expo` types; if it differs, adjust to the real option that enables Solana embedded-wallet auto-creation and document it.

- [ ] **Step 3: Implement `mobile/app/index.tsx`** (route guard / redirect)

```tsx
import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { usePrivy } from '@privy-io/expo';
import { useNavySession } from '../src/auth/SessionContext';

export default function Index() {
  const { isReady } = usePrivy();
  const { session, initializing } = useNavySession();

  if (!isReady || initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Redirect href={session ? '/home' : '/login'} />;
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/_layout.tsx mobile/app/index.tsx mobile/package.json mobile/app.json
git commit -m "feat(mobile): root layout with Privy + Session providers and route guard"
```

---

### Task 8: Login screen (social + email/SMS OTP + passkey)

**Files:**
- Create: `mobile/app/login.tsx`

- [ ] **Step 1: Implement `mobile/app/login.tsx`**

```tsx
import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useLoginWithOAuth, useLoginWithEmail, useLoginWithSMS } from '@privy-io/expo';
import { useNavySession } from '../src/auth/SessionContext';

export default function Login() {
  const router = useRouter();
  const { establishFromPrivy } = useNavySession();
  const { login: loginOAuth } = useLoginWithOAuth();
  const email = useLoginWithEmail();
  const sms = useLoginWithSMS();

  const [emailAddr, setEmailAddr] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');

  // After ANY successful Privy login, exchange for a Navy session and route home.
  const finish = async () => {
    try {
      await establishFromPrivy();
      router.replace('/home');
    } catch (e) {
      Alert.alert('Login failed', (e as Error).message);
    }
  };

  const social = async (provider: 'google' | 'apple') => {
    try {
      await loginOAuth({ provider });
      await finish();
    } catch (e) {
      Alert.alert('Social login failed', (e as Error).message);
    }
  };

  return (
    <View style={styles.c}>
      <Text style={styles.h}>Sign in to Navy</Text>

      <Button title="Continue with Google" onPress={() => social('google')} />
      <Button title="Continue with Apple" onPress={() => social('apple')} />

      <Text style={styles.s}>Email code</Text>
      <TextInput style={styles.i} autoCapitalize="none" keyboardType="email-address"
        placeholder="you@example.com" value={emailAddr} onChangeText={setEmailAddr} />
      <Button title="Send email code" onPress={() => email.sendCode({ email: emailAddr })} />
      <TextInput style={styles.i} keyboardType="number-pad" placeholder="123456"
        value={emailCode} onChangeText={setEmailCode} />
      <Button title="Verify email code" onPress={async () => {
        try { await email.loginWithCode({ code: emailCode, email: emailAddr }); await finish(); }
        catch (e) { Alert.alert('Email login failed', (e as Error).message); }
      }} />

      <Text style={styles.s}>Phone code</Text>
      <TextInput style={styles.i} keyboardType="phone-pad" placeholder="+15551234567"
        value={phone} onChangeText={setPhone} />
      <Button title="Send SMS code" onPress={() => sms.sendCode({ phone })} />
      <TextInput style={styles.i} keyboardType="number-pad" placeholder="123456"
        value={smsCode} onChangeText={setSmsCode} />
      <Button title="Verify SMS code" onPress={async () => {
        try { await sms.loginWithCode({ code: smsCode, phone }); await finish(); }
        catch (e) { Alert.alert('SMS login failed', (e as Error).message); }
      }} />
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, gap: 8, justifyContent: 'center' },
  h: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
  s: { marginTop: 16, fontWeight: '600' },
  i: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
});
```

> **Passkey note (spec §3.1):** Privy passkey login on native requires associated-domain / app-linking native config plus dashboard setup, which is environment-specific. Add passkey via `useLoginWithPasskey` once the app has a registered bundle id and associated domain; wire it with the same `finish()` callback. It is intentionally NOT in this screen's first cut to keep the build green without native signing config — tracked as a follow-up in the spec. Social + email + SMS cover login for v1.
> Confirm `useLoginWithEmail`/`useLoginWithSMS` method names (`sendCode`, `loginWithCode`) and `useLoginWithOAuth().login` against the installed SDK types; adjust if renamed.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (If a hook name differs in the installed SDK, fix per the note and re-run.)

- [ ] **Step 3: Commit**

```bash
git add mobile/app/login.tsx
git commit -m "feat(mobile): login screen with social and email/SMS OTP"
```

---

### Task 9: Home screen (wallet address + logout)

**Files:**
- Create: `mobile/app/home.tsx`

- [ ] **Step 1: Implement `mobile/app/home.tsx`**

```tsx
import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useNavySession } from '../src/auth/SessionContext';

export default function Home() {
  const router = useRouter();
  const { session, signOut } = useNavySession();
  const solana = useEmbeddedSolanaWallet();
  const address = solana?.wallets?.[0]?.address ?? 'provisioning…';

  return (
    <View style={styles.c}>
      <Text style={styles.h}>Navy Wallet</Text>
      <Text style={styles.l}>Solana address</Text>
      <Text selectable style={styles.mono}>{address}</Text>
      <Text style={styles.l}>Navy session</Text>
      <Text style={styles.mono}>{session ? 'active' : 'none'}</Text>
      <Button title="Sign out" onPress={async () => { await signOut(); router.replace('/login'); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, gap: 8, justifyContent: 'center' },
  h: { fontSize: 22, fontWeight: '600' },
  l: { marginTop: 16, fontWeight: '600' },
  mono: { fontFamily: 'monospace' },
});
```

> Confirm `useEmbeddedSolanaWallet()` returns `{ wallets: [{ address }] }` in the installed SDK; adjust the address accessor if the shape differs.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add mobile/app/home.tsx
git commit -m "feat(mobile): home screen showing Solana wallet address and logout"
```

---

### Task 10: Full verification — tests, typecheck, manual smoke

**Files:** none (verification task)

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: all logic specs pass — `env` (2), `navyClient` (3), `tokenStore` (4), `session` (4) = 13 tests.

- [ ] **Step 2: Typecheck the whole app**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Fill real dev credentials**

Edit `mobile/app.json` `extra.privyAppId` / `extra.privyClientId` with values from the Privy dashboard (a dev app with devnet enabled; configure the `navy://` redirect scheme and allowed login methods in the dashboard). Set `extra.navyApiUrl` to the address the device/emulator can reach (iOS sim `http://localhost:3000`, Android emulator `http://10.0.2.2:3000`, physical device `http://<LAN-ip>:3000`).

- [ ] **Step 4: Start the backend and the app**

In one terminal: `cd /home/khoa/Desktop/uni/be && docker compose up -d && pnpm start`.
In another: `cd /home/khoa/Desktop/uni/mobile && pnpm exec expo start`.

- [ ] **Step 5: Manual smoke (record results)**

On a simulator/device, verify the end-to-end flow:
1. App opens to `/login` (no session).
2. Email-code login: enter email → "Send email code" → enter the code → "Verify". App routes to `/home`.
3. `/home` shows a Solana address (auto-provisioned, non-custodial) and "Navy session: active".
4. Confirm the backend created a `User` row (the `/auth/privy` exchange ran): `cd /home/khoa/Desktop/uni/be && pnpm prisma studio` (or a quick `psql` count of `"User"`).
5. Kill and reopen the app → it restores the session and lands on `/home` (TokenStore persistence).
6. "Sign out" → returns to `/login`; reopening stays on `/login`.

Record the outcomes in the commit message / PR notes. This manual smoke is the integration test for the Privy↔backend boundary that unit tests mock.

- [ ] **Step 6: Commit any credential/config changes**

```bash
git add mobile/app.json
git commit -m "chore(mobile): dev Privy credentials and API URL for smoke test"
```

---

## Self-Review

**Spec coverage (spec §→ task):**
- §3.1 user login via Privy (Google/Apple social, email OTP, SMS OTP) → Task 8; passkey explicitly deferred with a documented native-config reason (Task 8 note) — noted as follow-up, social+email+SMS satisfy login for v1.
- §3.1 verify Privy token at backend → upsert user → Navy JWT → Tasks 3 (client) + 5 (establish) + 6 (wired to `getAccessToken`); backend endpoint already built (Plan 1).
- §4 non-custodial embedded Solana wallet auto-provisioned → Task 7 (`PrivyProvider config.embedded.solana.createOnLogin`) + Task 9 (display).
- Unified Navy JWT held client-side + session restore → Tasks 4 (secure store), 5 (restore), 6 (boot rehydrate).
- Networks devnet → Task 10 (dashboard dev app on devnet; `navyApiUrl` config).

**Placeholder scan:** No TBD/TODO-as-implementation. Every logic step ships complete code with real tests. UI tasks ship complete component code; their verification is typecheck + a concrete, enumerated manual smoke (RN UI cannot be meaningfully unit-tested). The three SDK-shape caveats (Privy `config` prop, `usePrivy` accessors, login-hook method names) are explicitly flagged with "inspect installed types and adjust" instructions and isolated so they surface at typecheck, not at runtime — matching how the backend plan handled SDK drift.

**Type consistency:** `NavyTokens`/`NavySession` (Task 3 `types.ts`) used identically in `NavyClient` (3), `TokenStore` (4), `SessionManager` (5), `SessionContext` (6). `SecureBackend` (4) consumed by `expoSecureBackend` and `SessionContext` (6). `NavyClient.exchangePrivyToken` signature (3) called by `SessionManager.establish` (5). `SessionManager` methods `establish/restore/clear` (5) consumed by `SessionContext` (6). `useNavySession` value shape (6) consumed by `index`/`login`/`home` (7–9). Consistent.

**Known follow-ups (recorded):** passkey login (needs associated-domain native config + dashboard setup); access-token refresh/rotation on Navy 401 (mirrors backend's deferred refresh endpoint); `app.config.ts` to inject `.env` into `extra` at build time instead of hand-editing `app.json`.
