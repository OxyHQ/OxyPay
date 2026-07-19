// Configuration for the server-side `OxyPay` client. The SDK is configured
// with a confidential `ApplicationCredential` (`{publicKey, secret}`, the
// SAME credential Oxy Console already issues for a `type:'service'`
// credential) — never a bespoke "Oxy Pay API key". See the SDK plan's
// "Architecture / auth" section.

/** Default Gateway host (`api.pay.oxy.so`) — the SDK never sends a `livemode`
 * flag; the credential's `environment` rides in the minted service JWT and
 * the Gateway resolves test/live from it. */
export const DEFAULT_GATEWAY_BASE_URL = 'https://api.pay.oxy.so';

/** Default oxy-api host used to mint the short-lived service token. */
export const DEFAULT_OXY_API_URL = 'https://api.oxy.so';

export interface OxyPayConfig {
  /** ApplicationCredential publicKey (e.g. `oxy_dk_...`). */
  publicKey: string;
  /** ApplicationCredential plaintext secret. */
  secret: string;
  /** Gateway base URL. Default `https://api.pay.oxy.so`. */
  baseURL?: string;
  /** oxy-api host used to mint the service token. Default `https://api.oxy.so`. */
  oxyApiUrl?: string;
}

/** `OxyPayConfig` with every optional field defaulted and normalized. */
export interface ResolvedOxyPayConfig {
  publicKey: string;
  secret: string;
  baseURL: string;
  oxyApiUrl: string;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Validate and normalize an `OxyPayConfig`. Throws a plain `Error` for a
 * missing `publicKey`/`secret` — a programmer error caught at construction
 * time, not an API-response failure, so it deliberately does not go through
 * the `OxyPayError` hierarchy (which models mapped HTTP responses).
 */
export function resolveConfig(config: OxyPayConfig): ResolvedOxyPayConfig {
  if (!config.publicKey) {
    throw new Error('OxyPay: `publicKey` is required');
  }
  if (!config.secret) {
    throw new Error('OxyPay: `secret` is required');
  }
  return {
    publicKey: config.publicKey,
    secret: config.secret,
    baseURL: stripTrailingSlash(config.baseURL ?? DEFAULT_GATEWAY_BASE_URL),
    oxyApiUrl: stripTrailingSlash(config.oxyApiUrl ?? DEFAULT_OXY_API_URL),
  };
}
