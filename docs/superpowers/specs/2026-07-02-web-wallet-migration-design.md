# Web Wallet Migration — Design

**Date:** 2026-07-02
**Status:** Approved (design)
**Supersedes/relates:** `2026-06-16-navy-mobile-wallet-design.md` (this is a web port of that app)

## Goal

Migrate the Navy **end-user wallet** from Expo/React Native (`mobile/`) to a
Next.js web app that runs in the browser, **preserving the mobile-first design**.
The result is a new, independent app `web-wallet/` that reads as a mobile app on
the web (centered phone-width column) and is a **full functional port**: real
Privy web auth, live Solana balances, real gateway API + pay/farming flows, and
browser-camera QR scanning.

Non-goals (YAGNI): push notifications, offline storage, PWA/installability,
desktop-responsive redesign, any change to the `be/` gateway logic beyond CORS.

## App shape & stack

A **5th independent app**, `web-wallet/`, following the repo's "four independent
apps" convention (its own `package.json`; run `pnpm` inside the dir — NOT a
workspace). It mirrors `fe/`'s conventions:

- **Next.js 16 (App Router) + React 19**, TypeScript.
- **CSS Modules + a `globals.css` design-token layer** for styling (no Tailwind —
  consistent with `fe/`).
- **Jest + ts-jest** for `src/lib/**/*.test.ts` (pure logic only, as in `fe/`).
- Gates: `pnpm exec tsc --noEmit` for pages/components, `pnpm build` (`next build`).
- `pnpm.onlyBuiltDependencies` configured for any native deps (per repo rule).

Env via `NEXT_PUBLIC_*`: `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_CLIENT_ID`,
`NEXT_PUBLIC_NAVY_API_URL`, `NEXT_PUBLIC_SOLANA_RPC`, `NEXT_PUBLIC_USDC_MINT`.

## Reused (portable) logic

These modules are plain TS with no React Native imports and port **verbatim**
into `web-wallet/src/lib/`, keeping their subdirectory names and their `.test.ts`
files (the tests run unchanged under ts-jest):

- `pay/navyPayClient.ts`, `pay/payUrl.ts`, `pay/payFlow.ts`
- `farming/farmingClient.ts`
- `wallet/balances.ts`
- `api/navyClient.ts`
- `auth/session.ts`, `auth/types.ts`

`@solana/web3.js` and `@solana/spl-token` work in the browser (Next bundles a
`Buffer` polyfill; verify during build — this is the web analogue of the mobile
Buffer gotcha).

## Rewritten platform shims (thin)

- **`config/env.ts`** — read `process.env.NEXT_PUBLIC_*` instead of
  `expo-constants`. Same `NavyEnv` shape and `readEnv()` validator (reused);
  only `getEnv()` changes its source.
- **`auth/tokenStore.ts`** — a `localStorage`-backed `TokenStore` backend
  replacing `expoSecureBackend()`. Same `TokenStore` interface so `session.ts`
  is untouched. (localStorage is acceptable for a devnet wallet; documented as a
  mainnet hardening item.)
- **`auth/SessionContext.tsx`** — same context/API (`session`, `initializing`,
  `establishFromPrivy`, `signOut`) but backed by `@privy-io/react-auth`'s
  `usePrivy` (`isReady`, `getAccessToken`, `logout`, `user`) instead of
  `@privy-io/expo`.

## Design system port (`src/ui/`)

Port `mobile/src/ui/theme.ts` → **CSS custom properties** in `globals.css`
(same deep-ocean palette, 4-pt spacing scale, radii, type scale, glow shadows).
React Native primitives become DOM components with CSS Modules, keeping the same
prop-driven API where practical:

- `Screen` — scrollable padded column with optional pull-to-refresh affordance
  (web: a manual refresh button/gesture; RN `RefreshControl` has no direct web
  equivalent, so refresh becomes an explicit control).
- `Text` — variant/color/muted/upper/numeric props → styled `<span>/<p>`.
- `Button` — variants (primary/secondary/ghost), loading, icon, disabled.
- `Card` — surface panel (compact/elevated).
- `Gradient` — CSS `linear-gradient` wrapper (replaces `react-native-svg` LinearGradient).
- `Icon` — port the existing SVG icon set to inline `<svg>` (near 1:1 from
  `react-native-svg`); `IconName` union preserved.
- `Bits` — `IconBadge`, `Pill`, `Divider`, `PressRow`.
- **Toast/inline banner** — replaces RN `Alert.alert` for success/error feedback.

Motion (splash pulse, scan laser, tab lift) → CSS keyframe animations /
transitions.

## Layout & routing

Root `layout.tsx` wraps the tree in `PrivyProvider` + `SessionProvider` and
renders a **centered phone column** (~430px max-width) on a dark ambient
backdrop, so the app reads as mobile in the browser. A fixed custom **bottom tab
bar** (Wallet / Scan / Earn / Activity) lives within the column.

| Route | Screen | Notes |
|---|---|---|
| `/` | Splash → redirect | `session ? /home : /login`; pulsing logo while Privy/`initializing` |
| `/login` | Auth | passkey (FaceID/TouchID), Google, Apple, email code, SMS code |
| `/home` | Wallet | USDC hero, SOL chip, address copy, quick actions, recent activity |
| `/scan` | Scan-to-pay | camera QR + manual paste fallback |
| `/farming` | Earn | create/fund/withdraw subwallet, value hero |
| `/history` | Activity | payments grouped by day |
| `/pay/[orderId]` | Pay confirm | slide-up modal styling; amount focal card |

The four tab routes share a route-group layout that renders the tab bar;
`/login`, `/`, and `/pay/[orderId]` render without it.

## Auth (Privy web)

`@privy-io/react-auth` with an embedded Solana wallet
(`config.embeddedWallets` / `solana` create-on-login), the direct equivalent of
`@privy-io/expo`. Login screen maps hooks:

- **Passkey** — `useLoginWithPasskey` (`loginWithPasskey` / `signupWithPasskey`);
  WebAuthn surfaces FaceID/TouchID/platform authenticators. Primary option.
- **OAuth** — `useLoginWithOAuth` → Google, Apple.
- **Email** — `useLoginWithEmail` (`sendCode` / `loginWithCode`).
- **SMS** — `useLoginWithSms` (`sendCode` / `loginWithCode`).

After any Privy login, `establishFromPrivy()` exchanges the Privy token at
`/auth/privy` for the Navy JWT (unchanged flow) and stores it via the
localStorage `TokenStore`.

## Web-specific challenges

**Camera QR scan.** Use `getUserMedia` + `@zxing/library` (browser
`BrowserQRCodeReader`) to decode frames from a `<video>` element (works on
`localhost` and https). Preserve the animated corner-bracket frame + laser UI.
On decode → `parsePayUrl(data)` → `router.push(/pay/[id])`. Provide a **manual
"paste invoice link"** fallback for cameraless desktops and a graceful
permission-denied state.

**Transaction signing.** Privy web's `useSignTransaction`
(`@privy-io/react-auth/solana`) replaces the Expo
`provider.signTransaction({ transaction })`. A thin web signer wrapper adapts it
to the existing `payFlow`/farming `signTransaction: (tx) => Promise<...>`
adapters. The gasless two-signer relayer flow and the `be/` gateway are
unchanged — the wallet still only adds the user signature to the server-built tx.

## Backend touch point

Browser (cross-origin) calls to `be/` require CORS, which the mobile app did not.
Add `app.enableCors({ origin: <web-wallet dev origin>, credentials: false })` in
`be/src/main.ts` (env-driven allowed origin). No other backend change; the JWT is
sent as a `Bearer` header exactly as mobile does.

## Data flow (unchanged from mobile)

- **Balances:** `new Connection(NEXT_PUBLIC_SOLANA_RPC)` +
  `fetchBalances()` (ported) — client-side, in the browser.
- **Payments/orders:** `NavyPayClient` → `be/` gateway; `getUserPayments` sends
  the Navy JWT.
- **Pay:** `getPaymentTx` → Privy sign → `submitSignedTx` (server relays/pays gas).
- **Farming:** `FarmingClient` create/position/withdraw; fund signs a
  `SystemProgram.transfer` from the main wallet via Privy.

## Error handling

RN `Alert.alert` → a small toast/inline-banner system. Network/API failures
surface as inline error pills (as the mobile screens already do for balances and
invoice-not-found). Camera permission denied → dedicated empty state with a
manual-entry path.

## Testing & verification

- Port `lib` unit tests (pay/farming/wallet/api/session/env) — run under ts-jest.
- `pnpm exec tsc --noEmit` gate for pages/components.
- `pnpm build` (`next build`) — the web analogue of "verify by bundling";
  catches Buffer/polyfill and module-resolution issues that `tsc` misses.
- Manual devnet smoke: login (each method) → balances → scan → pay → farm
  create/fund/withdraw → history.

## Open decisions (resolved)

- **Location:** new independent app `web-wallet/`.
- **Fidelity:** full functional port.
- **Layout:** centered phone-width column (not desktop-responsive).
- **Auth:** `@privy-io/react-auth`, including passkeys (FaceID/TouchID).
- **Styling:** CSS Modules + `globals.css` tokens (no Tailwind).
- **CORS:** add an `enableCors` line to `be/src/main.ts`.
