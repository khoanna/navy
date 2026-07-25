# Expo HAS CHANGED

This app is pinned to **Expo SDK 54** (the user's iPhone Expo Go supports SDK 54). Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code — do NOT rely on training-data memory for Expo/React Native APIs, and verify SDK-specific package APIs (Privy `@privy-io/expo`, expo-camera, reanimated v4 + `react-native-worklets`) against the installed `node_modules` `.d.ts`.

Navigation: **Expo Router** (file-based). Native deps mean this app runs via a **custom EAS dev client**, not stock Expo Go.

The AI assistant streams over **SSE** from the backend's `POST /agent/chat`. React Native has no native `EventSource`, so `src/lib/agent` parses the `fetch` response body stream itself (SSE parser + `chatReducer`, both plain-TS/unit-tested); assistant UI lives in `src/features/assistant/*Card.tsx`.
