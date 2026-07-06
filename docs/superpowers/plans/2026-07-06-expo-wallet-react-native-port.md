# Expo Wallet — React Native Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `web-wallet/` (Next.js + `@privy-io/react-auth`) to a native iPhone app in `expo-wallet/` (Expo SDK 54 + Expo Router + `@privy-io/expo`), preserving all business logic unchanged.

**Architecture:** New independent 5th app at `/home/khoa/Desktop/uni/expo-wallet`. Copy `web-wallet/src/lib/**` (framework-free plain TS) verbatim; swap the platform adapters it already abstracts behind interfaces (token storage, env, Privy hooks, QR scan, clipboard, linking); rewrite the `src/ui/**` + screen layer from HTML/CSS to React Native primitives keeping the same prop APIs. Delivered as an Expo Dev Client via EAS Build (Privy cannot run in Expo Go).

**Tech Stack:** Expo SDK 54, TypeScript, Expo Router, `@privy-io/expo`, `@solana/web3.js` 1.98.4, `@solana/spl-token`, `expo-secure-store`, `expo-camera`, `expo-linear-gradient`, `expo-clipboard`, `expo-web-browser`, `expo-linking`, `react-native-get-random-values`, jest + ts-jest.

---

## Critical facts (verified against Privy docs 2026-07-06)

**SDK drift from `@privy-io/react-auth` → `@privy-io/expo` (verify each against the installed `.d.ts` before use):**
- `usePrivy()` exposes **`isReady`** (NOT `ready`), plus `user`, `getAccessToken`, `logout`. `authenticated` is derived from `user != null` — confirm the exact field name in the installed types.
- Login hooks: `useLoginWithEmail()` → `{ sendCode, loginWithCode }`; `useLoginWithOAuth()` → `{ login }` (needs `expo-web-browser`); passkey via the installed passkey hook (verify name).
- Solana: `useEmbeddedSolanaWallet()` → `{ wallets, create }`. Sign via:
  ```ts
  const provider = await wallet.getProvider();
  const { signedTransaction } = await provider.request({
    method: 'signTransaction',
    params: { transaction }, // legacy Transaction | VersionedTransaction
  });
  ```
- `PrivyProvider` requires both `appId` and `clientId` props.

**Repo conventions to honor:**
- Money is serialized as strings from `be`; the lib already handles this — do not reintroduce BigInt in UI.
- `@solana/web3.js` pinned to 1.98.4 (match web-wallet exactly).
- Keep non-UI logic in plain-TS modules (no framework imports) so lib tests keep passing.
- Verify by running the app on-device, not just `tsc` (RN analog of web-wallet's "build is the runtime gate").

**Reference source files (read before porting each):** all paths under `web-wallet/src/`.

---

## File structure (what gets created)

```
expo-wallet/
  package.json                         # own deps, pnpm.onlyBuiltDependencies
  app.json                             # scheme, permissions, plugins, associated domains
  eas.json                             # development dev-client profile
  tsconfig.json                        # extends expo/tsconfig.base, @/* path alias
  babel.config.js                      # babel-preset-expo + reanimated plugin
  metro.config.js                      # default expo metro
  jest.config.js                       # ts-jest, roots src/lib
  index.ts                             # entry: polyfills + expo-router/entry
  .env.local                           # EXPO_PUBLIC_* (gitignored)
  src/
    lib/**                             # COPIED VERBATIM from web-wallet/src/lib (minus web-only adapters)
    lib/auth/tokenStore.ts             # + add secureStoreBackend()
    lib/config/env.ts                  # getEnv() reads EXPO_PUBLIC_* via expo-constants
    lib/wallet/useMobileSigner.ts      # replaces useWebSigner.ts
    lib/pay/useCameraScanner.ts        # replaces useQrScanner.ts (expo-camera)
    ui/theme.ts                        # COPIED VERBATIM
    ui/*.tsx                           # rewritten RN primitives, same prop APIs
    lib/auth/SessionContext.tsx        # ported (ready→isReady)
    ui/Toast.tsx                       # ported ToastProvider (RN)
  app/
    _layout.tsx                        # PrivyProvider + SessionProvider + ToastProvider
    index.tsx                          # redirect by session
    login.tsx
    pay/[orderId].tsx
    (tabs)/_layout.tsx                 # Tabs + auth guard
    (tabs)/{home,scan,receive,history,farming,settings}.tsx
```

---

## Task 0: Scaffold the Expo app

**Files:**
- Create: `expo-wallet/` (via `create-expo-app`)

- [ ] **Step 1: Scaffold Expo SDK 54 + Expo Router (blank-typescript)**

Run from `/home/khoa/Desktop/uni`:
```bash
pnpm dlx create-expo-app@latest expo-wallet --template blank-typescript
cd expo-wallet
pnpm dlx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar
```
Expected: `expo-wallet/` created; `expo --version` reports SDK 54.

- [ ] **Step 2: Convert entry to Expo Router**

Set `package.json` `"main": "index.ts"`. Create `expo-wallet/index.ts`:
```ts
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
// @ts-expect-error global shim
globalThis.Buffer = globalThis.Buffer ?? Buffer;
import 'expo-router/entry';
```
Add to `app.json` under `expo`: `"scheme": "navywallet"` and `"plugins": ["expo-router"]`.

- [ ] **Step 3: tsconfig path alias**

`expo-wallet/tsconfig.json`:
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

- [ ] **Step 4: Minimal placeholder route to prove boot**

Create `expo-wallet/app/_layout.tsx`:
```tsx
import { Slot } from 'expo-router';
export default function Root() { return <Slot />; }
```
Create `expo-wallet/app/index.tsx`:
```tsx
import { Text, View } from 'react-native';
export default function Index() {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text>Navy boots</Text></View>;
}
```
Delete the template's `App.tsx` if present.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add expo-wallet && git commit -m "feat(expo-wallet): scaffold Expo SDK 54 + Expo Router app"
```
Expected: tsc clean.

---

## Task 1: Install Privy + native deps and configure EAS dev client

**Files:**
- Modify: `expo-wallet/package.json`, `expo-wallet/app.json`
- Create: `expo-wallet/eas.json`

- [ ] **Step 1: Install Privy + Solana + platform deps**

```bash
cd /home/khoa/Desktop/uni/expo-wallet
pnpm dlx expo install @privy-io/expo expo-secure-store expo-camera expo-linear-gradient expo-clipboard expo-web-browser expo-apple-authentication expo-application react-native-passkeys react-native-webview react-native-get-random-values buffer react-native-gesture-handler react-native-reanimated
pnpm add @solana/web3.js@1.98.4 @solana/spl-token
```
> If `@privy-io/expo` prints a required-plugins/peer-deps notice, follow it exactly and record the resolved versions in the commit message. Pin `@solana/web3.js` to `1.98.4` to match `web-wallet`.

- [ ] **Step 2: onlyBuiltDependencies (pnpm 10 native-build gate)**

In `expo-wallet/package.json` add:
```json
"pnpm": { "onlyBuiltDependencies": ["@privy-io/expo"] }
```
Then `pnpm install`.

- [ ] **Step 3: Configure app.json plugins & permissions**

In `expo-wallet/app.json` under `expo`, set:
```json
"scheme": "navywallet",
"ios": {
  "bundleIdentifier": "com.navy.wallet",
  "supportsTablet": false,
  "associatedDomains": ["webcredentials:PRIVY_RP_ID_PLACEHOLDER"],
  "infoPlist": { "NSCameraUsageDescription": "Scan a Navy pay QR code to pay." }
},
"plugins": [
  "expo-router",
  "expo-secure-store",
  "expo-web-browser",
  ["expo-camera", { "cameraPermission": "Scan a Navy pay QR code to pay." }],
  ["@privy-io/expo", {}]
]
```
> Replace `PRIVY_RP_ID_PLACEHOLDER` with the passkey RP ID from the Privy dashboard once known; passkeys are verified last. Confirm the exact `@privy-io/expo` plugin key/args from its docs output in Step 1.

- [ ] **Step 4: Reanimated babel plugin**

`expo-wallet/babel.config.js`:
```js
module.exports = (api) => {
  api.cache(true);
  return { presets: ['babel-preset-expo'], plugins: ['react-native-reanimated/plugin'] };
};
```

- [ ] **Step 5: EAS dev-client profile**

```bash
pnpm dlx eas-cli@latest login   # user runs interactively: suggest `! eas login`
```
Create `expo-wallet/eas.json`:
```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": false }
    }
  }
}
```
Run `pnpm dlx eas-cli build:configure` to attach the EAS project id (writes `extra.eas.projectId` into app.json).

- [ ] **Step 6: Commit**

```bash
git add package.json app.json eas.json babel.config.js pnpm-lock.yaml
git commit -m "feat(expo-wallet): add Privy Expo SDK, native deps, EAS dev-client config"
```
> Do NOT build the dev client yet — build once the UI compiles (Task 16 gate). Boot verification happens on-device there.

---

## Task 2: Port the framework-free lib and its tests

**Files:**
- Create (copy): `expo-wallet/src/lib/**` from `web-wallet/src/lib/**`
- Create: `expo-wallet/jest.config.js`

- [ ] **Step 1: Copy the plain-TS lib verbatim (exclude web-only adapters)**

```bash
cd /home/khoa/Desktop/uni
mkdir -p expo-wallet/src
cp -R web-wallet/src/lib expo-wallet/src/lib
# Remove web-only adapters — replaced in later tasks:
rm expo-wallet/src/lib/wallet/useWebSigner.ts
rm expo-wallet/src/lib/pay/useQrScanner.ts
```
Everything else (session, navyClient, farmingClient, payFlow, payUrl, balances, identicon, otp, slide, tips, linkedAccounts + their `.test.ts`) stays byte-for-byte identical.

- [ ] **Step 2: Add jest config (mirror web-wallet's)**

Read `web-wallet/jest.config.js` and copy its `moduleNameMapper`/`transform` settings. Create `expo-wallet/jest.config.js`:
```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/lib'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  // Copy any uuid/rpc-websockets ESM mappers from web-wallet/jest.config.js verbatim.
};
```
Add dev deps: `pnpm add -D jest ts-jest @types/jest typescript`. Add `"test": "jest"` to scripts.

- [ ] **Step 3: Run the ported tests — the safety net**

```bash
cd expo-wallet && pnpm test
```
Expected: PASS with the same suite count as `web-wallet` minus the two removed adapter files. If any test references `useWebSigner`/`useQrScanner`, note it — those are covered by Tasks 8/11.

- [ ] **Step 4: Commit**

```bash
git add expo-wallet/src/lib expo-wallet/jest.config.js expo-wallet/package.json
git commit -m "feat(expo-wallet): port framework-free lib + tests verbatim"
```

---

## Task 3: Env adapter (EXPO_PUBLIC_* via expo-constants)

**Files:**
- Modify: `expo-wallet/src/lib/config/env.ts`
- Test: `expo-wallet/src/lib/config/env.test.ts` (already copied)

- [ ] **Step 1: Confirm the existing test still pins `readEnv` behavior**

`env.test.ts` tests `readEnv(extra)` (pure). Keep it unchanged — do NOT test `getEnv()` (it reads the platform). Run:
```bash
pnpm test env.test
```
Expected: PASS (readEnv is unchanged).

- [ ] **Step 2: Replace only `getEnv()` source**

In `expo-wallet/src/lib/config/env.ts`, keep `NavyEnv`, `RawExtra`, and `readEnv()` exactly. Replace `getEnv()`:
```ts
// EXPO_PUBLIC_* are inlined by Expo's Metro bundler at build time — reference by literal name.
export function getEnv(): NavyEnv {
  return readEnv({
    privyAppId: process.env.EXPO_PUBLIC_PRIVY_APP_ID,
    privyClientId: process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID,
    navyApiUrl: process.env.EXPO_PUBLIC_NAVY_API_URL,
    solanaRpc: process.env.EXPO_PUBLIC_SOLANA_RPC,
    usdcMint: process.env.EXPO_PUBLIC_USDC_MINT,
  });
}
```

- [ ] **Step 3: Create `.env.local` (gitignored) mirroring web-wallet values**

```bash
cat > expo-wallet/.env.local <<'EOF'
EXPO_PUBLIC_PRIVY_APP_ID=<from web-wallet/.env.local NEXT_PUBLIC_PRIVY_APP_ID>
EXPO_PUBLIC_PRIVY_CLIENT_ID=<from web-wallet NEXT_PUBLIC_PRIVY_CLIENT_ID>
EXPO_PUBLIC_NAVY_API_URL=<be API url, LAN IP not localhost so the phone can reach it>
EXPO_PUBLIC_SOLANA_RPC=<devnet RPC>
EXPO_PUBLIC_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
EOF
echo ".env.local" >> expo-wallet/.gitignore
```
> `NAVY_API_URL` must be a LAN-reachable host (e.g. `http://192.168.x.x:3000`), NOT `localhost` — the phone is a separate device.

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm exec tsc --noEmit && git add src/lib/config/env.ts .gitignore && git commit -m "feat(expo-wallet): env via EXPO_PUBLIC_*"
```

---

## Task 4: SecureStore token backend (TDD)

**Files:**
- Modify: `expo-wallet/src/lib/auth/tokenStore.ts`
- Test: `expo-wallet/src/lib/auth/tokenStore.test.ts` (already copied — add one case)

- [ ] **Step 1: Write a failing test for an injectable backend round-trip**

The existing `TokenStore` tests already use a fake `SecureBackend`. Add a test asserting `secureStoreBackend` conforms to `SecureBackend` by shape (no native call in jest). Append to `tokenStore.test.ts`:
```ts
import { secureStoreBackend } from './tokenStore';
it('secureStoreBackend exposes the SecureBackend interface', () => {
  const b = secureStoreBackend();
  expect(typeof b.getItemAsync).toBe('function');
  expect(typeof b.setItemAsync).toBe('function');
  expect(typeof b.deleteItemAsync).toBe('function');
});
```

- [ ] **Step 2: Run — verify it fails**

```bash
pnpm test tokenStore
```
Expected: FAIL — `secureStoreBackend` is not exported.

- [ ] **Step 3: Implement `secureStoreBackend`, remove `localStorageBackend`**

In `tokenStore.ts` keep `SecureBackend`, `KEY`, and the `TokenStore` class unchanged. Replace `localStorageBackend()` with:
```ts
import * as SecureStore from 'expo-secure-store';

// expo-secure-store already matches the SecureBackend interface 1:1.
export function secureStoreBackend(): SecureBackend {
  return {
    getItemAsync: (k) => SecureStore.getItemAsync(k),
    setItemAsync: (k, v) => SecureStore.setItemAsync(k, v),
    deleteItemAsync: (k) => SecureStore.deleteItemAsync(k),
  };
}
```
Mock the native module for jest — create `expo-wallet/__mocks__/expo-secure-store.js`:
```js
const store = new Map();
module.exports = {
  getItemAsync: async (k) => (store.has(k) ? store.get(k) : null),
  setItemAsync: async (k, v) => { store.set(k, v); },
  deleteItemAsync: async (k) => { store.delete(k); },
};
```
Add to `jest.config.js`: `moduleNameMapper['^expo-secure-store$'] = '<rootDir>/__mocks__/expo-secure-store.js'`.

- [ ] **Step 4: Run — verify pass**

```bash
pnpm test tokenStore
```
Expected: PASS (all existing cases + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/tokenStore.ts src/lib/auth/tokenStore.test.ts __mocks__ jest.config.js
git commit -m "feat(expo-wallet): expo-secure-store token backend"
```

---

## Task 5: Port the design tokens + first UI primitives

**Files:**
- Create (copy): `expo-wallet/src/ui/theme.ts` from `web-wallet/src/ui/theme.ts`
- Create: `expo-wallet/src/ui/Text.tsx`, `expo-wallet/src/ui/Screen.tsx`

- [ ] **Step 1: Copy theme verbatim**

```bash
cp web-wallet/src/ui/theme.ts expo-wallet/src/ui/theme.ts
```
`theme.ts` is pure tokens (colors/space/radius/gradients) — no framework imports. It compiles unchanged.

- [ ] **Step 2: Port `Text` to RN**

Read `web-wallet/src/ui/Text.tsx` for the `variant`/`color`/`dim`/`muted`/`upper`/`center` prop API. Create `expo-wallet/src/ui/Text.tsx` using RN `<Text>` + `StyleSheet`, mapping each `variant` to the same font sizes/weights as the web version, and honoring the same props. Keep the exported component name `Text` and the same prop names so screens are unchanged.

- [ ] **Step 3: Port `Screen` to RN**

Read `web-wallet/src/ui/Screen.tsx`. Create `expo-wallet/src/ui/Screen.tsx` using `SafeAreaView` + optional `ScrollView` (the `scroll` prop) from `react-native-safe-area-context`/`react-native`, background `colors.bg`. Same prop API (`scroll`, `children`, `style`).

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/ui/theme.ts src/ui/Text.tsx src/ui/Screen.tsx
git commit -m "feat(expo-wallet): port theme tokens + Text/Screen primitives"
```
> Note: `tsc` cannot render RN — visual correctness is confirmed on-device in Task 16. Each subsequent UI task ends at `tsc` clean.

---

## Task 6: Port remaining UI primitives

**Files:**
- Create: `expo-wallet/src/ui/{Button,Card,Gradient,Icon,OtpInput,SlideToConfirm,Sheet,Splash,Toast,Skeleton,SuccessCheck,Bits}.tsx`, `expo-wallet/src/ui/index.ts`

- [ ] **Step 1: Port static primitives**

For each of `Button`, `Card`, `Gradient`, `Icon`, `Splash`, `Skeleton`, `Bits`, `SuccessCheck`: read the web source under `web-wallet/src/ui/<name>.tsx` and rewrite with RN primitives, **preserving the exact exported name and prop API** (e.g. `Button` keeps `label`/`icon`/`variant`/`loading`/`disabled`/`onPress`). Mapping rules:
  - `<div>` → `<View>`; text → `<Text>`; `onClick`/`onPress` → RN `onPress` via `Pressable`.
  - Inline CSS objects → `StyleSheet.create` using the same `colors`/`space`/`radius` tokens.
  - `Gradient` → `expo-linear-gradient` `<LinearGradient colors={...}>`; keep the `colors`/`glow` props.
  - `Icon` → pick one icon set (`@expo/vector-icons` `Feather`) and map each existing icon `name` (`wallet`, `send`, `shield`, `check`, etc.) to a Feather name in a lookup table; keep the `name`/`size`/`color`/`strokeWidth` prop API.

- [ ] **Step 2: Port interactive primitives**

  - `OtpInput`: read `web-wallet/src/ui/OtpInput.tsx`; rewrite with RN `TextInput` (numeric keypad), same `value`/`onChange`/`onComplete` API. Reuse `src/lib/ui/otp.ts` (`isComplete`) unchanged.
  - `SlideToConfirm`: rewrite using `react-native-gesture-handler` `PanGestureHandler` + `react-native-reanimated`, driving the same `src/lib/ui/slide.ts` math; keep `onConfirm`/`label` props.
  - `Sheet`: rewrite as a RN `Modal` bottom sheet (the web version portals to body for a full-screen scrim — replicate with `Modal transparent`). Keep `open`/`onClose`/`children` API.
  - `Toast` (`ToastProvider` + `useToast`): read `web-wallet/src/ui/Toast.tsx`; port the context provider to RN (an absolutely-positioned `View` + `Animated`), keeping the `useToast()` → `(msg: string) => void` API exactly.

- [ ] **Step 3: Barrel export**

Create `expo-wallet/src/ui/index.ts` re-exporting every component (mirror `web-wallet/src/ui/index.ts`).

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/ui && git commit -m "feat(expo-wallet): port remaining UI primitives to RN"
```

---

## Task 7: Providers, Session context, and root layout

**Files:**
- Create: `expo-wallet/src/lib/auth/SessionContext.tsx` (ported), `expo-wallet/src/lib/wallet/useMobileSigner.ts`
- Create: `expo-wallet/app/_layout.tsx`, `expo-wallet/app/index.tsx`

- [ ] **Step 1: Port SessionContext (ready → isReady)**

Copy `web-wallet/src/lib/auth/SessionContext.tsx` to `expo-wallet/src/lib/auth/SessionContext.tsx`. Change only:
  - Import `usePrivy` from `@privy-io/expo`.
  - Destructure `isReady` (verify the exact field on the installed type) and use it everywhere the web code used `ready`.
  - Construct the manager with the SecureStore backend: `new TokenStore(secureStoreBackend())`.
  - Everything else (SessionManager, NavyClient, establish/latch/logout effects) stays identical.

- [ ] **Step 2: Write `useMobileSigner` (same shape as useWebSigner)**

Create `expo-wallet/src/lib/wallet/useMobileSigner.ts`:
```ts
import { Connection, Transaction, VersionedTransaction } from '@solana/web3.js';
import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { useEffect, useRef } from 'react';
import { getEnv } from '@/lib/config/env';

// Same contract as web-wallet's useWebSigner: { address, sign, ready }.
export function useMobileSigner() {
  const { isReady } = usePrivy();
  const solana = useEmbeddedSolanaWallet();
  const wallets = solana?.wallets ?? [];
  const wallet = wallets[0]; // Privy Expo embedded Solana wallet
  const address = wallet?.address as string | undefined;

  // Fallback provisioning (mirrors useWebSigner): if authenticated but no wallet, create one, latched once.
  const creatingRef = useRef(false);
  useEffect(() => {
    if (isReady && solana && !wallet && !creatingRef.current && typeof solana.create === 'function') {
      creatingRef.current = true;
      Promise.resolve(solana.create()).catch(() => {});
    }
  }, [isReady, solana, wallet]);

  const sign = async (tx: Transaction): Promise<Transaction> => {
    if (!wallet) throw new Error('No Solana embedded wallet available');
    const provider = await wallet.getProvider();
    const { signedTransaction } = await provider.request({
      method: 'signTransaction',
      params: { transaction: tx },
    });
    if (signedTransaction instanceof Transaction) return signedTransaction;
    return Transaction.from(Uint8Array.from((signedTransaction as VersionedTransaction).serialize()));
  };

  return { address, sign, wallets, ready: !!isReady };
}
```
> Verify `useEmbeddedSolanaWallet()`'s exact returned shape (`wallets`, `create`/`createWallet`) against the installed `.d.ts` and adjust field names if they differ. `Connection` import kept for parity if a later call needs it; drop if unused to keep tsc clean.

- [ ] **Step 3: Root layout with providers**

Create `expo-wallet/app/_layout.tsx`:
```tsx
import 'react-native-gesture-handler';
import { PrivyProvider } from '@privy-io/expo';
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getEnv } from '@/lib/config/env';
import { SessionProvider } from '@/lib/auth/SessionContext';
import { ToastProvider } from '@/ui/Toast';

export default function Root() {
  const env = getEnv();
  return (
    <SafeAreaProvider>
      <PrivyProvider
        appId={env.privyAppId}
        clientId={env.privyClientId}
        config={{ embedded: { solana: { createOnLogin: 'users-without-wallets' } } }}
      >
        <SessionProvider>
          <ToastProvider>
            <Slot />
          </ToastProvider>
        </SessionProvider>
      </PrivyProvider>
    </SafeAreaProvider>
  );
}
```
> Verify the exact `config` shape for embedded Solana createOnLogin against `@privy-io/expo` types; if unsupported, rely solely on the `useMobileSigner` fallback provisioning and drop `config`.

- [ ] **Step 4: index redirect by session**

Read `web-wallet/src/app/page.tsx` for the redirect logic. Create `expo-wallet/app/index.tsx`:
```tsx
import { Redirect } from 'expo-router';
import { useNavySession } from '@/lib/auth/SessionContext';
import { Splash } from '@/ui/Splash';

export default function Index() {
  const { session, initializing } = useNavySession();
  if (initializing) return <Splash />;
  return <Redirect href={session ? '/home' : '/login'} />;
}
```

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/lib/auth/SessionContext.tsx src/lib/wallet/useMobileSigner.ts app/_layout.tsx app/index.tsx
git commit -m "feat(expo-wallet): providers, session context (isReady), mobile signer, index redirect"
```

---

## Task 8: Login screen

**Files:**
- Create: `expo-wallet/app/login.tsx`

- [ ] **Step 1: Port the login screen**

Read `web-wallet/src/app/login/page.tsx`. Create `expo-wallet/app/login.tsx` preserving the same flow (email OTP → passkey → Google/Apple OAuth, the `sent`/`busy` state machine, the `run(fn,label)` toast wrapper, and the redirect-if-session effect). Changes:
  - Hooks from `@privy-io/expo`: `useLoginWithEmail()` → `{ sendCode, loginWithCode }`; `useLoginWithOAuth()` → `{ login }` (call `login({ provider: 'google' | 'apple' })`); passkey hook per installed types.
  - `useRouter` from `expo-router` (`router.replace('/home')`).
  - `<input>` → RN `<TextInput>` (`autoCapitalize="none"`, `keyboardType="email-address"`); `onChange(e.target.value)` → `onChangeText`.
  - Reuse ported `Screen`, `Text`, `Button`, `Gradient`, `Icon`, `OtpInput`, `Splash`, and `useToast`; reuse `isComplete` from `@/lib/ui/otp`.
  - `establishFromPrivy` + `useNavySession` unchanged.

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add app/login.tsx && git commit -m "feat(expo-wallet): login screen (email OTP + OAuth + passkey)"
```
> Live OAuth/passkey verified on-device in Task 16 (they need the dev client + dashboard config).

---

## Task 9: Tabs layout + auth guard + tab bar

**Files:**
- Create: `expo-wallet/app/(tabs)/_layout.tsx`

- [ ] **Step 1: Port the auth-guard + tab navigator**

Read `web-wallet/src/app/(tabs)/layout.tsx` (client auth-guard: render `<Splash>` until Privy `isReady` AND session `initializing` settle, then redirect to `/login` when no session) and `web-wallet/src/ui/TabBar.tsx`. Create `expo-wallet/app/(tabs)/_layout.tsx` using Expo Router `<Tabs>`:
```tsx
import { Tabs, Redirect } from 'expo-router';
import { usePrivy } from '@privy-io/expo';
import { useNavySession } from '@/lib/auth/SessionContext';
import { Splash } from '@/ui/Splash';
import { Icon } from '@/ui/Icon';
import { colors } from '@/ui/theme';

export default function TabsLayout() {
  const { isReady } = usePrivy();
  const { session, initializing } = useNavySession();
  if (!isReady || initializing) return <Splash />;
  if (!session) return <Redirect href="/login" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.aqua, tabBarStyle: { backgroundColor: colors.bgElevated } }}>
      <Tabs.Screen name="home"     options={{ tabBarIcon: ({ color }) => <Icon name="home" color={color} /> }} />
      <Tabs.Screen name="scan"     options={{ tabBarIcon: ({ color }) => <Icon name="scan" color={color} /> }} />
      <Tabs.Screen name="receive"  options={{ tabBarIcon: ({ color }) => <Icon name="download" color={color} /> }} />
      <Tabs.Screen name="history"  options={{ tabBarIcon: ({ color }) => <Icon name="clock" color={color} /> }} />
      <Tabs.Screen name="farming"  options={{ tabBarIcon: ({ color }) => <Icon name="trendingUp" color={color} /> }} />
      <Tabs.Screen name="settings" options={{ tabBarIcon: ({ color }) => <Icon name="settings" color={color} /> }} />
    </Tabs>
  );
}
```
> Match the tab order/icons to the web `TabBar`. Ensure every `Icon` name used here exists in the Task 6 Feather lookup.

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add "app/(tabs)/_layout.tsx" && git commit -m "feat(expo-wallet): tabs layout + auth guard"
```

---

## Task 10: Home screen

**Files:**
- Create: `expo-wallet/app/(tabs)/home.tsx`

- [ ] **Step 1: Port Home**

Read `web-wallet/src/app/(tabs)/home/page.tsx`. Create `expo-wallet/app/(tabs)/home.tsx` preserving the balance-fetch + hero + provisioning states. Swap `useWebSigner` → `useMobileSigner` (same `{ address, sign, ready }`). Reuse `balances`/`identicon`/`tips` from `@/lib/wallet/*` unchanged, and ported UI primitives. Replace any `div`/CSS with RN `View`/`StyleSheet`.

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add "app/(tabs)/home.tsx" && git commit -m "feat(expo-wallet): home screen"
```

---

## Task 11: Camera scanner adapter + Scan screen

**Files:**
- Create: `expo-wallet/src/lib/pay/useCameraScanner.ts`, `expo-wallet/app/(tabs)/scan.tsx`

- [ ] **Step 1: Read the web scanner contract**

Read `web-wallet/src/lib/pay/useQrScanner.ts` and `web-wallet/src/app/(tabs)/scan/page.tsx` to capture the decode callback contract the scan screen expects (e.g. `onDecode(text)` then parse via `@/lib/pay/payUrl`).

- [ ] **Step 2: Implement `useCameraScanner` with expo-camera**

Create `expo-wallet/src/lib/pay/useCameraScanner.ts` exposing permission state + a `onBarcodeScanned` handler wired to `expo-camera`'s `CameraView` (`barcodeScannerSettings={{ barcodeTypes: ['qr'] }}`), calling the same decode callback with the scanned string. Keep parsing in `@/lib/pay/payUrl` (unchanged).

- [ ] **Step 3: Port the Scan screen**

Create `expo-wallet/app/(tabs)/scan.tsx` rendering `expo-camera`'s `CameraView` full-bleed, requesting permission on mount, and on a valid pay URL routing to `/pay/[orderId]` via `expo-router`. Reuse `payUrl` parsing.

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/lib/pay/useCameraScanner.ts "app/(tabs)/scan.tsx"
git commit -m "feat(expo-wallet): expo-camera QR scanner + scan screen"
```

---

## Task 12: Pay screen + deep linking

**Files:**
- Create: `expo-wallet/app/pay/[orderId].tsx`

- [ ] **Step 1: Port the pay page**

Read `web-wallet/src/app/pay/[orderId]/page.tsx`. Create `expo-wallet/app/pay/[orderId].tsx`. Get `orderId` via `useLocalSearchParams()` from `expo-router` (replaces Next's `params`). Reuse `@/lib/pay/payFlow` and `@/lib/pay/navyPayClient` unchanged. Swap `useWebSigner` → `useMobileSigner`. Preserve the itemized breakdown UI, `SlideToConfirm`, and `SuccessCheck` flow with ported primitives.

- [ ] **Step 2: Deep-link registration**

Confirm `app.json` `scheme: "navywallet"` is set (Task 1). Expo Router auto-maps `navywallet://pay/<id>` to this route. No extra code needed; note it for the Task 16 device test (scanning a QR from another device opens the app).

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add "app/pay/[orderId].tsx" && git commit -m "feat(expo-wallet): pay screen + deep link route"
```

---

## Task 13: Receive, History, Farming, Settings screens

**Files:**
- Create: `expo-wallet/app/(tabs)/receive.tsx`, `expo-wallet/app/(tabs)/history.tsx`, `expo-wallet/app/(tabs)/farming.tsx`, `expo-wallet/app/(tabs)/settings.tsx`

- [ ] **Step 0: Port Receive**

Add the QR dep: `pnpm add react-native-qrcode-svg react-native-svg`. Read `web-wallet/src/app/(tabs)/receive/page.tsx`. Create `expo-wallet/app/(tabs)/receive.tsx`: show the embedded wallet address (via `useMobileSigner`), render a QR with `react-native-qrcode-svg`, and copy-to-clipboard via `expo-clipboard` (`Clipboard.setStringAsync(address)`) with a toast. Reuse `identicon`/`short` helpers unchanged.

- [ ] **Step 1: Port History**

Read `web-wallet/src/app/(tabs)/history/page.tsx`. Create `expo-wallet/app/(tabs)/history.tsx` with a RN `FlatList` for the transaction list (replaces the web mapped list), reusing `@/lib/api/navyClient` and identity helpers. Same empty/loading states via ported primitives.

- [ ] **Step 2: Port Farming**

Read `web-wallet/src/app/(tabs)/farming/page.tsx`. Create `expo-wallet/app/(tabs)/farming.tsx` reusing `@/lib/farming/farmingClient` unchanged and `useMobileSigner` for any signing. Rewrite layout in RN.

- [ ] **Step 3: Port Settings + account features**

Read `web-wallet/src/app/(tabs)/settings/page.tsx` and `@/lib/account/linkedAccounts.ts`. Create `expo-wallet/app/(tabs)/settings.tsx`. Map account hooks to `@privy-io/expo` equivalents (link/unlink/MFA/export). **For any hook not available in `@privy-io/expo`, gracefully hide that row rather than crash** (per spec open-item). Reuse `linkedAccounts.ts` (plain TS) unchanged for the display mapping. Wire `signOut` from `useNavySession`.

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add "app/(tabs)/receive.tsx" "app/(tabs)/history.tsx" "app/(tabs)/farming.tsx" "app/(tabs)/settings.tsx" package.json
git commit -m "feat(expo-wallet): receive, history, farming, settings screens"
```

---

## Task 14: Full test + typecheck gate

**Files:** none (verification)

- [ ] **Step 1: Run the lib test suite**

```bash
cd /home/khoa/Desktop/uni/expo-wallet && pnpm test
```
Expected: PASS — all ported lib tests green (proves logic preserved).

- [ ] **Step 2: Full typecheck**

```bash
pnpm exec tsc --noEmit
```
Expected: no errors across app/ + src/.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "chore(expo-wallet): green test + typecheck gate" || echo "nothing to commit"
```

---

## Task 15: Metro bundle smoke (catches RN resolution issues tsc misses)

**Files:** none (verification) — RN analog of web-wallet's "build is the runtime gate"

- [ ] **Step 1: Export a production bundle to force full module resolution**

```bash
cd /home/khoa/Desktop/uni/expo-wallet && pnpm dlx expo export --platform ios
```
Expected: bundle succeeds. If it fails on `Buffer`/`crypto`/`@solana/web3.js` resolution, confirm the `index.ts` polyfills (Task 0 Step 2) load before any Solana import, and add a Metro `resolver`/shim as needed. Fix, re-run.

- [ ] **Step 2: Commit any polyfill/metro fixes**

```bash
git add -A && git commit -m "fix(expo-wallet): RN bundle resolution/polyfills" || echo "nothing to commit"
```

---

## Task 16: Build the dev client + on-device verification

**Files:** none (device verification — the true runtime gate)

- [ ] **Step 1: Build the iOS dev client via EAS**

```bash
cd /home/khoa/Desktop/uni/expo-wallet
pnpm dlx eas-cli@latest build --profile development --platform ios
```
(User runs interactively — suggest `! eas build --profile development --platform ios`.) Install the resulting build on the iPhone via the EAS QR/link. Register the device with the Apple provisioning profile when EAS prompts.

- [ ] **Step 2: Configure the Privy dashboard for this app**

Add the app's bundle id / redirect scheme (`navywallet`) to the Privy dashboard allowed clients (analog of the web-origin whitelist). Fill the passkey RP ID / associated domain if using passkeys, and update `app.json` `associatedDomains` accordingly, then rebuild if changed.

- [ ] **Step 3: Start Metro and connect the device**

```bash
pnpm dlx expo start --dev-client
```
Open the dev client on the iPhone, connect to Metro (same LAN). Verify against this checklist:
  - [ ] App boots to Splash → login (no Buffer/crypto redbox).
  - [ ] Email OTP login completes; Navy session establishes; lands on Home.
  - [ ] Google/Apple OAuth completes (returns into the app via the scheme).
  - [ ] Passkey login completes (if dashboard-enabled).
  - [ ] Home shows the correct balance for the embedded wallet address.
  - [ ] Receive shows the address/QR; copy works (`expo-clipboard`).
  - [ ] Scan opens the camera, decodes a Navy pay QR, routes to Pay.
  - [ ] Pay shows the itemized breakdown; SlideToConfirm signs + submits; success shows.
  - [ ] History lists transactions.
  - [ ] Farming loads and (if applicable) a farm action signs.
  - [ ] Settings shows linked accounts + sign-out works.

- [ ] **Step 4: Log results + commit any fixes**

Record which checklist items passed and any device-only fixes. Commit fixes:
```bash
git add -A && git commit -m "fix(expo-wallet): on-device fixes from dev-client verification" || echo "clean"
```

---

## Task 17: Finalize the branch

- [ ] **Step 1: Invoke the finishing-a-development-branch skill** to decide merge/PR/cleanup for the `expo-wallet` work.

---

## Self-review notes

- **Spec coverage:** app shape (T0/T1) ✓; EAS dev-client (T1/T16) ✓; lib reuse verbatim (T2) ✓; token storage adapter (T4) ✓; env adapter (T3) ✓; Privy auth hooks (T7/T8) ✓; Privy Solana signing (T7) ✓; QR scan adapter (T11) ✓; deep-link pay (T12) ✓; clipboard/Receive (T13 Step 0) ✓; navigation map/all 7 screens — login(T8), home(T10), scan(T11), pay(T12), receive/history/farming/settings(T13) ✓; UI layer incl. theme verbatim (T5/T6) ✓; native modules & polyfills (T0/T1/T15) ✓; testing (T2/T14) + device gate (T15/T16) ✓; non-goals respected (no be/onchain/logic changes) ✓.
- **Type consistency:** signer contract `{ address, sign, ready }` identical in `useWebSigner`→`useMobileSigner`, consumed unchanged by home/pay/farming. `SecureBackend` method names match `expo-secure-store`. `readEnv` unchanged; only `getEnv` source swapped.
- **Placeholders:** the only intentional fill-ins are dashboard-derived secrets (Privy RP ID, EAS project id, `.env.local` values) — these are environment config, correctly deferred to the operator, not code placeholders.
```
