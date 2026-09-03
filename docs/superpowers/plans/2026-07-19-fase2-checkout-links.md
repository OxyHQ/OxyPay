# Oxy Pay — F2.2 + F2.3: Hosted checkout + Payment links Implementation Plan

> ## 🟡 EXECUTION STATUS (2026-07-19): backend DONE; frontend pending
> Backend Tasks 1-6 (contracts, createIntent extraction, PaymentLink + CheckoutSession models/routes + public payer routes + merchant-identity resolver + public rate-limiter) ✅ — commits `a0fa9f4`/`dc81018` (+ rate-limit fix `c69decc`), backend 214/214, reviewed Approved-after-fix. **Frontend Tasks 7-11 (packages/checkout Vite SPA) pending: T9 live-status + T10 mode-B need the anonymous-realtime owner decision; the SDK's frozen browser interface (imported by the CheckoutView) is ready.** Detail: `.superpowers/sdd/progress.md`.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Design authority:** `docs/superpowers/specs/2026-07-18-oxypay-fase2-gateway-dashboard.md` §6 (owner-approved, binding). This plan combines F2.2 (hosted checkout) + F2.3 (payment links) because a payment link is a thin generator of `PaymentIntent`s that reuses the entire checkout page as its pay UI — one package, one deploy.

**Goal:** Ship a **lightweight, non-Expo** hosted checkout web app served at **`checkout.oxy.so`** that renders a payment page from a `PaymentIntent`, a `CheckoutSession` (one-off), or a `PaymentLink` (shareable), showing amount + merchant identity + QR + live status over the existing Gateway socket, and driving the non-custodial payer approve flow. Plus the two new Gateway resources — `PaymentLink` (`link_`) and `CheckoutSession` (`cs_`) — and the public payer-facing routes the page consumes.

**Architecture:** The checkout page is a static SPA. It never holds keys or funds (non-custody invariant, §2). It reads a `PaymentIntent` snapshot over the **payer-authed** `GET /v1/payment_intents/:id?client_secret=…` (F2.0 task 3, already shipped) and streams live status over the existing `subscribe`/`intent.updated` socket contract (`realtime/socket.ts`, already shipped). Two payment-entry modes over the SAME intent: **(A)** a payer with Oxy Pay is offered the `oxypay://pay?…` deep link (same params the wallet's `app/pay/[intent].tsx` already parses); **(B)** a payer with an external wallet is shown address + QR + amount and polls status (gated behind the `addressindex` infra prerequisite, §4 of the spec — ships behind a flag until then, with manual-txid fallback). A **Payment Link** mints (or the page reuses an open) fresh `PaymentIntent` per visit; a **Checkout Session** wraps exactly one `PaymentIntent` created at session-create time with `success_url`/`cancel_url`.

**Tech Stack:** Vite + React 19 + TypeScript (NO Expo, NO react-native-web, NO Bloom — Stripe-Checkout-lightweight so an anonymous payer gets a fast first paint). Plain CSS or a minimal utility layer (see Task 5 decision). Gateway interaction is imported from **`@oxyhq/pay/checkout`** (the SDK browser entry — owner of the payer-side REST+socket client core; see the SDK plan `2026-07-19-fase2-sdk.md`) so the socket/REST client is defined ONCE, never duplicated here. QR via a single tiny zero-dep library. `bun` workspace + `bun test` / Playwright for the page.

## Global Constraints

- **Non-custody invariant (legal firewall — never violate):** the checkout page never asks for, sees, transports, or stores a private key, mnemonic, or seed. Mode A hands off to the payer's self-custody wallet via deep link; mode B shows a receive address the payer pays from their own external wallet. The page's only Gateway authority is possession of a public `client_secret` (read + `submit_tx`) — never a service token. Any change that puts key material or a signing path in this package is a legal bug. **`security-reviewer` MUST review this package's diff before it serves any `livemode:true` intent** (spec §2 — checkout is a public-domain surface not covered by the F1 audit).
- **Do NOT duplicate the payer client.** The REST snapshot fetch, the socket subscribe/unsubscribe, the typed status stream, and `submit_tx` live in `@oxyhq/pay/checkout` (SDK plan). This package imports them. If the SDK is not yet published during parallel dev, consume it as a `workspace:*` dep against the frozen interface in the SDK plan Task 2 — do NOT hand-roll a second socket client.
- **Amounts are base-unit integer strings** (`amount: string`, m⊜; `1 FAIR = UNITS_PER_COIN = 100_000_000`). Never parse to float for anything but a display estimate. Use `@fairco.in/core` `formatFair`/`UNITS_PER_COIN` for display, same as the wallet.
- **Reuse `@oxypay/shared-types`** for every wire shape; add new contracts there (Task 1), never redefine a DTO inside this package or the routes.
- **Reuse existing serializers/services** in the backend (`toPaymentIntentDTO`, `resolveMerchant`, `reserveNextAddress`, `newId`, `clientSecretFor`, `applyEvent`) — the new routes are thin; they never re-implement intent creation logic that `paymentIntents.ts` already owns. Extract the shared create-intent core (Task 2) rather than copy-pasting the `POST /v1/payment_intents` body.
- **Clean code:** no `as any`, `@ts-ignore`, `!` non-null, `var`, `console.log`, silent `catch {}`, TODO/HACK, barrel/re-export shims. Explicit field whitelists on every write (never spread `req.body`). Public routes are rate-limited.
- **Package manager:** `bun` only; hoisted linker. Commit `bun.lock` with its `package.json` change in the SAME commit.
- **Host:** `checkout.oxy.so` (proposed; owner/infra must confirm DNS + CloudFront/static host — see Deploy section). Does NOT block the build; the page reads its Gateway base URL from an env var (`VITE_GATEWAY_URL`, default `https://api.pay.oxy.so`).

---

## File Structure

```
packages/checkout/                         # NEW — @oxypay/checkout (private), Vite SPA, checkout.oxy.so
  index.html
  package.json
  vite.config.ts
  tsconfig.json
  .env.example                             # VITE_GATEWAY_URL, VITE_WALLET_DEEPLINK_SCHEME
  src/
    main.tsx                               # React root
    App.tsx                                # router: /c/:sessionId, /l/:linkId, /i/:intentId
    routes/
      SessionRoute.tsx                     # loads a CheckoutSession → CheckoutView
      LinkRoute.tsx                        # loads a PaymentLink → mint/reuse intent → CheckoutView
      IntentRoute.tsx                      # direct intent + client_secret (embed/deep test) → CheckoutView
    components/
      CheckoutView.tsx                     # amount hero, merchant identity, mode switch, live status
      PayWithOxyPay.tsx                    # mode A: oxypay:// deep-link + QR of the deep link
      PayWithExternalWallet.tsx            # mode B: address + amount + QR (addressindex-gated)
      StatusPanel.tsx                      # broadcast→confirming→settled, terminal states
      MerchantIdentity.tsx                 # name + avatar + description
      Qr.tsx                               # QR render (single tiny dep)
    lib/
      config.ts                            # env: gatewayUrl, deepLinkScheme
      intentClient.ts                      # thin re-export/binding of @oxyhq/pay/checkout for this app's config
      linkSession.ts                       # sessionStorage reuse-if-open bookkeeping per link
      deepLink.ts                          # buildPayDeepLink(intent, clientSecret) — mirrors wallet parser params
    styles.css
  e2e/ (or src/__tests__)                  # Playwright / component tests

packages/backend/src/
  models/
    PaymentLink.ts                         # NEW
    CheckoutSession.ts                     # NEW
  routes/
    paymentLinks.ts                        # NEW — merchant CRUD + public display + public mint-intent
    checkoutSessions.ts                    # NEW — merchant create + public GET
  services/
    createIntent.ts                        # NEW — extracted create-intent core (shared by paymentIntents/links/sessions)
    merchantDisplay.ts                     # NEW — resolve public merchant identity (name + avatar url + desc)
  lib/serialize.ts                         # + toPaymentLinkDTO, toCheckoutSessionDTO, toPublicPaymentLinkDTO, toCheckoutSessionPublicDTO
  server.ts                               # wire the two new routers + a public rate-limiter

packages/shared-types/src/
  paymentLink.ts                           # NEW PaymentLink + CreatePaymentLinkParams + PublicPaymentLink
  checkoutSession.ts                       # NEW CheckoutSession + CreateCheckoutSessionParams + CheckoutSessionPublic
  merchantDisplay.ts                       # NEW MerchantDisplay (public: name, avatarUrl, description)
  index.ts                                 # export the new contracts
```

---

## Backend — new Gateway resources (F2.3 + the checkout data plane)

### Task 1: shared-types — PaymentLink, CheckoutSession, MerchantDisplay contracts

**Files:** create `packages/shared-types/src/paymentLink.ts`, `checkoutSession.ts`, `merchantDisplay.ts`; modify `index.ts`; test `src/__tests__/`.

**Interfaces — Produces:**
- `MerchantDisplay` — public, secret-free identity the checkout page renders:
  ```ts
  export interface MerchantDisplay {
    name: string;                 // Merchant.displayName ?? a neutral fallback
    avatarUrl: string | null;     // resolved server-side via the SDK media chokepoint — never a bare cloud.oxy.so string built here
    description: string | null;
  }
  ```
- `PaymentLink` (merchant DTO) + `PublicPaymentLink` (payer DTO) + `CreatePaymentLinkParams`:
  ```ts
  export interface PaymentLink {
    id: string; object: 'payment_link';
    amount: string; network: NetworkType;
    active: boolean;
    metadata: Record<string, string>;
    successUrl?: string;          // optional post-payment redirect target for the checkout page
    url: string;                  // canonical checkout.oxy.so/l/<id>
    createdAt: string; updatedAt: string;
  }
  export interface PublicPaymentLink {   // what the unauthenticated checkout page may see
    id: string; object: 'payment_link';
    amount: string; network: NetworkType; active: boolean;
    merchant: MerchantDisplay;
  }
  export interface CreatePaymentLinkParams {
    amount: string; network: NetworkType;
    metadata?: Record<string, string>; successUrl?: string;
  }
  ```
- `CheckoutSession` (merchant/SDK DTO) + `CheckoutSessionPublic` (payer DTO) + `CreateCheckoutSessionParams`:
  ```ts
  export interface CheckoutSession {
    id: string; object: 'checkout_session';
    paymentIntentId: string;
    clientSecret: string;         // the WRAPPED intent's client_secret, returned to the merchant on create
    amount: string; network: NetworkType;
    metadata: Record<string, string>;
    successUrl?: string; cancelUrl?: string;
    url: string;                  // canonical checkout.oxy.so/c/<id>
    createdAt: string; updatedAt: string;
  }
  export interface CheckoutSessionPublic {
    id: string; object: 'checkout_session';
    successUrl?: string; cancelUrl?: string;
    merchant: MerchantDisplay;
    paymentIntent: PaymentIntent; // snapshot the page renders from (already includes clientSecret in the DTO)
  }
  export interface CreateCheckoutSessionParams {
    amount: string; network: NetworkType;
    metadata?: Record<string, string>; successUrl?: string; cancelUrl?: string;
  }
  ```

> **Note on `clientSecret` exposure:** `toPaymentIntentDTO` already includes `clientSecret` (see `lib/serialize.ts:29`), so every `PaymentIntent` DTO the payer path returns already carries it — the checkout page needs it to open the socket and to `submit_tx`. `CheckoutSessionPublic.paymentIntent` reuses that DTO unchanged.

- [ ] **Step 1:** Write `paymentLink.ts`, `checkoutSession.ts`, `merchantDisplay.ts` with the shapes above. Import `NetworkType` the same way the existing contracts do (`from '@fairco.in/core'`) and `PaymentIntent` from `./paymentIntent`.
- [ ] **Step 2:** Export all new symbols from `index.ts` (grouped, following the existing export style).
- [ ] **Step 3:** Add a small test asserting the DTOs' shape is assignable from representative literals (mirrors `paymentIntent.test.ts`).
- [ ] **Step 4:** `bun run --filter @oxypay/shared-types typecheck && bun run --filter @oxypay/shared-types test` → PASS. Commit.

> These new contracts ride to npm with the shared-types publish task in the SDK plan (`2026-07-19-fase2-sdk.md` Task 1). Nothing here publishes shared-types; it just adds the types the backend + checkout page compile against via the workspace link.

---

### Task 2: backend — extract the create-intent core

**Why:** `POST /v1/payment_intents` (`paymentIntents.ts:118-215`) owns the canonical intent-creation logic (idempotency fast-path + race-path, `reserveNextAddress`, `newId`/`clientSecretFor`, expiry, explicit field whitelist). Payment links and checkout sessions must mint intents through the SAME code — copy-pasting it would fork the idempotency/derivation logic. Extract it to a service, and have the existing route call it.

**Files:** create `services/createIntent.ts`; modify `routes/paymentIntents.ts`.

**Interfaces — Produces:**
```ts
// services/createIntent.ts
export interface CreateIntentInput {
  merchant: HydratedDocument<MerchantDoc>;
  amount: string;
  network: NetworkType;
  metadata?: Record<string, string>;
  expiresInSeconds?: number;
  idempotencyKey?: string;        // optional: links/sessions mint without a caller Idempotency-Key
}
export interface CreateIntentResult { intent: PaymentIntentDocument; reused: boolean; }
export async function createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;
```
- The `network === merchant.network` firewall (F2.0 task 1a, `paymentIntents.ts:150`) moves INTO `createIntent` so links/sessions inherit it automatically.
- When `idempotencyKey` is absent, skip the idempotency fast-path and always mint fresh (links/sessions manage reuse at their own layer). When present, keep the existing find-then-create-then-race-recover behavior.

- [ ] **Step 1:** Write `createIntent.ts` moving the body of the current create handler (network check → idempotency fast path → `reserveNextAddress` → `PaymentIntent.create` with the explicit whitelist → race-path recovery) behind the signature above. Keep `DEFAULT_EXPIRY_SECONDS` here.
- [ ] **Step 2:** Rewrite `POST /v1/payment_intents` to: resolve merchant, require `Idempotency-Key`, parse+validate body, then `const { intent, reused } = await createIntent({ merchant, ...params, idempotencyKey })`, and respond 200 (reused) / 201 (new) with `{ ...toPaymentIntentDTO(intent), client_secret: intent.clientSecret }`. Behavior must be byte-for-byte identical to today.
- [ ] **Step 3:** Run the existing backend suite (`bun test` in `packages/backend`) — the payment-intents + e2e tests must stay green with zero changes to them. Commit.

---

### Task 3: backend — PaymentLink model + routes

**Files:** create `models/PaymentLink.ts`, `routes/paymentLinks.ts`; modify `lib/serialize.ts`, `server.ts`, `lib/ids.ts` (already supports `link_` — verify), `services/merchantDisplay.ts` (Task 5).

**Model `PaymentLinkDoc`:** `publicId (link_)`, `merchantId`, `oxyAppId`, `environment`, `amount (string)`, `network`, `metadata (Map)`, `active (bool, default true)`, `successUrl?`, timestamps. Index `{ oxyAppId: 1, environment: 1 }` (non-unique — a merchant may have many links).

**Routes** (base URL host = `checkout.oxy.so/l/<id>` built in the serializer from `config`):
- `POST /v1/payment_links` — **merchant-authed** (`requireMerchant` + `requireAuthenticated` + `requireScope('payments:write')`, same chain as `POST /v1/merchants`). Body = `CreatePaymentLinkParams`. Runs the `network === merchant.network` firewall. Explicit whitelist. → 201 `toPaymentLinkDTO`.
- `GET /v1/payment_links` — merchant-authed, `payments:read`, Stripe-style pagination (mirror the `GET /v1/payment_intents` list at `paymentIntents.ts:218-267`).
- `GET /v1/payment_links/:id` — merchant-authed retrieve.
- `PATCH /v1/payment_links/:id` — merchant-authed, `payments:write`; only `active` + `metadata` + `successUrl` mutable (whitelist; never amount/network — a link's price must be immutable once shared).
- `GET /v1/payment_links/:id/public` — **UNAUTHENTICATED, rate-limited** (public payer path). Returns `PublicPaymentLink` (amount, network, active, `merchant: MerchantDisplay`). No secrets, no metadata, no successUrl. 404 if not found; still returns `active:false` links so the page can show a "link disabled" state.
- `POST /v1/payment_links/:id/payment_intent` — **UNAUTHENTICATED, rate-limited** (public payer path). If the link is inactive → 422. Else `createIntent({ merchant, amount: link.amount, network: link.network, metadata: link.metadata })` (fresh, no idempotencyKey) → 201 `{ ...toPaymentIntentDTO(intent), client_secret }`. The page owns reuse-if-open via sessionStorage (Task 8) — the server always mints fresh here.

> **Security notes to bake in:** the two public routes must be behind a dedicated rate-limiter with a distinct `prefix` (`'rl:paylink-public:'`) — `POST …/payment_intent` derives a fresh watch-only address each call, so an unthrottled caller could inflate `nextDerivationIndex` (address-space churn, mild DoS). Cap and document. The public routes MUST NOT accept a caller-supplied `network`, amount, or merchant — every value comes from the stored link. `security-reviewer` covers these before mainnet.

- [ ] **Step 1:** Write `PaymentLink.ts` (schema + index + `PaymentLinkDoc`). No `pre('validate')` needed (no xpub here).
- [ ] **Step 2:** Add `toPaymentLinkDTO` + `toPublicPaymentLinkDTO(doc, merchantDisplay)` to `serialize.ts`. The `url` field = `${config.checkoutBaseUrl}/l/${doc.publicId}` (add `checkoutBaseUrl` to `config.ts`, default `https://checkout.oxy.so`).
- [ ] **Step 3:** Write `routes/paymentLinks.ts` with the six routes. Merchant routes reuse `resolveMerchant`; public routes look up the link, then its merchant, then build `MerchantDisplay` via `services/merchantDisplay.ts` (Task 5).
- [ ] **Step 4:** Wire `createPaymentLinksRouter({ requireMerchant, publicRateLimit })` in `server.ts` (add a public rate-limiter dep; see Task 6).
- [ ] **Step 5:** Tests (`routes/__tests__/paymentLinks.test.ts`): merchant CRUD happy path + environment/network firewall (a testnet merchant link rejects a mainnet body), public display hides secrets, public mint creates an intent bound to the link's merchant + amount, inactive link → 422 on mint. `bun test` PASS. Commit.

---

### Task 4: backend — CheckoutSession model + routes

**Files:** create `models/CheckoutSession.ts`, `routes/checkoutSessions.ts`; modify `serialize.ts`, `server.ts`.

**Model `CheckoutSessionDoc`:** `publicId (cs_)`, `merchantId`, `oxyAppId`, `environment`, `paymentIntentId`, `amount`, `network`, `metadata (Map)`, `successUrl?`, `cancelUrl?`, timestamps.

**Routes:**
- `POST /v1/checkout_sessions` — **merchant-authed** (`payments:write`). Body = `CreateCheckoutSessionParams`. Runs the network firewall, then `createIntent({ merchant, amount, network, metadata })` (fresh), persists the session pointing at `intent.id`. → 201 `toCheckoutSessionDTO` (includes `paymentIntentId`, `clientSecret` = the wrapped intent's secret, and `url = ${checkoutBaseUrl}/c/${publicId}`). This is the object the SDK's `oxypay.checkout.sessions.create()` returns (SDK plan).
- `GET /v1/checkout_sessions/:id` — merchant-authed retrieve (for SDK `.retrieve` / dashboard).
- `GET /v1/checkout_sessions/:id/public` — **UNAUTHENTICATED, rate-limited**, authorized by possession of the wrapped intent's `client_secret` (query param or `X-Oxy-Pay-Client-Secret` header, exactly like the payer GET at `paymentIntents.ts:308-331`). Returns `CheckoutSessionPublic` = `{ successUrl?, cancelUrl?, merchant: MerchantDisplay, paymentIntent: toPaymentIntentDTO(wrapped) }`. Without a valid secret → 401/403. This is how the checkout page loads a `/c/<id>` URL: the session `url` the merchant shares carries the secret in the URL fragment (`#cs=<client_secret>`, never sent to the server in a way that logs it — the page reads `location.hash` and passes it as the query param over HTTPS).

> **Open decision (flag to owner):** where the checkout-session client_secret travels to the page. Recommended: **URL fragment** (`/c/cs_x#cs=<secret>`) — the fragment is never sent in the HTTP request line, so it stays out of gateway/CDN access logs, and the page forwards it as a query param on the authenticated `…/public` call over TLS. Alternative (Stripe-style): a short-lived signed lookup token. The fragment approach reuses the existing `verifySecret` idiom with zero new crypto and is the recommendation unless the owner wants a token.

- [ ] **Step 1:** Write `CheckoutSession.ts`.
- [ ] **Step 2:** `toCheckoutSessionDTO` + `toCheckoutSessionPublicDTO(session, merchantDisplay, intentDoc)` in `serialize.ts`.
- [ ] **Step 3:** Write `routes/checkoutSessions.ts` (create + retrieve + public GET). Public GET reuses the exact `verifySecret` payer-auth branch from `paymentIntents.ts`.
- [ ] **Step 4:** Wire `createCheckoutSessionsRouter({ requireMerchant, publicRateLimit })` in `server.ts`.
- [ ] **Step 5:** Tests: create wraps a real intent + returns its client_secret; public GET requires the secret (401 without, 403 wrong, 200 right) and never leaks it without proof; network firewall enforced. `bun test` PASS. Commit.

---

### Task 5: backend — public merchant-identity resolver

**Files:** create `services/merchantDisplay.ts`; touches `config.ts`.

**Interface:** `async function resolveMerchantDisplay(merchant: HydratedDocument<MerchantDoc>): Promise<MerchantDisplay>` → `{ name: merchant.displayName ?? <neutral fallback>, avatarUrl, description: merchant.description ?? null }`.

- The `Merchant` model already carries `displayName`, `avatarFileId`, `description` (`models/Merchant.ts:39-44`). The avatar URL MUST be resolved through the SDK media chokepoint — `oxyServices.getFileDownloadUrl(avatarFileId, variant)` — NOT by hand-building a `cloud.oxy.so` string (ecosystem canonical-media rule). `oxyClient` from `@oxyhq/core` is already imported across the backend.
- [ ] **Step 1:** Confirm the server-side SDK exposes `getFileDownloadUrl` on `oxyClient` (grep `@oxyhq/core`). If it does, use it; if the download-URL builder is client-only, **flag it** — the fallback is to add a tiny resolver upstream in `@oxyhq/core` (fix-upstream, never hardcode the CDN host here) or return `avatarUrl: null` for v1 and open a follow-up. Do NOT hardcode `cloud.oxy.so`.
- [ ] **Step 2:** Implement + unit test (`avatarFileId` present → resolved URL; absent → null; no displayName → neutral fallback name). Commit.

---

### Task 6: backend — public rate-limiter + wiring

**Files:** modify `server.ts`.

- [ ] **Step 1:** Add a `publicRateLimit` middleware via `createOxyRateLimit(oxyClient)` (already imported) with a distinct `prefix: 'rl:pay-public:'` and a tighter budget than the merchant routes, applied ONLY to the four public payer routes (`…/public`, `…/payment_intent`). Confirm the `rate-limit-redis` unique-prefix rule (AGENTS.md) is honored.
- [ ] **Step 2:** Register `createPaymentLinksRouter` + `createCheckoutSessionsRouter` in `createGateway()` alongside the existing routers. Verify CORS (`createOxyCors`) already allows the `checkout.oxy.so` origin — add it to `config.allowedOrigins` for the socket CORS allowlist too (the page opens a socket).
- [ ] **Step 3:** Full backend `bun test` + `typecheck` PASS. Commit.

---

## Frontend — the hosted checkout page (F2.2)

### Task 7: scaffold `packages/checkout` (lightweight Vite SPA)

**Files:** create the `packages/checkout` skeleton.

- [ ] **Step 1:** `package.json` — name `@oxypay/checkout`, `private: true`, scripts `dev` (`vite`), `build` (`vite build`), `preview`, `typecheck` (`tsc --noEmit`), `test`. Deps: `react`, `react-dom`, `react-router-dom` (tiny router), `@oxyhq/pay` (workspace: the browser client core — see SDK plan), `@oxypay/shared-types` (workspace), `@fairco.in/core` (for `formatFair`/`UNITS_PER_COIN` display + `NetworkType`), one QR lib (e.g. `qrcode` or `qr-creator` — pick the smallest zero-transitive-dep option). DevDeps: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, Playwright (or `@testing-library/react` + `bun test`).
- [ ] **Step 2:** `vite.config.ts` — `@vitejs/plugin-react` only (NO react-native-web plugin — this is a plain web app, the whole point of a separate package per spec §6). `index.html` with a single `#root`. `.env.example` with `VITE_GATEWAY_URL` + `VITE_WALLET_DEEPLINK_SCHEME=oxypay`.
- [ ] **Step 3:** `src/lib/config.ts` — typed env read (`import.meta.env.VITE_GATEWAY_URL` etc., no magic strings inline). `src/main.tsx` + `src/App.tsx` with routes `/c/:sessionId`, `/l/:linkId`, `/i/:intentId` and a minimal not-found.
- [ ] **Step 4:** Decide the styling layer — **recommendation:** plain hand-written `styles.css` with CSS custom properties (light/dark via `prefers-color-scheme`), NOT Tailwind/Bloom, to keep the bundle tiny and the first paint fast for anonymous payers. Match Oxy Pay brand tokens (oxy purple, FairCoin symbol) by copying the color values as CSS vars (do not import Bloom). Flag if the owner prefers Tailwind v4 here.
- [ ] **Step 5:** `bun run --filter @oxypay/checkout build` succeeds on the empty shell. Commit.

---

### Task 8: LinkRoute + reuse-if-open + IntentRoute + SessionRoute loaders

**Files:** `src/routes/*.tsx`, `src/lib/linkSession.ts`, `src/lib/intentClient.ts`.

- `intentClient.ts` binds `@oxyhq/pay/checkout` to this app's config once: `const client = createOxyPayCheckout({ gatewayUrl: config.gatewayUrl })` exposing `getPaymentIntent(id, clientSecret)`, `subscribe(id, clientSecret, cb) → unsubscribe`, `submitTx(id, clientSecret, txid)` (the frozen SDK interface — SDK plan Task 2). This file is the ONLY place the app touches the SDK, so swapping workspace↔published is a one-line change.
- `linkSession.ts` — `getOpenIntentForLink(linkId)` / `rememberIntentForLink(linkId, {id, clientSecret})` over `sessionStorage`. Reuse-if-open (spec §6): on visiting `/l/:linkId`, if sessionStorage holds an intent for this link, re-fetch it via `getPaymentIntent`; if still non-terminal + unexpired → reuse; else clear + mint fresh via `POST /v1/payment_links/:id/payment_intent`.

- [ ] **Step 1:** `IntentRoute` — reads `:intentId` + `client_secret` from the query/fragment, fetches the snapshot, renders `CheckoutView`. (Simplest path; also what the embed/deep-test uses.)
- [ ] **Step 2:** `LinkRoute` — fetch `GET …/payment_links/:id/public` for display; render amount + merchant + a "Pay" affordance; on pay, run reuse-if-open → obtain `{intent, clientSecret}` → render `CheckoutView`. Handle `active:false` with a "link no longer active" state.
- [ ] **Step 3:** `SessionRoute` — read `#cs=<secret>` from `location.hash`, call `GET …/checkout_sessions/:id/public?client_secret=…`, render `CheckoutView` from `paymentIntent`. On terminal `settled`, if `successUrl` present, offer/redirect to it.
- [ ] **Step 4:** Component tests for reuse-if-open (open intent reused, terminal intent → fresh mint). Commit.

---

### Task 9: CheckoutView + mode A (Oxy Pay deep link) + live status

**Files:** `src/components/CheckoutView.tsx`, `PayWithOxyPay.tsx`, `StatusPanel.tsx`, `MerchantIdentity.tsx`, `Qr.tsx`, `src/lib/deepLink.ts`.

- `deepLink.ts` — `buildPayDeepLink({ intentId, clientSecret, address, amount, network })` producing `oxypay://pay?intent=<id>&secret=<client_secret>&address=<addr>&amount=<baseunits>&network=<net>`. Param names + validation MUST match the wallet's parser exactly (`app/pay/[intent].tsx:198-213`: `intent`, `secret` starting with `<intentId>_secret_`, `address`, `amount` decimal digits, `network` mainnet|testnet). Verify against that file — a mismatch means the wallet rejects the link.
- `CheckoutView` subscribes via `intentClient.subscribe` on mount, tears down on unmount (mirror the wallet's `subscriptionRef` cleanup, `app/pay/[intent].tsx:188-193`), and renders `StatusPanel` from the live `PaymentIntent` (`broadcast → confirming → settled`, terminal states — reuse the wallet's status→visual mapping semantics, `describePaymentStatus`).

> **HARD GAP — anonymous payer realtime (blocks live status on this page; requires a backend change).** The Gateway socket authenticates the *connection* with an Oxy identity token (`realtime/socket.ts:46`: `io.use(oxyClient.authSocket())`, handshake `auth.token` = the Oxy access token — see the wallet's `gateway-socket.ts`). The wallet payer is always a signed-in Oxy user, so this is invisible today. But an **anonymous** checkout-page visitor (mode B external-wallet payer) and an **anonymous embed buyer** (SDK F2.4) have NO Oxy session — their socket handshake is rejected, so they get no live status. Room-join authorization is already per-intent via `client_secret` + `verifySecret` (`socket.ts:59-66`), so the `client_secret` is the real capability; the connection-level identity gate is redundant for the payer path. **This is defined as a concrete backend task in the SDK plan (`2026-07-19-fase2-sdk.md`, "anonymous payer realtime")** — an optional/anonymous socket-connection path (or a dedicated payer namespace) that allows a token-less connection but still gates every room join by `client_secret`. Until it lands, `CheckoutView` MUST fall back to short-interval REST polling of the payer-authed `GET /v1/payment_intents/:id?client_secret=…` (F2.0 task 3) — flag this fallback in the code and remove it once anonymous realtime ships. This is an owner-facing decision (weakening connection auth vs a separate namespace vs poll-only) — surface it, do not silently pick.

- [ ] **Step 1:** `MerchantIdentity` (name + avatar `<img>` + description from the `MerchantDisplay` DTO), `Qr` (render any string to a QR canvas/svg).
- [ ] **Step 2:** `PayWithOxyPay` — a "Pay with Oxy Pay" button that on mobile opens the `oxypay://` deep link (via `window.location.href`) and on desktop shows a QR of the deep link for the payer to scan with their phone's Oxy Pay app. Amount hero via `formatFair`.
- [ ] **Step 3:** `StatusPanel` — live status card; on `settled` show success + (session) `successUrl` CTA; terminal failed/expired/rejected states. Uses the SAME status semantics as the wallet screen so both surfaces read identically.
- [ ] **Step 4:** Wire the socket subscription in `CheckoutView`; the initial REST snapshot (already loaded by the route) is the first frame, the socket supplies updates — no polling. Verify in a real foregrounded browser tab (AGENTS.md: backgrounded tabs pause timers/rAF and mimic "stuck" status).
- [ ] **Step 5:** Component/e2e test with a stubbed `@oxyhq/pay/checkout` client (snapshot → socket updates → settled). Commit.

---

### Task 10: mode B (external wallet) — addressindex-gated

**Files:** `src/components/PayWithExternalWallet.tsx`, `CheckoutView.tsx`.

> **Blocked by the `addressindex` infra prerequisite (spec §4).** Without per-address watching, the Gateway can only confirm a payment someone reports a `txid` for. So mode B ships **behind a build/config flag** (`VITE_ENABLE_EXTERNAL_WALLET`, default off) until infra confirms `addressindex` is live — this avoids shipping two permanent checkout UXs. Until then the ONLY external-wallet path is the manual-txid fallback (degraded, explicitly temporary).

- [ ] **Step 1:** `PayWithExternalWallet` — show the intent `address` + `amount` + a QR of a BIP21-style `faircoin:<address>?amount=<fair>` URI (confirm the URI scheme with `@fairco.in/core`). Poll status via the socket (already subscribed) — no new transport.
- [ ] **Step 2:** Manual-txid fallback form (behind the same flag): a field to paste a broadcast `txid` → `intentClient.submitTx(intentId, clientSecret, txid)`. Label it clearly as a fallback. This reuses the existing `submit_tx` payer route.
- [ ] **Step 3:** Gate mode B behind `VITE_ENABLE_EXTERNAL_WALLET`; when off, `CheckoutView` shows only mode A. Document that flipping it on is contingent on the infra ticket. Commit.

---

### Task 11: end-to-end verification + deploy shape

- [ ] **Step 1:** Full-stack e2e against a testnet merchant: create a payment link via the merchant API → open `/l/<id>` in a real browser → mint intent → (mode A) build the deep link and assert the wallet parser would accept its params → drive the intent through the state machine server-side and assert the page's `StatusPanel` advances to `settled` over the socket. Then a checkout-session flow `/c/<id>#cs=…`. Verify in a **foregrounded** tab.
- [ ] **Step 2:** `bun run --filter @oxypay/checkout build` produces a static `dist/`; confirm the bundle is small (no Expo/RN-web/Bloom leaked in — check the bundle report).
- [ ] **Step 3:** `security-reviewer` on the full diff (checkout package + new public routes) BEFORE any mainnet/`livemode:true` exposure (spec §2). Address findings.
- [ ] **Step 4:** Document the deploy shape (see below) and hand the infra asks to the owner. Merge on green CI.

---

## Dependencies & sequencing

- **Hard prerequisite:** F2.0 (shipped) — specifically the payer-authed `GET /v1/payment_intents/:id` (task 3), the socket `subscribe` contract, and `newId` already knowing `link_`/`cs_` (`lib/ids.ts:13` — confirmed present).
- **Soft dependency on the SDK plan (`2026-07-19-fase2-sdk.md`):** the checkout page imports the payer client core from `@oxyhq/pay/checkout`. Freeze that interface FIRST (SDK plan Task 2 defines it). During parallel dev, consume it as `workspace:*`; it need not be npm-published for this package to build. Backend Tasks 1-6 have NO dependency on the SDK and can start immediately.
- **Mode B (Task 10)** is blocked by the `addressindex` infra ticket (spec §4) and ships behind a flag until then. Everything else (mode A, links, sessions) ships without it.
- Within this plan: Task 1 → Task 2 → (Tasks 3, 4 in parallel) → Tasks 5, 6 → frontend Tasks 7 → 8 → 9 → (10 flagged) → 11.

## Deploy shape / owner + infra actions

- **`checkout.oxy.so`** — NEW host. Needs: DNS record, a static-site host (CloudFront + S3, matching the ecosystem's `cloud.oxy.so` CloudFront pattern) or the app's existing web-static pipeline, and TLS. **Owner/oxy-infra action.** The build is a plain static `dist/` — no server runtime.
- **CORS + socket allowlist** — `checkout.oxy.so` must be added to the Gateway's `config.allowedOrigins` (socket CORS) and `createOxyCors` allowlist. **Code (Task 6) + confirm the env value with the owner.**
- **`api.pay.oxy.so`** already serves the Gateway; the new routes deploy with the backend's existing `deploy-aws.yml`. No new backend infra.
- **`addressindex` on the FairCoin Explorer node** — the mode-B infra prerequisite (spec §4), an oxy-infra ticket owned separately; only gates Task 10.
