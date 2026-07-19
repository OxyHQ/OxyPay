/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL: string | undefined;
  readonly VITE_WALLET_DEEPLINK_SCHEME: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// `qr-creator`'s `types` field only covers the package root, not the deep
// `dist/qr-creator.es6.min.js` path `Qr.tsx` imports (see the comment there
// for why the deep path is necessary). Re-export the package's real types
// rather than duplicating the interface.
declare module 'qr-creator/dist/qr-creator.es6.min.js' {
  export { default } from 'qr-creator';
}
