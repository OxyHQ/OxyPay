import { randomUUID } from "node:crypto";
import type { HydratedDocument } from "mongoose";
import type { NetworkType } from "@fairco.in/core";
import type { MerchantDoc } from "../models/Merchant";
import { PaymentIntent } from "../models/PaymentIntent";
import type { PaymentIntentDoc } from "../models/PaymentIntent";
import { reserveNextAddress } from "./reserveAddress";
import { newId, clientSecretFor } from "../lib/ids";
import { isDuplicateKeyError } from "../lib/http";

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
  merchant: HydratedDocument<MerchantDoc>;
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
  intent: HydratedDocument<PaymentIntentDoc>;
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

  // Idempotency (fast path): a prior intent for this key wins as-is. Only
  // meaningful when the caller supplied a key.
  if (idempotencyKey) {
    const existing = await PaymentIntent.findOne({
      merchantId: merchant.id,
      idempotencyKey,
    });
    if (existing) {
      return { intent: existing, reused: true };
    }
  }

  const { address } = await reserveNextAddress(merchant.id);
  const id = newId("pi");
  const clientSecret = clientSecretFor(id);
  const expiresAt = new Date(
    Date.now() + (expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS) * MS_PER_SECOND,
  );
  const key = idempotencyKey ?? randomUUID();

  try {
    // Explicit field whitelist — never spread a caller body (mass-assignment
    // would be an IDOR).
    const intent = await PaymentIntent.create({
      id,
      status: "created",
      amount,
      network,
      address,
      merchantId: merchant.id,
      txid: null,
      confirmations: 0,
      clientSecret,
      idempotencyKey: key,
      metadata: metadata ? new Map(Object.entries(metadata)) : new Map<string, string>(),
      expiresAt,
    });
    return { intent, reused: false };
  } catch (err) {
    // Idempotency (race path): a concurrent create with the same key lost the
    // unique-index bet — return the winner rather than erroring. Only
    // meaningful when the caller supplied a key to race on.
    if (idempotencyKey && isDuplicateKeyError(err)) {
      const winner = await PaymentIntent.findOne({
        merchantId: merchant.id,
        idempotencyKey,
      });
      if (winner) {
        return { intent: winner, reused: true };
      }
    }
    throw err;
  }
}
