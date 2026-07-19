import { oxyClient, getNormalizedUserHandle } from "@oxyhq/core";
import type { EnrichmentResult } from "@oxypay/shared-types";
import { PaymentIntent } from "../models/PaymentIntent";
import { Merchant } from "../models/Merchant";
import { SocialSendAttribution } from "../models/SocialSendAttribution";

/** Hard cap on a single enrichment batch — enforced by the `POST /v1/enrich` route (Task 9). */
export const ENRICH_MAX_ADDRESSES = 50;

/**
 * Resolve display identity for a batch of the CALLER's own addresses (spec
 * §4.8) — "Paid at <merchant>" for a Gateway PaymentIntent receive address,
 * "Sent to @x" / "Received from @x" for a social-receive address the caller
 * was the sender or recipient of, else `unknown` (an honest external
 * on-chain payment, per spec §4.5). Display-only: never touches a private
 * key, never blocks a payment, degrades to `unknown` on any partial failure
 * to resolve a counterparty's profile.
 *
 * Every address defaults to `unknown` up front so the returned record always
 * has exactly one entry per input address, in every branch.
 */
export async function enrichAddresses(
  addresses: string[],
  viewerUserId: string,
): Promise<Record<string, EnrichmentResult>> {
  const result: Record<string, EnrichmentResult> = {};
  for (const address of addresses) {
    result[address] = { kind: "unknown" };
  }
  if (addresses.length === 0) {
    return result;
  }

  // 1. Merchant payments — PaymentIntent.address -> Merchant display fields.
  const intents = await PaymentIntent.find({ address: { $in: addresses } });
  const merchantIdByAddress = new Map<string, string>();
  for (const intent of intents) {
    merchantIdByAddress.set(intent.address, intent.merchantId);
  }
  const merchants = await Merchant.find({
    _id: { $in: [...new Set(merchantIdByAddress.values())] },
  });
  const merchantById = new Map(merchants.map((m) => [m.id, m]));
  const resolvedAddresses = new Set<string>();
  for (const [address, merchantId] of merchantIdByAddress) {
    const merchant = merchantById.get(merchantId);
    if (!merchant) continue;
    result[address] = {
      kind: "merchant",
      displayName: merchant.displayName,
      avatarFileId: merchant.avatarFileId,
      description: merchant.description,
    };
    resolvedAddresses.add(address);
  }

  // 2. Social sends/receives — SocialSendAttribution, scoped to the VIEWER's
  // own side of the payment (never leak a counterparty for an address the
  // caller wasn't party to).
  const remaining = addresses.filter((a) => !resolvedAddresses.has(a));
  if (remaining.length > 0) {
    const attributions = await SocialSendAttribution.find({
      address: { $in: remaining },
    });
    const counterpartyByAddress = new Map<string, string>();
    for (const attribution of attributions) {
      if (attribution.senderUserId === viewerUserId) {
        counterpartyByAddress.set(attribution.address, attribution.recipientUserId);
      } else if (attribution.recipientUserId === viewerUserId) {
        counterpartyByAddress.set(attribution.address, attribution.senderUserId);
      }
    }

    if (counterpartyByAddress.size > 0) {
      const counterpartyIds = [...new Set(counterpartyByAddress.values())];
      const profiles = await oxyClient.getUsersByIds(counterpartyIds);
      const profileById = new Map(profiles.map((p) => [p.id, p]));
      for (const [address, counterpartyId] of counterpartyByAddress) {
        const profile = profileById.get(counterpartyId);
        if (!profile) continue;
        const handle = getNormalizedUserHandle(profile) ?? profile.username;
        result[address] = {
          kind: "user",
          displayName: profile.name.displayName ?? handle,
          avatarFileId: profile.avatar ?? undefined,
          username: profile.username,
        };
      }
    }
  }

  return result;
}
