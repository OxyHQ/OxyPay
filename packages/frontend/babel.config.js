module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          jsxImportSource: 'nativewind',
          unstable_transformImportMeta: true,
        },
      ],
      'nativewind/babel',
    ],
    plugins: [
      [
        'module-resolver',
        {
          root: ['.'],
          alias: { '@': './' },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.svg'],
        },
      ],
      'react-native-worklets/plugin',
    ],
  };
};
