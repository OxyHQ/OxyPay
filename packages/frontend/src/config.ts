/**
 * Typed runtime configuration for Oxy Pay.
 *
 * Every value is overridable per-environment via an `EXPO_PUBLIC_*` variable
 * (inlined into the bundle at build time by Expo) and falls back to the
 * production default. No URL, client id, or endpoint is hardcoded elsewhere —
 * import from here.
 */

// Oxy identity platform API. Owns the device-first session that OxyProvider
// restores on cold boot.
export const OXY_BASE_URL =
  process.env.EXPO_PUBLIC_OXY_BASE_URL ?? 'https://api.oxy.so';

// Oxy Pay's registered Oxy OAuth client id (ApplicationCredential publicKey),
// reused from the Oxy Pay Console client. Required by @oxyhq/services for the
// cross-app device sign-in flow. Public and safe to commit.
export const OXY_CLIENT_ID =
  process.env.EXPO_PUBLIC_OXY_CLIENT_ID ??
  'oxy_dk_857cabdaba3f79ec5c931706424f439b67f3bc7b7bc34fca';

/** Registered OAuth redirect surface for the Oxy Pay web origin (exact match). */
export const OXY_AUTH_REDIRECT_URI =
  process.env.EXPO_PUBLIC_OXY_AUTH_REDIRECT_URI ?? 'https://pay.oxy.so';

// Oxy Pay Gateway backend (payment intents, submit-tx). RP backend addressed by
// a linked client that re-mints the Oxy token from the device secret.
export const GATEWAY_API_URL =
  process.env.EXPO_PUBLIC_GATEWAY_API_URL ?? 'https://api.pay.oxy.so';

// Gateway realtime (Socket.IO) — live payment-intent status updates.
export const GATEWAY_SOCKET_URL =
  process.env.EXPO_PUBLIC_GATEWAY_SOCKET_URL ?? 'wss://api.pay.oxy.so';
