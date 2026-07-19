import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { oxyClient } from "@oxyhq/core";
import { createOxyAuthMiddleware, getRequiredOxyUserId } from "@oxyhq/core/server";
import type { SocialNextAddressResponse } from "@oxypay/shared-types";
import { reserveNextSocialAddress } from "../services/socialReceive";
import { SocialSendAttribution } from "../models/SocialSendAttribution";
import { sendError, wrap } from "../lib/http";

const nextAddressBodySchema = z.object({
  network: z.enum(["mainnet", "testnet"]),
});

/**
 * Build the social-send REST router (spec §4.4 step 3, §4.5, §4.8 bullets
 * 2-3).
 *
 * `requireOxyUser` is injectable so tests can bypass a real Oxy bearer token
 * with a stub that populates `req.userId`; production defaults to
 * `createOxyAuthMiddleware(oxyClient)` — the PAYER's own signed-in Oxy
 * session, distinct from the merchant service-auth `paymentIntents.ts` uses.
 */
export function createSocialRouter(deps?: { requireOxyUser?: RequestHandler }): Router {
  const requireOxyUser: RequestHandler =
    deps?.requireOxyUser ?? createOxyAuthMiddleware(oxyClient);
  const router = Router();

  router.post(
    "/v1/social/:username/next_address",
    requireOxyUser,
    wrap(async (req, res) => {
      const senderUserId = getRequiredOxyUserId(req);

      const parsed = nextAddressBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          422,
          "invalid_request_error",
          parsed.error.issues[0]?.message ?? "invalid request body",
        );
        return;
      }
      const { network } = parsed.data;

      const { username } = req.params;
      if (!username) {
        sendError(res, 422, "invalid_request_error", "username is required");
        return;
      }

      let recipient: { id: string };
      try {
        recipient = await oxyClient.getProfileByUsername(username);
      } catch {
        sendError(res, 404, "invalid_request_error", "recipient not found");
        return;
      }

      if (recipient.id === senderUserId) {
        sendError(res, 422, "invalid_request_error", "cannot pay yourself");
        return;
      }

      // Reservation (Task 5) + attribution write (Task 6) happen together in
      // this handler so an enrichment lookup can never observe a reserved
      // address with no attribution row.
      const reservation = await reserveNextSocialAddress(recipient.id, network);
      if (!reservation) {
        sendError(
          res,
          409,
          "keyless_recipient",
          "recipient has not set up an Oxy identity yet",
        );
        return;
      }

      await SocialSendAttribution.create({
        address: reservation.address,
        network,
        senderUserId,
        recipientUserId: recipient.id,
        index: reservation.index,
      });

      const body: SocialNextAddressResponse = {
        address: reservation.address,
        index: reservation.index,
      };
      res.status(200).json(body);
    }),
  );

  return router;
}
