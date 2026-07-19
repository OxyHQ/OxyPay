// Browser entry (`@oxyhq/pay/checkout`) — the anonymous payer-side client
// core (Task 5) plus the embeddable pay-button widget (Task 6). Deliberately
// imports nothing from `./core/*` beyond `core/errors.ts` (a pure
// status-mapper with no service-token/secret machinery): the browser bundle
// must never carry the merchant-authed code or a path to a secret.
//
// `packages/checkout` (the hosted checkout page, a separate package) can
// still consume `createOxyPayCheckout` directly instead of `OxyPayCheckout`
// when it wants to build its own UI over the payer client core (see the
// checkout+links plan's `intentClient.ts`).
export {
  createOxyPayCheckout,
  type CreateOxyPayCheckoutOptions,
  type OxyPayCheckoutClient,
} from './browser/payerClient';

export {
  OxyPayCheckout,
  type OxyPayCheckoutMountOptions,
  type OxyPayCheckoutInstance,
  type OxyPayCheckoutEventMap,
} from './browser/mount';
