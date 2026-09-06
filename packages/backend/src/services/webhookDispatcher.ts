import {
  safeFetch as realSafeFetch,
  SsrfRejection,
  UpstreamError,
  type SafeFetchResult,
} from "@oxyhq/core/server";
import {
  signWebhook,
  type PaymentIntent,
  type WebhookEvent,
  type WebhookEventType,
} from "@peable.to/shared-types";
import { newId } from "../lib/ids";

/** The concrete `safeFetch` signature — injected in tests, real one in prod. */
export type SafeFetchFn = typeof import("@oxyhq/core/server").safeFetch;

/** Where a merchant's signed webhook events are POSTed, and the signing secret. */
export interface WebhookTarget {
  url: string;
  secret: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 50;
const MAX_BACKOFF_MS = 2000;
const MILLIS_PER_SECOND = 1000;
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 300;
const HTTP_SERVER_ERROR_MIN = 500;

/**
 * Wrap a PaymentIntent in a Stripe-parity `evt_` webhook envelope. `created` is
 * the emission time in ISO-8601; the resource sits under `data.object`.
 */
export function buildEvent(
  type: WebhookEventType,
  intent: PaymentIntent,
): WebhookEvent {
  return {
    id: newId("evt"),
    object: "event",
    type,
    created: new Date(Date.now()).toISOString(),
    data: { object: intent },
  };
}

/** Exponential backoff, capped — kept short since delivery is in-line best-effort. */
function backoffMs(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Deliver a signed webhook event to a merchant target via the SSRF-safe
 * `safeFetch`. Best-effort by contract: it NEVER throws, so a hostile or dead
 * endpoint can never break settlement.
 *
 * - 2xx → `delivered: true`.
 * - 5xx or an `UpstreamError` (timeout/redirect) → transient; retry with a short
 *   bounded backoff up to `maxAttempts`.
 * - any other non-2xx (e.g. 4xx) → the target rejected the payload; give up now.
 * - `SsrfRejection` → the URL resolves to a blocked/private address; warn and
 *   give up (retrying cannot make a blocked target safe).
 *
 * The caller owns the `safeFetch` response stream — we do not read the body, so
 * every attempt destroys it in `finally`.
 */
export async function deliver(
  event: WebhookEvent,
  target: WebhookTarget,
  deps: { safeFetch?: SafeFetchFn; maxAttempts?: number } = {},
): Promise<{ delivered: boolean; attempts: number }> {
  const safeFetch = deps.safeFetch ?? realSafeFetch;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const rawBody = JSON.stringify(event);

  let attempts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    const timestamp = Math.floor(Date.now() / MILLIS_PER_SECOND);
    const signature = signWebhook(target.secret, rawBody, timestamp);

    let result: SafeFetchResult | null = null;
    try {
      result = await safeFetch(target.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Peable-Signature": signature,
        },
        body: rawBody,
      });
      if (result.status >= HTTP_OK_MIN && result.status < HTTP_OK_MAX) {
        return { delivered: true, attempts };
      }
      if (result.status < HTTP_SERVER_ERROR_MIN) {
        // 4xx (or any non-2xx below 5xx): the target rejected the payload —
        // retrying will not help.
        return { delivered: false, attempts };
      }
      // 5xx → transient; fall through to the backoff + retry below.
    } catch (error) {
      if (error instanceof SsrfRejection) {
        process.emitWarning(
          `Peable webhook target refused as SSRF-unsafe: ${target.url} (${error.message})`,
        );
        return { delivered: false, attempts };
      }
      if (!(error instanceof UpstreamError)) {
        // An unexpected failure: surface it (never silently) and stop rather
        // than throwing out of a best-effort delivery.
        const message = error instanceof Error ? error.message : String(error);
        process.emitWarning(
          `Peable webhook delivery error for ${target.url}: ${message}`,
        );
        return { delivered: false, attempts };
      }
      // UpstreamError → transient; fall through to the backoff + retry below.
    } finally {
      result?.response.destroy();
    }

    if (attempt < maxAttempts) await sleep(backoffMs(attempt));
  }

  return { delivered: false, attempts };
}
