import { getNetwork } from "@fairco.in/core";
import { Merchant } from "../models/Merchant";
import { deriveIntentAddress } from "./derivation";

/**
 * Atomically claim the merchant's next derivation index and derive its
 * watch-only receive address. The `$inc` under `findOneAndUpdate` with
 * `new: false` returns the PRE-increment document, so its `nextDerivationIndex`
 * is exactly the index this call owns — concurrent callers each get a distinct
 * index with no read-modify-write race.
 */
export async function reserveNextAddress(
  merchantId: string,
): Promise<{ index: number; address: string }> {
  const merchant = await Merchant.findOneAndUpdate(
    { _id: merchantId },
    { $inc: { nextDerivationIndex: 1 } },
    { new: false },
  );

  if (!merchant) {
    throw new Error(`merchant not found: ${merchantId}`);
  }

  const index = merchant.nextDerivationIndex;
  const address = deriveIntentAddress(
    merchant.xpub,
    0,
    index,
    getNetwork(merchant.network),
  );

  return { index, address };
}
