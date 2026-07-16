const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// ---------------------------------------------------------------------------
// Crypto polyfill: inject before all other modules so globalThis.crypto
// is available when @noble/hashes captures it at import time.
// ---------------------------------------------------------------------------

const originalGetModules =
  config.serializer?.getModulesRunBeforeMainModule ?? (() => []);

config.serializer = {
  ...config.serializer,
  getModulesRunBeforeMainModule() {
    const defaults = originalGetModules();
    return [...defaults, path.resolve(__dirname, "src/crypto-polyfill.ts")];
  },
};

// ---------------------------------------------------------------------------
// Resolver configuration
// ---------------------------------------------------------------------------

const TCP_SHIM = path.resolve(
  __dirname,
  "src/shims/react-native-tcp-socket.ts",
);

const originalResolveRequest = config.resolver?.resolveRequest;

config.resolver = {
  ...config.resolver,
  assetExts: [...(config.resolver?.assetExts ?? []), "wasm"],
  resolveRequest(context, moduleName, platform) {
    // On web, replace react-native-tcp-socket with an empty shim
    // (TCP sockets are not available in browsers; Electron uses IPC instead)
    if (platform === "web" && moduleName === "react-native-tcp-socket") {
      return { type: "sourceFile", filePath: TCP_SHIM };
    }
    if (originalResolveRequest) {
      return originalResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

// NativeWind 5 (built on react-native-css) compiles both the app's own Tailwind
// classes and Bloom's — a single wrapper, no separate `withReactNativeCSS`.
module.exports = withNativeWind(config, {
  input: "./global.css",
  inlineRem: 16,
  inlineVariables: false,
});
