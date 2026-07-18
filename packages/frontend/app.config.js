// Dynamic Expo config (Oxy dev/prod variant pattern — see Mention + create-oxy-app).
//
// A development build sits next to the production Oxy Pay app AND every other
// app on the device (FairWallet's `in.fairco.wallet` is a DIFFERENT app and is
// never touched) by giving the dev build a distinct applicationId + name.
// Build the dev variant with `APP_VARIANT=development`; production is default.
//
// The base config (plugins, scheme, icons, notifications, …) lives in app.json;
// this file reads it as `config` and only overrides the identity fields.
module.exports = ({ config }) => {
  const IS_DEV = process.env.APP_VARIANT === 'development';
  const BASE_ID = 'so.oxy.pay';
  const APP_ID = IS_DEV ? `${BASE_ID}.dev` : BASE_ID;
  const APP_NAME = IS_DEV ? 'Oxy Pay (Dev)' : 'Oxy Pay';

  return {
    ...config,
    name: APP_NAME,
    ios: { ...config.ios, bundleIdentifier: APP_ID },
    android: { ...config.android, package: APP_ID },
  };
};
