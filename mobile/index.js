// Polyfills MUST load before anything imports @privy-io/expo or @solana/* (they
// touch the globals `crypto` / `TextEncoder` / `Buffer` at module-eval time).
// Keep these imports first — see https://github.com/privy-io/expo and AGENTS.md.
import 'fast-text-encoding';
import 'react-native-get-random-values';
import '@ethersproject/shims';

// React Native has no global `Buffer`. @solana/web3.js (index.native.js does
// `require('buffer')`) and @solana/spl-token reference it at the top level, so
// it must exist before any route imports them — otherwise the route module
// throws `ReferenceError: Property 'Buffer' doesn't exist` and never registers
// its default export. @ethersproject/shims references Buffer but does NOT assign
// the global, so we install it explicitly here.
import { Buffer } from 'buffer';
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

// Hands control to expo-router, which then loads app/_layout.tsx and the routes.
import 'expo-router/entry';
