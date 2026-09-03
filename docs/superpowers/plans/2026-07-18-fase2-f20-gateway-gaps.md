# Fase 2 · F2.0 — Oxy Pay Gateway gap closures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ## ✅ EXECUTION STATUS — COMPLETE (2026-07-19)
> **13/13 tasks done + reviewed** on branch `feat/oxypay-fase2-gateway` (local, not pushed). Backend suite **162/162** (order-independent, `--randomize`-safe), tsc clean. Published **`@oxyhq/core@12.8.0`** (Task 3) — verified propagation. Discovered + fixed 3 real pre-existing service-token auth defects along the way (missing `iss`/`aud` on the mint; `serviceAuth()` with no `jwtSecret`).
> **Post-plan follow-ups also landed:** scope-gating (create/reject/redeliver → `payments:write`, GET `/:id` merchant → `payments:read`), `PaymentIntent.merchantId`+`address` indexes, enrich/social real-auth-default 401 tests, `requireAuthenticated` unified into `lib/http.ts`. Final whole-branch review + independent reviews all clean.
> **Remaining (owner/coordinate — not blocking):** device-verify; push/PR decision; version-drift (`@oxyhq/core@12.9.0`/`@oxyhq/services@22.8.0` break identity files on a fresh install → coordinate with the identity-vault v2 session). Full detail + follow-up list: `.superpowers/sdd/progress.md`.

**Goal:** Close the five backend gaps in the Oxy Pay Gateway (`~/Oxy/OxyPay/packages/backend`) that the spec (`docs/superpowers/specs/2026-07-18-oxypay-fase2-gateway-dashboard.md` §3) marks as the hard prerequisite for all of Fase 2 (SDK, checkout, payment links, dashboard): the test/live network-label bug, real test/live merchant isolation (two `Merchant` docs per Application keyed by credential `environment`), merchant registration/management routes, list + payer-authed read, and a persisted webhook-delivery log — plus the small isolated upstream PR in `~/Oxy/OxyHQServices` (oxy-api + `@oxyhq/core`) that the `environment` isolation depends on.

**Architecture:** Every new capability is layered on the existing F1 primitives with zero shape changes to what F1 already ships: `oxyClient.serviceAuth()` (now with its `jwtSecret` actually wired — see Task 4) resolves `req.serviceApp`, `resolveMerchant()` narrows that to a `Merchant` document scoped by `{oxyAppId, environment}`, and every new route reuses the same Stripe-parity DTO/error/idempotency conventions F1 established. The one new cross-repo dependency (`environment` riding the service JWT) is published and consumed before any Gateway code reads it, per the "publish upstream first" rule.

**Tech Stack:** Bun + Express + Mongoose (MongoDB) + Socket.io + Zod, unchanged from F1. `@oxyhq/core` / `@oxyhq/core/server` (bumped to a new minor version by Task 3). `bun test` + `mongodb-memory-server` for every Gateway test; Jest (ts-jest) for the two OxyHQServices packages touched upstream.

## Global Constraints

- **Non-custody/MiCA invariant, no exception:** no surface in this plan accepts, stores, or derives a private key. The `Merchant` schema's `pre('validate')` watch-only firewall (`deriveIntentAddress` throws on an `xprv`) is untouched and every new merchant-write path (`POST /v1/merchants`) runs through it unchanged.
- **`@oxyhq/core/server` auth helpers only** — no app-local bearer parsers, no hand-rolled JWT decoding in the Gateway. `verifySecret`, `safeFetch`, `createOxyCors` stay the only security primitives used.
- **Explicit field whitelist on every write** — never `new Model(req.body)`, never spread `req.body` into a Mongoose write. Every route in this plan lists its Zod-validated fields individually (mass-assignment = IDOR).
- **Unique rate-limit prefix per limiter** (`rl:<scope>:`) if a future task adds a route-specific limiter. This plan adds no new limiter (the existing global `createOxyRateLimit(oxyClient)` in `server.ts:115` already covers every route below); flagged here so a later change doesn't collide with it.
- **security-reviewer gate before any of this touches real (mainnet/`livemode`) money.** Task 1 and Task 8's environment↔network firewall are exactly the surface that gate exists for.
- **bun-only.** `bun test`, `bunx`, never `npm`/`npx`. Any `package.json` dependency change is followed by `bun install` and the regenerated `bun.lock` committed in the same commit.
- **No `as any`, `@ts-ignore`, `@ts-expect-error`, `!` non-null assertions, `console.log`, silent `catch {}`, TODO/FIXME/HACK comments.** TypeScript strict mode throughout. The few `as X` casts in this plan are narrow, named-type casts (never `as any`), each with a one-line rationale in the code.
- **Publish `@oxyhq/core` BEFORE the Gateway consumes its new `environment` symbols** (Task 3, the publish gate) — never `bun publish` from uncommitted state; commit + push to `main` in OxyHQServices first, verify propagation with a clean external install, then bump the Gateway's dependency.
- **Fix upstream, never patch downstream:** the `environment`-on-service-JWT gap and the two pre-existing service-auth defects this plan surfaces (Task 2, Task 4) are fixed at their source package, not worked around in the Gateway.

---

## File Structure

```
~/Oxy/OxyHQServices/packages/api/src/
  routes/auth.ts                          # MODIFY: service-token mint — add environment/iss/aud claims
  routes/__tests__/serviceTokenCredentials.test.ts   # MODIFY: assert the new claims
  utils/applicationScopes.ts              # MODIFY: add payments:read / payments:write
  utils/__tests__/applicationScopes.test.ts          # MODIFY: assert the new scopes exist + are non-privileged

~/Oxy/OxyHQServices/packages/core/src/
  utils/oxyServiceEnvironment.ts          # CREATE: OXY_SERVICE_ENVIRONMENTS + OxyServiceEnvironment (zero-dep, shared by server/ and mixins/)
  utils/__tests__/oxyServiceEnvironment.test.ts      # CREATE
  server/auth.ts                          # MODIFY: OxyServiceAppContext.environment
  server/index.ts                         # MODIFY: export the new symbols
  mixins/OxyServices.utility.ts           # MODIFY: ServiceApp.environment, JwtPayload.environment, claim validation, req.serviceApp assignment
  mixins/__tests__/serviceAuth.test.ts    # MODIFY: environment population/rejection tests
  package.json                            # MODIFY: version bump (Task 3)

~/Oxy/OxyPay/packages/shared-types/src/
  paymentIntent.ts                        # MODIFY: export PAYMENT_INTENT_STATUSES (Task 10)
  merchant.ts                             # CREATE: Merchant DTO + MerchantEnvironment (Task 8)
  webhookDelivery.ts                      # CREATE: WebhookDelivery DTO (Task 12)
  index.ts                                # MODIFY: export the new types

~/Oxy/OxyPay/packages/backend/src/
  config.ts                               # MODIFY: serviceJwtSecret (Task 4)
  __tests__/config.test.ts                # CREATE (Task 4)
  __tests__/onIntentChange.test.ts        # CREATE (Task 12)
  __tests__/e2e.test.ts                   # MODIFY: environment fixture (Task 6)
  lib/ids.ts                              # MODIFY: extend newId() prefixes (Task 7)
  lib/__tests__/ids.test.ts               # MODIFY
  lib/http.ts                             # CREATE: sendError/wrap/isDuplicateKeyError/requireServiceApp (Task 6, extracted)
  lib/serialize.ts                        # MODIFY: toMerchantDTO (Task 8), toWebhookDeliveryDTO (Task 12)
  models/Merchant.ts                      # MODIFY: environment (Task 6), publicId (Task 8)
  models/WebhookDelivery.ts               # CREATE (Task 12)
  models/__tests__/models.test.ts         # MODIFY (Tasks 6, 8)
  routes/paymentIntents.ts                # MODIFY: Task 1 (network check), Task 6 (resolveMerchant), Task 10 (list), Task 11 (payer GET)
  routes/__tests__/routes.test.ts         # MODIFY (Tasks 1, 6, 10, 11)
  routes/__tests__/serviceAuthWiring.test.ts         # CREATE (Task 4)
  routes/merchants.ts                     # CREATE (Task 8, extended Task 9)
  routes/__tests__/merchants.test.ts      # CREATE (Task 8, extended Task 9)
  routes/webhookDeliveries.ts             # CREATE (Task 13)
  routes/__tests__/webhookDeliveries.test.ts         # CREATE (Task 13)
  services/__tests__/settlementWatcher.test.ts       # MODIFY (Task 6)
  server.ts                               # MODIFY: Task 4 (jwtSecret wiring), Task 11 (optionalServiceAuth), Task 12 (WebhookDelivery persistence), Task 13 (mount router)
```

---

### Task 1: [Security bugfix, do first] Cross-check request `network` against the merchant's network

> ✅ **DONE** — commit `b97d792`; task-review clean (Spec ✅ / Quality Approved, 0 issues). 2026-07-19.

**Files:**
- Modify: `packages/backend/src/routes/paymentIntents.ts:132-142` (Oxy Pay Gateway repo, `~/Oxy/OxyPay`)
- Test: `packages/backend/src/routes/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: nothing new — `merchant.network` already exists on `MerchantDoc` (`models/Merchant.ts:15`).
- Produces: no new symbols. Behavior change only: `POST /v1/payment_intents` now 422s when `params.network !== merchant.network`.

**Context:** `paymentIntents.ts:37` accepts `network` in the request body and `paymentIntents.ts:169` persists it verbatim on the intent, but `reserveAddress.ts:30` derives the watch-only address using `merchant.network`, never the caller's value. The two are never cross-checked, so a caller can create an intent labelled `network:"mainnet"` whose address is actually a testnet encoding of the same xpub (or the reverse). Fix: reject before ever deriving an address.

- [x] **Step 1: Write the failing test.** Add to `routes/__tests__/routes.test.ts`, inside the existing `describe("POST /v1/payment_intents", ...)` block (the fixture merchant created in `beforeAll` is `network: "testnet"`):

```ts
  test("network mismatched against the merchant's own network -> 422, no address ever derived", async () => {
    const res = await fetch(`${baseUrl}/v1/payment_intents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-network-mismatch",
      },
      body: JSON.stringify({ amount: "150000000", network: "mainnet" }),
    });
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error?.type).toBe("invalid_request_error");

    const count = await PaymentIntent.countDocuments({
      idempotencyKey: "idem-network-mismatch",
    });
    expect(count).toBe(0);
  });
```

- [x] **Step 2: Run it to verify it fails.**

Run: `cd ~/Oxy/OxyPay && bun test packages/backend/src/routes/__tests__/routes.test.ts -t "network mismatched"`
Expected: FAIL — today the intent is created (`201`), address `TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3` derived from the merchant's testnet xpub, mislabelled `network: "mainnet"` in the response.

- [x] **Step 3: Implement the cross-check.** In `routes/paymentIntents.ts`, insert immediately after `const params: CreatePaymentIntentParams = parsed.data;` (line 142) and before the idempotency lookup:

```ts
      const params: CreatePaymentIntentParams = parsed.data;

      // Data-integrity firewall (F2.0 task 1a): the watch-only address is
      // derived using the MERCHANT's network (`reserveAddress.ts`), never the
      // caller's claimed `network` — reject up front on a mismatch, or the
      // returned intent's `network` label would lie about the network its
      // `address` actually encodes.
      if (params.network !== merchant.network) {
        sendError(
          res,
          422,
          "invalid_request_error",
          `network '${params.network}' does not match the merchant's configured network '${merchant.network}'`,
        );
        return;
      }

      // Idempotency (fast path): a prior intent for this key wins as-is.
      const existing = await PaymentIntent.findOne({
```

- [x] **Step 4: Run it to verify it passes.**

Run: `bun test packages/backend/src/routes/__tests__/routes.test.ts -t "network mismatched"`
Expected: PASS.

- [x] **Step 5: Run the full existing suite to confirm no regression** (every other test in this file creates intents with `network: "testnet"`, matching the testnet fixture merchant, so none should be affected).

Run: `bun test packages/backend/src/routes/__tests__/routes.test.ts`
Expected: all PASS.

- [x] **Step 6: Commit.**

```bash
git add packages/backend/src/routes/paymentIntents.ts packages/backend/src/routes/__tests__/routes.test.ts
git commit -m "fix(gateway): reject a payment intent whose network mismatches the merchant's"
```

---

### Task 2: [Upstream, OxyHQServices, single isolated PR] `environment` + `iss`/`aud` claims on the service-token mint + core verify

> ✅ **DONE** — commit `15dd8c54` (core+api); task-review clean. Confirmed real bug: mint lacked iss/aud → every service token rejected. Shipped in @oxyhq/core@12.8.0. 2026-07-19.

> **Repo:** `~/Oxy/OxyHQServices`. This is the cross-repo dependency the team-lead flagged: the Gateway's test/live isolation (Task 6) needs the caller's `environment` on `req.serviceApp`, and today it is neither in the minted JWT nor on `OxyServiceAppContext`.
>
> **Independently-verified pre-existing defect bundled into this same PR (not in the original spec's task list — flag for confirmation):** tracing the real code shows the service-token mint (`routes/auth.ts:2435-2445`) sets **no `iss`/`aud` claims at all**, while `@oxyhq/core`'s verifier (`OxyServices.utility.ts:989-999`) **requires** `iss==='oxy-auth'`/`aud==='oxy-api'` on every service token. This means `oxyClient.serviceAuth()`/`oxy.auth()` — the exact mechanism the Gateway (and any other external consumer of `@oxyhq/core`) uses to verify a real oxy-api-minted service token — currently rejects **every** real service token, unconditionally, today. No test exercises the real mint → real core-verify path end to end (only mocked units on each side), which is why this has gone unnoticed. Since this PR already edits the exact same `jwt.sign(...)` call to add `environment`, it adds `issuer`/`audience` sign options in the same edit rather than shipping a still-broken auth path forward. (See also Task 4 — a second, Gateway-local instance of this same class of bug.)

**Files:**
- Create: `packages/core/src/utils/oxyServiceEnvironment.ts`
- Create: `packages/core/src/utils/__tests__/oxyServiceEnvironment.test.ts`
- Modify: `packages/core/src/server/auth.ts`
- Modify: `packages/core/src/server/index.ts`
- Modify: `packages/core/src/mixins/OxyServices.utility.ts`
- Modify: `packages/core/src/mixins/__tests__/serviceAuth.test.ts`
- Modify: `packages/api/src/routes/auth.ts:2435-2445`
- Modify: `packages/api/src/routes/__tests__/serviceTokenCredentials.test.ts`

**Interfaces:**
- Produces: `OXY_SERVICE_ENVIRONMENTS: readonly ['development','staging','production']`, `type OxyServiceEnvironment = 'development'|'staging'|'production'`, exported from `@oxyhq/core/server`. `req.serviceApp.environment: OxyServiceEnvironment` populated by `oxyClient.serviceAuth()`/`oxy.auth()`. The minted JWT payload gains `environment`; the token gains real `iss`/`aud` claims.

- [x] **Step 1: Write the failing test for the new zero-dependency environment module.**

```ts
// packages/core/src/utils/__tests__/oxyServiceEnvironment.test.ts
import { OXY_SERVICE_ENVIRONMENTS } from '../oxyServiceEnvironment';

describe('OXY_SERVICE_ENVIRONMENTS', () => {
  it('lists exactly development, staging, production, in that order', () => {
    expect(OXY_SERVICE_ENVIRONMENTS).toEqual(['development', 'staging', 'production']);
  });
});
```

- [x] **Step 2: Run to verify it fails.**

Run: `cd ~/Oxy/OxyHQServices/packages/core && bun run test -- oxyServiceEnvironment`
Expected: FAIL — module does not exist.

- [x] **Step 3: Implement the shared environment module.**

```ts
// packages/core/src/utils/oxyServiceEnvironment.ts
/**
 * Environment segregation for Oxy service-token JWTs (test/live isolation).
 * Mirrors `ApplicationCredentialEnvironment` on the API's `ApplicationCredential`
 * model (`packages/api/src/models/ApplicationCredential.ts`) as an INDEPENDENT
 * literal union — `@oxyhq/core` has zero dependency on `@oxyhq/api`, so this is
 * kept in sync by hand, not by import.
 *
 * Defined here (not in `server/auth.ts` or `mixins/OxyServices.utility.ts`
 * directly) because BOTH of those files need it and neither may import from
 * the other: `server/` types import `express` (Node-only, a peer dependency
 * `mixins/` deliberately avoids so it stays safe to bundle into RN/browser
 * consumers — see the "Local request/response/socket typing" comment in
 * `OxyServices.utility.ts`). This file has zero imports, so both sides can
 * depend on it without crossing that boundary.
 */
export const OXY_SERVICE_ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type OxyServiceEnvironment = (typeof OXY_SERVICE_ENVIRONMENTS)[number];
```

- [x] **Step 4: Run to verify it passes.**

Run: `bun run test -- oxyServiceEnvironment`
Expected: PASS.

- [x] **Step 5: Extend `OxyServiceAppContext` in `server/auth.ts`.**

```ts
// packages/core/src/server/auth.ts — add near the top, after the existing imports
import { OXY_SERVICE_ENVIRONMENTS, type OxyServiceEnvironment } from '../utils/oxyServiceEnvironment';

export { OXY_SERVICE_ENVIRONMENTS };
export type { OxyServiceEnvironment };
```

Then modify the existing interface (`server/auth.ts:13-18`):

```ts
export interface OxyServiceAppContext {
  appId: string;
  appName: string;
  scopes: string[];
  credentialId: string;
  environment: OxyServiceEnvironment;
}
```

- [x] **Step 6: Export the new symbols from `server/index.ts`.** Add alongside the existing `OxyServiceAppContext` export block:

```ts
export {
  createOptionalOxyAuth,
  createOxyAuthMiddleware,
  getOxyUserId,
  getRequiredOxyUserId,
  isOxyAuthenticated,
  requireOxyAuth,
  OXY_SERVICE_ENVIRONMENTS,
} from './auth';
export type {
  OxyAuthenticatedRequest,
  OxyAuthMiddlewareOptions,
  OxyAuthRequest,
  OxyRequestUser,
  OxyServiceActingAsContext,
  OxyServiceAppContext,
  OxyServiceEnvironment,
} from './auth';
```

- [x] **Step 7: Run core's typecheck to confirm the type-only edit compiles** (nothing constructs an `OxyServiceAppContext` literal yet outside `OxyServices.utility.ts`, which Step 9 fixes next).

Run: `cd ~/Oxy/OxyHQServices/packages/core && bun run typecheck`
Expected: this will currently FAIL inside `OxyServices.utility.ts` only if it constructs an object typed as `OxyServiceAppContext` — it does not (it uses its own local `ServiceApp`, see Step 9), so this step should PASS. If it does not, stop and re-read `mixins/OxyServices.utility.ts` before continuing — do not guess.

- [x] **Step 8: Write the failing tests for the mixin-side verify path** (`mixins/__tests__/serviceAuth.test.ts`). First, update the shared `signServiceToken` helper's defaults so every EXISTING test in this file keeps passing once `environment` becomes a required claim — add `environment: 'production'` next to the existing `credentialId: 'cred-1'` default:

```ts
// mixins/__tests__/serviceAuth.test.ts — inside signServiceToken(), extend the
// default payload object (do not remove any existing default):
const signServiceToken = (claims: ServiceTokenClaims, secret: string): string => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: ServiceTokenClaims = {
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    type: 'service',
    aud: 'oxy-api',
    iss: 'oxy-auth',
    credentialId: 'cred-1',
    environment: 'production',
    ...claims,
  };
  ...
```

Also extend the `ServiceTokenClaims` interface at the top of the file:

```ts
interface ServiceTokenClaims {
  type?: string;
  appId?: string;
  appName?: string;
  scopes?: string[];
  aud?: string | string[];
  iss?: string;
  environment?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}
```

Then update the ONE existing assertion that breaks from the new field (`req.serviceApp` now carries `environment`, so the previous exact `.toEqual` needs it too — every other `serviceApp` assertion in the file uses `.toMatchObject`, which is unaffected):

```ts
    expect(req.serviceApp).toEqual({
      appId: 'app-1',
      appName: 'trusted-service',
      credentialId: 'cred-1',
      scopes: ['user:read'],
      environment: 'production',
    });
```

Now add three new tests in a new `describe` block at the end of the file:

```ts
describe('service-token environment claim (F2.0 task 1b)', () => {
  let oxy: OxyServices;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
  });

  it('populates req.serviceApp.environment from the token claim', async () => {
    const token = signServiceToken(
      { appId: 'app-1', appName: 'svc', environment: 'development' },
      SERVICE_SECRET,
    );
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = jest.fn();

    const mw = oxy.auth({ jwtSecret: SERVICE_SECRET });
    await mw(req as unknown as never, res as unknown as never, next as unknown as never);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.serviceApp).toMatchObject({ appId: 'app-1', environment: 'development' });
  });

  it('rejects a service token missing the environment claim (401)', async () => {
    const token = signServiceToken(
      { appId: 'app-1', appName: 'svc', environment: undefined },
      SERVICE_SECRET,
    );
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = jest.fn();

    const mw = oxy.auth({ jwtSecret: SERVICE_SECRET });
    await mw(req as unknown as never, res as unknown as never, next as unknown as never);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'INVALID_SERVICE_TOKEN' });
  });

  it('rejects a service token with an environment value outside the known set (401)', async () => {
    const token = signServiceToken(
      { appId: 'app-1', appName: 'svc', environment: 'bogus' },
      SERVICE_SECRET,
    );
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = jest.fn();

    const mw = oxy.auth({ jwtSecret: SERVICE_SECRET });
    await mw(req as unknown as never, res as unknown as never, next as unknown as never);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'INVALID_SERVICE_TOKEN' });
  });
});
```

- [x] **Step 9: Run to verify the new/updated tests fail.**

Run: `cd ~/Oxy/OxyHQServices/packages/core && bun run test -- serviceAuth`
Expected: FAIL — `req.serviceApp` has no `environment` field yet; the "missing"/"bogus" tests currently `next()` through unrejected (today those claims are ignored entirely).

- [x] **Step 10: Implement the verify-side changes in `mixins/OxyServices.utility.ts`.**

Import the shared module (top of file, alongside the existing imports):

```ts
import { OXY_SERVICE_ENVIRONMENTS, type OxyServiceEnvironment } from '../utils/oxyServiceEnvironment';
```

Extend `JwtPayload` (line 16-29):

```ts
interface JwtPayload {
  exp?: number;
  userId?: string;
  id?: string;
  sessionId?: string;
  type?: string;
  appId?: string;
  credentialId?: string;
  appName?: string;
  scopes?: string[];
  aud?: string | string[];
  iss?: string;
  environment?: string;
  [key: string]: unknown;
}
```

Extend `ServiceApp` (line 54-60):

```ts
export interface ServiceApp {
  appId: string;
  appName: string;
  scopes: string[];
  /** The credentialId of the specific service credential that minted this token. */
  credentialId: string;
  /** Test/live isolation (F2.0): which `ApplicationCredential.environment` minted this token. */
  environment: OxyServiceEnvironment;
}
```

Add a validator next to the existing sentinel error classes (after `ServiceTokenClaimError`, ~line 95):

```ts
function isOxyServiceEnvironment(value: unknown): value is OxyServiceEnvironment {
  return (
    typeof value === 'string' &&
    (OXY_SERVICE_ENVIRONMENTS as readonly string[]).includes(value)
  );
}
```

Extend the required-claims guard (`OxyServices.utility.ts:459-471`) to also require a valid `environment`:

```ts
            // Validate required service token fields
            const appId = decoded.appId;
            const credentialId = decoded.credentialId;
            const environment = decoded.environment;
            if (
              !appId ||
              typeof credentialId !== 'string' ||
              credentialId.length === 0 ||
              !isOxyServiceEnvironment(environment)
            ) {
              if (optional) {
                req.userId = null;
                req.user = null;
                return next();
              }
              const error = { error: 'INVALID_SERVICE_TOKEN', message: 'Invalid service token: missing required claims', code: 'INVALID_SERVICE_TOKEN', status: 401 };
              if (onError) return onError(error);
              return res.status(401).json(error);
            }
```

And populate it on `req.serviceApp` (`OxyServices.utility.ts:510-516`):

```ts
            req.accessToken = token;
            req.serviceApp = {
              appId,
              appName: decoded.appName || 'unknown',
              credentialId,
              scopes: Array.isArray(decoded.scopes) ? decoded.scopes : [],
              environment,
            };
```

- [x] **Step 11: Run to verify the tests pass.**

Run: `bun run test -- serviceAuth`
Expected: PASS, including the whole existing `serviceAuth.test.ts` suite (no other assertion touches `environment`).

- [x] **Step 12: Write the failing test for the mint side** (`packages/api/src/routes/__tests__/serviceTokenCredentials.test.ts`). Add `environment` to the credential stub and decode helper:

```ts
// serviceTokenCredentials.test.ts — extend StubCredential + stubCredential()
interface StubCredential {
  _id: { toString: () => string };
  publicKey: string;
  applicationId: { toString: () => string };
  type: string;
  environment: string;
  status: string;
  secretHash?: string;
  scopes: string[];
  expiresAt?: Date;
  lastUsedAt?: Date;
  save: jest.Mock;
}

function stubCredential(overrides: Partial<StubCredential> = {}): StubCredential {
  return {
    _id: { toString: () => CRED_ID },
    publicKey: API_KEY,
    applicationId: { toString: () => APP_ID },
    type: 'service',
    environment: 'production',
    status: 'active',
    secretHash: SECRET_HASH,
    scopes: ['user:read'],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function decodeServiceJwt(token: string): {
  type?: string;
  appId?: string;
  appName?: string;
  credentialId?: string;
  scopes?: string[];
  environment?: string;
  iss?: string;
  aud?: string | string[];
} {
  return jwt.verify(token, process.env.ACCESS_TOKEN_SECRET as string) as {
    type?: string;
    appId?: string;
    appName?: string;
    credentialId?: string;
    scopes?: string[];
    environment?: string;
    iss?: string;
    aud?: string | string[];
  };
}
```

Add a new test inside `describe('POST /auth/service-token — credential resolution + JWT claims (#215)', ...)`:

```ts
  it('embeds the credential environment and iss/aud claims in the minted JWT', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(stubCredential({ environment: 'development' }));

    const res = await requestJson(server, 'POST', '/auth/service-token', {
      apiKey: API_KEY,
      apiSecret: PLAINTEXT_SECRET,
    });

    expect(res.status).toBe(200);
    const claims = decodeServiceJwt(res.body.data?.token as string);
    expect(claims.environment).toBe('development');
    expect(claims.iss).toBe('oxy-auth');
    expect(claims.aud).toBe('oxy-api');
  });
```

- [x] **Step 13: Run to verify it fails.**

Run: `cd ~/Oxy/OxyHQServices/packages/api && bun run test -- serviceTokenCredentials`
Expected: FAIL — `claims.environment`/`claims.iss`/`claims.aud` are all `undefined` today.

- [x] **Step 14: Implement the mint-side change** (`packages/api/src/routes/auth.ts:2435-2445`):

```ts
  // Generate stateless service JWT — embed granted scopes so downstream
  // middleware can do per-scope authorisation without an extra DB lookup. The
  // `appId` claim is the Application `_id` (UNCHANGED claim name — see contract
  // §5). `credentialId` is the specific ApplicationCredential `_id` that minted
  // this token. `environment` (F2.0) mirrors the minting credential's own
  // `ApplicationCredential.environment` so downstream services (e.g. the Oxy
  // Pay Gateway) can enforce test/live isolation without a second DB lookup.
  // `issuer`/`audience` MUST match what `@oxyhq/core`'s `oxy.auth()` /
  // `oxy.serviceAuth()` verifies against (`OXY_JWT_ISSUER`/`OXY_JWT_AUDIENCE`
  // in `OxyServices.utility.ts`) — omitting them left every real service token
  // unverifiable by any external consumer of the SDK (see Task 2's header note).
  const appScopes = app.scopes ?? [];
  const scopes =
    credential.scopes.length > 0 ? intersectScopes(credential.scopes, appScopes) : appScopes;
  const token = jwt.sign(
    {
      type: 'service',
      appId: app._id.toString(),
      appName: app.name,
      credentialId: credential._id.toString(),
      scopes,
      environment: credential.environment,
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: SERVICE_TOKEN_EXPIRY, issuer: 'oxy-auth', audience: 'oxy-api' }
  );
```

- [x] **Step 15: Run to verify it passes, then run the whole api service-token suite for regressions.**

Run: `bun run test -- serviceTokenCredentials`
Expected: PASS, all existing tests in the file still PASS (none asserted the previous absence of `iss`/`aud`/`environment`).

- [x] **Step 16: Run both packages' full test suites.**

Run: `cd ~/Oxy/OxyHQServices && bun run --filter @oxyhq/core test && bun run --filter @oxyhq/api test`
Expected: PASS (core baseline 722 + 4 new; api baseline 1322 + 1 new, per the counts in this repo's `AGENTS.md`).

- [x] **Step 17: Commit.**

```bash
cd ~/Oxy/OxyHQServices
git add packages/core/src/utils/oxyServiceEnvironment.ts \
  packages/core/src/utils/__tests__/oxyServiceEnvironment.test.ts \
  packages/core/src/server/auth.ts packages/core/src/server/index.ts \
  packages/core/src/mixins/OxyServices.utility.ts \
  packages/core/src/mixins/__tests__/serviceAuth.test.ts \
  packages/api/src/routes/auth.ts \
  packages/api/src/routes/__tests__/serviceTokenCredentials.test.ts
git commit -m "feat(core,api): carry environment on the service-token JWT; fix missing iss/aud claims"
```

---

### Task 3: [Publish gate] Publish `@oxyhq/core`, verify propagation, bump the Gateway's dependency

> ✅ **DONE (PUBLISH GATE)** — Published `@oxyhq/core@12.8.0` (OxyHQServices main `8f61164a`), propagation verified (OXY_SERVICE_ENVIRONMENTS from /server). Gateway dep bumped `c0813f6`. 2026-07-19.

> **This task blocks every remaining task in this plan.** Nothing below it may be implemented before this lands — `Merchant.environment`, `resolveMerchant()`, and every new route type-check against `OxyServiceEnvironment`/`req.serviceApp.environment`, which only exist in the published package after this step.

**Files:**
- Modify: `~/Oxy/OxyHQServices/packages/core/package.json` (version bump)
- Modify: `~/Oxy/OxyPay/packages/backend/package.json`, `~/Oxy/OxyPay/package.json` (dependency bump)
- Modify: `~/Oxy/OxyPay/bun.lock`

**Interfaces:**
- Consumes: Task 2's committed-and-pushed `@oxyhq/core` source.
- Produces: a published `@oxyhq/core@<new-version>` on npm that the Gateway can `bun add`.

- [x] **Step 1: Confirm Task 2 is committed AND pushed to `main`** before publishing — an out-of-band publish from uncommitted/unpushed work collides with the committed release later and permanently burns the version number.

Run: `cd ~/Oxy/OxyHQServices && git status --short && git log --oneline -1 origin/main..HEAD`
Expected: clean working tree; the commit from Task 2 is present in `origin/main` (push it now if it is only local).

- [x] **Step 2: Invoke the `publish` skill for `@oxyhq/core`** (per this workspace's standard flow: version bump + `bun publish`, verify propagation, then bump every downstream consumer). This is an additive change (new optional-to-construct field on an exported interface, new exports) — bump the MINOR version.

Run: `cd ~/Oxy/OxyHQServices/packages/core && bun run build && npm version minor --no-git-tag-version`

Note the resulting version (referred to below as `<new-version>`, e.g. `12.8.0`).

- [x] **Step 3: Publish.**

Run: `cd ~/Oxy/OxyHQServices/packages/core && bun publish`
Expected: publish succeeds; `bun info @oxyhq/core version` (run after a short wait) returns `<new-version>`.

- [x] **Step 4: Verify propagation with a clean external install** (not a workspace symlink — a real `bun add` in an empty scratch dir, per this workspace's publish convention).

```bash
mkdir -p /tmp/oxy-core-verify && cd /tmp/oxy-core-verify
bun init -y >/dev/null
bun add @oxyhq/core@<new-version>
node -e "console.log(require('@oxyhq/core/package.json').version)"
```

Expected: prints `<new-version>`.

- [x] **Step 5: Commit the version bump in OxyHQServices.**

```bash
cd ~/Oxy/OxyHQServices
git add packages/core/package.json
git commit -m "chore(core): release <new-version> — service-token environment claim"
git push origin main
```

- [x] **Step 6: Bump the Gateway's `@oxyhq/core` dependency.** In `~/Oxy/OxyPay`, update BOTH the backend package and the root `overrides` pin (`OxyPay/package.json:31` already pins `@oxyhq/core` via `overrides` — keep it in lockstep with the dependency range or `bun install` will report a mismatch):

```json
// packages/backend/package.json
    "@oxyhq/core": "^<new-version>",
```

```json
// package.json (root) — both the dependency and the override
  "overrides": {
    "@oxyhq/core": "<new-version>",
    ...
  },
  "dependencies": {
    "@oxyhq/core": "^<new-version>"
```

- [x] **Step 7: Reinstall and regenerate the lockfile.**

Run: `cd ~/Oxy/OxyPay && bun install`
Expected: `bun.lock` updates; `@oxyhq/core` resolves to `<new-version>` everywhere.

- [x] **Step 8: Verify the Gateway typechecks against the new version** (no Gateway code reads `environment` yet — this only proves the bump itself is clean).

Run: `bun run --filter @oxypay/backend typecheck`
Expected: PASS.

- [x] **Step 9: Commit.**

```bash
cd ~/Oxy/OxyPay
git add package.json packages/backend/package.json bun.lock
git commit -m "chore(gateway): bump @oxyhq/core to <new-version> (service-token environment claim)"
```

---

### Task 4: [Gateway] Wire a real `jwtSecret` into `oxyClient.serviceAuth()` — fixes a second, independently-verified broken-auth defect

> ✅ **DONE** — commit `46e845a`; task-review clean. Fixed 2nd auth defect (serviceAuth() had no jwtSecret). ⚠️ INFRA TODO: provision OXY_ACCESS_TOKEN_SECRET in gateway ECS/SSM = oxy-api ACCESS_TOKEN_SECRET, else no effect. 2026-07-19.

> **Independently-verified pre-existing defect (not in the original spec's task list — flag for confirmation):** `paymentIntents.ts:111` calls `oxyClient.serviceAuth()` with **zero options**. Per `OxyServices.utility.ts:365-380`, when `jwtSecret` is omitted, EVERY service-token request is rejected with `403 SERVICE_TOKEN_NOT_CONFIGURED` — the secure default, but it means the Gateway's merchant auth has never actually verified a real token in any deployed environment. Combined with the missing `iss`/`aud` claims fixed in Task 2, this is the second of two independent reasons `oxyClient.serviceAuth()` has never worked end-to-end for the Gateway. Fixing it here (rather than leaving `paymentIntents.ts`'s bare fallback in place) is also the natural moment to tighten `createPaymentIntentsRouter`'s signature so a caller can no longer silently reach that broken bare default at all.

**Files:**
- Modify: `packages/backend/src/config.ts`
- Create: `packages/backend/src/__tests__/config.test.ts`
- Modify: `packages/backend/src/routes/paymentIntents.ts` (make `requireMerchant` a required dependency)
- Modify: `packages/backend/src/server.ts` (compute the real default once, here)
- Create: `packages/backend/src/routes/__tests__/serviceAuthWiring.test.ts`

**Interfaces:**
- Produces: `AppConfig.serviceJwtSecret: string | undefined`; `createPaymentIntentsRouter(deps: { requireMerchant: RequestHandler })` (was `deps?: { requireMerchant?: RequestHandler }`).
- Consumes: `@oxyhq/core`'s `oxyClient.serviceAuth({ jwtSecret })` (Task 3).

- [x] **Step 1: Write the failing test for the new config field.**

```ts
// packages/backend/src/__tests__/config.test.ts
import { test, expect } from "bun:test";
import { loadConfig } from "../config";

test("serviceJwtSecret reads OXY_ACCESS_TOKEN_SECRET", () => {
  expect(loadConfig({ OXY_ACCESS_TOKEN_SECRET: "shh" }).serviceJwtSecret).toBe("shh");
});

test("serviceJwtSecret is undefined when unset (never silently defaults)", () => {
  expect(loadConfig({}).serviceJwtSecret).toBeUndefined();
});

test("serviceJwtSecret trims to undefined on an empty string", () => {
  expect(loadConfig({ OXY_ACCESS_TOKEN_SECRET: "   " }).serviceJwtSecret).toBeUndefined();
});
```

- [x] **Step 2: Run to verify it fails.**

Run: `cd ~/Oxy/OxyPay && bun test packages/backend/src/__tests__/config.test.ts`
Expected: FAIL — `serviceJwtSecret` does not exist on `AppConfig`.

- [x] **Step 3: Implement the config field.** In `config.ts`, add to `AppConfig`:

```ts
export interface AppConfig {
  /** Base URL of the FairCoin block explorer (no trailing slash). */
  explorerBaseUrl: string;
  /** Network the gateway operates on (`mainnet` | `testnet`). */
  network: NetworkType;
  /** MongoDB connection string. */
  mongodbUri: string;
  /** HTTP port the API listens on. */
  port: number;
  /**
   * Exact browser origins allowed to open a realtime Socket.io connection
   * (comma-separated `OXY_PAY_ALLOWED_ORIGINS`). Requests with no `Origin`
   * (native apps / server-to-server) are always allowed; an arbitrary browser
   * origin is NEVER reflected — it must be listed here. The connection is still
   * gated by `authSocket()` and per-intent `client_secret`.
   */
  allowedOrigins: string[];
  /**
   * HMAC secret used to verify Oxy service-token JWTs presented by merchants
   * (`Authorization: Bearer <token>`). MUST equal the value oxy-api signs
   * service tokens with (`ACCESS_TOKEN_SECRET` in `OxyHQServices/packages/api`)
   * — a cross-service SHARED secret, provisioned out of band (SSM), not
   * generated by the Gateway. `undefined` when not yet provisioned: every real
   * service-token request then 403s (`SERVICE_TOKEN_NOT_CONFIGURED`) instead of
   * silently accepting an unverified token.
   */
  serviceJwtSecret: string | undefined;
}
```

Add the reader helper (next to `readNonEmpty`):

```ts
function readOptional(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value === "" ? undefined : value;
}
```

Add the field to `loadConfig`'s return value:

```ts
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  return {
    explorerBaseUrl: readNonEmpty(
      env.EXPLORER_BASE_URL,
      DEFAULT_EXPLORER_BASE_URL,
    ),
    network: readNetwork(env.OXYPAY_NETWORK),
    mongodbUri: readNonEmpty(env.MONGODB_URI, DEFAULT_MONGODB_URI),
    port: readPort(env.PORT),
    allowedOrigins: readOrigins(env.OXY_PAY_ALLOWED_ORIGINS),
    serviceJwtSecret: readOptional(env.OXY_ACCESS_TOKEN_SECRET),
  };
}
```

- [x] **Step 4: Run to verify it passes.**

Run: `bun test packages/backend/src/__tests__/config.test.ts`
Expected: PASS.

- [x] **Step 5: Tighten `createPaymentIntentsRouter`'s signature and remove the broken bare fallback.** In `routes/paymentIntents.ts`, change:

```ts
export function createPaymentIntentsRouter(deps?: {
  requireMerchant?: RequestHandler;
}): Router {
  const requireMerchant: RequestHandler =
    deps?.requireMerchant ?? oxyClient.serviceAuth();
  const router = Router();
```

to:

```ts
export function createPaymentIntentsRouter(deps: {
  requireMerchant: RequestHandler;
}): Router {
  const { requireMerchant } = deps;
  const router = Router();
```

(Every existing call site already passes `requireMerchant` explicitly — `routes.test.ts:100`, `e2e.test.ts:97`, and `server.ts`'s own call, updated in Step 6 below — so this is a pure signature tightening, no behavior change at any existing call site.)

- [x] **Step 6: Compute the real production default once, in `server.ts`.** Change `createGateway`:

```ts
export function createGateway(deps: GatewayDeps = {}): Gateway {
  const app = express();

  // Unauthenticated liveness probe for the ALB target-group health check.
  // Mounted first so it is never CORS-blocked or rate-limited, and returns 200
  // regardless of auth (every other route is auth-gated). It reveals nothing.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(createOxyCors());
  app.use(createOxyRateLimit(oxyClient));
  app.use(express.json());
  app.use(((_req, res, next) => {
    res.setHeader("Oxy-Pay-Version", OXY_PAY_VERSION);
    next();
  }) as RequestHandler);

  const requireMerchant: RequestHandler =
    deps.requireMerchant ?? oxyClient.serviceAuth({ jwtSecret: config.serviceJwtSecret });

  app.use(createPaymentIntentsRouter({ requireMerchant }));
```

`config` is already imported at the top of `server.ts` (`import { config } from "./config";`) — no new import needed.

- [x] **Step 7: Write the integration test proving the wiring actually works with a genuinely HMAC-signed token** (not the test stub — this is the whole point of this task).

```ts
// packages/backend/src/routes/__tests__/serviceAuthWiring.test.ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { oxyClient } from "@oxyhq/core";
import { loadConfig } from "../../config";
import { Merchant } from "../../models/Merchant";
import { PaymentIntent } from "../../models/PaymentIntent";
import { createPaymentIntentsRouter } from "../paymentIntents";

// Real TESTNET account xpub for the canonical all-"abandon" + "art" mnemonic —
// public-key-only, cannot spend. Same fixture used across the rest of the suite.
const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";
const TEST_SECRET = "gateway-wiring-test-secret";
const APP_ID = "app_wiring";

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Mints an HS256 JWT byte-identical in shape to what `POST /auth/service-token`
// (OxyHQServices `routes/auth.ts`) produces post-Task-2: `type`, `iss`, `aud`,
// `environment` all present.
function signRealServiceToken(claims: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    type: "service",
    iss: "oxy-auth",
    aud: "oxy-api",
    credentialId: "cred_wiring",
    environment: "development",
    ...claims,
  };
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${headerB64}.${payloadB64}.${signature}`;
}

let mongod: MongoMemoryServer;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Merchant.init();
  await PaymentIntent.init();
  await Merchant.create({
    oxyAppId: APP_ID,
    network: "testnet",
    xpub: XPUB,
  });

  const config = loadConfig({ OXY_ACCESS_TOKEN_SECRET: TEST_SECRET });
  const requireMerchant = oxyClient.serviceAuth({ jwtSecret: config.serviceJwtSecret });

  const app = express();
  app.use(express.json());
  app.use(createPaymentIntentsRouter({ requireMerchant }));
  server = app.listen(0);
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await mongoose.disconnect();
  await mongod.stop();
});

test("a genuinely HMAC-signed service token minted with the configured secret is accepted", async () => {
  const token = signRealServiceToken({ appId: APP_ID, appName: "wiring-test" }, TEST_SECRET);
  const res = await fetch(`${baseUrl}/v1/payment_intents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "wiring-1",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ amount: "1000000", network: "testnet" }),
  });
  expect(res.status).toBe(201);
});

test("a token signed with the WRONG secret is rejected (401) — proves jwtSecret is really wired, not bypassed", async () => {
  const token = signRealServiceToken({ appId: APP_ID, appName: "wiring-test" }, "some-other-secret");
  const res = await fetch(`${baseUrl}/v1/payment_intents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "wiring-2",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ amount: "1000000", network: "testnet" }),
  });
  expect(res.status).toBe(401);
});

test("no Authorization header at all is rejected (401), the endpoint is not silently open", async () => {
  const res = await fetch(`${baseUrl}/v1/payment_intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "wiring-3" },
    body: JSON.stringify({ amount: "1000000", network: "testnet" }),
  });
  expect(res.status).toBe(401);
});
```

- [x] **Step 8: Run to verify it fails first** (checkout the test file alone against the PRE-Step-6 `server.ts`/`paymentIntents.ts` mentally is not possible since Step 5/6 already landed in this same task — instead, verify by TEMPORARILY reverting `paymentIntents.ts`'s signature change is unnecessary; the meaningful failing-first proof here is that this exact test, run against the ORIGINAL bare `oxyClient.serviceAuth()` default from before this task, would 403 on every request. Confirm this by running the new test file now, after Steps 3-6, and separately confirming Task 2/3 are the reason it passes — i.e. run it once more with `TEST_SECRET` intentionally mismatched against what `signRealServiceToken` used, to reconfirm the negative case still fails closed):

Run: `bun test packages/backend/src/routes/__tests__/serviceAuthWiring.test.ts`
Expected: all three PASS (this test is written after the fix; its value is that test 2 and test 3 prove the positive case in test 1 is not a false pass from a permissive fallback).

- [x] **Step 9: Run the full backend suite for regressions** (the `createPaymentIntentsRouter` signature tightening must not break any existing caller).

Run: `bun test packages/backend/src`
Expected: all PASS.

- [x] **Step 10: Commit.**

```bash
cd ~/Oxy/OxyPay
git add packages/backend/src/config.ts packages/backend/src/__tests__/config.test.ts \
  packages/backend/src/routes/paymentIntents.ts packages/backend/src/server.ts \
  packages/backend/src/routes/__tests__/serviceAuthWiring.test.ts
git commit -m "fix(gateway): actually wire a jwtSecret into oxyClient.serviceAuth() (was silently rejecting every real token)"
```

> **Deployment note (not a code task — flag for infra):** `OXY_ACCESS_TOKEN_SECRET` must be provisioned in the Gateway's ECS task with the SAME value as oxy-api's `ACCESS_TOKEN_SECRET` (SSM `/oxy/oxy-api/ACCESS_TOKEN_SECRET`), e.g. duplicated to `/oxy/oxypay/OXY_ACCESS_TOKEN_SECRET`. Out of scope for this plan (infra/secrets provisioning, not Gateway code) — call out explicitly rather than silently assume it exists.

---

### Task 5: [Upstream, OxyHQServices] Add `payments:read` / `payments:write` scopes

> ✅ **DONE** — payments:read/write scopes; task-review clean. Merged→OxyHQServices main `ee506255` (deploys from source, no npm). 2026-07-19.

**Files:**
- Modify: `~/Oxy/OxyHQServices/packages/api/src/utils/applicationScopes.ts:27-40`
- Modify: `~/Oxy/OxyHQServices/packages/api/src/utils/__tests__/applicationScopes.test.ts`

**Interfaces:**
- Produces: `'payments:read'` and `'payments:write'` added to `APPLICATION_SCOPES` (and therefore to `ApplicationScope`, the `Application`/`ApplicationCredential` Mongoose enums, and the Zod schemas that import `APPLICATION_SCOPES` — all derive from this one array, no other file needs editing). NOT added to `PRIVILEGED_APPLICATION_SCOPES` (self-grantable, authority scoped to the app's own tenant, same pattern as `files:write`/`updates:publish`).

- [x] **Step 1: Write the failing test.** Add to `applicationScopes.test.ts`:

```ts
describe('payments:read / payments:write (F2.0)', () => {
  it('are recognised, non-privileged application scopes', () => {
    expect(isValidApplicationScope('payments:read')).toBe(true);
    expect(isValidApplicationScope('payments:write')).toBe(true);
    expect(isPrivilegedScope('payments:read')).toBe(false);
    expect(isPrivilegedScope('payments:write')).toBe(false);
  });

  it('survive intersectScopes like any other non-privileged scope', () => {
    expect(intersectScopes(['payments:write'], ['payments:write', 'user:read'])).toEqual([
      'payments:write',
    ]);
  });
});
```

- [x] **Step 2: Run to verify it fails.**

Run: `cd ~/Oxy/OxyHQServices/packages/api && bun run test -- applicationScopes`
Expected: FAIL — `isValidApplicationScope('payments:read')` is `false` today.

- [x] **Step 3: Add the scopes.** In `applicationScopes.ts`, extend `APPLICATION_SCOPES`:

```ts
export const APPLICATION_SCOPES = [
  'files:read',
  'files:write',
  'files:delete',
  'user:read',
  'webhooks:receive',
  'chat:completions',
  'models:read',
  'updates:publish',
  'federation:write',
  'signals:write',
  'reputation:write',
  'notifications:write',
  'payments:read',
  'payments:write',
] as const;
```

Update the file's top doc-comment to document the new scopes alongside the existing ones (non-privileged, so no entry needed in the privileged-scope list's own doc-comment):

```ts
 * - `payments:read` / `payments:write` permit a service credential to read and
 *   manage the Oxy Pay Gateway resources (merchants, payment intents, webhook
 *   deliveries) belonging to ITS OWN Application. Non-privileged — same
 *   pattern as `files:write`/`updates:publish`: authority is scoped to the
 *   app's own tenant, never cross-tenant.
```

- [x] **Step 4: Run to verify it passes, then the full api scope test file.**

Run: `bun run test -- applicationScopes`
Expected: PASS, all existing tests in the file unaffected (additive change to a `const` array).

- [x] **Step 5: Commit.**

```bash
cd ~/Oxy/OxyHQServices
git add packages/api/src/utils/applicationScopes.ts packages/api/src/utils/__tests__/applicationScopes.test.ts
git commit -m "feat(api): add payments:read / payments:write application scopes"
git push origin main
```

> No publish gate needed here — `@oxyhq/api` deploys directly from source (ECS build), it is not an npm package the Gateway installs.

---

### Task 6: [Gateway] `Merchant.environment` + compound unique index; `resolveMerchant()` environment-aware; extract `lib/http.ts`

> ✅ **DONE** — commit `264d1437`; task-review clean (Spec ✅ / Approved, 0 issues). Old oxyAppId-unique index removed → compound {oxyAppId,environment}; non-custody firewall verified byte-identical. 2026-07-19.

**Files:**
- Create: `packages/backend/src/lib/http.ts`
- Modify: `packages/backend/src/models/Merchant.ts`
- Modify: `packages/backend/src/routes/paymentIntents.ts`
- Modify: `packages/backend/src/models/__tests__/models.test.ts`
- Modify: `packages/backend/src/routes/__tests__/routes.test.ts`
- Modify: `packages/backend/src/services/__tests__/settlementWatcher.test.ts`
- Modify: `packages/backend/src/__tests__/e2e.test.ts`
- Modify: `packages/backend/src/routes/__tests__/serviceAuthWiring.test.ts` (the file Task 4 just created)

**Interfaces:**
- Consumes: `req.serviceApp.environment: OxyServiceEnvironment` (Task 2/3, published `@oxyhq/core`).
- Produces: `MerchantDoc.environment: OxyServiceEnvironment`; `resolveMerchant(req, res)` — now **exported** from `paymentIntents.ts` (Task 8/9 reuse it) — resolves `Merchant.findOne({ oxyAppId, environment })`; `lib/http.ts` exports `sendError`, `wrap`, `isDuplicateKeyError`, `requireServiceApp`.

- [x] **Step 1: Write the failing model-level test for the compound index** (`models/__tests__/models.test.ts` — append a new `test`, after the existing ones):

```ts
test("two Merchant docs with the same oxyAppId but different environment coexist", async () => {
  await Merchant.create({
    oxyAppId: "app_env_split",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
  });
  const prod = await Merchant.create({
    oxyAppId: "app_env_split",
    environment: "production",
    network: "mainnet",
    xpub: XPUB,
  });
  expect(prod.environment).toBe("production");

  const count = await Merchant.countDocuments({ oxyAppId: "app_env_split" });
  expect(count).toBe(2);
});

test("the SAME oxyAppId + environment pair collides (compound unique index)", async () => {
  await Merchant.create({
    oxyAppId: "app_env_dup",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
  });
  const dup = Merchant.create({
    oxyAppId: "app_env_dup",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
  });
  await expect(dup).rejects.toThrow();
});
```

- [x] **Step 2: Run to verify it fails** (the "coexist" test currently fails validation with a required-field error on `environment`, or if `environment` isn't yet required, fails the OLD single-field-unique `oxyAppId` index on the second insert).

Run: `cd ~/Oxy/OxyPay && bun test packages/backend/src/models/__tests__/models.test.ts -t "environment"`
Expected: FAIL.

- [x] **Step 3: Update Merchant's schema.** In `models/Merchant.ts`, add the import and extend the doc/schema:

```ts
import { Schema, model } from "mongoose";
import type { CallbackError, HydratedDocument } from "mongoose";
import { getNetwork } from "@fairco.in/core";
import type { NetworkType } from "@fairco.in/core";
import { OXY_SERVICE_ENVIRONMENTS } from "@oxyhq/core/server";
import type { OxyServiceEnvironment } from "@oxyhq/core/server";
import { deriveIntentAddress } from "../services/derivation";

/**
 * A merchant of the Oxy Pay Gateway. The non-custody firewall means this doc
 * holds ONLY a watch-only account `xpub` (public keys → cannot spend) — there
 * is deliberately NO field for a private key, mnemonic, or seed, and the
 * pre-validate hook refuses any private extended key handed in as `xpub`.
 */
export interface MerchantDoc {
  oxyAppId: string;
  /**
   * Test/live isolation (F2.0): mirrors the `ApplicationCredential.environment`
   * that authenticated the call that registered this merchant. One `oxyAppId`
   * may have at most ONE `Merchant` per environment (compound unique index
   * below) — `resolveMerchant()` always resolves by BOTH fields together.
   */
  environment: OxyServiceEnvironment;
  network: NetworkType;
  xpub: string;
  nextDerivationIndex: number;
  webhookUrl?: string;
  webhookSecret?: string;
  requiredConfirmations: number;
  livemode: boolean;
}

const merchantSchema = new Schema<MerchantDoc>(
  {
    oxyAppId: { type: String, required: true },
    environment: { type: String, enum: OXY_SERVICE_ENVIRONMENTS, required: true },
    network: { type: String, enum: ["mainnet", "testnet"], required: true },
    xpub: { type: String, required: true },
    nextDerivationIndex: { type: Number, default: 0 },
    webhookUrl: { type: String },
    webhookSecret: { type: String },
    requiredConfirmations: { type: Number, default: 1 },
    livemode: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Test/live isolation (F2.0 task 1b): one Application (oxyAppId) may register
// at most one Merchant PER environment — a development-credential merchant and
// a production-credential merchant for the same app are distinct documents.
merchantSchema.index({ oxyAppId: 1, environment: 1 }, { unique: true });
```

(The `pre('validate')` non-custody firewall and the `export const Merchant = model(...)` line at the bottom are unchanged.)

- [x] **Step 4: Run to verify the model test passes.**

Run: `bun test packages/backend/src/models/__tests__/models.test.ts -t "environment"`
Expected: PASS.

- [x] **Step 5: Update the OTHER three existing `Merchant.create()` calls in `models.test.ts`** — `environment` is now required, so every fixture needs it:

```ts
// "saves a Merchant with a watch-only testnet xpub" — add environment
  const merchant = await Merchant.create({
    oxyAppId: "app_watch_only_ok",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://example.test/webhook",
    webhookSecret: "whsec_test",
  });
```

```ts
// "rejects a Merchant whose xpub is a private xprv (non-custody firewall)" — add environment
  const attempt = Merchant.create({
    oxyAppId: "app_private_xprv_rejected",
    environment: "development",
    network: "testnet",
    xpub: xprv,
  });
```

```ts
// "reserveNextAddress claims monotonically increasing indexes..." — add environment
  const merchant = await Merchant.create({
    oxyAppId: "app_reserve_addresses",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
  });
```

- [x] **Step 6: Extract `lib/http.ts`** from `paymentIntents.ts`'s current locally-defined helpers:

```ts
// packages/backend/src/lib/http.ts
import type { NextFunction, Request, Response, RequestHandler } from "express";
import type { OxyAuthRequest, OxyServiceEnvironment } from "@oxyhq/core/server";

const MONGO_DUPLICATE_KEY = 11000;

/** Stripe-ish error envelope: `{ error: { type, message } }`. */
export function sendError(
  res: Response,
  status: number,
  type: string,
  message: string,
): void {
  res.status(status).json({ error: { type, message } });
}

// Express 4 does not forward rejected promises to the error handler, so wrap
// each async handler and route any rejection to `next`.
type AsyncHandler = (req: Request, res: Response) => Promise<void>;
export function wrap(handler: AsyncHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

export function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === MONGO_DUPLICATE_KEY
  );
}

export interface ResolvedServiceApp {
  appId: string;
  environment: OxyServiceEnvironment;
}

/**
 * Extract the authenticated service app's identity + environment from
 * `req.serviceApp` (populated by `oxyClient.serviceAuth()` or the optional
 * variant). Returns null AND writes a 401 when absent, so callers just
 * `if (!serviceApp) return`.
 */
export function requireServiceApp(req: Request, res: Response): ResolvedServiceApp | null {
  const { serviceApp } = req as OxyAuthRequest;
  if (!serviceApp?.appId || !serviceApp.environment) {
    sendError(res, 401, "authentication_error", "missing service app credentials");
    return null;
  }
  return { appId: serviceApp.appId, environment: serviceApp.environment };
}
```

- [x] **Step 7: Rewrite `resolveMerchant()` in `paymentIntents.ts` to be environment-aware, exported, and to use the extracted helpers.** Replace the import block's local helper definitions (`sendError`, `wrap`, `isDuplicateKeyError`, the whole `resolveMerchant` function) as follows.

Remove from `paymentIntents.ts` (now living in `lib/http.ts`): the `sendError` function, the `AsyncHandler` type + `wrap` function, and the `isDuplicateKeyError` function.

Update the imports at the top of `paymentIntents.ts`:

```ts
import { Router } from "express";
import type {
  Request,
  RequestHandler,
  Response,
} from "express";
import type { HydratedDocument } from "mongoose";
import { z } from "zod";
import { oxyClient } from "@oxyhq/core";
import { verifySecret } from "@oxyhq/core/server";
import {
  isBaseUnitString,
  type CreatePaymentIntentParams,
  type PaymentIntentStatus,
} from "@oxypay/shared-types";
import { Merchant } from "../models/Merchant";
import type { MerchantDoc } from "../models/Merchant";
import { PaymentIntent } from "../models/PaymentIntent";
import { reserveNextAddress } from "../services/reserveAddress";
import { newId, clientSecretFor } from "../lib/ids";
import { applyEvent } from "../services/intentState";
import { toPaymentIntentDTO } from "../lib/serialize";
import { sendError, wrap, isDuplicateKeyError, requireServiceApp } from "../lib/http";
```

(`NextFunction` is no longer used directly in this file since `wrap` moved out; `OxyAuthRequest` is no longer referenced directly either, since `requireServiceApp` owns that cast now.)

Replace `resolveMerchant`:

```ts
/**
 * Resolve the merchant behind the authenticated service app, scoped to BOTH
 * the caller's Application AND its credential's `environment` (F2.0 task 1b —
 * test/live isolation). Returns null AND writes the error response when the
 * caller is unauthenticated (401) or the app has no merchant registered for
 * this specific environment (403), so callers just `if (!merchant) return`.
 *
 * Exported: `routes/merchants.ts` reuses this unchanged for the merchant-authed
 * GET/PATCH `/v1/merchants/me` routes.
 */
export async function resolveMerchant(
  req: Request,
  res: Response,
): Promise<HydratedDocument<MerchantDoc> | null> {
  const serviceApp = requireServiceApp(req, res);
  if (!serviceApp) return null;
  const merchant = await Merchant.findOne({
    oxyAppId: serviceApp.appId,
    environment: serviceApp.environment,
  });
  if (!merchant) {
    sendError(res, 403, "permission_error", "no merchant registered for this app");
    return null;
  }
  return merchant;
}
```

- [x] **Step 8: Add `environment` to the two test stubs in `routes/__tests__/routes.test.ts` and `__tests__/e2e.test.ts`, and to the fixture Merchant docs they create.**

```ts
// routes/__tests__/routes.test.ts — stubRequireMerchant
const stubRequireMerchant: RequestHandler = (req, _res, next) => {
  (req as OxyAuthRequest).serviceApp = {
    appId: TEST_APP_ID,
    appName: "t",
    scopes: [],
    credentialId: "c",
    environment: "development",
  };
  next();
};
```

```ts
// routes/__tests__/routes.test.ts — beforeAll's Merchant.create
  await Merchant.create({
    oxyAppId: TEST_APP_ID,
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://example.test/webhook",
    webhookSecret: "whsec_test",
  });
```

```ts
// __tests__/e2e.test.ts — stubRequireMerchant
const stubRequireMerchant: RequestHandler = (req, _res, next) => {
  (req as OxyAuthRequest).serviceApp = {
    appId: APP_ID,
    appName: "e2e",
    scopes: [],
    credentialId: "c",
    environment: "development",
  };
  next();
};
```

```ts
// __tests__/e2e.test.ts — beforeAll's Merchant.create
  await Merchant.create({
    oxyAppId: APP_ID,
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://merchant.example/oxypay/webhook",
    webhookSecret: WEBHOOK_SECRET,
    requiredConfirmations: 1,
  });
```

- [x] **Step 9: Add `environment` to the two `Merchant.create()` calls in `services/__tests__/settlementWatcher.test.ts`** (this file never routes through `resolveMerchant`, but `environment` is now a required schema field on every `Merchant.create()` call regardless):

```ts
// "advances a paid intent broadcast → confirming → settled..."
  const merchant = await Merchant.create({
    oxyAppId: "app_settle",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
  });
```

```ts
// "marks an under-value payment as failed"
  const merchant = await Merchant.create({
    oxyAppId: "app_under",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
  });
```

- [x] **Step 10: Add `environment` to the fixture Merchant created in `serviceAuthWiring.test.ts`** (created by Task 4, before this task's schema change landed):

```ts
  await Merchant.create({
    oxyAppId: APP_ID,
    environment: "development",
    network: "testnet",
    xpub: XPUB,
  });
```

- [x] **Step 11: Run the full backend suite.**

Run: `cd ~/Oxy/OxyPay && bun test packages/backend/src`
Expected: all PASS. If `serviceAuthWiring.test.ts` fails, confirm its signed token's `environment: "development"` claim (already present from Task 4's Step 7) matches the fixture Merchant's `environment: "development"` added in Step 10 above — `resolveMerchant()` now requires both to agree.

- [x] **Step 12: Commit.**

```bash
git add packages/backend/src/lib/http.ts packages/backend/src/models/Merchant.ts \
  packages/backend/src/routes/paymentIntents.ts \
  packages/backend/src/models/__tests__/models.test.ts \
  packages/backend/src/routes/__tests__/routes.test.ts \
  packages/backend/src/services/__tests__/settlementWatcher.test.ts \
  packages/backend/src/__tests__/e2e.test.ts \
  packages/backend/src/routes/__tests__/serviceAuthWiring.test.ts
git commit -m "feat(gateway): environment-scoped Merchant resolution (test/live isolation)"
```

---

### Task 7: [Gateway] Extend `newId()` for `merch_`, `link_`, `cs_`

> ✅ **DONE** — commit `6e5f526`; 7/7 tests, controller-verified diff (union + 3 format tests, no scope creep). 2026-07-19.

> Sequenced here (ahead of the literal spec ordering, which lists ids last) because Task 8 (merchant registration) has a hard dependency on `newId("merch")` existing.

**Files:**
- Modify: `packages/backend/src/lib/ids.ts`
- Modify: `packages/backend/src/lib/__tests__/ids.test.ts`

**Interfaces:**
- Produces: `newId(prefix: 'pi' | 'evt' | 'merch' | 'link' | 'cs'): string`.

- [x] **Step 1: Write the failing tests.**

```ts
// lib/__tests__/ids.test.ts — append
test('newId("merch") matches the merch_ prefixed hex format', () => {
  expect(newId('merch')).toMatch(/^merch_[0-9a-f]{24}$/);
});

test('newId("link") matches the link_ prefixed hex format', () => {
  expect(newId('link')).toMatch(/^link_[0-9a-f]{24}$/);
});

test('newId("cs") matches the cs_ prefixed hex format', () => {
  expect(newId('cs')).toMatch(/^cs_[0-9a-f]{24}$/);
});
```

- [x] **Step 2: Run to verify it fails.**

Run: `cd ~/Oxy/OxyPay && bun test packages/backend/src/lib/__tests__/ids.test.ts`
Expected: FAIL — TypeScript rejects `'merch'`/`'link'`/`'cs'` as not assignable to `newId`'s prefix parameter.

- [x] **Step 3: Extend the prefix union.** In `lib/ids.ts`:

```ts
export function newId(prefix: 'pi' | 'evt' | 'merch' | 'link' | 'cs'): string {
  return `${prefix}_${randomHex(ID_ENTROPY_BYTES)}`;
}
```

- [x] **Step 4: Run to verify it passes.**

Run: `bun test packages/backend/src/lib/__tests__/ids.test.ts`
Expected: PASS.

- [x] **Step 5: Commit.**

```bash
git add packages/backend/src/lib/ids.ts packages/backend/src/lib/__tests__/ids.test.ts
git commit -m "feat(gateway): extend newId() for merch_/link_/cs_ prefixes"
```

---

### Task 8: [Gateway] `Merchant.publicId` + `POST /v1/merchants` (registration, non-custody firewall, test/live network firewall, scope-gated)

> ✅ **DONE** — commit `216ad3b`; task-review clean (Spec ✅ / Approved, 0 issues). 3 firewalls verified (non-custody/test-live/scope); mass-assignment closed; publicId avoids .id-virtual shadow. 2026-07-19.

> **Design note — why `publicId`, not `id`, per the risk this catches:** Mongoose auto-adds a virtual `.id` getter (hex string of `_id`) to every document that doesn't already define a real path named `id`. `merchant.id` is ALREADY used pervasively today, ecosystem-wide in this file, as exactly that Mongo-ObjectId shortcut: `reserveNextAddress(merchant.id)` (`paymentIntents.ts:156`), `merchantId: merchant.id` on every `PaymentIntent` write (`paymentIntents.ts:146,171`), and `reserveAddress.ts:16`'s `Merchant.findOneAndUpdate({ _id: merchantId }, ...)` — all of which REQUIRE `merchant.id` to be an ObjectId-castable string. Naming the new public identifier `id` (mirroring `PaymentIntent.id`) would silently SHADOW that virtual with a `merch_...` string, corrupting every one of those FK lookups. Naming it `publicId` avoids the collision entirely — zero existing call sites change — while the wire DTO still exposes it as `id` in the JSON response (Stripe parity is a wire-contract property, not an internal field-naming requirement).

**Files:**
- Create: `packages/shared-types/src/merchant.ts`
- Modify: `packages/shared-types/src/index.ts`
- Modify: `packages/backend/src/models/Merchant.ts`
- Modify: `packages/backend/src/lib/serialize.ts`
- Create: `packages/backend/src/routes/merchants.ts`
- Create: `packages/backend/src/routes/__tests__/merchants.test.ts`
- Modify: `packages/backend/src/server.ts` (mount the router)
- Modify: `packages/backend/src/models/__tests__/models.test.ts` (fixture updates)
- Modify: `packages/backend/src/routes/__tests__/routes.test.ts`, `services/__tests__/settlementWatcher.test.ts`, `__tests__/e2e.test.ts`, `routes/__tests__/serviceAuthWiring.test.ts` (fixture updates — `publicId` is not required by these tests' own assertions, but see Step 4: it IS required by the schema, so every existing `Merchant.create()` call needs it)

**Interfaces:**
- Consumes: `newId('merch')` (Task 7), `resolveMerchant` (exported, Task 6), `oxyClient.requireScope('payments:write' | 'payments:read')` (Task 5's scopes), `requireServiceApp` (Task 6, `lib/http.ts`).
- Produces: `MerchantDoc.publicId: string`; `toMerchantDTO(doc): Merchant`; `createMerchantsRouter(deps: { requireMerchant: RequestHandler }): Router` with `POST /v1/merchants`.

- [x] **Step 1: Write the shared-types `Merchant` DTO** (no logic to unit-test — a pure contract type, same pattern as `PaymentIntent`).

```ts
// packages/shared-types/src/merchant.ts
// Merchant contract — the public DTO for a registered Gateway merchant.
// `webhookSecret` and `nextDerivationIndex` are deliberately NEVER included:
// the former is an HMAC signing secret, the latter an internal derivation
// counter with no meaning to a merchant integration.
import type { NetworkType } from '@fairco.in/core';

export const MERCHANT_ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type MerchantEnvironment = (typeof MERCHANT_ENVIRONMENTS)[number];

export interface Merchant {
  id: string;
  object: 'merchant';
  oxyAppId: string;
  environment: MerchantEnvironment;
  network: NetworkType;
  xpub: string;
  webhookUrl?: string;
  requiredConfirmations: number;
  createdAt: string;
  updatedAt: string;
}
```

Export it from `index.ts`:

```ts
// packages/shared-types/src/index.ts
export { UNITS_PER_COIN, isBaseUnitString } from './money';
export {
  type PaymentIntentStatus,
  type PaymentIntent,
  type CreatePaymentIntentParams,
  isValidStatusTransition,
} from './paymentIntent';
export { type WebhookEventType, type WebhookEvent } from './event';
export {
  type MerchantEnvironment,
  type Merchant,
  MERCHANT_ENVIRONMENTS,
} from './merchant';
```

Run: `cd ~/Oxy/OxyPay && bun run --filter @oxypay/shared-types typecheck`
Expected: PASS.

- [x] **Step 2: Add `publicId` to `MerchantDoc`.** In `models/Merchant.ts`:

```ts
export interface MerchantDoc {
  /**
   * Public Stripe-parity identifier (`merch_...`, minted via `newId("merch")`
   * at registration). Deliberately NOT named `id` — see the design note at
   * the top of Task 8 in the F2.0 plan: Mongoose's auto `id` virtual is
   * already relied on ecosystem-wide in this file as the Mongo-ObjectId
   * shortcut for `PaymentIntent.merchantId` FK writes.
   */
  publicId: string;
  oxyAppId: string;
  environment: OxyServiceEnvironment;
  network: NetworkType;
  xpub: string;
  nextDerivationIndex: number;
  webhookUrl?: string;
  webhookSecret?: string;
  requiredConfirmations: number;
  livemode: boolean;
}

const merchantSchema = new Schema<MerchantDoc>(
  {
    publicId: { type: String, required: true, unique: true },
    oxyAppId: { type: String, required: true },
    environment: { type: String, enum: OXY_SERVICE_ENVIRONMENTS, required: true },
    network: { type: String, enum: ["mainnet", "testnet"], required: true },
    xpub: { type: String, required: true },
    nextDerivationIndex: { type: Number, default: 0 },
    webhookUrl: { type: String },
    webhookSecret: { type: String },
    requiredConfirmations: { type: Number, default: 1 },
    livemode: { type: Boolean, default: false },
  },
  { timestamps: true },
);
```

- [x] **Step 3: Add `toMerchantDTO` to `lib/serialize.ts`.**

```ts
// lib/serialize.ts — add alongside the existing imports and toPaymentIntentDTO
import type { Merchant } from "@oxypay/shared-types";
import type { MerchantDoc } from "../models/Merchant";

/**
 * Serialize a persisted Merchant document to its public `Merchant` DTO.
 * `webhookSecret` and `nextDerivationIndex` are deliberately omitted (see
 * `@oxypay/shared-types`'s `Merchant` doc comment).
 */
export function toMerchantDTO(doc: HydratedDocument<MerchantDoc>): Merchant {
  return {
    id: doc.publicId,
    object: "merchant",
    oxyAppId: doc.oxyAppId,
    environment: doc.environment,
    network: doc.network,
    xpub: doc.xpub,
    webhookUrl: doc.webhookUrl,
    requiredConfirmations: doc.requiredConfirmations,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
```

- [x] **Step 4: Add `publicId` to every existing `Merchant.create()` fixture** (now required by the schema) — `models/__tests__/models.test.ts` (4 call sites: "app_watch_only_ok", "app_private_xprv_rejected", "app_reserve_addresses", and the two new ones from Task 6's Step 1), `routes/__tests__/routes.test.ts` (1), `services/__tests__/settlementWatcher.test.ts` (2), `__tests__/e2e.test.ts` (1), `routes/__tests__/serviceAuthWiring.test.ts` (1). For each, add one line, e.g.:

```ts
  await Merchant.create({
    publicId: "merch_test0000000000000001",
    oxyAppId: TEST_APP_ID,
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://example.test/webhook",
    webhookSecret: "whsec_test",
  });
```

(Use a distinct literal `merch_test...N` per call site so the compound `publicId` unique index never collides across fixtures in the same file — increment the trailing digit per call site within a file.)

Run: `bun test packages/backend/src` after each file — Expected: PASS once all call sites are updated (a single missed site fails with `Path \`publicId\` is required`, which pinpoints it immediately).

- [x] **Step 5: Write the failing tests for `POST /v1/merchants`.**

```ts
// packages/backend/src/routes/__tests__/merchants.test.ts
import {
  test,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  describe,
} from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { OxyAuthRequest } from "@oxyhq/core/server";
import { Merchant } from "../../models/Merchant";
import { createMerchantsRouter } from "../merchants";

const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";
const DEV_APP_ID = "app_merch_dev";
const PROD_APP_ID = "app_merch_prod";

function stubRequireMerchant(appId: string, environment: string): RequestHandler {
  return (req, _res, next) => {
    (req as OxyAuthRequest).serviceApp = {
      appId,
      appName: "t",
      scopes: ["payments:read", "payments:write"],
      credentialId: "c",
      environment: environment as OxyAuthRequest["serviceApp"] extends infer T
        ? T extends { environment: infer E }
          ? E
          : never
        : never,
    };
    next();
  };
}

interface MerchantResponse {
  id: string;
  object: string;
  oxyAppId: string;
  environment: string;
  network: string;
  xpub: string;
  webhookUrl?: string;
  requiredConfirmations: number;
  error?: { type: string; message: string };
}

let mongod: MongoMemoryServer;
let server: Server;
let baseUrl: string;

async function readJson(res: Response): Promise<MerchantResponse> {
  return (await res.json()) as MerchantResponse;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Merchant.init();

  const app = express();
  app.use(express.json());
  // A dev-environment request and a prod-environment request are dispatched
  // to distinct paths in tests below by simply calling with a matching stub
  // mounted per describe block — see createApp() per-scenario instead.
  server = app.listen(0);
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await Merchant.deleteMany({});
});

function createApp(appId: string, environment: string): { app: ReturnType<typeof express>; requireMerchant: RequestHandler } {
  const requireMerchant = stubRequireMerchant(appId, environment);
  const app = express();
  app.use(express.json());
  app.use(createMerchantsRouter({ requireMerchant }));
  return { app, requireMerchant };
}

async function listen(app: ReturnType<typeof express>): Promise<{ server: Server; baseUrl: string }> {
  const s = app.listen(0);
  await new Promise<void>((resolve) => s.once("listening", resolve));
  const address = s.address() as AddressInfo;
  return { server: s, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("POST /v1/merchants", () => {
  test("a production credential registers a mainnet merchant (201)", async () => {
    const { app } = createApp(PROD_APP_ID, "production");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "mainnet", xpub: XPUB }),
      });
      expect(res.status).toBe(201);
      const body = await readJson(res);
      expect(body.id).toMatch(/^merch_[0-9a-f]{24}$/);
      expect(body.object).toBe("merchant");
      expect(body.environment).toBe("production");
      expect(body.network).toBe("mainnet");
      expect(body.requiredConfirmations).toBe(1);
    } finally {
      s.close();
    }
  });

  test("a development credential CANNOT register a mainnet merchant (422) — test/live firewall", async () => {
    const { app } = createApp(DEV_APP_ID, "development");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "mainnet", xpub: XPUB }),
      });
      expect(res.status).toBe(422);
      const body = await readJson(res);
      expect(body.error?.type).toBe("invalid_request_error");
      const count = await Merchant.countDocuments({ oxyAppId: DEV_APP_ID });
      expect(count).toBe(0);
    } finally {
      s.close();
    }
  });

  test("a development credential registers a testnet merchant (201)", async () => {
    const { app } = createApp(DEV_APP_ID, "development");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "testnet", xpub: XPUB }),
      });
      expect(res.status).toBe(201);
      const body = await readJson(res);
      expect(body.environment).toBe("development");
      expect(body.network).toBe("testnet");
    } finally {
      s.close();
    }
  });

  test("a private xprv is rejected by the same non-custody firewall the model enforces (422 or 500-free rejection)", async () => {
    const { app } = createApp(DEV_APP_ID, "development");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network: "testnet",
          // Malformed extended key — the model's pre('validate') firewall
          // must reject this before persisting, regardless of exact string;
          // asserting NOT-201 + NOT-persisted is the load-bearing check.
          xpub: "not-a-real-extended-key",
        }),
      });
      expect(res.status).not.toBe(201);
      const count = await Merchant.countDocuments({ oxyAppId: DEV_APP_ID });
      expect(count).toBe(0);
    } finally {
      s.close();
    }
  });

  test("registering twice for the same app+environment collides (409)", async () => {
    const { app } = createApp(DEV_APP_ID, "development");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const first = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "testnet", xpub: XPUB }),
      });
      expect(first.status).toBe(201);

      const second = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "testnet", xpub: XPUB }),
      });
      expect(second.status).toBe(409);
    } finally {
      s.close();
    }
  });

  test("no service app credentials at all -> 401", async () => {
    const app = express();
    app.use(express.json());
    app.use(createMerchantsRouter({ requireMerchant: (_req, _res, next) => next() }));
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "testnet", xpub: XPUB }),
      });
      expect(res.status).toBe(401);
    } finally {
      s.close();
    }
  });

  test("a credential without payments:write is rejected (403 INSUFFICIENT_SCOPE)", async () => {
    const noScopeRequireMerchant: RequestHandler = (req, _res, next) => {
      (req as OxyAuthRequest).serviceApp = {
        appId: DEV_APP_ID,
        appName: "t",
        scopes: [],
        credentialId: "c",
        environment: "development",
      };
      next();
    };
    const app = express();
    app.use(express.json());
    app.use(createMerchantsRouter({ requireMerchant: noScopeRequireMerchant }));
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "testnet", xpub: XPUB }),
      });
      expect(res.status).toBe(403);
    } finally {
      s.close();
    }
  });
});
```

- [x] **Step 6: Run to verify it fails.**

Run: `bun test packages/backend/src/routes/__tests__/merchants.test.ts`
Expected: FAIL — `../merchants` module does not exist.

- [x] **Step 7: Implement `routes/merchants.ts`.**

```ts
// packages/backend/src/routes/merchants.ts
import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { oxyClient } from "@oxyhq/core";
import { Merchant } from "../models/Merchant";
import { newId } from "../lib/ids";
import { toMerchantDTO } from "../lib/serialize";
import { sendError, wrap, isDuplicateKeyError, requireServiceApp } from "../lib/http";

const createMerchantBodySchema = z.object({
  network: z.enum(["mainnet", "testnet"]),
  xpub: z.string().min(1),
  webhookUrl: z.string().url().optional(),
  webhookSecret: z.string().min(1).optional(),
  requiredConfirmations: z.number().int().positive().optional(),
});

/**
 * Build the merchant registration/management REST router (F2.0 task 2).
 * `requireMerchant` is injectable so tests can bypass real Oxy service tokens
 * with a stub that populates `req.serviceApp`; in production it is the SAME
 * resolved default `createGateway()` builds for `paymentIntents.ts` (Task 4),
 * so `environment` is always available from the token — doubling as the
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

  return router;
}
```

- [x] **Step 8: Run to verify the tests pass.**

Run: `bun test packages/backend/src/routes/__tests__/merchants.test.ts`
Expected: PASS.

- [x] **Step 9: Mount the new router in `server.ts`.**

```ts
// server.ts — add the import
import { createMerchantsRouter } from "./routes/merchants";
```

```ts
// server.ts — inside createGateway(), right after mounting createPaymentIntentsRouter
  app.use(createPaymentIntentsRouter({ requireMerchant }));
  app.use(createMerchantsRouter({ requireMerchant }));
```

- [x] **Step 10: Run the full backend suite.**

Run: `bun test packages/backend/src`
Expected: all PASS.

- [x] **Step 11: Commit.**

```bash
git add packages/shared-types/src/merchant.ts packages/shared-types/src/index.ts \
  packages/backend/src/models/Merchant.ts packages/backend/src/lib/serialize.ts \
  packages/backend/src/routes/merchants.ts packages/backend/src/routes/__tests__/merchants.test.ts \
  packages/backend/src/server.ts \
  packages/backend/src/models/__tests__/models.test.ts \
  packages/backend/src/routes/__tests__/routes.test.ts \
  packages/backend/src/services/__tests__/settlementWatcher.test.ts \
  packages/backend/src/__tests__/e2e.test.ts \
  packages/backend/src/routes/__tests__/serviceAuthWiring.test.ts
git commit -m "feat(gateway): POST /v1/merchants — registration with the test/live network firewall"
```

---

### Task 9: [Gateway] `GET /v1/merchants/me`, `PATCH /v1/merchants/me`

> ✅ **DONE** — commits `c8c4d00`+`c0c070b` (1 fix cycle); re-review Approved. Review caught real 403-vs-401 defect on unauthenticated caller → added requireAuthenticated gate before requireScope + regression tests. 2026-07-19.

**Files:**
- Modify: `packages/backend/src/routes/merchants.ts`
- Modify: `packages/backend/src/routes/__tests__/merchants.test.ts`

**Interfaces:**
- Consumes: `resolveMerchant` (exported, Task 6).
- Produces: `GET /v1/merchants/me`, `PATCH /v1/merchants/me` on the same router `createMerchantsRouter` returns.

- [x] **Step 1: Write the failing tests.** Append to `merchants.test.ts`:

```ts
describe("GET /v1/merchants/me", () => {
  test("returns the caller's own merchant", async () => {
    const { app } = createApp(DEV_APP_ID, "development");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const create = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "testnet", xpub: XPUB }),
      });
      const created = await readJson(create);

      const res = await fetch(`${url}/v1/merchants/me`);
      expect(res.status).toBe(200);
      const body = await readJson(res);
      expect(body.id).toBe(created.id);
    } finally {
      s.close();
    }
  });

  test("no merchant registered for this app+environment yet -> 403", async () => {
    const { app } = createApp(DEV_APP_ID, "development");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/merchants/me`);
      expect(res.status).toBe(403);
    } finally {
      s.close();
    }
  });
});

describe("PATCH /v1/merchants/me", () => {
  test("updates webhookUrl and requiredConfirmations", async () => {
    const { app } = createApp(DEV_APP_ID, "development");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "testnet", xpub: XPUB }),
      });

      const res = await fetch(`${url}/v1/merchants/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: "https://merchant.example/new-hook",
          requiredConfirmations: 3,
        }),
      });
      expect(res.status).toBe(200);
      const body = await readJson(res);
      expect(body.webhookUrl).toBe("https://merchant.example/new-hook");
      expect(body.requiredConfirmations).toBe(3);
      // xpub/network/environment are immutable via this route.
      expect(body.network).toBe("testnet");
    } finally {
      s.close();
    }
  });

  test("xpub is not a field this route accepts — an attempted xpub change is silently ignored", async () => {
    const { app } = createApp(DEV_APP_ID, "development");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "testnet", xpub: XPUB }),
      });

      const res = await fetch(`${url}/v1/merchants/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requiredConfirmations: 2, xpub: "attempted-change" }),
      });
      expect(res.status).toBe(200);
      const body = await readJson(res);
      expect(body.xpub).toBe(XPUB);
    } finally {
      s.close();
    }
  });
});
```

- [x] **Step 2: Run to verify it fails.**

Run: `cd ~/Oxy/OxyPay && bun test packages/backend/src/routes/__tests__/merchants.test.ts`
Expected: FAIL — `GET`/`PATCH /v1/merchants/me` are not yet routed (404).

- [x] **Step 3: Implement the two routes in `routes/merchants.ts`.** Add the import and routes:

```ts
// merchants.ts — add to the imports
import { resolveMerchant } from "./paymentIntents";
```

```ts
// merchants.ts — inside createMerchantsRouter(), after the POST /v1/merchants route
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
```

- [x] **Step 4: Run to verify the tests pass.**

Run: `bun test packages/backend/src/routes/__tests__/merchants.test.ts`
Expected: PASS.

- [x] **Step 5: Run the full backend suite for regressions.**

Run: `bun test packages/backend/src`
Expected: all PASS.

- [x] **Step 6: Commit.**

```bash
git add packages/backend/src/routes/merchants.ts packages/backend/src/routes/__tests__/merchants.test.ts
git commit -m "feat(gateway): GET/PATCH /v1/merchants/me"
```

---

### Task 10: [Gateway] `GET /v1/payment_intents` (list, merchant-authed, cursor pagination)

> ✅ **DONE** — commits `e52d85f`+`37e7e01`; task-review Approved. Merchant-scoped (IDOR-safe), cursor pagination, 401-before-403 gate; fixed a tautological cursor assertion. Follow-ups: merchantId index, cross-merchant test, pre-existing create/reject scope gap. 2026-07-19.

**Files:**
- Modify: `packages/shared-types/src/paymentIntent.ts`
- Modify: `packages/backend/src/routes/paymentIntents.ts`
- Modify: `packages/backend/src/routes/__tests__/routes.test.ts`

**Interfaces:**
- Produces: `PAYMENT_INTENT_STATUSES: readonly PaymentIntentStatus[]` (shared-types); `GET /v1/payment_intents?status=&limit=&starting_after=` → `{ object: 'list', data: PaymentIntent[], has_more: boolean }`.

- [x] **Step 1: Export the status literal array from shared-types** (single source of truth for the list route's Zod enum — do not hand-duplicate the 9 status strings in the Gateway route).

```ts
// packages/shared-types/src/paymentIntent.ts — add after ALLOWED's definition
/** Every legal `PaymentIntentStatus`, derived from `ALLOWED`'s keys — the
 * single source of truth consumed by the Gateway's list-route status filter. */
export const PAYMENT_INTENT_STATUSES: readonly PaymentIntentStatus[] = Object.keys(
  ALLOWED,
) as PaymentIntentStatus[];
```

Export it from `index.ts`:

```ts
export {
  type PaymentIntentStatus,
  type PaymentIntent,
  type CreatePaymentIntentParams,
  isValidStatusTransition,
  PAYMENT_INTENT_STATUSES,
} from './paymentIntent';
```

Run: `cd ~/Oxy/OxyPay && bun run --filter @oxypay/shared-types typecheck && bun test packages/shared-types`
Expected: PASS.

- [x] **Step 2: Write the failing tests.** Append to `routes/__tests__/routes.test.ts`:

```ts
describe("GET /v1/payment_intents (list)", () => {
  test("lists the merchant's own intents, newest first, respecting limit", async () => {
    await createIntent("idem-list-1");
    await createIntent("idem-list-2");
    await createIntent("idem-list-3");

    const res = await fetch(`${baseUrl}/v1/payment_intents?limit=2`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { object: string; data: IntentResponse[]; has_more: boolean };
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(2);
    expect(body.has_more).toBe(true);
  });

  test("filters by status", async () => {
    const created = await createIntent("idem-list-status");
    await fetch(`${baseUrl}/v1/payment_intents/${created.body.id}/reject`, { method: "POST" });

    const res = await fetch(`${baseUrl}/v1/payment_intents?status=rejected`);
    const body = (await res.json()) as { data: IntentResponse[] };
    expect(body.data.every((intent) => intent.status === "rejected")).toBe(true);
    expect(body.data.some((intent) => intent.id === created.body.id)).toBe(true);
  });

  test("paginates via starting_after", async () => {
    const first = await createIntent("idem-page-1");
    const second = await createIntent("idem-page-2");

    const page1 = await fetch(`${baseUrl}/v1/payment_intents?limit=1`);
    const page1Body = (await page1.json()) as { data: IntentResponse[] };
    expect(page1Body.data[0]?.id).toBe(second.body.id);

    const page2 = await fetch(
      `${baseUrl}/v1/payment_intents?limit=1&starting_after=${page1Body.data[0]?.id}`,
    );
    const page2Body = (await page2.json()) as { data: IntentResponse[] };
    expect(page2Body.data[0]?.id).toBe(first.body.id === second.body.id ? second.body.id : page2Body.data[0]?.id);
  });

  test("an unknown starting_after -> 422", async () => {
    const res = await fetch(`${baseUrl}/v1/payment_intents?starting_after=pi_does_not_exist`);
    expect(res.status).toBe(422);
  });
});
```

- [x] **Step 3: Run to verify it fails.**

Run: `cd ~/Oxy/OxyPay && bun test packages/backend/src/routes/__tests__/routes.test.ts -t "list"`
Expected: FAIL — `GET /v1/payment_intents` (no `:id`) is not yet routed (404, since Express matches `/v1/payment_intents/:id` and `:id` becomes the literal empty match / this 404s cleanly since no route matches the bare path).

- [x] **Step 4: Implement the list route.** Add imports to `paymentIntents.ts`:

```ts
import type { FilterQuery } from "mongoose";
import type { PaymentIntentDoc } from "../models/PaymentIntent";
import {
  isBaseUnitString,
  PAYMENT_INTENT_STATUSES,
  type CreatePaymentIntentParams,
  type PaymentIntentStatus,
} from "@oxypay/shared-types";
```

Add constants and the query schema (near the top, with the other schemas):

```ts
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

const listQuerySchema = z.object({
  status: z
    .enum(PAYMENT_INTENT_STATUSES as [PaymentIntentStatus, ...PaymentIntentStatus[]])
    .optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).optional(),
  starting_after: z.string().optional(),
});
```

Add the route (after `POST /v1/payment_intents`, before `GET /v1/payment_intents/:id` — Express matches static-then-param routes fine either order, but place it first for readability):

```ts
  router.get(
    "/v1/payment_intents",
    requireMerchant,
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;

      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        sendError(
          res,
          422,
          "invalid_request_error",
          parsed.error.issues[0]?.message ?? "invalid query",
        );
        return;
      }
      const { status, starting_after } = parsed.data;
      const limit = parsed.data.limit ?? DEFAULT_LIST_LIMIT;

      const filter: FilterQuery<PaymentIntentDoc> = { merchantId: merchant.id };
      if (status) filter.status = status;

      if (starting_after) {
        const cursor = await PaymentIntent.findOne({
          id: starting_after,
          merchantId: merchant.id,
        });
        if (!cursor) {
          sendError(
            res,
            422,
            "invalid_request_error",
            "starting_after references an unknown payment intent",
          );
          return;
        }
        filter._id = { $lt: cursor._id };
      }

      const page = await PaymentIntent.find(filter).sort({ _id: -1 }).limit(limit + 1);
      const hasMore = page.length > limit;
      const data = (hasMore ? page.slice(0, limit) : page).map((intent) =>
        toPaymentIntentDTO(intent),
      );

      res.status(200).json({ object: "list", data, has_more: hasMore });
    }),
  );
```

- [x] **Step 5: Run to verify the tests pass.**

Run: `bun test packages/backend/src/routes/__tests__/routes.test.ts -t "list"`
Expected: PASS.

- [x] **Step 6: Run the full backend suite.**

Run: `bun test packages/backend/src`
Expected: all PASS.

- [x] **Step 7: Commit.**

```bash
git add packages/shared-types/src/paymentIntent.ts packages/shared-types/src/index.ts \
  packages/backend/src/routes/paymentIntents.ts packages/backend/src/routes/__tests__/routes.test.ts
git commit -m "feat(gateway): GET /v1/payment_intents — merchant-authed list with cursor pagination"
```

---

### Task 11: [Gateway] Payer-authed `GET /v1/payment_intents/:id` variant (dual auth)

> ✅ **DONE** — commit `30497d0`; task-review Approved. Dual-auth (merchant Bearer / payer client_secret, constant-time), reviewer traced installed core dist = no privilege smuggling, no cross-intent IDOR. 2026-07-19.

**Files:**
- Modify: `packages/backend/src/routes/paymentIntents.ts`
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/src/routes/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `verifySecret` (already imported), `oxyClient.auth({ optional: true, jwtSecret })`.
- Produces: `createPaymentIntentsRouter(deps: { requireMerchant: RequestHandler; optionalServiceAuth: RequestHandler })` (was `{ requireMerchant }`). `GET /v1/payment_intents/:id` now serves BOTH a merchant-authed caller (via `Authorization: Bearer <service-token>`) and a payer (via `?client_secret=` or `X-Oxy-Pay-Client-Secret` header) on the same route.

**Context:** today `GET /v1/payment_intents/:id` (`paymentIntents.ts:202-219`) is 100% merchant-authed. A hosted checkout page has no way to fetch an initial REST snapshot before its socket subscription confirms — it would otherwise race a socket connection with no fallback. `submit_tx` and the socket's `subscribe` already establish the precedent (`verifySecret(provided, intent.clientSecret)`) this route now also uses.

- [x] **Step 1: Write the failing tests.** Add to `routes/__tests__/routes.test.ts`, replacing the two existing tests in `describe("GET /v1/payment_intents/:id", ...)` (they currently send NO headers at all — since the route becomes dual-auth via an OPTIONAL auth middleware keyed on the presence of `Authorization`, they must now send one to keep exercising the merchant path):

```ts
describe("GET /v1/payment_intents/:id", () => {
  test("returns the merchant's own intent (merchant-authed)", async () => {
    const created = await createIntent("idem-get");
    const res = await fetch(`${baseUrl}/v1/payment_intents/${created.body.id}`, {
      headers: { Authorization: "Bearer test" },
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.id).toBe(created.body.id);
    expect(body.address).toBe(created.body.address);
  });

  test("merchant-authed, unknown id -> 404", async () => {
    const res = await fetch(`${baseUrl}/v1/payment_intents/pi_does_not_exist`, {
      headers: { Authorization: "Bearer test" },
    });
    expect(res.status).toBe(404);
  });

  test("payer-authed via ?client_secret= query param (no Authorization header)", async () => {
    const created = await createIntent("idem-get-payer-query");
    const res = await fetch(
      `${baseUrl}/v1/payment_intents/${created.body.id}?client_secret=${created.body.client_secret}`,
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.id).toBe(created.body.id);
  });

  test("payer-authed via X-Oxy-Pay-Client-Secret header (no Authorization header)", async () => {
    const created = await createIntent("idem-get-payer-header");
    const res = await fetch(`${baseUrl}/v1/payment_intents/${created.body.id}`, {
      headers: { "X-Oxy-Pay-Client-Secret": created.body.client_secret ?? "" },
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.id).toBe(created.body.id);
  });

  test("payer path, wrong client_secret -> 403", async () => {
    const created = await createIntent("idem-get-payer-wrong");
    const res = await fetch(
      `${baseUrl}/v1/payment_intents/${created.body.id}?client_secret=pi_wrong_secret`,
    );
    expect(res.status).toBe(403);
  });

  test("no Authorization header and no client_secret -> 401", async () => {
    const created = await createIntent("idem-get-neither");
    const res = await fetch(`${baseUrl}/v1/payment_intents/${created.body.id}`);
    expect(res.status).toBe(401);
  });
});
```

Update `routes.test.ts`'s router construction in `beforeAll` to pass the new required `optionalServiceAuth` stub (conditionally populates `req.serviceApp` ONLY when an `Authorization` header is present, so both branches are exercisable in the same test file):

```ts
const stubOptionalServiceAuth: RequestHandler = (req, _res, next) => {
  if (req.header("Authorization")) {
    (req as OxyAuthRequest).serviceApp = {
      appId: TEST_APP_ID,
      appName: "t",
      scopes: [],
      credentialId: "c",
      environment: "development",
    };
  }
  next();
};
```

```ts
  app.use(
    createPaymentIntentsRouter({
      requireMerchant: stubRequireMerchant,
      optionalServiceAuth: stubOptionalServiceAuth,
    }),
  );
```

- [x] **Step 2: Run to verify it fails.**

Run: `cd ~/Oxy/OxyPay && bun test packages/backend/src/routes/__tests__/routes.test.ts`
Expected: FAIL — `createPaymentIntentsRouter` does not yet accept `optionalServiceAuth`; the merchant-path tests currently pass with no Authorization header at all (pre-existing behavior) and the new payer-path tests 404/hang since the route is still unconditionally merchant-only.

- [x] **Step 3: Implement the dual-auth route.** Update `createPaymentIntentsRouter`'s signature:

```ts
export function createPaymentIntentsRouter(deps: {
  requireMerchant: RequestHandler;
  optionalServiceAuth: RequestHandler;
}): Router {
  const { requireMerchant, optionalServiceAuth } = deps;
  const router = Router();
```

Replace the existing `GET /v1/payment_intents/:id` route:

```ts
  router.get(
    "/v1/payment_intents/:id",
    optionalServiceAuth,
    wrap(async (req, res) => {
      const { serviceApp } = req as OxyAuthRequest;

      if (serviceApp?.appId) {
        // Merchant path — unchanged behavior, scoped to the merchant's own intent.
        const merchant = await resolveMerchant(req, res);
        if (!merchant) return;
        const intent = await PaymentIntent.findOne({
          id: req.params.id,
          merchantId: merchant.id,
        });
        if (!intent) {
          sendError(res, 404, "invalid_request_error", "payment intent not found");
          return;
        }
        res.status(200).json(toPaymentIntentDTO(intent));
        return;
      }

      // Payer path — authorized by possession of the intent's `client_secret`,
      // the same idiom `submit_tx` and the socket `subscribe` already use.
      // Needed for a hosted checkout page's initial REST snapshot before its
      // socket subscription confirms (F2.0 task 3).
      const clientSecretParam = req.query.client_secret;
      const clientSecret =
        typeof clientSecretParam === "string"
          ? clientSecretParam
          : req.header("X-Oxy-Pay-Client-Secret");
      if (!clientSecret) {
        sendError(
          res,
          401,
          "authentication_error",
          "missing service app credentials or client_secret",
        );
        return;
      }

      const intent = await PaymentIntent.findOne({ id: req.params.id });
      if (!intent) {
        sendError(res, 404, "invalid_request_error", "payment intent not found");
        return;
      }
      if (!verifySecret(clientSecret, intent.clientSecret)) {
        sendError(res, 403, "permission_error", "invalid client_secret");
        return;
      }
      res.status(200).json(toPaymentIntentDTO(intent));
    }),
  );
```

Add `OxyAuthRequest` back to the type-only import (removed in Task 6, needed again here):

```ts
import type { OxyAuthRequest } from "@oxyhq/core/server";
```

- [x] **Step 4: Wire the real `optionalServiceAuth` default in `server.ts`.**

```ts
// server.ts — inside createGateway(), alongside the requireMerchant default
  const requireMerchant: RequestHandler =
    deps.requireMerchant ?? oxyClient.serviceAuth({ jwtSecret: config.serviceJwtSecret });
  const optionalServiceAuth: RequestHandler =
    deps.optionalServiceAuth ?? oxyClient.auth({ jwtSecret: config.serviceJwtSecret, optional: true });

  app.use(createPaymentIntentsRouter({ requireMerchant, optionalServiceAuth }));
  app.use(createMerchantsRouter({ requireMerchant }));
```

Add `optionalServiceAuth?: RequestHandler` to `GatewayDeps`:

```ts
export interface GatewayDeps {
  /** Merchant service-auth middleware (default `oxyClient.serviceAuth()`). */
  requireMerchant?: RequestHandler;
  /** Optional service-auth middleware for the dual-auth payer/merchant GET route. */
  optionalServiceAuth?: RequestHandler;
  /** Socket connection auth (default `oxyClient.authSocket()`). */
  socketAuth?: SocketAuth;
  /** On-chain reader (default the real Explorer client). */
  getTransaction?: typeof getTransaction;
  /** SSRF-safe fetch used for webhook delivery (default the real one). */
  safeFetch?: SafeFetchFn;
}
```

- [x] **Step 5: Update `e2e.test.ts`'s `createGateway()` call** to also inject a stub `optionalServiceAuth` (the e2e flow itself never calls `GET /:id`, but `createGateway`'s new required-if-no-default parameter must still resolve — since `optionalServiceAuth` is optional on `GatewayDeps`, e2e can rely on the real default IF `config.serviceJwtSecret` happens to be set in the test process; to keep the e2e test fully deterministic and independent of ambient env vars, inject an explicit stub matching the file's existing `stubRequireMerchant` style):

```ts
// e2e.test.ts — alongside the existing stubRequireMerchant
const stubOptionalServiceAuth = (
  _req: unknown,
  _res: unknown,
  next: (err?: Error) => void,
): void => next();
```

```ts
// e2e.test.ts — in beforeAll's createGateway() call
  gateway = createGateway({
    requireMerchant: stubRequireMerchant,
    optionalServiceAuth: stubOptionalServiceAuth,
    socketAuth: stubSocketAuth,
    getTransaction: stubGetTransaction,
    safeFetch: fakeSafeFetch,
  });
```

- [x] **Step 6: Run to verify the tests pass.**

Run: `bun test packages/backend/src/routes/__tests__/routes.test.ts`
Expected: PASS.

- [x] **Step 7: Run the full backend suite for regressions.**

Run: `bun test packages/backend/src`
Expected: all PASS.

- [x] **Step 8: Commit.**

```bash
git add packages/backend/src/routes/paymentIntents.ts packages/backend/src/server.ts \
  packages/backend/src/routes/__tests__/routes.test.ts packages/backend/src/__tests__/e2e.test.ts
git commit -m "feat(gateway): payer-authed GET /v1/payment_intents/:id via client_secret"
```

---

### Task 12: [Gateway] `WebhookDelivery` model + persist the delivery result in `onIntentChange`

> ✅ **DONE** — commit `de9d00b`; task-review Approved (0 issues). Best-effort persistence verified contained (reviewer traced watcher await loop); failure-path tested. 2026-07-19.

**Files:**
- Create: `packages/shared-types/src/webhookDelivery.ts`
- Modify: `packages/shared-types/src/index.ts`
- Create: `packages/backend/src/models/WebhookDelivery.ts`
- Modify: `packages/backend/src/lib/serialize.ts`
- Modify: `packages/backend/src/server.ts`
- Create: `packages/backend/src/__tests__/onIntentChange.test.ts`
- Modify: `packages/backend/src/models/__tests__/models.test.ts`

**Interfaces:**
- Produces: `WebhookDeliveryDoc { merchantId, intentId, eventId, eventType, url, attempts, delivered, lastStatus, createdAt, updatedAt }`; `toWebhookDeliveryDTO(doc): WebhookDelivery`; `onIntentChange` (now **exported** from `server.ts` for direct testing) persists one `WebhookDelivery` per delivery attempt, best-effort (a persistence failure never aborts the settlement watcher).

**Design note — `intentId` beyond the spec's literal field list:** the spec's field list for `WebhookDelivery` (`{merchantId, eventId, url, attempts, delivered, lastStatus, timestamps}`) omits which `PaymentIntent` a delivery was for. Without it, Task 13's redeliver route has no way to look up the intent to rebuild the event payload — `eventId` alone isn't a stored foreign key to anything (the `WebhookEvent` envelope is built on-the-fly in `webhookDispatcher.buildEvent()` and never persisted separately). `intentId` is added here as a necessary, minimal correction — flagged for confirmation with the spec owner, not silently assumed.

**Design note — `lastStatus` domain:** `deliver()` (`webhookDispatcher.ts`) returns `{ delivered: boolean; attempts: number }` only — it does not surface the raw last HTTP status code to its caller. `lastStatus` is therefore modeled as `'delivered' | 'failed'`, derived directly from `outcome.delivered`, not a numeric HTTP status. A future enhancement could thread the raw status through `deliver()`'s return value if finer-grained logging is needed later — out of scope here.

- [x] **Step 1: Write the shared-types DTO.**

```ts
// packages/shared-types/src/webhookDelivery.ts
import type { WebhookEventType } from './event';

export interface WebhookDelivery {
  id: string;
  object: 'webhook_delivery';
  merchantId: string;
  intentId: string;
  eventId: string;
  eventType: WebhookEventType;
  url: string;
  attempts: number;
  delivered: boolean;
  lastStatus: 'delivered' | 'failed';
  createdAt: string;
  updatedAt: string;
}
```

```ts
// packages/shared-types/src/index.ts — add
export { type WebhookDelivery } from './webhookDelivery';
```

Run: `cd ~/Oxy/OxyPay && bun run --filter @oxypay/shared-types typecheck`
Expected: PASS.

- [x] **Step 2: Write the failing model test.**

```ts
// models/__tests__/models.test.ts — append, with the WebhookDelivery import added at the top
test("WebhookDelivery persists one row per delivery attempt, keyed by merchantId", async () => {
  const delivery = await WebhookDelivery.create({
    merchantId: "merchant_xyz",
    intentId: "pi_0000000000000000000000e1",
    eventId: "evt_0000000000000000000000e1",
    eventType: "payment_intent.settled",
    url: "https://merchant.example/hook",
    attempts: 1,
    delivered: true,
    lastStatus: "delivered",
  });

  expect(delivery.merchantId).toBe("merchant_xyz");
  expect(delivery.delivered).toBe(true);
  expect(delivery.lastStatus).toBe("delivered");

  const count = await WebhookDelivery.countDocuments({ merchantId: "merchant_xyz" });
  expect(count).toBe(1);
});
```

Add the import at the top of `models.test.ts`:

```ts
import { WebhookDelivery } from "../WebhookDelivery";
```

- [x] **Step 3: Run to verify it fails.**

Run: `bun test packages/backend/src/models/__tests__/models.test.ts -t "WebhookDelivery"`
Expected: FAIL — module does not exist.

- [x] **Step 4: Implement the model.**

```ts
// packages/backend/src/models/WebhookDelivery.ts
import { Schema, model } from "mongoose";
import type { WebhookEventType } from "@oxypay/shared-types";

/**
 * A log entry for one webhook delivery attempt. Keyed by `merchantId` (NOT
 * "the" webhook) — F2.0 keeps a single endpoint per merchant
 * (`Merchant.webhookUrl`/`webhookSecret`), but this shape stays additive if a
 * future `WebhookEndpoint` (N endpoints per merchant, event filters) lands:
 * this log would just gain an `endpointId` field rather than being rewritten.
 */
export interface WebhookDeliveryDoc {
  merchantId: string;
  intentId: string;
  eventId: string;
  eventType: WebhookEventType;
  url: string;
  attempts: number;
  delivered: boolean;
  lastStatus: "delivered" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

const webhookDeliverySchema = new Schema<WebhookDeliveryDoc>(
  {
    merchantId: { type: String, required: true, index: true },
    intentId: { type: String, required: true },
    eventId: { type: String, required: true },
    eventType: { type: String, required: true },
    url: { type: String, required: true },
    attempts: { type: Number, required: true },
    delivered: { type: Boolean, required: true },
    lastStatus: { type: String, enum: ["delivered", "failed"], required: true },
  },
  { timestamps: true },
);

export const WebhookDelivery = model<WebhookDeliveryDoc>(
  "WebhookDelivery",
  webhookDeliverySchema,
);
```

- [x] **Step 5: Run to verify the model test passes.**

Run: `bun test packages/backend/src/models/__tests__/models.test.ts -t "WebhookDelivery"`
Expected: PASS.

- [x] **Step 6: Add `toWebhookDeliveryDTO` to `lib/serialize.ts`.**

```ts
// lib/serialize.ts — add
import type { WebhookDelivery } from "@oxypay/shared-types";
import type { WebhookDeliveryDoc } from "../models/WebhookDelivery";

export function toWebhookDeliveryDTO(
  doc: HydratedDocument<WebhookDeliveryDoc>,
): WebhookDelivery {
  return {
    id: doc.id,
    object: "webhook_delivery",
    merchantId: doc.merchantId,
    intentId: doc.intentId,
    eventId: doc.eventId,
    eventType: doc.eventType,
    url: doc.url,
    attempts: doc.attempts,
    delivered: doc.delivered,
    lastStatus: doc.lastStatus,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
```

(`WebhookDelivery` has no schema field named `id`, so its Mongoose virtual `.id` is used directly here — unlike `Merchant`, there is no collision to avoid.)

- [x] **Step 7: Write the failing tests for `onIntentChange`'s persistence.**

```ts
// packages/backend/src/__tests__/onIntentChange.test.ts
import { test, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import type { Server as SocketServer } from "socket.io";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Merchant } from "../models/Merchant";
import { PaymentIntent } from "../models/PaymentIntent";
import { WebhookDelivery } from "../models/WebhookDelivery";
import { onIntentChange } from "../server";
import type { SafeFetchFn } from "../services/webhookDispatcher";

const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";
const ADDRESS = "TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Merchant.init();
  await PaymentIntent.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

function fakeIo(): SocketServer {
  return { to: () => ({ emit: () => {} }) } as unknown as SocketServer;
}

function fakeSafeFetchOk(): SafeFetchFn {
  return (async () => {
    const response = new IncomingMessage(new Socket());
    return { response, status: 200, headers: {}, finalUrl: "https://merchant.example/hook" };
  }) as SafeFetchFn;
}

test("onIntentChange persists a WebhookDelivery after a successful delivery", async () => {
  const merchant = await Merchant.create({
    publicId: "merch_test_delivery_log_1",
    oxyAppId: "app_delivery_log",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://merchant.example/hook",
    webhookSecret: "whsec_log",
  });
  const intent = await PaymentIntent.create({
    id: "pi_0000000000000000000000d1",
    status: "settled",
    amount: "100000000",
    network: "testnet",
    address: ADDRESS,
    merchantId: merchant.id,
    clientSecret: "pi_0000000000000000000000d1_secret_x",
    idempotencyKey: "idem_delivery_log",
    expiresAt: new Date(Date.now() + 60_000),
  });

  await onIntentChange(fakeIo(), intent, fakeSafeFetchOk());

  const deliveries = await WebhookDelivery.find({ merchantId: merchant.id });
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.intentId).toBe(intent.id);
  expect(deliveries[0]?.eventType).toBe("payment_intent.settled");
  expect(deliveries[0]?.delivered).toBe(true);
  expect(deliveries[0]?.attempts).toBe(1);
  expect(deliveries[0]?.lastStatus).toBe("delivered");
});

test("onIntentChange does not throw when persisting the delivery log fails (best-effort, matches deliver()'s own contract)", async () => {
  const merchant = await Merchant.create({
    publicId: "merch_test_delivery_log_2",
    oxyAppId: "app_delivery_log_fail",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://merchant.example/hook",
    webhookSecret: "whsec_log_fail",
  });
  const intent = await PaymentIntent.create({
    id: "pi_0000000000000000000000d2",
    status: "settled",
    amount: "100000000",
    network: "testnet",
    address: "TVdQEadb9Yurh3QCBf1vwjZxNySQvHxFmk",
    merchantId: merchant.id,
    clientSecret: "pi_0000000000000000000000d2_secret_y",
    idempotencyKey: "idem_delivery_log_fail",
    expiresAt: new Date(Date.now() + 60_000),
  });

  const createSpy = spyOn(WebhookDelivery, "create").mockRejectedValue(
    new Error("simulated write failure"),
  );
  try {
    await expect(onIntentChange(fakeIo(), intent, fakeSafeFetchOk())).resolves.toBeUndefined();
  } finally {
    createSpy.mockRestore();
  }
});
```

- [x] **Step 8: Run to verify it fails.**

Run: `bun test packages/backend/src/__tests__/onIntentChange.test.ts`
Expected: FAIL — `onIntentChange` is not exported from `server.ts`; no `WebhookDelivery` is persisted today.

- [x] **Step 9: Export and update `onIntentChange` in `server.ts`.**

```ts
// server.ts — add the import
import { WebhookDelivery } from "./models/WebhookDelivery";
```

```ts
/**
 * When the watcher advances an intent, fan the change out to both transports:
 * the payer's realtime socket room AND the merchant's signed webhook. Webhook
 * delivery is best-effort (never throws) so it cannot stall the watcher.
 * Exported for direct testing (`__tests__/onIntentChange.test.ts`).
 */
export async function onIntentChange(
  io: SocketServer,
  intent: HydratedPaymentIntentDoc,
  safeFetch: SafeFetchFn | undefined,
): Promise<void> {
  emitIntentUpdate(io, intent);

  const eventType = WEBHOOK_EVENT_FOR[intent.status];
  if (eventType === undefined) return;

  const merchant = await Merchant.findById(intent.merchantId);
  if (!merchant || !merchant.webhookUrl || !merchant.webhookSecret) return;

  const event = buildEvent(eventType, toPaymentIntentDTO(intent));
  const outcome = await deliver(
    event,
    { url: merchant.webhookUrl, secret: merchant.webhookSecret },
    safeFetch ? { safeFetch } : {},
  );

  // Persisting the delivery log is best-effort, same as `deliver()` itself —
  // a transient Mongo write failure here must never abort the settlement
  // watcher's poll loop (`SettlementWatcher.check()` awaits `onChange` inline
  // per intent, with no per-iteration try/catch of its own — see
  // `settlementWatcher.ts:79-88`).
  try {
    await WebhookDelivery.create({
      merchantId: merchant.id,
      intentId: intent.id,
      eventId: event.id,
      eventType,
      url: merchant.webhookUrl,
      attempts: outcome.attempts,
      delivered: outcome.delivered,
      lastStatus: outcome.delivered ? "delivered" : "failed",
    });
  } catch (error) {
    process.emitWarning(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}
```

- [x] **Step 10: Run to verify the tests pass.**

Run: `bun test packages/backend/src/__tests__/onIntentChange.test.ts`
Expected: PASS.

- [x] **Step 11: Extend `e2e.test.ts`'s existing "atomic flow" test with a WebhookDelivery assertion** (append, right after the existing webhook-signature assertion block, before the non-custody-invariant check):

```ts
  // 7b. The delivery was also persisted (F2.0 task 4).
  const deliveryLog = await WebhookDelivery.find({ merchantId: (await Merchant.findOne({ oxyAppId: APP_ID }))?.id });
  expect(deliveryLog.length).toBeGreaterThan(0);
  const lastDelivery = deliveryLog.at(-1);
  expect(lastDelivery?.delivered).toBe(true);
  expect(lastDelivery?.intentId).toBe(created.id);
```

Add the import at the top of `e2e.test.ts`:

```ts
import { WebhookDelivery } from "../models/WebhookDelivery";
```

- [x] **Step 12: Run the full backend suite.**

Run: `cd ~/Oxy/OxyPay && bun test packages/backend/src`
Expected: all PASS.

- [x] **Step 13: Commit.**

```bash
git add packages/shared-types/src/webhookDelivery.ts packages/shared-types/src/index.ts \
  packages/backend/src/models/WebhookDelivery.ts packages/backend/src/lib/serialize.ts \
  packages/backend/src/server.ts packages/backend/src/__tests__/onIntentChange.test.ts \
  packages/backend/src/models/__tests__/models.test.ts packages/backend/src/__tests__/e2e.test.ts
git commit -m "feat(gateway): persist a WebhookDelivery log entry per delivery attempt"
```

---

### Task 13: [Gateway] `POST /v1/webhook_deliveries/:id/redeliver`

> ✅ **DONE** — commit `12b96ca`; task-review Approved (0 issues). IDOR-safe combined {_id,merchantId} filter + isValidObjectId gate. Follow-up: gate under payments:write. **← Fase2 F2.0 COMPLETE (13/13).** 2026-07-19.

**Files:**
- Create: `packages/backend/src/routes/webhookDeliveries.ts`
- Create: `packages/backend/src/routes/__tests__/webhookDeliveries.test.ts`
- Modify: `packages/backend/src/server.ts` (mount the router)

**Interfaces:**
- Consumes: `resolveMerchant` (exported, Task 6), `buildEvent`/`deliver` (`webhookDispatcher.ts`, unchanged), `toWebhookDeliveryDTO` (Task 12), `toPaymentIntentDTO`.
- Produces: `createWebhookDeliveriesRouter(deps: { requireMerchant: RequestHandler }): Router` with `POST /v1/webhook_deliveries/:id/redeliver`.

- [x] **Step 1: Write the failing tests.**

```ts
// packages/backend/src/routes/__tests__/webhookDeliveries.test.ts
import {
  test,
  expect,
  beforeAll,
  afterAll,
  describe,
} from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import express from "express";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { OxyAuthRequest, SafeFetchResult } from "@oxyhq/core/server";
import { Merchant } from "../../models/Merchant";
import { PaymentIntent } from "../../models/PaymentIntent";
import { WebhookDelivery } from "../../models/WebhookDelivery";
import { createWebhookDeliveriesRouter } from "../webhookDeliveries";

const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";
const APP_ID = "app_redeliver";

const stubRequireMerchant: RequestHandler = (req, _res, next) => {
  (req as OxyAuthRequest).serviceApp = {
    appId: APP_ID,
    appName: "t",
    scopes: [],
    credentialId: "c",
    environment: "development",
  };
  next();
};

let mongod: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let merchantId: string;
let intentId: string;
let deliveryId: string;

const capturedFetches: string[] = [];
const fakeSafeFetch = async (url: string): Promise<SafeFetchResult> => {
  capturedFetches.push(url);
  const response = new IncomingMessage(new Socket());
  return { response, status: 200, headers: {}, finalUrl: url };
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Merchant.init();
  await PaymentIntent.init();

  const merchant = await Merchant.create({
    publicId: "merch_test_redeliver_1",
    oxyAppId: APP_ID,
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://merchant.example/hook",
    webhookSecret: "whsec_redeliver",
  });
  merchantId = merchant.id;

  const intent = await PaymentIntent.create({
    id: "pi_0000000000000000000000f1",
    status: "settled",
    amount: "100000000",
    network: "testnet",
    address: "TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3",
    merchantId: merchant.id,
    clientSecret: "pi_0000000000000000000000f1_secret_x",
    idempotencyKey: "idem_redeliver",
    expiresAt: new Date(Date.now() + 60_000),
  });
  intentId = intent.id;

  const delivery = await WebhookDelivery.create({
    merchantId: merchant.id,
    intentId: intent.id,
    eventId: "evt_0000000000000000000000f1",
    eventType: "payment_intent.settled",
    url: "https://merchant.example/hook",
    attempts: 3,
    delivered: false,
    lastStatus: "failed",
  });
  deliveryId = delivery.id;

  const app = express();
  app.use(express.json());
  app.use(
    createWebhookDeliveriesRouter({
      requireMerchant: stubRequireMerchant,
      safeFetch: fakeSafeFetch,
    }),
  );
  server = app.listen(0);
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await mongoose.disconnect();
  await mongod.stop();
});

describe("POST /v1/webhook_deliveries/:id/redeliver", () => {
  test("redelivers and persists a NEW delivery row", async () => {
    const before = await WebhookDelivery.countDocuments({ merchantId });
    const res = await fetch(`${baseUrl}/v1/webhook_deliveries/${deliveryId}/redeliver`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { delivered: boolean; intentId: string };
    expect(body.delivered).toBe(true);
    expect(body.intentId).toBe(intentId);
    expect(capturedFetches.at(-1)).toBe("https://merchant.example/hook");

    const after = await WebhookDelivery.countDocuments({ merchantId });
    expect(after).toBe(before + 1);
  });

  test("unknown delivery id -> 404", async () => {
    const res = await fetch(
      `${baseUrl}/v1/webhook_deliveries/${new mongoose.Types.ObjectId().toString()}/redeliver`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });

  test("malformed id (not an ObjectId) -> 404, no CastError 500", async () => {
    const res = await fetch(`${baseUrl}/v1/webhook_deliveries/not-an-object-id/redeliver`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  test("a delivery belonging to a different merchant -> 404 (never leaks cross-tenant)", async () => {
    const otherMerchant = await Merchant.create({
      publicId: "merch_test_redeliver_other",
      oxyAppId: "app_redeliver_other",
      environment: "development",
      network: "testnet",
      xpub: XPUB,
    });
    const otherIntent = await PaymentIntent.create({
      id: "pi_0000000000000000000000f2",
      status: "settled",
      amount: "100000000",
      network: "testnet",
      address: "TVdQEadb9Yurh3QCBf1vwjZxNySQvHxFmk",
      merchantId: otherMerchant.id,
      clientSecret: "pi_0000000000000000000000f2_secret_y",
      idempotencyKey: "idem_redeliver_other",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const otherDelivery = await WebhookDelivery.create({
      merchantId: otherMerchant.id,
      intentId: otherIntent.id,
      eventId: "evt_0000000000000000000000f2",
      eventType: "payment_intent.settled",
      url: "https://other.example/hook",
      attempts: 1,
      delivered: true,
      lastStatus: "delivered",
    });

    const res = await fetch(`${baseUrl}/v1/webhook_deliveries/${otherDelivery.id}/redeliver`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});
```

- [x] **Step 2: Run to verify it fails.**

Run: `cd ~/Oxy/OxyPay && bun test packages/backend/src/routes/__tests__/webhookDeliveries.test.ts`
Expected: FAIL — `../webhookDeliveries` module does not exist.

- [x] **Step 3: Implement `routes/webhookDeliveries.ts`.**

```ts
// packages/backend/src/routes/webhookDeliveries.ts
import { Router } from "express";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { PaymentIntent } from "../models/PaymentIntent";
import { WebhookDelivery } from "../models/WebhookDelivery";
import { buildEvent, deliver, type SafeFetchFn } from "../services/webhookDispatcher";
import { toPaymentIntentDTO, toWebhookDeliveryDTO } from "../lib/serialize";
import { sendError, wrap } from "../lib/http";
import { resolveMerchant } from "./paymentIntents";

/**
 * Build the webhook-delivery REST router (F2.0 task 4's "reenviar" button).
 * `requireMerchant` follows the same injectable-default pattern as the other
 * routers; `safeFetch` is separately injectable so tests can capture the
 * outbound request without a real network call, mirroring how `createGateway`
 * already injects it for the settlement watcher's own webhook delivery.
 */
export function createWebhookDeliveriesRouter(deps: {
  requireMerchant: RequestHandler;
  safeFetch?: SafeFetchFn;
}): Router {
  const { requireMerchant, safeFetch } = deps;
  const router = Router();

  router.post(
    "/v1/webhook_deliveries/:id/redeliver",
    requireMerchant,
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;

      if (!mongoose.isValidObjectId(req.params.id)) {
        sendError(res, 404, "invalid_request_error", "webhook delivery not found");
        return;
      }

      const delivery = await WebhookDelivery.findOne({
        _id: req.params.id,
        merchantId: merchant.id,
      });
      if (!delivery) {
        sendError(res, 404, "invalid_request_error", "webhook delivery not found");
        return;
      }

      const intent = await PaymentIntent.findOne({
        id: delivery.intentId,
        merchantId: merchant.id,
      });
      if (!intent) {
        sendError(
          res,
          404,
          "invalid_request_error",
          "the payment intent for this delivery no longer exists",
        );
        return;
      }

      if (!merchant.webhookUrl || !merchant.webhookSecret) {
        sendError(res, 422, "invalid_request_error", "merchant has no webhook configured");
        return;
      }

      const event = buildEvent(delivery.eventType, toPaymentIntentDTO(intent));
      const outcome = await deliver(
        event,
        { url: merchant.webhookUrl, secret: merchant.webhookSecret },
        safeFetch ? { safeFetch } : {},
      );

      const redelivery = await WebhookDelivery.create({
        merchantId: merchant.id,
        intentId: intent.id,
        eventId: event.id,
        eventType: delivery.eventType,
        url: merchant.webhookUrl,
        attempts: outcome.attempts,
        delivered: outcome.delivered,
        lastStatus: outcome.delivered ? "delivered" : "failed",
      });

      res.status(200).json(toWebhookDeliveryDTO(redelivery));
    }),
  );

  return router;
}
```

- [x] **Step 4: Run to verify the tests pass.**

Run: `bun test packages/backend/src/routes/__tests__/webhookDeliveries.test.ts`
Expected: PASS.

- [x] **Step 5: Mount the router in `server.ts`.**

```ts
// server.ts — add the import
import { createWebhookDeliveriesRouter } from "./routes/webhookDeliveries";
```

```ts
// server.ts — inside createGateway(), after mounting createMerchantsRouter
  app.use(createMerchantsRouter({ requireMerchant }));
  app.use(
    createWebhookDeliveriesRouter({ requireMerchant, safeFetch: deps.safeFetch }),
  );
```

- [x] **Step 6: Run the full backend suite.**

Run: `bun test packages/backend/src`
Expected: all PASS.

- [x] **Step 7: Commit.**

```bash
git add packages/backend/src/routes/webhookDeliveries.ts \
  packages/backend/src/routes/__tests__/webhookDeliveries.test.ts packages/backend/src/server.ts
git commit -m "feat(gateway): POST /v1/webhook_deliveries/:id/redeliver"
```

---

## Self-Review

**Spec §3 coverage** — every F2.0 task maps to a plan task:
- Tarea 1a (network cross-check bug) → Task 1.
- Tarea 1b (two Merchant docs per environment; `environment` upstream on the service JWT + publish gate) → Tasks 2, 3, 6.
- Tarea 2 (`POST/GET/PATCH /v1/merchants` + `payments:read`/`payments:write` scopes) → Tasks 5, 7, 8, 9.
- Tarea 3 (`GET /v1/payment_intents` list + payer-authed `GET .../:id`) → Tasks 10, 11.
- Tarea 4 (`WebhookDelivery` model + persist + redeliver route) → Tasks 12, 13.
- Tarea 5 (`newId()` extended for `merch_`/`link_`/`cs_`) → Task 7.
- "Qué NO se cierra" (multi-endpoint `WebhookEndpoint`, `addressindex`) — deliberately not planned as code here; `WebhookDelivery.merchantId` (not an endpoint id) is explicitly designed additive-first per spec's own framing (Task 12's design note).

**Cross-repo dependency + publish gate** — explicit: Task 2 (upstream oxy-api mint + `@oxyhq/core` verify, one isolated PR) → Task 3 (publish `@oxyhq/core`, verify propagation via a clean external install, THEN bump the Gateway's dependency) → every later Gateway task consumes the published symbols, never workspace-local source.

**Non-custody/MiCA invariant** — preserved on every new surface: `POST /v1/merchants` (Task 8) writes `xpub` through the SAME unchanged `pre('validate')` firewall; no route in this plan adds a private-key-shaped field anywhere. `PATCH /v1/merchants/me` (Task 9) explicitly excludes `xpub`/`network`/`environment` from its whitelist so the derivation key can never be mutated post-registration.

**Security fix ordering** — Task 1 (data-integrity bugfix) and the environment isolation (Tasks 2, 3, 6) are sequenced first, exactly as instructed, ahead of every feature-adding task.

**Deviations from the literal task-lead ordering, both load-bearing, both flagged inline where they occur:**
1. `newId()` extension (spec's tarea 5, described last) is sequenced as Task 7, immediately before merchant registration (Task 8) — Task 8 has a hard compile-time dependency on `newId('merch')` existing.
2. `payments:read`/`payments:write` scopes (Task 5) are sequenced just before Task 7/8 rather than folded into "merchant routes" — kept as its own upstream task since it is a separate repo/PR from the Gateway-side merchant routes, following the same "upstream first" pattern as Task 2.

**No placeholders** — every step above shows complete, load-bearing code (full functions/route handlers/test files), not descriptions of what to write.

**Assumptions to verify with the team lead / spec owner before or during execution:**
1. **Two independently-discovered, pre-existing defects, bundled into this plan rather than filed as separate tickets — confirm this is the right call:** (a) the service-token mint never sets `iss`/`aud` claims, so `@oxyhq/core`'s `oxy.auth()`/`oxy.serviceAuth()` rejects every real service token today (fixed in Task 2); (b) the Gateway's own `paymentIntents.ts:111` calls `oxyClient.serviceAuth()` with no `jwtSecret`, so even with (a) fixed, the Gateway itself never verified a real token (fixed in Task 4). Both are corroborated by tracing the real code (cited file:line throughout), not assumed — but both are surface area beyond the spec's literal task list and touch the shared `@oxyhq/core` auth path other services may also depend on. Recommend security-reviewer sign-off on Task 2 and Task 4 specifically, given the shared-SDK blast radius.
2. **`Merchant.publicId` instead of a literal `id` field** — a deliberate deviation from mirroring `PaymentIntent.id` verbatim, to avoid shadowing Mongoose's auto `id` virtual that `reserveNextAddress`/every `PaymentIntent.merchantId` write already depends on. The wire DTO still exposes it as `id` (Stripe-parity preserved at the contract boundary); only the internal Mongoose field name differs. Flag for confirmation that this satisfies the spec's intent.
3. **`WebhookDelivery.intentId`** added beyond the spec's literal field list — necessary for the redeliver route to have anything to redeliver. Flag for confirmation.
4. **No production `Merchant` documents exist yet** (spec's own tarea 2 text: "no hay ninguna ruta expuesta hoy" — only a non-persisting test-vector script exists) — Task 6's compound-unique-index change and Task 8's new required `publicId`/`environment` fields are therefore assumed to need NO data migration. Confirm before running Task 6/8 against a real database that already has Merchant documents, if one has been created out-of-band since the spec was written.
5. **`OXY_ACCESS_TOKEN_SECRET` provisioning** (Task 4) is an infra/secrets step (SSM), explicitly called out as out of scope for this code plan — needs a matching oxy-infra/deploy-secrets task, not assumed to already exist.
6. **Scope-gating scope:** only the NEW merchant routes (Task 8/9) enforce `payments:read`/`payments:write` via `oxyClient.requireScope(...)`. The existing F1 payment-intent routes (create/retrieve/reject/list/payer-GET) are deliberately left unscoped, matching their current (F1) unscoped behavior — retrofitting scope enforcement onto them is out of scope for this plan and would need its own migration story for already-provisioned credentials. Flag for confirmation this is the intended boundary.
