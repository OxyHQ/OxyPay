/**
 * Expo Config Plugin: withSharedUserId
 *
 * Adds android:sharedUserId="so.oxy.shared" to AndroidManifest.xml so Peable
 * joins the shared-keychain UID and can read the identity Commons writes.
 * REQUIRES every app sharing the UID to be signed with the SAME certificate
 * (the one Oxy ecosystem release keystore). Cannot change after publishing.
 */
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withSharedUserId(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;
    androidManifest.$ = {
      ...androidManifest.$,
      'android:sharedUserId': 'so.oxy.shared',
    };
    return config;
  });
};
