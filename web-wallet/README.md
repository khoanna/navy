# web-wallet

Mobile-first **web** port of the Navy end-user wallet (originally `mobile/`, Expo/React Native).
Same product — balances, scan-to-pay, farming, history — rendered as a phone-width column in the
browser. Built with Next.js 16 (App Router) + React 19 and `@privy-io/react-auth` embedded Solana
wallets. See the design/plan in `docs/superpowers/specs/2026-07-02-web-wallet-migration-design.md`
and `docs/superpowers/plans/2026-07-02-web-wallet-migration.md`.

## Layout

- `src/lib/**` — plain-TS logic **ported verbatim** from `mobile/src` (no framework imports, unit-tested):
  `api/`, `auth/` (session, types, localStorage `tokenStore`, `SessionContext`), `pay/`, `farming/`,
  `wallet/` (balances + `useWebSigner`), `config/env`. Keep non-UI logic here so it stays testable.
- `src/ui/**` — design system ported from `mobile/src/ui` (RN `StyleSheet` → inline `CSSProperties`
  objects; `theme.ts` is byte-identical). `Text/Button/Card/Gradient/Icon/Bits/Screen/Toast/TabBar`.
- `src/app/**` — routes: `/` (splash), `/login`, `(tabs)/{home,scan,farming,history}`, `/pay/[orderId]`.
  `layout.tsx` renders the centered `.navy-frame` phone column and wraps everything in `Providers`
  (PrivyProvider → SessionProvider → ToastProvider).

## Setup

```bash
cd web-wallet
cp .env.local.example .env.local     # fill in the NEXT_PUBLIC_* values
CI=true pnpm install
```

`.env.local` keys (all `NEXT_PUBLIC_*`, inlined at build time):
`PRIVY_APP_ID`, `PRIVY_CLIENT_ID`, `NAVY_API_URL`, `SOLANA_RPC`, `USDC_MINT`.

## Run

```bash
pnpm dev -p 3001         # dev server on http://localhost:3001
# or
pnpm build && pnpm start # production
```

**Runtime prerequisites for a working login/pay/farm (not needed just to render):**
1. The backend `be/` must be running (`cd be && pnpm start`, port 3000) **with `WEB_WALLET_ORIGIN`
   set** to this app's origin (e.g. `http://localhost:3001`) so its CORS allows browser calls.
2. This app's web origin must be **whitelisted in the Privy dashboard** for the Privy app — otherwise
   Privy refuses to load its auth iframe (403 / `frame-ancestors` block) and login can't complete.
3. A funded **devnet** wallet for pay/farming (USDC devnet mint `4zMMC9…DncDU`; farming uses native SOL).

## Test / verify

```bash
pnpm test                # jest — src/lib/**/*.test.ts (ported logic; 30 tests)
pnpm exec tsc --noEmit   # typecheck gate for screens/components
pnpm build               # runtime gate — catches browser polyfill/module-resolution issues tsc misses
```

`pnpm build` is the web analogue of the mobile "verify by bundling" rule: `tsc` passing does not
guarantee the browser bundle resolves (`@solana/web3.js` Buffer/crypto usage). If a build or a
loaded page surfaces a `Buffer`/`crypto` error, add a polyfill (webpack `resolve.fallback` in
`next.config.ts` or a client-side `globalThis.Buffer ??= Buffer`). As of the initial port, no
polyfill is needed — a headless-browser smoke of every route showed clean hydration.
