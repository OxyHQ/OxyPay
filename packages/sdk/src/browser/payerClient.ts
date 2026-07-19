// The payer-side REST+socket client core — the "./checkout" entry's payer
// capability. FROZEN here (Fase 2 SDK plan, Task 2 Step 5) as an interface +
// not-implemented stub so `packages/checkout` (and any other consumer of
// `@oxyhq/pay/checkout`) can build and typecheck against the final shape
// NOW, in parallel, before the real implementation lands (Fase 2, Task 5:
// REST snapshot fetch + `socket.io-client` subscribe + `submit_tx`, mirroring
// the wallet's `gateway-client.ts`/`gateway-socket.ts`).
//
// Holds NO service token and NO private key — only a public `client_secret`,
// the exact payer capability the wallet's own payer path already uses
// (non-custody invariant).
import type { PaymentIntent } from '@oxypay/shared-types';

export interface OxyPayCheckoutClient {
  /** `GET /v1/payment_intents/:id?client_secret=…` — the initial REST snapshot. */
  getPaymentIntent(id: string, clientSecret: string): Promise<PaymentIntent>;
  /** Realtime status stream over the Gateway's socket contract, filtered to this intent. */
  subscribe(
    id: string,
    clientSecret: string,
    onUpdate: (intent: PaymentIntent) => void,
  ): Promise<{ unsubscribe(): void }>;
  /** `POST /v1/payment_intents/:id/submit_tx` — report a broadcast txid. */
  submitTx(id: string, clientSecret: string, txid: string): Promise<PaymentIntent>;
}

export interface CreateOxyPayCheckoutOptions {
  /** Gateway base URL. Default `https://api.pay.oxy.so`. */
  gatewayUrl?: string;
}

// `async` so a caller awaiting `getPaymentIntent`/`subscribe`/`submitTx`
// (all Promise-returning per the frozen interface) sees a REJECTED promise,
// not a synchronous throw — matching how the real Task 5 implementation will
// fail (a network/socket error), not how a programmer error would.
async function notImplemented(): Promise<never> {
  throw new Error(
    'OxyPayCheckoutClient is not implemented yet — the browser payer client ' +
      '(Oxy Pay Fase 2, Task 5) has not landed. The interface is frozen so ' +
      'consumers can build against it now; every method throws until the ' +
      'real REST+socket implementation ships.',
  );
}

/**
 * Factory for the payer-side client core. Every method throws until Task 5
 * lands — there is no partial/silent implementation.
 */
export function createOxyPayCheckout(
  _opts: CreateOxyPayCheckoutOptions = {},
): OxyPayCheckoutClient {
  return {
    getPaymentIntent: notImplemented,
    subscribe: notImplemented,
    submitTx: notImplemented,
  };
}
