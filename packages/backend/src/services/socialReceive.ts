import { getNetwork, hexToBytes, deriveSocialReceiveAddress } from "@fairco.in/core";
import type { NetworkType } from "@fairco.in/core";
import { oxyClient } from "@oxyhq/core";
import { SocialReceiveCursor } from "../models/SocialReceiveCursor";

/**
 * First index this reservation flow ever hands out. Index 0 is the
 * recipient's stable default/favourite address — computed on-device from the
 * identity key, never reserved through the backend (spec §4.3).
 */
export const SOCIAL_RECEIVE_FIRST_FRESH_INDEX = 1;

const SECP256K1_VERIFICATION_METHOD_TYPE = "EcdsaSecp256k1VerificationKey2019";
const MONGO_DUPLICATE_KEY = 11000;

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === MONGO_DUPLICATE_KEY
  );
}

/**
 * Resolve `oxyUserId`'s identity secp256k1 public key from their DID document
 * (`GET /u/:userId/did.json`, public — no auth). Returns `null` for a
 * KEYLESS (custodial) account: no `identity` auth method, hence no
 * `EcdsaSecp256k1VerificationKey2019` verification method to derive from.
 */
export async function resolveIdentityPublicKey(
  oxyUserId: string,
): Promise<Uint8Array | null> {
  const doc = await oxyClient.resolveDid(oxyUserId);
  const vm = doc.verificationMethod.find(
    (entry) => entry.type === SECP256K1_VERIFICATION_METHOD_TYPE,
  );
  if (!vm || !("publicKeyHex" in vm)) {
    return null;
  }
  return hexToBytes(vm.publicKeyHex);
}

/**
 * Atomically claim the next unused social-receive index for `oxyUserId` and
 * derive its FairCoin address — the user-identity equivalent of
 * `reserveNextAddress` (merchant flow), reusing the SAME public-only
 * derivation primitive (`deriveSocialReceiveAddress`, published from
 * `@fairco.in/core`). The backend only ever handles the recipient's PUBLIC
 * identity key; it never sees or stores a private key.
 *
 * Returns `null` when the recipient is keyless (no identity key to derive
 * from) — callers surface the "invite them to set up Oxy Pay" flow (spec
 * §4.5) instead of a send.
 *
 * Lazily creates the per-user cursor on first use (no merchant-style
 * pre-registration exists for an ordinary user): the cursor is first
 * `create`d starting at {@link SOCIAL_RECEIVE_FIRST_FRESH_INDEX}, tolerating
 * the race where two concurrent first-payments both attempt the insert (the
 * unique index on `(oxyUserId, network)` lets exactly one win; the loser's
 * duplicate-key error is expected and ignored). Only AFTER the cursor is
 * guaranteed to exist does the atomic `$inc`/`new:false` claim run, so the
 * returned index is always the exact value THIS call reserved — the same
 * pre-increment-read contract `reserveNextAddress` relies on.
 */
export async function reserveNextSocialAddress(
  oxyUserId: string,
  network: NetworkType,
): Promise<{ index: number; address: string } | null> {
  const identityPublicKey = await resolveIdentityPublicKey(oxyUserId);
  if (!identityPublicKey) {
    return null;
  }

  try {
    await SocialReceiveCursor.create({
      oxyUserId,
      network,
      nextDerivationIndex: SOCIAL_RECEIVE_FIRST_FRESH_INDEX,
    });
  } catch (err) {
    if (!isDuplicateKeyError(err)) {
      throw err;
    }
    // Another concurrent first-payment already created the cursor — proceed
    // to the atomic increment below, which now finds it.
  }

  const cursor = await SocialReceiveCursor.findOneAndUpdate(
    { oxyUserId, network },
    { $inc: { nextDerivationIndex: 1 } },
    { new: false },
  );
  if (!cursor) {
    throw new Error(
      `social receive cursor vanished unexpectedly for user ${oxyUserId}`,
    );
  }

  const index = cursor.nextDerivationIndex;
  const address = deriveSocialReceiveAddress(identityPublicKey, index, getNetwork(network));
  return { index, address };
}
