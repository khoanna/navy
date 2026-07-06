// react-native-reanimated 4.x moved the babel plugin to react-native-worklets/plugin.
// The older 'react-native-reanimated/plugin' is only correct for v3.x.
module.exports = (api) => {
  api.cache(true);
  // `unstable_transformProfile: 'default'` forces babel to downlevel modern syntax
  // (incl. ES private class fields like RN core's DOMRectReadOnly `#x/#y/#width`).
  // The default 'hermes-stable' profile skips that transform, but the bundled
  // `hermesc -O` AOT step rejects private fields ("private properties are not
  // supported"), failing the release/export bundle. Downleveling in babel fixes it.
  return {
    presets: [['babel-preset-expo', { unstable_transformProfile: 'default' }]],
    plugins: ['react-native-worklets/plugin'],
  };
};
