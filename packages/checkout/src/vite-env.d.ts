/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL: string | undefined;
  readonly VITE_WALLET_DEEPLINK_SCHEME: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
