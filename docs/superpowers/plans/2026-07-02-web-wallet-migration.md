# Web Wallet Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Navy end-user wallet from Expo/React Native (`mobile/`) to a new, independent Next.js 16 web app `web-wallet/` that reads as a mobile app in the browser (centered phone-width column) and is fully functional: Privy web auth (incl. passkeys), live Solana balances, real gateway pay/farming flows, and browser-camera QR scan.

**Architecture:** New app dir `web-wallet/` (not a workspace — own `package.json`, run `pnpm` inside), following `fe/`'s Next.js 16 App Router conventions. Plain-TS logic modules port **verbatim** from `mobile/src` (they have no RN imports). Three platform shims are rewritten (env → `NEXT_PUBLIC_*`, tokenStore → `localStorage`, SessionContext → `@privy-io/react-auth`). The RN design system (`theme.ts` + `ui/*`) ports to the web by keeping `theme.ts` as JS token objects and converting each RN `StyleSheet.create` block into plain inline **style objects** (React DOM accepts the same camelCase shape), with a `globals.css` layer for tokens/keyframes/the phone frame. One CORS line is added to `be/src/main.ts`.

**Tech Stack:** Next.js 16, React 19, TypeScript, `@privy-io/react-auth` (+ `/solana`), `@solana/web3.js` 1.98.4, `@solana/spl-token`, `@zxing/library`, Jest + ts-jest.

---

## RN → Web conversion rules (shared reference — used by all UI/screen tasks)

When a task says "port `<file>` applying the conversion rules," apply these:

1. **Elements:** `View` → `div`; `Text`(RN) → our `Text` primitive (`span`); `Pressable`/`TouchableOpacity` → `button` (reset styles) or `div` with `onClick`; `ScrollView` → `div` with `overflow-y:auto`; `TextInput` → `input`; `SectionList`/`FlatList` → mapped `div`s.
2. **Styles:** `StyleSheet.create({...})` → a plain `const styles = {...}` object of `React.CSSProperties`. Apply with `style={styles.x}`; **merge arrays** `style={[a, b, c]}` → `style={{ ...a, ...b, ...(cond ? c : null) }}`.
3. **`onPress`** → `onClick`.
4. **lineHeight gotcha:** RN `lineHeight` is px; React DOM treats a *number* `lineHeight` as a unitless multiple. When porting `theme.type`, convert each `lineHeight`/`fontSize`/`letterSpacing` number to a px string in the primitive that consumes it (e.g. `lineHeight: `${v.lineHeight}px``). `fontWeight` stays a string.
5. **`fontVariant: ['tabular-nums']`** → `fontVariantNumeric: 'tabular-nums'`.
6. **Shadows:** RN `shadow*`/`elevation` → CSS `boxShadow: '0 12px 24px rgba(0,0,0,0.45)'` (translate `shadowOffset`/`shadowRadius`/`shadowColor`/`shadowOpacity`).
7. **Animations:** RN `Animated`/`Easing` → CSS. Splash pulse, scan laser, screen fade-in, tab lift, button press → CSS keyframes in `globals.css` or `transition` + a `:active`/state class. Do **not** add an animation library.
8. **Safe-area (`useSafeAreaInsets`)** → drop; the phone column uses fixed padding. `tabSafe` → `paddingBottom: 96`.
9. **`Alert.alert(title, msg)`** → `toast(msg)` / `toast(title + ': ' + msg)` from the Toast context (Task 8).
10. **`Clipboard.setStringAsync`** → `navigator.clipboard.writeText`.
11. **`expo-router` `useRouter().push/replace/back`** → `next/navigation` `useRouter().push/replace/back`; `useLocalSearchParams` → `useParams`; `<Redirect href>` → `redirect()` / `router.replace` in an effect.
12. **`'use client'`:** every component that uses hooks/state/effects/browser APIs gets `'use client'` at the top (all screens and all `ui/*` primitives with interactivity).
13. Preserve each component's **exported prop interface names and shapes** exactly (e.g. `ButtonProps`, `ScreenProps`, `IconName`) so screens compile unchanged.

---

## Task 1: Scaffold the `web-wallet/` app

**Files:**
- Create: `web-wallet/package.json`, `web-wallet/next.config.ts`, `web-wallet/tsconfig.json`, `web-wallet/jest.config.js`, `web-wallet/.gitignore`, `web-wallet/.env.local.example`, `web-wallet/next-env.d.ts` (generated), `web-wallet/src/app/layout.tsx` (placeholder), `web-wallet/src/app/globals.css` (placeholder), `web-wallet/src/app/page.tsx` (placeholder)

- [ ] **Step 1: Create `web-wallet/package.json`**

```json
{
  "name": "web-wallet",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "jest"
  },
  "dependencies": {
    "@privy-io/react-auth": "^2.0.0",
    "@solana/spl-token": "^0.4.14",
    "@solana/web3.js": "^1.98.4",
    "@zxing/library": "^0.21.3",
    "next": "16.2.9",
    "react": "19.2.4",
    "react-dom": "19.2.4"
  },
  "devDependencies": {
    "@types/jest": "^30.0.0",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.9",
    "jest": "^30.4.2",
    "ts-jest": "^29.4.11",
    "typescript": "^5"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "bufferutil",
      "utf-8-validate"
    ]
  }
}
```

- [ ] **Step 2: Create `web-wallet/next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 3: Create `web-wallet/tsconfig.json`** (copy of `fe/tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `web-wallet/jest.config.js`** (mirrors `fe/`, adds the uuid mapper the solana deps need)

```js
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }],
  },
  moduleNameMapper: { '^uuid$': require.resolve('uuid') },
  testMatch: ['<rootDir>/src/lib/**/*.test.ts'],
};
```

- [ ] **Step 5: Create `web-wallet/.gitignore`**

```
/node_modules
/.next
/out
next-env.d.ts
*.tsbuildinfo
.env*.local
```

- [ ] **Step 6: Create `web-wallet/.env.local.example`**

```
NEXT_PUBLIC_PRIVY_APP_ID=cmqx65j8s006w0cietx8rb9su
NEXT_PUBLIC_PRIVY_CLIENT_ID=client-WY6aV5oZSuds7zseYEFPcNgwMp3HJKHrcrgH5oyTr57y1
NEXT_PUBLIC_NAVY_API_URL=http://localhost:3000
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
NEXT_PUBLIC_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
```

- [ ] **Step 7: Create placeholder `web-wallet/src/app/globals.css`**

```css
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
```

- [ ] **Step 8: Create placeholder `web-wallet/src/app/layout.tsx`**

```tsx
import "./globals.css";

export const metadata = { title: "Navy Wallet", description: "Your wallet for the open ocean." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 9: Create placeholder `web-wallet/src/app/page.tsx`**

```tsx
export default function Page() {
  return <main>Navy Wallet — scaffolding</main>;
}
```

- [ ] **Step 10: Install and copy `.env.local`**

Run:
```bash
cd web-wallet && cp .env.local.example .env.local && CI=true pnpm install
```
Expected: install completes; `node_modules/` created.

- [ ] **Step 11: Verify the app builds**

Run: `cd web-wallet && pnpm build`
Expected: `next build` succeeds (compiles the placeholder page). Ignore the "no lint config" notice.

- [ ] **Step 12: Commit**

```bash
git add web-wallet/package.json web-wallet/next.config.ts web-wallet/tsconfig.json web-wallet/jest.config.js web-wallet/.gitignore web-wallet/.env.local.example web-wallet/src/app/
git commit -m "feat(web-wallet): scaffold Next.js app"
```

---

## Task 2: Port the plain-TS logic modules verbatim (with their tests)

These modules have **no React Native imports** and port byte-for-byte. Source → target:

| Source (`mobile/src/…`) | Target (`web-wallet/src/lib/…`) |
|---|---|
| `auth/types.ts` | `auth/types.ts` |
| `auth/session.ts` | `auth/session.ts` |
| `auth/session.test.ts` | `auth/session.test.ts` |
| `api/navyClient.ts` | `api/navyClient.ts` |
| `api/navyClient.test.ts` | `api/navyClient.test.ts` |
| `pay/navyPayClient.ts` | `pay/navyPayClient.ts` |
| `pay/navyPayClient.test.ts` | `pay/navyPayClient.test.ts` |
| `pay/payUrl.ts` | `pay/payUrl.ts` |
| `pay/payUrl.test.ts` | `pay/payUrl.test.ts` |
| `pay/payFlow.ts` | `pay/payFlow.ts` |
| `pay/payFlow.test.ts` | `pay/payFlow.test.ts` |
| `farming/farmingClient.ts` | `farming/farmingClient.ts` |
| `farming/farmingClient.test.ts` | `farming/farmingClient.test.ts` |
| `wallet/balances.ts` | `wallet/balances.ts` |
| `wallet/balances.test.ts` | `wallet/balances.test.ts` |

**Files:** Create all 15 target files above.

- [ ] **Step 1: Copy every file verbatim**

Run (from repo root):
```bash
cd /home/khoa/Desktop/uni
for d in auth api pay farming wallet; do mkdir -p web-wallet/src/lib/$d; done
cp mobile/src/auth/types.ts        web-wallet/src/lib/auth/types.ts
cp mobile/src/auth/session.ts      web-wallet/src/lib/auth/session.ts
cp mobile/src/auth/session.test.ts web-wallet/src/lib/auth/session.test.ts
cp mobile/src/api/navyClient.ts        web-wallet/src/lib/api/navyClient.ts
cp mobile/src/api/navyClient.test.ts   web-wallet/src/lib/api/navyClient.test.ts
cp mobile/src/pay/navyPayClient.ts       web-wallet/src/lib/pay/navyPayClient.ts
cp mobile/src/pay/navyPayClient.test.ts  web-wallet/src/lib/pay/navyPayClient.test.ts
cp mobile/src/pay/payUrl.ts       web-wallet/src/lib/pay/payUrl.ts
cp mobile/src/pay/payUrl.test.ts  web-wallet/src/lib/pay/payUrl.test.ts
cp mobile/src/pay/payFlow.ts       web-wallet/src/lib/pay/payFlow.ts
cp mobile/src/pay/payFlow.test.ts  web-wallet/src/lib/pay/payFlow.test.ts
cp mobile/src/farming/farmingClient.ts       web-wallet/src/lib/farming/farmingClient.ts
cp mobile/src/farming/farmingClient.test.ts  web-wallet/src/lib/farming/farmingClient.test.ts
cp mobile/src/wallet/balances.ts       web-wallet/src/lib/wallet/balances.ts
cp mobile/src/wallet/balances.test.ts  web-wallet/src/lib/wallet/balances.test.ts
```

- [ ] **Step 2: Run the ported tests**

Run: `cd web-wallet && pnpm test`
Expected: all suites PASS (session, navyClient, navyPayClient, payUrl, payFlow, farmingClient, balances). The `bigint-buffer` console.warn is harmless noise (per repo convention).

- [ ] **Step 3: Commit**

```bash
git add web-wallet/src/lib
git commit -m "feat(web-wallet): port plain-TS logic modules + tests verbatim"
```

---

## Task 3: Port the env shim to `NEXT_PUBLIC_*`

Keep the same `NavyEnv` shape and `readEnv()` validator (they're reused as-is); only `getEnv()`'s source changes. `NEXT_PUBLIC_*` vars are inlined by Next at build time, so reference them by full literal name (not dynamic indexing).

**Files:**
- Create: `web-wallet/src/lib/config/env.ts`, `web-wallet/src/lib/config/env.test.ts`

- [ ] **Step 1: Write the test** (copy the mobile test — it only exercises `readEnv`)

`web-wallet/src/lib/config/env.test.ts`:
```ts
import { readEnv } from './env';

describe('readEnv', () => {
  const base = { privyAppId: 'app', privyClientId: 'client', navyApiUrl: 'http://x:3000',
                 solanaRpc: 'https://api.devnet.solana.com', usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' };
  it('maps raw extra into a typed config', () => {
    expect(readEnv(base)).toEqual(base);
  });
  it('throws when a required value is missing', () => {
    expect(() => readEnv({ ...base, solanaRpc: '' })).toThrow(/solanaRpc/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web-wallet && pnpm test env.test`
Expected: FAIL — `Cannot find module './env'`.

- [ ] **Step 3: Write `web-wallet/src/lib/config/env.ts`**

```ts
export interface NavyEnv {
  privyAppId: string;
  privyClientId: string;
  navyApiUrl: string;
  solanaRpc: string;
  usdcMint: string;
}

type RawExtra = Partial<Record<keyof NavyEnv, string>>;

export function readEnv(extra: RawExtra): NavyEnv {
  const req = (k: keyof NavyEnv): string => {
    const v = extra[k];
    if (!v) throw new Error(`Missing required config: ${k}`);
    return v;
  };
  return {
    privyAppId: req('privyAppId'), privyClientId: req('privyClientId'), navyApiUrl: req('navyApiUrl'),
    solanaRpc: req('solanaRpc'), usdcMint: req('usdcMint'),
  };
}

// NEXT_PUBLIC_* are statically inlined by Next — must be referenced by literal name.
export function getEnv(): NavyEnv {
  return readEnv({
    privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    privyClientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
    navyApiUrl: process.env.NEXT_PUBLIC_NAVY_API_URL,
    solanaRpc: process.env.NEXT_PUBLIC_SOLANA_RPC,
    usdcMint: process.env.NEXT_PUBLIC_USDC_MINT,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web-wallet && pnpm test env.test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web-wallet/src/lib/config
git commit -m "feat(web-wallet): env shim reading NEXT_PUBLIC_* vars"
```

---

## Task 4: Port the token store to a `localStorage` backend

Keep the `TokenStore` class + `SecureBackend` interface identical (so `session.ts` is untouched); replace `expoSecureBackend()` with a `localStorage` backend that is SSR-safe (guards `typeof window`).

**Files:**
- Create: `web-wallet/src/lib/auth/tokenStore.ts`, `web-wallet/src/lib/auth/tokenStore.test.ts`

- [ ] **Step 1: Write the test**

`web-wallet/src/lib/auth/tokenStore.test.ts`:
```ts
import { TokenStore, SecureBackend } from './tokenStore';

function memBackend(): SecureBackend {
  const m = new Map<string, string>();
  return {
    getItemAsync: async (k) => m.get(k) ?? null,
    setItemAsync: async (k, v) => { m.set(k, v); },
    deleteItemAsync: async (k) => { m.delete(k); },
  };
}

describe('TokenStore', () => {
  it('saves and loads tokens', async () => {
    const s = new TokenStore(memBackend());
    await s.save({ accessToken: 'a', refreshToken: 'r' });
    expect(await s.load()).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });
  it('returns null when empty', async () => {
    expect(await new TokenStore(memBackend()).load()).toBeNull();
  });
  it('returns null on malformed json', async () => {
    const b = memBackend();
    await b.setItemAsync('navy.tokens', '{not json');
    expect(await new TokenStore(b).load()).toBeNull();
  });
  it('clears tokens', async () => {
    const s = new TokenStore(memBackend());
    await s.save({ accessToken: 'a', refreshToken: 'r' });
    await s.clear();
    expect(await s.load()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web-wallet && pnpm test tokenStore`
Expected: FAIL — `Cannot find module './tokenStore'`.

- [ ] **Step 3: Write `web-wallet/src/lib/auth/tokenStore.ts`**

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

// Browser localStorage backend. SSR-safe: no-ops when window is undefined.
export function localStorageBackend(): SecureBackend {
  const ls = (): Storage | null => (typeof window !== 'undefined' ? window.localStorage : null);
  return {
    getItemAsync: async (k) => ls()?.getItem(k) ?? null,
    setItemAsync: async (k, v) => { ls()?.setItem(k, v); },
    deleteItemAsync: async (k) => { ls()?.removeItem(k); },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web-wallet && pnpm test tokenStore`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web-wallet/src/lib/auth/tokenStore.ts web-wallet/src/lib/auth/tokenStore.test.ts
git commit -m "feat(web-wallet): localStorage-backed TokenStore"
```

---

## Task 5: Design tokens + `globals.css` chrome

Port `mobile/src/ui/theme.ts` **verbatim** (it's pure JS token objects — no RN import) to `web-wallet/src/ui/theme.ts`, then build the global CSS layer: CSS-variable mirror of the palette, the phone-frame backdrop, keyframes, scrollbar, and base resets.

**Files:**
- Create: `web-wallet/src/ui/theme.ts`
- Modify: `web-wallet/src/app/globals.css`

- [ ] **Step 1: Copy `theme.ts` verbatim**

Run: `cp mobile/src/ui/theme.ts web-wallet/src/ui/theme.ts`

- [ ] **Step 2: Replace `web-wallet/src/app/globals.css`**

```css
:root {
  --bg: #060B17;
  --bg-elevated: #0B1322;
  --surface: #111B2E;
  --text-hi: #F3F7FF;
  --text: #CBD6EC;
  --accent: #4F8CFF;
  --aqua: #2FE0C2;
  --frame-max: 430px;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }

body {
  background:
    radial-gradient(55% 40% at 12% 0%, rgba(79,140,255,0.20), transparent),
    radial-gradient(50% 35% at 95% 22%, rgba(47,224,194,0.14), transparent),
    var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  min-height: 100%;
}

/* Centered phone column */
.navy-frame {
  max-width: var(--frame-max);
  margin: 0 auto;
  min-height: 100vh;
  position: relative;
  background: var(--bg);
  overflow: hidden;
  box-shadow: 0 0 60px rgba(0,0,0,0.5);
}

button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
input { font: inherit; }

::-webkit-scrollbar { width: 0; height: 0; }

@keyframes navy-pulse {
  0%, 100% { transform: scale(1); opacity: 0.55; }
  50% { transform: scale(1.08); opacity: 1; }
}
@keyframes navy-rise {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes navy-laser {
  0% { transform: translateY(0); }
  50% { transform: translateY(var(--laser-travel, 260px)); }
  100% { transform: translateY(0); }
}
.navy-fade-in { animation: navy-rise 420ms ease both; }
```

- [ ] **Step 3: Verify typecheck**

Run: `cd web-wallet && pnpm exec tsc --noEmit`
Expected: no errors (theme.ts is pure JS objects).

- [ ] **Step 4: Commit**

```bash
git add web-wallet/src/ui/theme.ts web-wallet/src/app/globals.css
git commit -m "feat(web-wallet): design tokens + global CSS chrome (phone frame, keyframes)"
```

---

## Task 6: UI primitives — `Text`, `Icon`, `Gradient`, `Card`, `Bits`, `Toast`

Port the low-level primitives (no navigation deps). Apply the conversion rules. All are `'use client'`. Preserve the exported interfaces (`TextProps`, `IconName`, `IconProps`, `GradientProps`, `CardProps`, and the `Pill`/`IconBadge`/`Field`/`Divider`/`PressRow` signatures).

**Files:**
- Create: `web-wallet/src/ui/Text.tsx`, `web-wallet/src/ui/Icon.tsx`, `web-wallet/src/ui/Gradient.tsx`, `web-wallet/src/ui/Card.tsx`, `web-wallet/src/ui/Bits.tsx`, `web-wallet/src/ui/Toast.tsx`, `web-wallet/src/ui/index.ts`

- [ ] **Step 1: Port `Text.tsx`** — from `mobile/src/ui/Text.tsx`.

Render a `<span>`. Map `variant` → `theme.type[variant]`, converting `fontSize`/`lineHeight`/`letterSpacing` numbers to px strings and `fontVariant:['tabular-nums']` → `fontVariantNumeric:'tabular-nums'`. Keep props `variant/color/numeric/center/dim/muted/upper` + passthrough `style`, `children`. Default color logic identical (muted→textMute, dim→textDim, else text). `upper` → `textTransform:'uppercase'`. `numeric` → `fontVariantNumeric:'tabular-nums', letterSpacing:'-0.5px'`. Accept optional `title`/`onClick` passthrough via `...rest` typed as `React.HTMLAttributes<HTMLSpanElement>`.

- [ ] **Step 2: Port `Icon.tsx`** — from `mobile/src/ui/Icon.tsx`.

Copy the `IconName` union, `PATHS`, and `FILLED` maps **verbatim**. Render inline `<svg width={size} height={size} viewBox="0 0 24 24" fill="none">` with a `<g stroke=... strokeWidth=... strokeLinecap="round" strokeLinejoin="round" fill={filled?color:'none'}>` and map `PATHS[name]` to `<path d={d} />`. (This is a near-1:1 swap of `react-native-svg` for DOM SVG.)

- [ ] **Step 3: Port `Gradient.tsx`** — replace SVG gradient with CSS.

```tsx
'use client';
import React from 'react';

type Dir = 'diagonal' | 'vertical' | 'horizontal';
const ANGLE: Record<Dir, string> = { diagonal: '135deg', vertical: '180deg', horizontal: '90deg' };

export interface GradientProps {
  colors: readonly string[];
  locations?: readonly number[];
  direction?: Dir;
  glow?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export function Gradient({ colors, locations, direction = 'diagonal', glow, style, children }: GradientProps) {
  const stops = colors.map((c, i) => {
    const pct = locations ? locations[i] * 100 : (i / (colors.length - 1)) * 100;
    return `${c} ${pct}%`;
  }).join(', ');
  const base = `linear-gradient(${ANGLE[direction]}, ${stops})`;
  const glowLayer = 'radial-gradient(62% 62% at 82% 12%, rgba(255,255,255,0.35), rgba(255,255,255,0) 70%)';
  return (
    <div style={{ position: 'relative', overflow: 'hidden', background: glow ? `${glowLayer}, ${base}` : base, ...style }}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Port `Card.tsx`** — from `mobile/src/ui/Card.tsx`. A `<div>` with `background:surface`, `borderRadius:radius.xl (px)`, `1px solid border`, padding `compact?space.lg:space.xxl`, and `elevated` → `boxShadow` from `shadow.card`. Merge `style` prop last.

- [ ] **Step 5: Port `Bits.tsx`** — from `mobile/src/ui/Bits.tsx`. Port `Pill`, `IconBadge`, `Field`, `Divider`, `PressRow` with the same signatures. `PressRow` → a `<div>` with `onClick`, `display:flex`, and a CSS `:active`-style scale via `onMouseDown/Up` toggling a `transform`, OR simply `transition: transform 120ms` + `className` — keep it simple: `<div onClick style={{display:'flex',alignItems:'center', cursor:'pointer', ...style}}>`. Keep the `hexA()` helper verbatim.

- [ ] **Step 6: Create `Toast.tsx`** (replaces RN `Alert`).

```tsx
'use client';
import React, { createContext, useCallback, useContext, useState } from 'react';
import { colors, radius, space } from './theme';

const Ctx = createContext<(msg: string) => void>(() => {});
export function useToast() { return useContext(Ctx); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3200);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      {msg && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 110, transform: 'translateX(-50%)',
          maxWidth: 380, zIndex: 100, background: colors.surfaceHi, color: colors.textHi,
          border: `1px solid ${colors.borderStrong}`, borderRadius: radius.md,
          padding: `${space.md}px ${space.lg}px`, fontSize: 14, boxShadow: '0 12px 24px rgba(0,0,0,0.45)',
        }}>
          {msg}
        </div>
      )}
    </Ctx.Provider>
  );
}
```

- [ ] **Step 7: Create `web-wallet/src/ui/index.ts`**

```ts
export * from './theme';
export * from './Text';
export * from './Gradient';
export * from './Icon';
export * from './Card';
export * from './Bits';
export * from './Toast';
```

- [ ] **Step 8: Verify typecheck**

Run: `cd web-wallet && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add web-wallet/src/ui/Text.tsx web-wallet/src/ui/Icon.tsx web-wallet/src/ui/Gradient.tsx web-wallet/src/ui/Card.tsx web-wallet/src/ui/Bits.tsx web-wallet/src/ui/Toast.tsx web-wallet/src/ui/index.ts
git commit -m "feat(web-wallet): UI primitives (Text, Icon, Gradient, Card, Bits, Toast)"
```

---

## Task 7: `Button` and `Screen` primitives

**Files:**
- Create: `web-wallet/src/ui/Button.tsx`, `web-wallet/src/ui/Screen.tsx`
- Modify: `web-wallet/src/ui/index.ts`

- [ ] **Step 1: Port `Button.tsx`** — from `mobile/src/ui/Button.tsx`.

Preserve `ButtonProps` (`label/onPress/variant/icon/loading/disabled/full/style`). Render a `<button disabled={disabled||loading} onClick={onPress}>`. Primary variant wraps `Inner` in `<Gradient colors={gradients.ocean}>` with `boxShadow` from `shadow.accentGlow` when enabled; secondary/ghost/danger use flat surfaces (see mobile styles `secondary`/`ghost`/`dangerBg`). `Inner` = a flex row with the `Icon` (size 18) + `Text variant="bodyStrong"`; when `loading`, show a CSS spinner `<span>` instead (a 16px bordered circle with `animation: spin 0.7s linear infinite` — add the `@keyframes spin` to globals.css if not present). Press-scale → `:active { transform: scale(0.96) }` via inline `onMouseDown/onMouseUp` state or a small style class. `full` → `alignSelf:'stretch', width:'100%'`. Fill height 54, `borderRadius:radius.pill`.

- [ ] **Step 2: Add `@keyframes spin` to `globals.css`**

Append:
```css
@keyframes spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 3: Port `Screen.tsx`** — from `mobile/src/ui/Screen.tsx`.

Preserve `ScreenProps` (`children/scroll/tabSafe/padded/contentStyle/onRefresh/refreshing`). Drop the SVG `Aurora` (the body backdrop in globals.css provides it). Render a scroll container `<div style={{overflowY:'auto', height:'100%'}}>` (when `scroll`) or a plain `<div>`, with padding: `paddingTop: space.sm+? (use space.lg)`, `paddingBottom: tabSafe?96:space.lg`, `paddingLeft/Right: padded?space.xl:0`. Inner content wrapped in a `<div className="navy-fade-in">`. For `onRefresh`: render a small refresh affordance — a top-centered pill button "Pull to refresh" is not web-idiomatic; instead expose `onRefresh` as an optional **refresh icon button** in the top-right of the content area only if provided, OR simply ignore visual refresh control and let screens keep their own refresh buttons. Keep it minimal: if `onRefresh` provided, render a small `Icon name="down"` button at top-right that calls `onRefresh` (screens that pass it get a manual refresh). Merge `contentStyle` last.

- [ ] **Step 4: Update `web-wallet/src/ui/index.ts`** — add `export * from './Button';` and `export * from './Screen';`.

- [ ] **Step 5: Verify typecheck**

Run: `cd web-wallet && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web-wallet/src/ui/Button.tsx web-wallet/src/ui/Screen.tsx web-wallet/src/ui/index.ts web-wallet/src/app/globals.css
git commit -m "feat(web-wallet): Button + Screen primitives"
```

---

## Task 8: Privy provider, SessionContext, web signer

Wire `@privy-io/react-auth`, port `SessionContext` to it, and provide a `useWebSigner` hook that adapts Privy web signing to the `payFlow`/farming `(tx) => Promise<Transaction>` adapter.

**Files:**
- Create: `web-wallet/src/lib/auth/SessionContext.tsx`, `web-wallet/src/lib/wallet/useWebSigner.ts`, `web-wallet/src/app/Providers.tsx`
- Modify: `web-wallet/src/app/layout.tsx`

> **SDK drift warning:** `@privy-io/react-auth` v2 hook/config names may differ from this plan. Before coding, check the installed types under `web-wallet/node_modules/@privy-io/react-auth/dist/` for the exact exports: `PrivyProvider` config for embedded Solana wallets, `usePrivy` (`ready`, `authenticated`, `getAccessToken`, `logout`, `user`), the login hooks (`useLoginWithEmail`, `useLoginWithSms`, `useLoginWithOAuth`, `useLoginWithPasskey`), and the Solana wallet/sign hooks (from `@privy-io/react-auth/solana`: `useSolanaWallets` / `useSignTransaction`). Adjust names to match the installed version; the shapes below are the intent.

- [ ] **Step 1: Create `web-wallet/src/app/Providers.tsx`**

```tsx
'use client';
import React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { getEnv } from '@/lib/config/env';
import { SessionProvider } from '@/lib/auth/SessionContext';
import { ToastProvider } from '@/ui/Toast';

export function Providers({ children }: { children: React.ReactNode }) {
  const env = getEnv();
  return (
    <PrivyProvider
      appId={env.privyAppId}
      clientId={env.privyClientId}
      config={{
        embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' } },
        // Verify exact config keys against installed @privy-io/react-auth types.
      }}
    >
      <SessionProvider>
        <ToastProvider>{children}</ToastProvider>
      </SessionProvider>
    </PrivyProvider>
  );
}
```

- [ ] **Step 2: Port `SessionContext.tsx`** — from `mobile/src/auth/SessionContext.tsx`.

Same context value (`session`, `initializing`, `establishFromPrivy`, `signOut`) and same `useNavySession()` guard. Changes: `'use client'`; import `usePrivy` from `@privy-io/react-auth`; build the manager with `new SessionManager(new NavyClient(env.navyApiUrl), new TokenStore(localStorageBackend()))`; map Privy's readiness/user fields to the same effect logic (restore on mount; clear session if Privy becomes logged-out). `establishFromPrivy` calls `getAccessToken()` then `manager.establish(token)`.

- [ ] **Step 3: Create `web-wallet/src/lib/wallet/useWebSigner.ts`**

```tsx
'use client';
import { Transaction } from '@solana/web3.js';
import { useSignTransaction, useSolanaWallets } from '@privy-io/react-auth/solana';

/**
 * Adapts Privy web Solana signing to the payFlow/farming signer shape.
 * Verify hook names/return shapes against the installed @privy-io/react-auth/solana types.
 */
export function useWebSigner() {
  const { wallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const address = wallets?.[0]?.address as string | undefined;

  const sign = async (tx: Transaction): Promise<Transaction> => {
    const wallet = wallets[0];
    const signed = await signTransaction({ transaction: tx, connection: undefined as never, address: wallet.address });
    return signed instanceof Transaction ? signed : Transaction.from((signed as { signedTransaction: Uint8Array }).signedTransaction);
  };

  return { address, sign, wallets };
}
```

> Adjust `signTransaction`'s argument/return to the installed API. The contract this hook must satisfy: input a `Transaction`, output a signed `Transaction` (matching `payFlow`'s `signTransaction: (tx) => Promise<Transaction>`).

- [ ] **Step 4: Update `web-wallet/src/app/layout.tsx`** to wrap children in `<Providers>` inside the phone frame:

```tsx
import "./globals.css";
import { Providers } from "./Providers";

export const metadata = { title: "Navy Wallet", description: "Your wallet for the open ocean." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="navy-frame">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Verify typecheck**

Run: `cd web-wallet && pnpm exec tsc --noEmit`
Expected: no errors. If Privy type names differ, fix per the installed types, then re-run until clean.

- [ ] **Step 6: Commit**

```bash
git add web-wallet/src/app/Providers.tsx web-wallet/src/app/layout.tsx web-wallet/src/lib/auth/SessionContext.tsx web-wallet/src/lib/wallet/useWebSigner.ts
git commit -m "feat(web-wallet): Privy provider, SessionContext, web signer"
```

---

## Task 9: Splash route (`/`) + login route (`/login`)

**Files:**
- Create: `web-wallet/src/app/page.tsx` (replace placeholder), `web-wallet/src/app/login/page.tsx`

- [ ] **Step 1: Port the splash `page.tsx`** — from `mobile/app/index.tsx`.

`'use client'`. Use `usePrivy().ready` + `useNavySession().{session, initializing}`. While `!ready || initializing`, render the pulsing ocean-gradient logo (Gradient + `Icon name="wallet"`) using CSS `animation: navy-pulse 1.8s ease-in-out infinite`. Once ready, `useRouter().replace(session ? '/home' : '/login')` inside a `useEffect`.

- [ ] **Step 2: Port the login screen** — from `mobile/app/login.tsx`, applying conversion rules.

Map hooks to `@privy-io/react-auth`: `useLoginWithOAuth` (Google/Apple), `useLoginWithEmail` (`sendCode`/`loginWithCode`), `useLoginWithSms`, and **`useLoginWithPasskey`** (`loginWithPasskey`). Add a **passkey button** at the top of the social section: `Button label="Continue with passkey" icon="shield"` → `loginWithPasskey()` then `finish()`. `TextInput` → `<input>` with the same styling (surface bg, border, radius). `KeyboardAvoidingView` → plain `<div>`. `finish()` = `await establishFromPrivy(); router.replace('/home')`. Errors → `useToast()`. Keep the brand mark, email/phone segment switch, and code-entry UI.

- [ ] **Step 3: Verify build**

Run: `cd web-wallet && pnpm exec tsc --noEmit && pnpm build`
Expected: compiles. (Privy calls won't run at build time.)

- [ ] **Step 4: Commit**

```bash
git add web-wallet/src/app/page.tsx web-wallet/src/app/login
git commit -m "feat(web-wallet): splash + login (passkey/oauth/email/sms)"
```

---

## Task 10: Tab layout + bottom tab bar

**Files:**
- Create: `web-wallet/src/app/(tabs)/layout.tsx`, `web-wallet/src/ui/TabBar.tsx`

- [ ] **Step 1: Create `web-wallet/src/ui/TabBar.tsx`** — port from `mobile/app/(tabs)/_layout.tsx`'s `NavyTabBar`.

`'use client'`. Fixed within the phone frame: `position:'absolute', left:0, right:0, bottom:0`, centered pill bar. Tabs: `[{href:'/home',label:'Wallet',icon:'home'},{href:'/scan',label:'Scan',icon:'scan'},{href:'/farming',label:'Earn',icon:'sprout'},{href:'/history',label:'Activity',icon:'clock'}]`. Use `usePathname()` from `next/navigation` to compute `focused`. Each item: `Icon` (aqua when focused, textMute otherwise) in a rounded chip (active chip bg `rgba(47,224,194,0.12)`) + `Text variant="label"`. Navigate with `useRouter().push(href)` or `next/link` `<Link>`. Bar styling from mobile `styles.bar` (surface `rgba(17,27,46,0.96)`, pill radius, border, card shadow).

- [ ] **Step 2: Create `web-wallet/src/app/(tabs)/layout.tsx`**

```tsx
import { TabBar } from '@/ui/TabBar';

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <TabBar />
    </>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd web-wallet && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "web-wallet/src/app/(tabs)/layout.tsx" web-wallet/src/ui/TabBar.tsx
git commit -m "feat(web-wallet): tab layout + bottom tab bar"
```

---

## Task 11: Home screen (`/home`)

**Files:**
- Create: `web-wallet/src/app/(tabs)/home/page.tsx`

- [ ] **Step 1: Port `home.tsx`** — from `mobile/app/(tabs)/home.tsx`, applying conversion rules.

`'use client'`. Replace `useEmbeddedSolanaWallet` with `useWebSigner()` (`address`). Keep the `load()` logic: `fetchBalances` via `new Connection(env.solanaRpc)` and `NavyPayClient.getUserPayments(token)`. `copy` → `navigator.clipboard.writeText(address)` + `toast('Wallet address copied')`. Sign-out `Pressable` → button calling `signOut()` (use a `window.confirm` or just call directly + toast). Quick actions navigate with `next` router (`/scan`, `/farming`) and Receive → `copy`. Preserve the balance hero (Gradient ocean), SOL chip, address chip, quick-action cards, and recent-activity Card exactly.

- [ ] **Step 2: Verify build**

Run: `cd web-wallet && pnpm exec tsc --noEmit && pnpm build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add "web-wallet/src/app/(tabs)/home"
git commit -m "feat(web-wallet): home/wallet screen"
```

---

## Task 12: Scan screen (`/scan`) — camera QR + manual fallback

**Files:**
- Create: `web-wallet/src/app/(tabs)/scan/page.tsx`, `web-wallet/src/lib/pay/useQrScanner.ts`

- [ ] **Step 1: Create `web-wallet/src/lib/pay/useQrScanner.ts`** — `@zxing/library` browser decoder.

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/library';

/** Streams the default camera into `videoRef` and calls onResult on the first decode. */
export function useQrScanner(videoRef: React.RefObject<HTMLVideoElement | null>, onResult: (text: string) => void) {
  const [error, setError] = useState<string>('');
  const doneRef = useRef(false);
  useEffect(() => {
    const reader = new BrowserQRCodeReader();
    let controls: { stop: () => void } | undefined;
    (async () => {
      try {
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
          if (result && !doneRef.current) { doneRef.current = true; onResult(result.getText()); }
        });
      } catch (e) {
        setError((e as Error).message || 'Camera unavailable');
      }
    })();
    return () => { controls?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { error };
}
```

> Verify `decodeFromVideoDevice`'s signature/return against the installed `@zxing/library` version; the contract: start the camera into the `<video>` and invoke `onResult(text)` once on decode. Adjust if the installed API returns `IScannerControls` differently.

- [ ] **Step 2: Port the scan screen** — from `mobile/app/(tabs)/scan.tsx`.

`'use client'`. Render a full-frame `<video ref autoPlay muted playsInline style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'}}>`. Use `useQrScanner(videoRef, (data) => { try { router.push('/pay/' + parsePayUrl(data)); } catch(e){ setError(...) } })`. Keep the scrim overlay: header ("Scan to pay"), the corner-bracket frame (port the `Corner` component to `div`s with border), and the animated laser (`div` with `animation: navy-laser 3.6s ease-in-out infinite`; set `--laser-travel` to the frame height). Footer hint pill ("Gasless — Navy covers the network fee") or error pill. **Manual fallback:** below the footer, add an `<input>` + Button "Open invoice link" that runs `parsePayUrl` on the pasted value and navigates (for desktops without a camera / denied permission). On camera error, show the manual entry prominently.

- [ ] **Step 3: Verify build**

Run: `cd web-wallet && pnpm exec tsc --noEmit && pnpm build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add "web-wallet/src/app/(tabs)/scan" web-wallet/src/lib/pay/useQrScanner.ts
git commit -m "feat(web-wallet): scan screen (zxing camera QR + manual fallback)"
```

---

## Task 13: Pay screen (`/pay/[orderId]`)

**Files:**
- Create: `web-wallet/src/app/pay/[orderId]/page.tsx`

- [ ] **Step 1: Port `pay/[orderId].tsx`** — from `mobile/app/pay/[orderId].tsx`, applying conversion rules.

`'use client'`. `useParams<{orderId:string}>()` for the id. Replace the Privy Expo signing block with `useWebSigner()`: `const { address, sign } = useWebSigner();` and call `payInvoice({ orderId, payer: address, client, signTransaction: sign })`. `Alert` → `useToast()`. On success, `router.replace('/home')`. Keep the amount focal Gradient card, meta Card (reference + status Pill), gasless chip, and the payable/unavailable states. Close button → `router.back()` with a `/home` fallback. This route renders **without** the tab bar (it's under `app/pay/`, not `app/(tabs)/`) — give it a slide-up feel via the `.navy-fade-in` class.

- [ ] **Step 2: Verify build**

Run: `cd web-wallet && pnpm exec tsc --noEmit && pnpm build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add "web-wallet/src/app/pay"
git commit -m "feat(web-wallet): pay-confirm screen"
```

---

## Task 14: Farming screen (`/farming`)

**Files:**
- Create: `web-wallet/src/app/(tabs)/farming/page.tsx`

- [ ] **Step 1: Port `farming.tsx`** — from `mobile/app/(tabs)/farming.tsx`, applying conversion rules.

`'use client'`. Replace `useEmbeddedSolanaWallet` with `useWebSigner()`. The `fund` flow: build the `SystemProgram.transfer` tx exactly as mobile, set `feePayer`/`recentBlockhash`, then sign it via the web signer and `connection.sendRawTransaction(signed.serialize())` — adapt from mobile's `provider.signTransaction` to `sign(tx)` returning a `Transaction` (then `.serialize()`). `createSubwallet`/`withdraw` via `FarmingClient` unchanged. `Alert` → `useToast()`; `Clipboard` → `navigator.clipboard`. Preserve the empty-state Card, the value hero (Gradient aquaGlow), details Card, Fund/Withdraw buttons, and the Devnet note.

- [ ] **Step 2: Verify build**

Run: `cd web-wallet && pnpm exec tsc --noEmit && pnpm build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add "web-wallet/src/app/(tabs)/farming"
git commit -m "feat(web-wallet): farming/earn screen"
```

---

## Task 15: History screen (`/history`)

**Files:**
- Create: `web-wallet/src/app/(tabs)/history/page.tsx`

- [ ] **Step 1: Port `history.tsx`** — from `mobile/app/(tabs)/history.tsx`, applying conversion rules.

`'use client'`. Copy `dayLabel`/`timeLabel`/`groupByDay` verbatim. Replace `SectionList` with mapped `div`s: iterate `groupByDay(payments)`, render a section-header `Text variant="label" upper muted` then each payment row (IconBadge + merchant/reference + time/status + amount). Refresh → a manual refresh button (Screen's `onRefresh`) or a button in the header. Keep the empty state. Root is a scrollable padded column with `paddingBottom:110` for the tab bar.

- [ ] **Step 2: Verify build**

Run: `cd web-wallet && pnpm exec tsc --noEmit && pnpm build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add "web-wallet/src/app/(tabs)/history"
git commit -m "feat(web-wallet): history/activity screen"
```

---

## Task 16: Backend CORS for the web origin

Browser calls to `be/` are cross-origin (the mobile app was not). Add an env-driven `enableCors`.

**Files:**
- Modify: `be/src/main.ts`
- Modify: `be/.env.example`

- [ ] **Step 1: Read `be/src/main.ts`** to find the `NestFactory.create(...)` block and where the app is configured before `app.listen(...)`.

- [ ] **Step 2: Add CORS** right after the app is created:

```ts
app.enableCors({
  origin: (process.env.WEB_WALLET_ORIGIN ?? 'http://localhost:3001').split(','),
  credentials: false,
});
```

(The web-wallet dev server runs on a different port than `be:3000` — e.g. `next dev -p 3001`. Document that the two Navy JS apps and the wallet each get their own port.)

- [ ] **Step 3: Add to `be/.env.example`**

```
# Comma-separated origins allowed to call the API from a browser (web-wallet).
WEB_WALLET_ORIGIN=http://localhost:3001
```

- [ ] **Step 4: Verify the backend still builds**

Run: `cd be && pnpm build`
Expected: `nest build` succeeds.

- [ ] **Step 5: Commit**

```bash
git add be/src/main.ts be/.env.example
git commit -m "feat(be): enable CORS for the web-wallet origin"
```

---

## Task 17: Final verification & docs

**Files:**
- Create: `web-wallet/README.md`
- Modify: `CLAUDE.md` (root — register the 5th app)

- [ ] **Step 1: Run the full web-wallet gate**

Run: `cd web-wallet && pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: tests PASS, typecheck clean, `next build` succeeds with routes `/`, `/login`, `/home`, `/scan`, `/farming`, `/history`, `/pay/[orderId]`.

- [ ] **Step 2: Manual devnet smoke (record results)**

Start `be` (`cd be && pnpm start`, port 3000) and `cd web-wallet && pnpm dev -p 3001`. In a browser at `http://localhost:3001`:
- Login via passkey (and one of email/SMS/Google).
- Home shows SOL + USDC balances and address copy works.
- Scan: camera permission prompt; the manual invoice-link fallback navigates to `/pay/[id]`.
- Pay a test invoice → success toast, redirect to home.
- Farming: create subwallet → fund 0.1 SOL (signs) → withdraw.
- History lists the payment.

Note any failures and fix before proceeding.

- [ ] **Step 3: Write `web-wallet/README.md`** — a short doc: what it is (web port of the mobile wallet), `pnpm install`, `.env.local` keys, `pnpm dev -p 3001`, that `be` must run with `WEB_WALLET_ORIGIN` set, and the "verify by `pnpm build`" note (web analogue of the mobile bundling gotcha — catches Buffer/polyfill issues `tsc` misses).

- [ ] **Step 4: Register the app in root `CLAUDE.md`** — add a `web-wallet/` row to the apps table ("Next.js 16 web port of the mobile wallet — end-user wallet on the web via `@privy-io/react-auth`") and a one-line command note (`pnpm dev -p 3001`).

- [ ] **Step 5: Commit**

```bash
git add web-wallet/README.md CLAUDE.md
git commit -m "docs(web-wallet): README + register 5th app in root CLAUDE.md"
```

---

## Self-review notes

- **Spec coverage:** app shape (T1), portable logic (T2), env shim (T3), tokenStore (T4), design tokens (T5), UI primitives (T6–T7), Privy+session+signer (T8), splash/login incl. passkey (T9), tab layout (T10), all 6 screens (T11–T15), CORS (T16), testing/verify/docs (T17). All spec sections mapped.
- **Buffer/polyfill:** the mobile app needs a manual `Buffer` global; Next/webpack provides one for `@solana/web3.js` in the browser bundle. If `pnpm build` or runtime surfaces a `Buffer`/`crypto` resolution error, add a polyfill (e.g. a client `useEffect` `globalThis.Buffer ??= Buffer` or a webpack fallback in `next.config.ts`) — flagged here so the executing agent expects it.
- **Types consistency:** ported interfaces (`ButtonProps`, `ScreenProps`, `IconName`, `GradientProps`, `Position`, `Payment`, `NavyTokens`) keep mobile names so screens compile. The signer contract (`(tx: Transaction) => Promise<Transaction>`) matches `payFlow`/farming call sites.
- **SDK drift:** Privy react-auth v2 and `@zxing/library` APIs are verified against installed `node_modules` types at execution time (flagged in T8, T9, T12) rather than trusted from memory, per repo convention.
</content>
