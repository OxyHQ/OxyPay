// Browser entry (`@oxyhq/pay/checkout`) — the anonymous payer-side client
// core. Deliberately imports nothing from `./core/*` (the service-token /
// merchant-authed machinery): the browser bundle must never carry that code
// or a path to a secret.
//
// `OxyPayCheckout.mount(...)` (the embeddable pay-button widget, Fase 2 Task
// 6) is NOT exported yet — only the payer client core frozen in Task 2 Step 5
// is available at this phase. `packages/checkout` consumes
// `createOxyPayCheckout` directly (see the checkout+links plan's
// `intentClient.ts`).
export {
  createOxyPayCheckout,
  type CreateOxyPayCheckoutOptions,
  type OxyPayCheckoutClient,
} from './browser/payerClient';
