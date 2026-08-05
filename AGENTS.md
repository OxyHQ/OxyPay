# OxyPay

Oxy Pay: a FairCoin payment gateway with Stripe-shaped ergonomics, plus the
self-custodial wallet that spends on it. Bun monorepo, `packages/` layout.

> Org-wide engineering standards (package manager, TypeScript, React, naming,
> error handling, security, testing, git and PR conventions) live in
> <https://github.com/OxyHQ/engineering>. This file carries only what is true of
> OxyPay specifically. Versions are in `package.json`, never here.

## Packages

There are **five**, not three. Two of them are published to npm, so a change in
`shared-types` or `sdk` is an external API change, not an internal refactor.

| Path | Name | What it is |
|---|---|---|
| `packages/backend/` | `@oxypay/backend` | Express + Mongoose + Socket.IO gateway API |
| `packages/frontend/` | `@oxypay/frontend` | Expo / expo-router self-custodial FairCoin wallet, forked from FAIRWallet, with Oxy identity. Also packages as an Electron desktop app |
| `packages/checkout/` | `@oxypay/checkout` | Vite + React + react-router-dom SPA. The **anonymous** payer-facing hosted checkout at checkout.oxy.so. Not Expo, not React Native |
| `packages/sdk/` | **`@oxyhq/pay`** | Published client. Server entry mints Oxy service tokens from an `ApplicationCredential` and exposes `paymentIntents` / `paymentLinks` / `checkout.sessions` / `webhooks`; the `@oxyhq/pay/checkout` browser entry is the payer-side core |
| `packages/shared-types/` | `@oxypay/shared-types` | Published wire contract shared by backend, SDK and frontend |

The package directory name and the npm name differ for the SDK: `packages/sdk`
publishes as `@oxyhq/pay`, under the `@oxyhq` scope rather than `@oxypay`.

`bunfig.toml` sets `linker = "hoisted"`. Expo, Metro and Babel resolve transitive
deps through the standard `node_modules` chain, and the default isolated linker
breaks that plus ECS image resolution. Copy `bunfig.toml` into any Dockerfile
before `bun install`.

## Commands

```bash
bun run dev:frontend    # expo start --clear
bun run dev:backend     # bun --watch src/server.ts
bun run build:frontend  # expo export --platform web
bun run build:backend   # tsc
bun run build:shared-types
```

The named root shortcuts only cover `frontend`, `backend` and `shared-types`.
**`checkout` and `sdk` have no root shortcut**: reach them with
`bun run --filter @oxypay/checkout <script>` (`dev` is `vite`, `build` is
`vite build`) and `bun run --filter @oxyhq/pay <script>`, or run the script from
inside the package. The unnamed root scripts (`dev`, `build`, `test`, `lint`)
use `--filter '*'` and do cover all five.

Root `postinstall` builds `shared-types`, so a fresh `bun install` leaves its
`dist/` present. Both published packages build cjs + esm + types separately;
`shared-types` also runs `scripts/fix-esm-imports.mjs` after the esm pass.

## Chain access: Explorer HTTP, not RPC

The backend talks to the **FairCoin Explorer HTTP API** (`services/explorer.ts`,
`EXPLORER_BASE_URL` from `@fairco.in/core`). There is **no** FairCoin RPC client
and no RPC node dependency anywhere in this repo. `@fairco.in/core` is the only
`@fairco.in/*` package any workspace depends on.

`services/settlementWatcher.ts` polls the Explorer for in-flight intents.
Only `broadcast` and `confirming` intents carrying a payer-reported txid are
watchable; terminal and pre-broadcast intents are never polled. Its timer is
`.unref()`-ed so it cannot hold a test run or the event loop open.

## Non-custody is enforced in code, not by policy

A merchant registers a **watch-only account xpub**. `services/derivation.ts`
derives a per-intent receive address from it and **throws
`watch-only violation` if the extended key carries a private key**. That guard is
the legal firewall: if a merchant ever hands over an `xprv`, the gateway refuses
it rather than silently gaining the ability to spend their funds. Never relax it,
and never add a code path that accepts a private extended key.

`services/reserveAddress.ts` claims the next derivation index with
`findOneAndUpdate({ $inc: { nextDerivationIndex: 1 } }, { new: false })`. The
`new: false` is load-bearing: it returns the **pre**-increment document, so the
index that call owns is exactly what it read, and concurrent callers each get a
distinct index with no read-modify-write race. A `new: true` here silently hands
two intents the same address.

## Backend surface

Routes (`src/routes/`): `checkoutSessions`, `dashboard`, `enrich`, `merchants`,
`paymentIntents`, `paymentLinks`, `social`, `webhookDeliveries`.

Models (`src/models/`): `CheckoutSession`, `Merchant`, `PaymentIntent`,
`PaymentLink`, `SocialReceiveCursor`, `SocialSendAttribution`, `WebhookDelivery`.

## Auth

Backend uses `@oxyhq/core/server`: `createOxyAuthMiddleware` on routes,
`getRequiredOxyUserId` to read the caller, `authSocket()` for Socket.IO, plus
`createOxyCors` and `createOxyRateLimit` in `server.ts`. There is no
`requireOxyAuth` call site in this repo. Frontend uses `OxyProvider` and `useOxy`
from `@oxyhq/services` (`app/_layout.tsx`, `src/services/oxy-services.ts`).

The hosted checkout is deliberately **anonymous**: a payer has no Oxy session, so
do not add an Oxy auth requirement to a payer-facing route.

## Deploy

`.github/workflows/deploy-aws.yml` is the only deployment: native `linux/arm64`
build on an arm64 runner, pushed to ECR `oxy/oxypay`, rolling the `oxypay` ECS
service on `oxy-cluster`. GitHub repo secrets are the source of truth and are
synced to SSM by the workflow, which skips empty or placeholder values rather
than overwriting a real one.
