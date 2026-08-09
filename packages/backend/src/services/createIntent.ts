import { randomUUID } from "node:crypto";
import type { NetworkType } from "@fairco.in/core";
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

export interface CreateIntentInput {
  merchant: MerchantRow;
  amount: string;
  network: NetworkType;
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
export async function createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
  const { merchant, amount, network, metadata, expiresInSeconds, idempotencyKey } = input;

  if (network !== merchant.network) {
    throw new NetworkMismatchError(network, merchant.network);
  }

  const db = getDb();

  // Idempotency (fast path): a prior intent for this key wins as-is. Only
  // meaningful when the caller supplied a key.
  if (idempotencyKey) {
    const existing = await findIntentByIdempotencyKey(db, merchant.id, idempotencyKey);
    if (existing) {
      return { intent: existing, reused: true };
    }
  }

  const { address } = await reserveNextAddress(merchant.id);
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
    amount,
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
