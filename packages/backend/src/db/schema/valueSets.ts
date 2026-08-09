/**
 * The closed value sets this schema stores, as `const` tuples.
 *
 * Every one of them types a `text` column AND renders that column's CHECK
 * constraint, from the same tuple — the convention in
 * `schema/CONVENTIONS.md`. A pg `enum` would put the values in a type whose
 * every change is a migration and whose members cannot be removed at all.
 *
 * `AssertAllListed` is what stops a tuple silently falling behind the union it
 * mirrors. `satisfies` alone only proves each member IS a union member; the
 * dangerous direction is the other one — a union gaining a member no tuple
 * lists, which would type-check everywhere and then be refused by a CHECK at
 * runtime, on the first write of the new value, in production.
 */

import type { NetworkType } from '@fairco.in/core';
import { OXY_SERVICE_ENVIRONMENTS } from '@oxyhq/core/server';
import type { PaymentIntentStatus, WebhookEventType } from '@oxypay/shared-types';

/**
 * `true` when every member of `TUnion` appears in `TListed`, and a compile
 * error otherwise. Type-only, so it costs nothing at runtime and cannot be
 * left unasserted the way an unused `const` can.
 */
type AssertAllListed<TUnion extends TListed, TListed> = true;

/** FairCoin networks. */
export const NETWORK_TYPES = ['mainnet', 'testnet'] as const satisfies readonly NetworkType[];
export type NetworkTypesAreComplete = AssertAllListed<
  NetworkType,
  (typeof NETWORK_TYPES)[number]
>;

/** Oxy service-token environments — test/live isolation, re-exported so the CHECK reads from the SDK's own tuple. */
export const SERVICE_ENVIRONMENTS = OXY_SERVICE_ENVIRONMENTS;

/**
 * The payment-intent lifecycle.
 *
 * `@oxypay/shared-types` publishes `PAYMENT_INTENT_STATUSES` as a
 * `readonly PaymentIntentStatus[]` derived from `Object.keys(...)`, which
 * carries no literal types and therefore cannot type a column. This tuple is
 * the literal form; `schema/__tests__/valueSets.test.ts` asserts the two hold
 * the same members, so the runtime source of truth still governs.
 */
export const PAYMENT_INTENT_STATUS_VALUES = [
  'created',
  'awaiting_approval',
  'approved',
  'broadcast',
  'confirming',
  'settled',
  'expired',
  'failed',
  'rejected',
] as const satisfies readonly PaymentIntentStatus[];
export type PaymentIntentStatusesAreComplete = AssertAllListed<
  PaymentIntentStatus,
  (typeof PAYMENT_INTENT_STATUS_VALUES)[number]
>;

/** Stripe-parity dotted webhook event types. */
export const WEBHOOK_EVENT_TYPES = [
  'payment_intent.confirming',
  'payment_intent.settled',
  'payment_intent.failed',
  'payment_intent.rejected',
  'payment_intent.expired',
] as const satisfies readonly WebhookEventType[];
export type WebhookEventTypesAreComplete = AssertAllListed<
  WebhookEventType,
  (typeof WEBHOOK_EVENT_TYPES)[number]
>;

/** Outcome of the last delivery attempt for a webhook. */
export const WEBHOOK_DELIVERY_STATUSES = ['delivered', 'failed'] as const;

/**
 * The only currency this gateway denominates in. A single-member set still
 * earns a CHECK: it is what makes adding a second currency a migration with a
 * decision behind it rather than a value that appears one day in a row.
 */
export const CURRENCY_CODES = ['FAIR'] as const;

/**
 * A canonical non-negative base-unit integer string — the exact pattern
 * `isBaseUnitString` (`@oxypay/shared-types`) enforces in the application,
 * restated here because the database is where a value that skipped the
 * application guard would otherwise land unchallenged. Kept byte-identical to
 * the TypeScript source; `schema/__tests__/valueSets.test.ts` pins that.
 */
export const BASE_UNIT_STRING_PATTERN = '^(0|[1-9][0-9]*)$';
