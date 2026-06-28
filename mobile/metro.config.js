// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Privy's SDK core depends on packages (jose, viem, etc.) that ship separate
// node/browser builds behind the "exports" map. Enable package-exports
// resolution and prefer the react-native/browser conditions so they resolve to
// the RN-compatible build (Web Crypto) instead of the Node `crypto` build.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['react-native', 'browser', 'require'];

module.exports = config;
