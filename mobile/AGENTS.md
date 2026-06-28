# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.
**This app is on Expo SDK 54** (React 19.1.0, RN 0.81.5, expo-router 6) — NOT the SDK 56 in training data.

## Verify by bundling, not just `tsc`
Screens are `tsc`/build-verified, but `tsc` does NOT catch missing peer deps or Metro
resolution failures. After dependency/native changes, actually bundle:
`pnpm exec expo export --platform ios` — this is the only thing that surfaces the gotchas below.
Native module changes (new `expo-*` / `react-native-*` with native code) need a fresh dev-client
build (`expo run:ios|android` / EAS) — the old binary crashes at runtime even if JS bundles.

## Privy needs explicit peers + a metro.config.js (pnpm won't auto-install peers)
`@privy-io/expo` declares its peers as `"*"` and pnpm does NOT install them — they must be
explicit deps: `expo-apple-authentication expo-clipboard expo-web-browser react-native-svg
react-native-passkeys react-native-qrcode-styled viem@2.52.0 permissionless
@privy-io/expo-native-extensions`. Use `expo install` for the `expo-*`/RN ones (SDK-correct versions).
`metro.config.js` MUST set `resolver.unstable_enablePackageExports = true` +
`unstable_conditionNames = ['react-native','browser','require']`, else jose/viem resolve to their
Node build and bundling dies with `Unable to resolve module crypto`.
Privy's polyfills (`fast-text-encoding react-native-get-random-values @ethersproject/shims`) MUST
load before any Privy import, else runtime throws `Property 'crypto' doesn't exist`. They're imported
in `index.js` (the `package.json` `main`, NOT `expo-router/entry`) ahead of `import 'expo-router/entry'`.
**Privy needs a development build — it does NOT run in Expo Go** (native modules:
`@privy-io/expo-native-extensions`, `react-native-passkeys`). Use `expo run:android|ios` / EAS dev build;
press `s` in the Metro CLI to switch off Expo Go.

## `@solana/*` needs a global `Buffer` polyfill (Metro/Hermes has none)
`@solana/web3.js` (its `index.native.js` does `require('buffer')`) and `@solana/spl-token` reference
the global `Buffer` at **module-eval time**. RN/Metro provides `process` (via `@react-native/js-polyfills`)
but NOT `Buffer`, and `@ethersproject/shims` references Buffer without assigning the global. Without the
polyfill, any route importing balances/pay/farming throws `ReferenceError: Property 'Buffer' doesn't exist`
at import — which Metro reports confusingly as **"Route … is missing the required default export"** (the
module threw before its `export default` ran). Fix: the npm `buffer` package is a direct dep and `index.js`
does `import { Buffer } from 'buffer'; global.Buffer ??= Buffer;` **before** `import 'expo-router/entry'`.
This is a runtime-only failure — `tsc` and `expo export` both pass clean, so it only surfaces on device.

## Changing the Expo SDK: regenerate the lockfile, pin transitive peers
`rm -rf node_modules pnpm-lock.yaml && CI=true pnpm install` — a node_modules-only wipe leaves
stale transitive peer pins (e.g. `@expo/metro-runtime@56.x`) in the lock, which then break
expo-router's `error-overlay` import. Pin mismatched transitive peers via `pnpm.overrides`
(currently: `@expo/metro-runtime: 6.1.2`, `react-dom: 19.1.0`). Run `expo install --fix` after.
