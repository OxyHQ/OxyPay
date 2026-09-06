import { randomUUID } from "node:crypto";
import type { NetworkType } from "@fairco.in/core";
import type { CurrencyCode, PaymentIntentRail } from "@peable.to/shared-types";
import { getDb } from "../db/postgres";
import type { MerchantRow } from "../db/merchants/merchantRepository";
import {
  findIntentByIdempotencyKey,
  insertPaymentIntent,
} from "../db/payments/paymentIntentRepository";
import type { PaymentIntentRow } from "../db/payments/paymentIntentRepository";
import { reserveNextAddress } from "./reserveAddress";
import { newId, clientSecretFor } from "../lib/ids";

const DEFAULT_EXPIRY_SECONDS = 15 * 60;
const MS_PER_SECOND = 1000;

/**
 * Thrown when a caller's `network` doesn't match the merchant's configured
 * network — the data-integrity firewall (F2.0 task 1a) that keeps a
 * `PaymentIntent.network` label truthful about the network its watch-only
 * `address` actually encodes. Routes translate this into a 422.
 */
export class NetworkMismatchError extends Error {
  constructor(requested: NetworkType, merchantNetwork: NetworkType) {
    super(
      `network '${requested}' does not match the merchant's configured network '${merchantNetwork}'`,
    );
    this.name = "NetworkMismatchError";
  }
}

/**
 * Thrown when the rail and the rest of the request do not describe one payment
 * — a FairCoin intent with no network, a card intent claiming one, or either
 * rail with a currency it cannot settle in.
 *
 * A separate error from `NetworkMismatchError` because it is a DIFFERENT
 * mistake: that one is a caller naming the wrong chain, this one is a caller
 * naming a combination that is not a payment at all. Routes translate both into
 * a 422, and the message is what tells the integrator which they made.
 */
export class RailMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RailMismatchError";
  }
}

/**
 * The FairCoin rail settles in FAIR and nothing else.
 *
 * A FAIR-denominated card charge and a EUR-denominated chain payment are both
 * expressible in the type system and neither is a thing this gateway can do:
 * the second would need an FX conversion at settlement time that nothing here
 * performs. `payment_intents_rail_currency_agrees_check` says the same in the
 * database. Widening it later is a migration with a decision behind it.
 */
function assertRailCurrency(rail: PaymentIntentRail, currency: CurrencyCode): void {
  if (rail === "faircoin" && currency !== "FAIR") {
    throw new RailMismatchError(
      `the faircoin rail settles in FAIR, not '${currency}'`,
    );
  }
  if (rail === "card" && currency === "FAIR") {
    throw new RailMismatchError(
      "the card rail cannot settle in FAIR; name a fiat currency",
    );
  }
}

export interface CreateIntentInput {
  merchant: MerchantRow;
  amount: string;
  /** Defaults to `faircoin` — the rail this gateway shipped with (ADR 0001 D1). */
  rail?: PaymentIntentRail;
  /** Required on the faircoin rail; must be absent on the card rail. */
  network?: NetworkType;
  /** Defaults to `FAIR` on the faircoin rail; required on the card rail. */
  currency?: CurrencyCode;
  metadata?: Record<string, string>;
  expiresInSeconds?: number;
  /**
   * A caller-supplied `Idempotency-Key` enables the fast-path replay lookup
   * and race-path recovery below. Payment links and checkout sessions mint
   * without one (they manage reuse at their own layer) — a synthetic key is
   * generated for them so the required schema field is always satisfied,
   * but no replay lookup is ever done against a key nobody can present again.
   */
  idempotencyKey?: string;
}

export interface CreateIntentResult {
  intent: PaymentIntentRow;
  reused: boolean;
}

/**
 * Mint (or, for a replayed `Idempotency-Key`, return the existing) intent.
 * The single code path every intent-creating route — `POST /v1/payment_intents`,
 * payment links, checkout sessions — must go through, so the idempotency and
 * derivation logic can never fork between them.
 */
/** What a caller asked for, once the rail's defaults and rules have been applied. */
export interface ResolvedRail {
  readonly rail: PaymentIntentRail;
  readonly currency: CurrencyCode;
  /** The merchant's network on the faircoin rail; `null` on the card rail. */
  readonly network: NetworkType | null;
}

/**
 * Turn a caller's partial rail description into a coherent one, or refuse it.
 *
 * ONE owner, THREE callers: `createIntent` below, and the payment-link and
 * checkout-session routes, which have to apply the identical defaults to the
 * values they persist. A link that stored a rail its minted intents would then
 * be refused for is a price a payer can see and can never pay — and the two
 * rows are in different tables, so no constraint can catch the disagreement.
 *
 * @throws {RailMismatchError} when the combination is not a payment.
 * @throws {NetworkMismatchError} when a faircoin caller named the wrong chain.
 */
export function resolveRail(
  merchant: MerchantRow,
  input: { rail?: PaymentIntentRail; currency?: CurrencyCode; network?: NetworkType },
): ResolvedRail {
  const rail = input.rail ?? "faircoin";
  const currency = input.currency ?? (rail === "faircoin" ? "FAIR" : undefined);

  if (currency === undefined) {
    throw new RailMismatchError("the card rail requires an explicit currency");
  }
  assertRailCurrency(rail, currency);

  if (rail === "faircoin") {
    // The network firewall, unchanged. A `network` label that disagrees with the
    // network the `address` actually encodes sends a payer's funds to an address
    // nobody is watching.
    if (input.network === undefined) {
      throw new RailMismatchError("the faircoin rail requires a network");
    }
    if (input.network !== merchant.network) {
      throw new NetworkMismatchError(input.network, merchant.network);
    }
    return { rail, currency, network: input.network };
  }

  if (input.network !== undefined) {
    // Not pedantry: a card intent carrying a network makes the composite
    // reference to `merchants (id, network)` BIND, tying a card charge to a
    // chain — and `payment_intents_card_has_no_chain_fields_check` refuses it
    // one layer down anyway, as a 500 instead of this 422.
    throw new RailMismatchError("the card rail has no network");
  }
  return { rail, currency, network: null };
}

export async function createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
  const { merchant, amount, metadata, expiresInSeconds, idempotencyKey } = input;
  const { rail, currency, network } = resolveRail(merchant, input);

  const db = getDb();

  // Idempotency (fast path): a prior intent for this key wins as-is. Only
  // meaningful when the caller supplied a key.
  if (idempotencyKey) {
    const existing = await findIntentByIdempotencyKey(db, merchant.id, idempotencyKey);
    if (existing) {
      return { intent: existing, reused: true };
    }
  }

  // A card payment reserves NO derivation index. Reserving one anyway would
  // burn an index on a payment that can never receive coins, and every FairCoin
  // payer after it would be handed a different address than the counter implies.
  const address =
    rail === "faircoin" ? (await reserveNextAddress(merchant.id)).address : null;
  const publicId = newId("pi");
  const clientSecret = clientSecretFor(publicId);
  const expiresAt = new Date(
    Date.now() + (expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS) * MS_PER_SECOND,
  );
  const key = idempotencyKey ?? randomUUID();

  // Explicit field whitelist — never spread a caller body (mass-assignment
  // would be an IDOR). `status`, `currency` and `confirmations` take their
  // column defaults inside the repository: a caller does not get to mint an
  // intent that is already settled.
  const intent = await insertPaymentIntent(db, {
    publicId,
    merchantId: merchant.id,
    rail,
    amount,
    currency,
    network,
    address,
    clientSecret,
    idempotencyKey: key,
    metadata: metadata ?? {},
    expiresAt,
  });

  if (intent) {
    return { intent, reused: false };
  }

  // Idempotency (race path): a concurrent create with the same key lost the
  // unique-index bet — return the winner rather than erroring. `insertPaymentIntent`
  // converges on `(merchant_id, idempotency_key)` and answers `null` rather
  // than raising, so this is a branch and no longer a caught duplicate-key
  // error. Only reachable when the caller supplied a key to race on: without
  // one the key is a fresh uuid nothing else can collide with.
  if (idempotencyKey) {
    const winner = await findIntentByIdempotencyKey(db, merchant.id, idempotencyKey);
    if (winner) {
      return { intent: winner, reused: true };
    }
  }

  throw new Error(`payment intent insert converged on no row for merchant ${merchant.id}`);
}
