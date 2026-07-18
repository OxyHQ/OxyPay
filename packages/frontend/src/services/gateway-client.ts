import type { PaymentIntent } from '@oxypay/shared-types';
import { oxyServices } from '@/services/oxy-services';
import { GATEWAY_API_URL } from '@/config';

/**
 * HTTP client for the Oxy Pay Gateway backend (`api.pay.oxy.so`).
 *
 * A linked client owns its own base URL, cache, and request queue, but keeps its
 * bearer token in lockstep with the canonical Oxy session and delegates 401
 * refresh back to it — so the SDK re-mints the short access token from the device
 * secret when it expires. No app-local token provider or `Authorization` header.
 * GET caching stays OFF (the SDK cannot invalidate the Gateway's own resources);
 * React Query owns any caching in the consuming layer.
 */
export const gateway = oxyServices.createLinkedClient({ baseURL: GATEWAY_API_URL });

/**
 * Report a broadcast FairCoin txid for a payment intent — the payer path.
 * Possession of the intent's `client_secret` is the authorization; the reported
 * txid is what the Gateway's settlement watcher then verifies on-chain.
 *
 * The Gateway returns the updated `PaymentIntent` DTO directly (no `{ data }`
 * envelope — verified against `packages/backend/src/routes/paymentIntents.ts`),
 * so the linked client's parsed body IS the intent.
 */
export async function submitTx(
  intentId: string,
  clientSecret: string,
  txid: string,
): Promise<PaymentIntent> {
  return gateway.client.post<PaymentIntent>(
    `/v1/payment_intents/${intentId}/submit_tx`,
    { client_secret: clientSecret, txid },
  );
}
