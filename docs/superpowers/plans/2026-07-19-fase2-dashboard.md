# Oxy Pay — F2.5: Dashboard (standalone) Implementation Plan

> ## 🟡 EXECUTION STATUS (2026-07-19): backend (Phase 0) DONE; app (Phase 1) blocked on owner
> Phase 0 Tasks 1-2 (`/v1/dashboard/*` routes: human auth + oxy-api RBAC delegation, fail-closed; + refactor to shared cores; + createOxyCors appOrigins fix) ✅ — commit `a303191`, backend 214/214, reviewed Approved (RBAC fail-closed verified vs real oxy-api contract). **Phase 1 (packages/dashboard Vite app, Tasks 3-8) BLOCKED on an owner-registered Console Oxy Application → its clientId (VITE_OXY_CLIENT_ID).** Detail: `.superpowers/sdd/progress.md`.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Design authority:** `docs/superpowers/specs/2026-07-18-oxypay-fase2-gateway-dashboard.md` §8 (owner-approved, binding). Owner decisions that are NOT re-litigated: dashboard is a **standalone Vite app** (same stack as Oxy Console, NOT a Console tab); it **shares Console's Application/token system** for developer login (via oxy-api's app-permission check — zero duplicated RBAC) but its **data backend is the Gateway itself** (`api.pay.oxy.so`). **Invoices are explicitly OUT of scope** (spec §9) — do not build any invoice UI/route.

**Goal:** Ship `dashboard.pay.oxy.so` — a standalone Vite + react-native-web + `@oxyhq/services` app (mirroring Oxy Console) where a human Oxy user who is a member of a merchant's `Application` manages that merchant's Oxy Pay integration: **Payments** (list + detail), **Merchant setup** (register watch-only xpub), **Webhooks** (endpoint config + delivery logs + redeliver), **API keys** (create/rotate/revoke via oxy-api), and a **Test/Live** environment toggle. Plus the Gateway's new **`/v1/dashboard/*`** route family that authorizes a human session against oxy-api's RBAC.

**Architecture / the third identity:** the Gateway today knows two identities — merchant (`ApplicationCredential` service token) and payer (`client_secret`). A logged-in dashboard user is a **third**: an Oxy user who needs read/write on a `Merchant` bound to an `Application` they may not have created. Mechanism (owner decision, spec §8): the Gateway mounts `requireOxyAuth` (`@oxyhq/core/server`) on a **separate** route family `/v1/dashboard/*` (kept apart from `/v1/payment_intents/*`, which stays purely service-auth — never mix two auth strategies in one handler). Per request, the Gateway forwards the user's bearer to oxy-api `GET /applications/:applicationId` (gated by `requireAppPermission('app:read')`), reads `callerMembership` from the response, and requires it be non-null before resolving that Application's `Merchant`/`PaymentIntent`s (by `environment`, F2.0 task 1b). **Zero RBAC duplication** — the Gateway never re-implements `AccountMember`/`ApplicationPermission`; it delegates the authorization decision to oxy-api and caches the boolean result with a short TTL keyed `userId:applicationId:environment`.

**Tech Stack:** Vite (rolldown-vite) + `vite-plugin-react-native-web` + react-native-web + `@oxyhq/services` (`OxyProvider`/`useOxy`) + `@oxyhq/bloom` + Tailwind v4 — the SAME stack as Console (mirror it exactly; see recon). Backend additions are plain Express routers on the existing Gateway. `bun` workspace.

## Global Constraints

- **Zero RBAC duplication (hard rule, spec §0.1/§8).** The Gateway authorizes a dashboard request ONLY by forwarding the user bearer to oxy-api `GET /applications/:applicationId` and checking `callerMembership != null`. It NEVER reads/reimplements `AccountMember`, `ApplicationPermission`, or account roles. If a finer permission than `app:read` is needed later, extend the oxy-api check — never a local ACL.
- **Two auth strategies, two route families — never mixed.** `/v1/dashboard/*` = `requireOxyAuth` (human). `/v1/payment_intents/*`, `/v1/merchants/*`, `/v1/payment_links/*`, `/v1/checkout_sessions/*` = service-auth/payer. A single handler never accepts both. `/v1/dashboard/*` handlers reuse the SAME models/services/serializers (`toPaymentIntentDTO`, `toMerchantDTO`, `toWebhookDeliveryDTO`, `resolveMerchant`-equivalent by application+environment) — only the auth + the merchant-resolution key differ.
- **Environment is a first-class dimension.** Every dashboard data route is scoped by `{ applicationId, environment }` (F2.0 task 1b) — the Test/Live toggle changes which `environment` (and thus which `Merchant` doc) the dashboard reads/writes, NOT a mutable field on one merchant. A `development`/`staging` session may only touch a testnet merchant; the same firewall as `POST /v1/merchants` applies to the dashboard's merchant-register route.
- **Standalone, not a Console fork of code.** The dashboard registers its OWN Oxy `Application` (its own `clientId` to mount `OxyProvider`), distinct from each merchant Application it manages (spec §8). Console's React components (`credentials-section.tsx`) are NOT importable (they live in Console's internal stack) — the dashboard builds its own UI; what it reuses UNCHANGED are the **oxy-api routes** (`/applications/:id/credentials`) and the Gateway routes.
- **Canonical media / SDK patterns (ecosystem rules).** Avatars via the `ImageResolverProvider` + Bloom `Avatar` with bare file ids (never `cloud.oxy.so`). Backend calls via `oxyServices.createLinkedClient({ baseURL: gatewayUrl })` — the user's bearer rides automatically; no app-local token provider or manual `Authorization`. `OxyProvider` mounted once at root with the dashboard's `clientId`.
- **Non-custody + gate.** The dashboard shows a merchant's watch-only `xpub` and lets them register one — it NEVER accepts or displays a private key (the `Merchant` model's `pre('validate')` firewall already rejects an `xprv`; the UI must surface that error clearly). `security-reviewer` MUST review the dashboard + `/v1/dashboard/*` diff before it manages any `production`/mainnet merchant (spec §2 — a human-session surface not covered by the F1 audit).
- **Clean code:** no `as any`, `@ts-ignore`, `!`, `var`, `console.log`, silent `catch {}`, TODO/HACK, barrel/re-export shims. Explicit field whitelists on writes. Avoid `useEffect` for data (React Query). Commit `bun.lock` with each `package.json` change.

---

## File Structure

```
packages/backend/src/
  routes/dashboard.ts                     # NEW — /v1/dashboard/* (requireOxyAuth + app-membership gate)
  services/appMembership.ts               # NEW — forward bearer to oxy-api GET /applications/:id, cache callerMembership (TTL)
  server.ts                               # wire createDashboardRouter (requireOxyUser default = createOxyAuthMiddleware(oxyClient))

packages/dashboard/                       # NEW — @oxypay/dashboard (private), Vite RN-Web app, dashboard.pay.oxy.so
  package.json                            # mirror Console deps/scripts
  vite.config.ts                          # mirror Console (rolldown-vite + vite-plugin-react-native-web)  [RECON]
  index.html
  tsconfig.json  postcss/tailwind config  global.css
  .env.example                            # VITE_OXY_CLIENT_ID, VITE_GATEWAY_URL, VITE_OXY_API_URL
  src/
    main.tsx                              # OxyProvider (dashboard clientId) + BloomThemeProvider + ImageResolverProvider + Router  [mirror Console root]
    lib/
      gatewayClient.ts                    # oxyServices.createLinkedClient({ baseURL: gatewayUrl })
      queries.ts                          # React Query hooks over the /v1/dashboard/* routes
      appContext.tsx                      # selected applicationId + environment (Test/Live) context
    routes/
      Login.tsx                           # signed-out → useOxy().signIn() modal
      AppPicker.tsx                       # choose which of the user's Applications to manage
      Overview.tsx
      Payments.tsx  PaymentDetail.tsx
      MerchantSetup.tsx                   # register/edit watch-only xpub + requiredConfirmations
      Webhooks.tsx                        # endpoint config + delivery logs + redeliver
      ApiKeys.tsx                         # credentials CRUD via oxy-api  [own UI, oxy-api routes]
    components/
      TestLiveToggle.tsx  StatusBadge.tsx  DataTable.tsx  ...
```

---

## Phase 0 — Gateway: `/v1/dashboard/*` route family (human auth)

### Task 1: app-membership authorization service (delegate to oxy-api RBAC)

**Files:** create `services/appMembership.ts`.

**Interface — Produces:**
```ts
export interface AppMembershipResult { allowed: boolean; }
// Forwards the caller's bearer to oxy-api GET /applications/:applicationId, returns whether callerMembership != null.
export async function assertAppMembership(
  applicationId: string,
  userBearer: string,
): Promise<AppMembershipResult>;
```
- Calls oxy-api `GET {OXY_API_URL}/applications/:applicationId` with `Authorization: Bearer <userBearer>` (the route is gated by `requireAppPermission('app:read')`; response carries `callerMembership` — exact shape from recon). Non-null `callerMembership` ⇒ allowed. A 403/404 from oxy-api ⇒ not allowed (do not leak which).
- **Cache** the boolean with a short TTL (e.g. 30–60s) keyed `${userId}:${applicationId}` (userId from `req.oxyUserId`) so a dashboard that fires several data requests per view doesn't hammer oxy-api. Use a module-level `Map` + timestamp OR the ecosystem's cache pattern; if `setInterval` sweeps it, call `.unref?.()` (AGENTS.md). Invalidate on a short TTL only — membership changes are rare and eventual-consistency of ≤60s is acceptable (document it).
- `oxyClient` (`@oxyhq/core`) is already configured with `OXY_API_URL` (same client `serviceAuth()`/`authSocket()` use) — reuse it to issue the forwarded GET; do not stand up a new HTTP client. **[RECON: confirm how to issue a bearer-forwarded GET through `oxyClient` — a raw client method vs `safeFetch` to the configured api URL.]**

- [ ] **Step 1:** Implement `assertAppMembership` + the TTL cache.
- [ ] **Step 2:** Unit tests with a stubbed oxy-api: non-null membership → allowed; null/403 → denied; cache hit avoids a second upstream call; TTL expiry re-checks. Commit.

### Task 2: `/v1/dashboard/*` router

**Files:** create `routes/dashboard.ts`; modify `server.ts`.

**Routes (all `requireOxyAuth` + `assertAppMembership(:applicationId)` + `environment` query/param):**
- `GET  /v1/dashboard/applications/:applicationId/merchant` → the `Merchant` for `{oxyAppId: applicationId, environment}` (or 404 "no merchant for this environment") via `toMerchantDTO`.
- `POST /v1/dashboard/applications/:applicationId/merchant` → register a watch-only xpub for `{applicationId, environment}` — same body + `pre('validate')` firewall + testnet-only-for-non-production firewall as `POST /v1/merchants`. (Dashboard-authed equivalent of F2.0 task 2's register route.)
- `PATCH /v1/dashboard/applications/:applicationId/merchant` → edit `webhookUrl`/`webhookSecret`/`requiredConfirmations`/display fields (same whitelist as `PATCH /v1/merchants/me`; never xpub/network/environment).
- `GET  /v1/dashboard/applications/:applicationId/payment_intents` → the SAME list logic as `GET /v1/payment_intents` (`paymentIntents.ts:218-267` — pagination + status filter), but the merchant is resolved by `{applicationId, environment}` instead of `req.serviceApp`. Extract the list body into a shared helper so it is not copy-pasted.
- `GET  /v1/dashboard/applications/:applicationId/payment_intents/:id` → single, by `{merchantId, id}`, `toPaymentIntentDTO`.
- `GET  /v1/dashboard/applications/:applicationId/webhook_deliveries` → list `WebhookDelivery` for the resolved merchant (paginated), `toWebhookDeliveryDTO`.
- `POST /v1/dashboard/applications/:applicationId/webhook_deliveries/:id/redeliver` → reuse the redeliver logic from `webhookDeliveries.ts` (extract its core so the dashboard route and the merchant-authed route share one implementation).

> **Merchant resolution helper:** add `resolveMerchantByApp(applicationId, environment)` (a sibling of `resolveMerchant` in `paymentIntents.ts`, which resolves from `req.serviceApp`). The dashboard router resolves this way; the existing service-authed router keeps using `resolveMerchant`. Both hit `Merchant.findOne({ oxyAppId, environment })` — factor that single query so there is one owner of "find a merchant by app+env".

- [ ] **Step 1:** Implement `createDashboardRouter({ requireOxyUser })` with the routes above. Each handler: `assertAppMembership(req.params.applicationId, bearer)` → 403 if denied → resolve environment (query `?environment=`, validated against `OXY_SERVICE_ENVIRONMENTS`) → resolve merchant by app+env → do the read/write reusing existing serializers/services.
- [ ] **Step 2:** Extract the shared list-payment-intents body + the redeliver core so dashboard and service-authed routes share them (no duplication).
- [ ] **Step 3:** Wire in `server.ts`: `requireOxyUser` default = `createOxyAuthMiddleware(oxyClient)` (already a `GatewayDeps` field, `server.ts:69`). Ensure `dashboard.pay.oxy.so` is in `config.allowedOrigins` (CORS) — the app is a browser origin.
- [ ] **Step 4:** Integration tests (mirror `routes/__tests__/*`): membership allowed vs denied (stub `assertAppMembership`), environment scoping (dev session cannot read the production merchant's intents), merchant register firewall (non-production → testnet only), redeliver parity. `bun test` PASS. Commit.

---

## Phase 1 — the dashboard Vite app

### Task 3: scaffold `packages/dashboard` mirroring Oxy Console

**Files:** create the `packages/dashboard` skeleton. **[RECON: copy Console's `package.json`, `vite.config.*`, tailwind/postcss config, tsconfig, and root provider file — mirror exactly, changing name + clientId env.]**

- [ ] **Step 1:** `package.json` — name `@oxypay/dashboard`, `private:true`, scripts (`dev`/`build`/`preview`/`typecheck`) copied from Console. Deps mirror Console: `vite` (rolldown-vite), `vite-plugin-react-native-web`, `react`, `react-dom`, `react-native-web`, `@oxyhq/services`, `@oxyhq/core`, `@oxyhq/bloom`, `@tanstack/react-query`, a router (whatever Console uses — recon), `@oxypay/shared-types` (published `^0.2.0` from the SDK plan Task 1, or workspace during dev). Tailwind v4 + the Bloom CSS-var contract (recon: exact tailwind/postcss files).
- [ ] **Step 2:** `vite.config.ts` — mirror Console's plugin list (rolldown-vite + `vite-plugin-react-native-web`) exactly. `index.html`, `global.css`, tailwind/postcss config from Console.
- [ ] **Step 3:** `.env.example` — `VITE_OXY_CLIENT_ID` (the dashboard's OWN registered Application clientId), `VITE_GATEWAY_URL` (default `https://api.pay.oxy.so`), `VITE_OXY_API_URL`. `src/lib/config.ts` typed reader.
- [ ] **Step 4:** `src/main.tsx` — hoist `BloomThemeProvider` to the very top (AGENTS.md ordering rule), then `OxyProvider` with the dashboard `clientId`, `ImageResolverProvider value={(id,variant)=>oxyServices.getFileDownloadUrl(id,variant)}`, `QueryClientProvider`, Router. Mirror Console's root exactly. **[RECON: Console's exact provider nesting.]**
- [ ] **Step 5:** `bun run --filter @oxypay/dashboard build` succeeds on the empty shell (renders a "signed out" screen). Verify in a real foregrounded browser cold start (AGENTS.md: `useTheme`/boot-mount crashes are runtime-only). Commit.

### Task 4: auth shell + app picker + Test/Live context

**Files:** `src/routes/Login.tsx`, `AppPicker.tsx`, `src/lib/appContext.tsx`, `src/lib/gatewayClient.ts`.

- `gatewayClient.ts` = `oxyServices.createLinkedClient({ baseURL: config.gatewayUrl })` (the user bearer rides automatically; no manual auth — same pattern as the wallet's `gateway-client.ts`).
- `appContext.tsx` — React context holding the selected `applicationId` + `environment` ('development'|'production' toggle; map to test/live). Every dashboard query reads these.
- [ ] **Step 1:** `Login` — when `useOxy()`/`useAuth()` is signed out, render a neutral screen with a "Sign in" button calling `signIn()` (the in-app SDK modal — never a redirect, ecosystem rule). The root Router owns the signed-in↔signed-out swap (expo-router group rule analog: one authority for the boundary).
- [ ] **Step 2:** `AppPicker` — list the user's Applications (from oxy-api; the user picks which merchant integration to manage). **[RECON: the oxy-api route that lists a user's Applications + its response shape.]** Persist the selection in `appContext`.
- [ ] **Step 3:** `TestLiveToggle` writes `environment` into `appContext`; all queries re-fetch on change. Commit.

### Task 5: Payments (list + detail)

**Files:** `src/routes/Payments.tsx`, `PaymentDetail.tsx`, `src/lib/queries.ts`.

- React Query hooks over `GET /v1/dashboard/applications/:applicationId/payment_intents?environment=…` (list, `starting_after`/`limit`/`status` — Stripe pagination) and `…/payment_intents/:id`. Render `toPaymentIntentDTO` fields directly (amount via `formatFair`, status badge, address, txid link to the explorer via `@fairco.in/core` `explorerTxUrl`, metadata, timestamps).
- [ ] **Step 1:** `queries.ts` list + detail hooks keyed by `[applicationId, environment, …]` so the Test/Live toggle and app switch invalidate correctly.
- [ ] **Step 2:** `Payments` table (`DataTable` + `StatusBadge`) with status filter + "load more". `PaymentDetail` panel.
- [ ] **Step 3:** Component tests with a stubbed gateway client. Commit.

### Task 6: Merchant setup (watch-only xpub)

**Files:** `src/routes/MerchantSetup.tsx`.

- [ ] **Step 1:** Form to register a watch-only `xpub` + `requiredConfirmations` (+ optional display name/avatar/description) via `POST /v1/dashboard/applications/:applicationId/merchant`. On the `pre('validate')` firewall error (a private key was pasted), surface a clear "that is a private key — paste a watch-only xpub" message. Show the derived environment/network (test/live) prominently so the user knows which they're configuring.
- [ ] **Step 2:** Edit path via `PATCH …/merchant` (display fields + confirmations; never xpub/network). Show the existing `xpub` read-only when set.
- [ ] **Step 3:** Enforce the firewall UX: a `development`/`staging` (test) context can only register a testnet merchant — reflect the 422 clearly. Component tests. Commit.

### Task 7: Webhooks (config + logs + redeliver) + API keys

**Files:** `src/routes/Webhooks.tsx`, `ApiKeys.tsx`.

- **Webhooks:** config = `PATCH …/merchant` (`webhookUrl`/`webhookSecret`); logs = `GET …/webhook_deliveries` (paginated, show `eventType`/`delivered`/`attempts`/`lastStatus`/time); "Redeliver" button = `POST …/webhook_deliveries/:id/redeliver`. Show the merchant's current webhook secret masked with a reveal.
- **API keys:** the dashboard's own UI over the UNCHANGED oxy-api credentials routes (`/applications/:id/credentials` create/rotate/revoke — **[RECON: exact routes + request/response shapes; confirm create returns the plaintext secret once]**). Show `publicKey`, environment, created date; create shows the secret once with a copy affordance + "you won't see this again"; rotate/revoke with confirmation. This talks to **oxy-api**, not the Gateway (`config.oxyApiUrl`), via a linked client to that base URL.
- [ ] **Step 1:** Webhooks config + logs table + redeliver, over the Gateway dashboard routes.
- [ ] **Step 2:** API keys panel over oxy-api credentials routes (own UI, zero new backend). Handle the show-once secret carefully (never persist it in state longer than needed; never log it).
- [ ] **Step 3:** Component tests. Commit.

### Task 8: end-to-end verification + deploy shape

- [ ] **Step 1:** E2e against a testnet Application the test user is a member of: sign in → pick the app → register a testnet xpub → create an intent via the merchant API → see it in Payments → configure a webhook → drive a delivery → see it in the logs → redeliver. Then confirm a user who is NOT a member of an Application gets 403 from `/v1/dashboard/*` (membership gate). Verify in a foregrounded browser.
- [ ] **Step 2:** `security-reviewer` on the full diff (dashboard app + `/v1/dashboard/*` + `appMembership`) before it manages any production merchant (spec §2). Focus: the membership gate cannot be bypassed, environment scoping is airtight (no dev session reading live data), no RBAC reimplementation, credential-secret handling.
- [ ] **Step 3:** Document the deploy shape (below); hand infra asks to the owner. Merge on green CI.

---

## Dependencies & sequencing

- **Hard prerequisite:** F2.0 ONLY (shipped) — the dashboard consumes list/retrieve (task 3), merchant CRUD (task 2), webhook deliveries (task 4), and the `environment` scoping (task 1b). It does NOT depend on the SDK, checkout, or payment-links plans — it can run fully in parallel with them the moment F2.0 landed (spec §10/§11).
- **Soft:** `@oxypay/shared-types` published (SDK plan Task 1) is convenient for the app's types but a `workspace:*` link works during dev.
- **Internal order:** backend Phase 0 (Tasks 1→2) FIRST (the app needs the routes), then the app (Tasks 3→4→5→6→7→8). Backend and a Console-mirroring scaffold (Task 3) can start in parallel.

## Owner / infra actions (BLOCKING — flag early)

- **Register the dashboard's own Oxy `Application`** in Console to obtain its `clientId` (`VITE_OXY_CLIENT_ID`) — the dashboard mounts `OxyProvider` with it. **Owner action (Console).** Blocks Task 3 Step 4.
- **`dashboard.pay.oxy.so`** — NEW host: DNS + static host (CloudFront/S3, like Console) + TLS. **Owner/oxy-infra.** Plain static `dist/`.
- **CORS** — add `dashboard.pay.oxy.so` to the Gateway `config.allowedOrigins` (`OXY_PAY_ALLOWED_ORIGINS`). **Code (Task 2 Step 3) + env value from owner.**
- **oxy-api `GET /applications/:applicationId` reachability** — the Gateway must be able to reach `OXY_API_URL` server-to-server with a forwarded user bearer. Confirm the Gateway's egress + that `requireAppPermission('app:read')` returns `callerMembership` for a member (recon). No oxy-api CODE change expected (the route exists) — confirm only.
