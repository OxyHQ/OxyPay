const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

for (const ext of ['woff2', 'woff']) {
  if (!config.resolver.assetExts.includes(ext)) {
    config.resolver.assetExts.push(ext);
  }
}

module.exports = config;
