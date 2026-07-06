// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @privy-io/expo bundles `jose`, whose package `exports` offer a `browser`
// build (WebCrypto) and `import`/`require` builds (Node, which `import "crypto"`).
// Metro's default conditions don't include `browser`, so it resolves jose's Node
// ESM build and the bundle fails on `crypto`. Adding `browser` (ahead of the Node
// conditions) makes jose — and other isomorphic deps in the Privy/Solana stack —
// resolve their RN-safe browser builds. Package exports are enabled by default on
// SDK 54; we set the condition order explicitly.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['browser', 'require', 'react-native'];

module.exports = config;
