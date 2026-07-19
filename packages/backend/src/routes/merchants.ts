import { Router } from "express";
import type { RequestHandler } from "express";
import type { HydratedDocument } from "mongoose";
import { z } from "zod";
import { oxyClient } from "@oxyhq/core";
import type { OxyServiceEnvironment } from "@oxyhq/core/server";
import { Merchant } from "../models/Merchant";
import type { MerchantDoc } from "../models/Merchant";
import { newId } from "../lib/ids";
import { toMerchantDTO } from "../lib/serialize";
import {
  sendError,
  wrap,
  isDuplicateKeyError,
  requireServiceApp,
  requireAuthenticated,
} from "../lib/http";
import { resolveMerchant } from "./paymentIntents";

/** Exported: `routes/dashboard.ts` parses the SAME registration body for its dashboard-authed register route (F2.5) so the two never drift. */
export const createMerchantBodySchema = z.object({
  network: z.enum(["mainnet", "testnet"]),
  xpub: z.string().min(1),
  webhookUrl: z.string().url().optional(),
  webhookSecret: z.string().min(1).optional(),
  requiredConfirmations: z.number().int().positive().optional(),
});

/** Exported: `routes/dashboard.ts` reuses the SAME patch body for its dashboard-authed PATCH route (F2.5). */
export const patchMerchantBodySchema = z.object({
  webhookUrl: z.string().url().nullable().optional(),
  webhookSecret: z.string().min(1).nullable().optional(),
  requiredConfirmations: z.number().int().positive().optional(),
});

export type RegisterMerchantResult =
  | { ok: true; merchant: HydratedDocument<MerchantDoc> }
  | { ok: false; status: number; message: string };

/**
 * Shared registration body (F2.5) — factored out so `POST /v1/merchants`
 * (service-authed) and the dashboard's `POST
 * /v1/dashboard/applications/:applicationId/merchant` (human-authed) run the
 * EXACT same test/live firewall + create-with-whitelist + duplicate-key
 * handling, never two copies to keep in sync. The `Merchant` model's own
 * `pre('validate')` non-custody firewall runs regardless of caller, since it
 * lives on the schema.
 */
export async function registerMerchant(
  oxyAppId: string,
  environment: OxyServiceEnvironment,
  params: {
    network: "mainnet" | "testnet";
    xpub: string;
    webhookUrl?: string;
    webhookSecret?: string;
    requiredConfirmations?: number;
  },
): Promise<RegisterMerchantResult> {
  // Test/live firewall (F2.0 task 1b): a development/staging caller can only
  // ever register a testnet merchant — this makes it structurally impossible
  // for a leaked test credential (or a compromised dashboard session) to move
  // mainnet funds, not merely a data-labelling convention.
  if (environment !== "production" && params.network === "mainnet") {
    return {
      ok: false,
      status: 422,
      message: `a '${environment}' environment cannot register a mainnet merchant`,
    };
  }

  try {
    // Explicit field whitelist — never spread caller input. The non-custody
    // firewall (`Merchant.ts`'s `pre('validate')`) still runs on `xpub`
    // regardless of this function: it rejects any private extended key.
    const merchant = await Merchant.create({
      publicId: newId("merch"),
      oxyAppId,
      environment,
      network: params.network,
      xpub: params.xpub,
      webhookUrl: params.webhookUrl,
      webhookSecret: params.webhookSecret,
      requiredConfirmations: params.requiredConfirmations,
    });
    return { ok: true, merchant };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return {
        ok: false,
        status: 409,
        message: "a merchant is already registered for this application and environment",
      };
    }
    throw err;
  }
}

/**
 * Apply the mutable merchant fields (F2.5 — shared by `PATCH /v1/merchants/me`
 * and the dashboard's `PATCH .../merchant`). `xpub`/`network`/`environment`/
 * `oxyAppId` are deliberately NOT accepted here: mutating the derivation key
 * after intents already derived addresses from it would corrupt address
 * history, and network/environment are the test/live firewall itself.
 */
export function applyMerchantPatch(
  merchant: HydratedDocument<MerchantDoc>,
  params: {
    webhookUrl?: string | null;
    webhookSecret?: string | null;
    requiredConfirmations?: number;
  },
): void {
  if (params.webhookUrl !== undefined) merchant.webhookUrl = params.webhookUrl ?? undefined;
  if (params.webhookSecret !== undefined) merchant.webhookSecret = params.webhookSecret ?? undefined;
  if (params.requiredConfirmations !== undefined) {
    merchant.requiredConfirmations = params.requiredConfirmations;
  }
}

/**
 * Build the merchant registration/management REST router (F2.0 task 8).
 * `requireMerchant` is injectable so tests can bypass real Oxy service tokens
 * with a stub that populates `req.serviceApp`; in production it is the SAME
 * resolved default `createGateway()` builds for `paymentIntents.ts`, so
 * `environment` is always available from the token — doubling as the
 * enforcement point for the test/live firewall below.
 */
export function createMerchantsRouter(deps: {
  requireMerchant: RequestHandler;
}): Router {
  const { requireMerchant } = deps;
  const router = Router();

  router.post(
    "/v1/merchants",
    requireMerchant,
    requireAuthenticated,
    oxyClient.requireScope("payments:write"),
    wrap(async (req, res) => {
      const serviceApp = requireServiceApp(req, res);
      if (!serviceApp) return;

      const parsed = createMerchantBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          422,
          "invalid_request_error",
          parsed.error.issues[0]?.message ?? "invalid request body",
        );
        return;
      }
      const result = await registerMerchant(serviceApp.appId, serviceApp.environment, parsed.data);
      if (!result.ok) {
        sendError(res, result.status, "invalid_request_error", result.message);
        return;
      }
      res.status(201).json(toMerchantDTO(result.merchant));
    }),
  );

  router.get(
    "/v1/merchants/me",
    requireMerchant,
    requireAuthenticated,
    oxyClient.requireScope("payments:read"),
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;
      res.status(200).json(toMerchantDTO(merchant));
    }),
  );

  router.patch(
    "/v1/merchants/me",
    requireMerchant,
    requireAuthenticated,
    oxyClient.requireScope("payments:write"),
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;

      const parsed = patchMerchantBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          422,
          "invalid_request_error",
          parsed.error.issues[0]?.message ?? "invalid request body",
        );
        return;
      }
      applyMerchantPatch(merchant, parsed.data);
      await merchant.save();
      res.status(200).json(toMerchantDTO(merchant));
    }),
  );

  return router;
}
