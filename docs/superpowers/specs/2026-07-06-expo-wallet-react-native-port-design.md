# Expo Wallet — React Native port of the Navy web-wallet

**Date:** 2026-07-06
**Status:** Design approved
**Scope:** Port the existing `web-wallet/` (Next.js + `@privy-io/react-auth`) to a native iPhone app built with **React Native / Expo SDK 54**, using **`@privy-io/expo`** for auth + embedded Solana wallets. **Pure platform port — no business-logic or backend changes.**

## Problem & constraints

The user wants a mobile (iPhone) version of the web wallet, developed with Expo and tested on their iPhone. Two hard constraints shape the design:

1. **Privy does not run in Expo Go.** `@privy-io/expo` ships native modules (secure key storage, native crypto, passkeys). Expo Go is a fixed prebuilt binary and cannot load third-party native code, so the SDK throws at startup inside Expo Go. **Decision:** ship a **custom Expo Dev Client** built via **EAS Build** (free tier, no Mac required). Installed once on the iPhone, it preserves the exact Expo Go workflow (`expo start`, QR scan, Metro live reload) while supporting Privy.
2. **Do not change the working logic.** All business logic in `web-wallet/src/lib/**` is already framework-free plain TypeScript and stays behaviorally identical. Only the UI layer and platform adapters change.

## Why this port is low-risk

- **`src/lib/**` is framework-free plain TS** (session, `navyClient`, `farmingClient`, `payFlow`, `payUrl`, `balances`, `identicon`, `otp`, `slide`, `tips`, `linkedAccounts`). It copies over verbatim and its jest tests come along unchanged — the primary safety net.
- **`tokenStore.ts` was already written for RN.** Its `SecureBackend` interface (`getItemAsync`/`setItemAsync`/`deleteItemAsync`) is exactly the `expo-secure-store` API. The web app plugs a `localStorage` backend into it; the mobile app plugs a SecureStore backend in — session logic untouched.
- **`env.ts` splits source from validation.** `readEnv()` (validation) stays; only `getEnv()` (the source of the raw values) changes.

## Architecture

New independent app at **`/home/khoa/Desktop/uni/expo-wallet`** — a 5th app alongside `be/`, `fe/`, `web-wallet/`, `onchain/`, consistent with the repo's "independent apps, own `package.json`, copy-not-workspace" convention (the same way logic was previously ported from `fe/` → `web-wallet/`). Web-wallet is **left untouched** (not deleted).

- **Expo SDK 54**, TypeScript, **Expo Router** (file-based routing — mirrors the current Next App Router folder layout 1:1).
- **`@privy-io/expo`** + **`expo-dev-client`**, delivered via **EAS Build** `development` profile.

### Logic reuse strategy

Copy `web-wallet/src/lib/**` into `expo-wallet/src/lib/**` verbatim. The only files that change are the platform adapters the lib already abstracts behind interfaces:

| Concern | Web (current) | Expo (port) |
|---|---|---|
| Token storage | `localStorageBackend()` | `expo-secure-store` backend (interface already matches — ~10 lines) |
| Config/env | `process.env.NEXT_PUBLIC_*` | `EXPO_PUBLIC_*` via `expo-constants`; `readEnv()` unchanged, only `getEnv()` source changes |
| Privy auth hooks | `@privy-io/react-auth` | `@privy-io/expo` (see Privy mapping) |
| Privy Solana signing | `@privy-io/react-auth/solana` | `@privy-io/expo` embedded-Solana-wallet provider (see Privy mapping) |
| QR scan | `@zxing/library` (`useQrScanner.ts`) | `expo-camera` barcode scanning (new `useCameraScanner.ts`, same decode contract `payFlow` expects) |
| Deep-link pay URL | web URL | `expo-linking` + Expo Router `pay/[orderId]` route |
| Clipboard (receive) | `navigator.clipboard` | `expo-clipboard` |

### Navigation / screen map (Expo Router)

```
app/_layout.tsx        → PrivyProvider + SessionProvider + ToastProvider (was Providers.tsx)
app/index.tsx          → redirect by session (was app/page.tsx)
app/login.tsx          → login: email OTP + passkey + Google/Apple OAuth
app/pay/[orderId].tsx  → pay page
app/(tabs)/_layout.tsx → Tabs navigator (was (tabs)/layout.tsx auth-guard + TabBar)
app/(tabs)/home.tsx
app/(tabs)/scan.tsx
app/(tabs)/receive.tsx
app/(tabs)/history.tsx
app/(tabs)/farming.tsx
app/(tabs)/settings.tsx
```

Full parity — all 7 screens (login, home, scan, receive, history, farming, settings) + pay page.

### Privy SDK mapping (the drift-sensitive core)

Per the CLAUDE.md SDK-drift rule, every hook is **verified against the installed `@privy-io/expo` `.d.ts` at implementation time**, not from memory. Expected mapping:

| Web (`@privy-io/react-auth`) | Expo (`@privy-io/expo`) — to verify |
|---|---|
| `usePrivy()` (auth state, `getAccessToken`, `logout`) | `usePrivy()` |
| `useLoginWithEmail` (`sendCode`/`loginWithCode`) | `useLoginWithEmail` |
| `useLoginWithOAuth` (`initOAuth`) | `useLoginWithOAuth` — needs `expo-web-browser` + redirect scheme |
| `useLoginWithPasskey` | `useLoginWithPasskey` — needs associated-domains entitlement (dev-client only) |
| `useSolanaWallets` + `useSignTransaction` (`/solana` subpath) | `useEmbeddedSolanaWallet()` + `wallet.getProvider().request(...)` — **shapes differ most here** |
| Settings account hooks (`useLinkAccount`, `useMfaEnrollment`, `useExportWallet`, etc.) | `@privy-io/expo` equivalents — verify per-hook; some may be unavailable and get gracefully hidden |

`useWebSigner.ts` becomes `useMobileSigner.ts`, exposing the **same `{ address, sign, ready }` shape** so `payFlow`/`farmingClient` remain untouched. It preserves the existing fallback provisioning + embedded-wallet-pinning logic, adapted to the Expo wallet API.

### UI layer

- `src/ui/theme.ts` (pure design tokens — colors/space/radius/gradients) ports verbatim.
- Every other `src/ui/*` component (`Button`, `Card`, `Text`, `Screen`, `TabBar`, `OtpInput`, `SlideToConfirm`, `Sheet`, `Gradient`, `Toast`, `Splash`, `Icon`, `Skeleton`, `SuccessCheck`, `Bits`) is rewritten from HTML/CSS (`div`, inline styles) to RN primitives (`View`/`Text`/`Pressable`/`StyleSheet`), **keeping the same prop APIs** so screens change minimally.
- Gradients via `expo-linear-gradient`; icons via an RN icon set matching current `Icon` names; `SlideToConfirm`/`Sheet` via `react-native-gesture-handler` + `react-native-reanimated` (both bundled with Expo). The restrained monochrome list UI language from CLAUDE.md is preserved.

### Native modules & EAS

New native deps (the reason a dev-client is required, not Expo Go): `@privy-io/expo`, `expo-secure-store`, `expo-camera`, `expo-linear-gradient`, `expo-clipboard`, `expo-web-browser`, `expo-linking`, plus Privy's required config plugins. `react-native-get-random-values` + a Buffer shim in the entry file polyfill `@solana/web3.js` in RN (the RN analog of the web-wallet Buffer/crypto note).

- `app.json`: URL scheme, camera permission string, associated domains (passkeys), Privy plugin config.
- `eas.json`: a `development` profile producing a dev-client build.
- Privy dashboard: whitelist the app's redirect scheme / app identifier (analogous to the web-origin whitelist).

## Testing

- Ported `src/lib/**/*.test.ts` run under jest **exactly as today** (pure logic — the real safety net). No logic changes ⇒ passing lib tests are strong evidence the port preserved behavior.
- Screens / Privy / chain calls are verified by `tsc --noEmit` + a successful dev-client run on the device — mirrors the web-wallet "build/dev is the runtime gate, tsc alone is insufficient" convention.

## Non-goals

- No changes to `be/`, `onchain/`, or any business logic.
- No new features.
- `web-wallet/` is not modified or deleted.
- This is a pure platform port.

## Open items to resolve during implementation

- Exact `@privy-io/expo` version compatible with Expo SDK 54, and its precise hook signatures (verify against installed `.d.ts`).
- Which Settings-tab account features (`export wallet`, MFA, linking) have Expo-SDK equivalents; gracefully hide any that don't rather than block.
- Icon library choice that covers the current `Icon` name set without visual regression.
