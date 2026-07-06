// react-native-reanimated 4.x moved the babel plugin to react-native-worklets/plugin.
// The older 'react-native-reanimated/plugin' is only correct for v3.x.
module.exports = (api) => {
  api.cache(true);
  return { presets: ['babel-preset-expo'], plugins: ['react-native-worklets/plugin'] };
};
