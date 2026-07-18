import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { oxyClient } from "@oxyhq/core";
import { Merchant } from "../models/Merchant";
import { newId } from "../lib/ids";
import { toMerchantDTO } from "../lib/serialize";
import { sendError, wrap, isDuplicateKeyError, requireServiceApp } from "../lib/http";
import { resolveMerchant } from "./paymentIntents";

const createMerchantBodySchema = z.object({
  network: z.enum(["mainnet", "testnet"]),
  xpub: z.string().min(1),
  webhookUrl: z.string().url().optional(),
  webhookSecret: z.string().min(1).optional(),
  requiredConfirmations: z.number().int().positive().optional(),
});

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
    // `oxyClient.requireScope()` answers 403 SERVICE_TOKEN_REQUIRED when
    // `req.serviceApp` is missing entirely, not 401 — gate on serviceApp
    // presence FIRST so a fully unauthenticated caller gets 401 like every
    // other route in this gateway, and requireScope's 403 is reserved for
    // "authenticated but missing payments:write".
    ((req, res, next) => {
      if (!requireServiceApp(req, res)) return;
      next();
    }) as RequestHandler,
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
      const params = parsed.data;

      // Test/live firewall (F2.0 task 1b): a development/staging credential
      // can only ever register a testnet merchant — this makes it
      // structurally impossible for a leaked test credential to move mainnet
      // funds, not merely a data-labelling convention.
      if (serviceApp.environment !== "production" && params.network === "mainnet") {
        sendError(
          res,
          422,
          "invalid_request_error",
          `a '${serviceApp.environment}' credential cannot register a mainnet merchant`,
        );
        return;
      }

      try {
        // Explicit field whitelist — never spread `req.body`. The non-custody
        // firewall (`Merchant.ts`'s `pre('validate')`) still runs on `xpub`
        // regardless of this route: it rejects any private extended key.
        const merchant = await Merchant.create({
          publicId: newId("merch"),
          oxyAppId: serviceApp.appId,
          environment: serviceApp.environment,
          network: params.network,
          xpub: params.xpub,
          webhookUrl: params.webhookUrl,
          webhookSecret: params.webhookSecret,
          requiredConfirmations: params.requiredConfirmations,
        });
        res.status(201).json(toMerchantDTO(merchant));
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          sendError(
            res,
            409,
            "invalid_request_error",
            "a merchant is already registered for this application and environment",
          );
          return;
        }
        throw err;
      }
    }),
  );

  router.get(
    "/v1/merchants/me",
    requireMerchant,
    oxyClient.requireScope("payments:read"),
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;
      res.status(200).json(toMerchantDTO(merchant));
    }),
  );

  const patchMerchantBodySchema = z.object({
    webhookUrl: z.string().url().nullable().optional(),
    webhookSecret: z.string().min(1).nullable().optional(),
    requiredConfirmations: z.number().int().positive().optional(),
  });

  router.patch(
    "/v1/merchants/me",
    requireMerchant,
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
      const params = parsed.data;

      // Explicit field whitelist — xpub/network/environment/oxyAppId are
      // deliberately NOT accepted here: mutating the derivation key after
      // intents already derived addresses from it would corrupt address
      // history, and network/environment are the test/live firewall itself.
      if (params.webhookUrl !== undefined) merchant.webhookUrl = params.webhookUrl ?? undefined;
      if (params.webhookSecret !== undefined) merchant.webhookSecret = params.webhookSecret ?? undefined;
      if (params.requiredConfirmations !== undefined) {
        merchant.requiredConfirmations = params.requiredConfirmations;
      }

      await merchant.save();
      res.status(200).json(toMerchantDTO(merchant));
    }),
  );

  return router;
}
