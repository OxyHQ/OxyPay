// Browser entry (`@peable/sdk/checkout`) — the anonymous payer-side client
// core (Task 5) plus the embeddable pay-button widget (Task 6). Deliberately
// imports nothing from `./core/*` beyond `core/errors.ts` (a pure
// status-mapper with no service-token/secret machinery): the browser bundle
// must never carry the merchant-authed code or a path to a secret.
//
// `packages/checkout` (the hosted checkout page, a separate package) can
// still consume `createPeableCheckout` directly instead of `PeableCheckout`
// when it wants to build its own UI over the payer client core (see the
// checkout+links plan's `intentClient.ts`).
export {
  createPeableCheckout,
  type CreatePeableCheckoutOptions,
  type PeableCheckoutClient,
} from './browser/payerClient';

export {
  PeableCheckout,
  type PeableCheckoutMountOptions,
  type PeableCheckoutInstance,
  type PeableCheckoutEventMap,
} from './browser/mount';
