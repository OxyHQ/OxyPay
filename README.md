# Oxy Pay

<p align="center">
  <b>A FairCoin payments gateway with Stripe's ergonomics and no custody of anyone's money.</b><br>
  Payment intents, payment links, hosted checkout, signed webhooks, and an SDK to drive them.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@oxyhq/pay"><img alt="@oxyhq/pay" src="https://img.shields.io/npm/v/@oxyhq/pay?style=flat-square&label=%40oxyhq%2Fpay&labelColor=440151&color=D26AE7"></a>
  <img alt="Bun" src="https://img.shields.io/badge/bun-1.0+-440151?style=flat-square&logo=bun&logoColor=white">
  <img alt="Expo" src="https://img.shields.io/badge/Expo-57-440151?style=flat-square&logo=expo&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-Drizzle-440151?style=flat-square&logo=postgresql&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-440151?style=flat-square&logo=typescript&logoColor=white">
</p>

---

<table>
<tr>
<td valign="top" width="50%">

### 🔒 The Gateway cannot spend your money

A merchant record holds a **watch only account `xpub` and nothing else**. There is no
field for a private key, a mnemonic or a seed anywhere in the schema.

A pre validate hook on the model rejects any private extended key handed in as `xpub`, so
the non custody property is enforced by the database layer rather than by convention.

Each payment intent gets a receive address derived from that `xpub`. Funds go straight to
the merchant.

</td>
<td valign="top" width="50%">

### 🧾 Stripe shaped on purpose

`payment_intents`, `payment_links` and `checkout_sessions`, with `Idempotency-Key` on
creates and HMAC signed webhooks carrying a timestamp against replay.

Test and live are isolated by the environment on the credential that authenticated the
call, not by a flag the caller sends. One Oxy app gets at most one merchant per
environment.

Amounts are canonical base unit strings and never floats. The currency is `FAIR`.

</td>
</tr>
</table>

## Packages

A Bun workspace monorepo. Everything is under `packages/`.

| Path | Package | What it is |
|---|---|---|
| [`packages/backend`](packages/backend/) | `@oxypay/backend` | The Gateway. Express, Drizzle on PostgreSQL and Socket.IO on Bun |
| [`packages/sdk`](packages/sdk/) | [`@oxyhq/pay`](https://www.npmjs.com/package/@oxyhq/pay) | The published SDK. Server client plus a browser checkout client |
| [`packages/checkout`](packages/checkout/) | `@oxypay/checkout` | The hosted, anonymous, payer facing checkout web app. Vite and React |
| [`packages/frontend`](packages/frontend/) | `@oxypay/frontend` | Expo app for iOS, Android, web and Electron |
| [`packages/shared-types`](packages/shared-types/) | `@oxypay/shared-types` | The wire contract shared by all of the above |

`shared-types` is the reason the webhook signer cannot drift: the Gateway signs and the
SDK verifies through the same exported routine.

## Quick start

You need Bun and a PostgreSQL instance — `docker compose -f
docker-compose.postgres.yml up -d` starts one, and the backend refuses to boot
without `DATABASE_URL` pointing at it (see `packages/backend/.env.example`).

```bash
bun install                    # postinstall builds shared-types for you
bun run dev                    # every package at once
```

Or one at a time:

```bash
bun run dev:backend            # bun --watch, listens on 3001 by default
bun run dev:frontend           # expo start --clear
```

`checkout` and `sdk` have no root alias, so reach them through the workspace filter:

```bash
bun run --filter @oxypay/checkout dev
bun run --filter @oxyhq/pay dev
```

<details>
<summary><b>Every script</b></summary>

<br>

**Root**: `dev`, `dev:frontend`, `dev:backend`, `build`, `build:shared-types`,
`build:frontend`, `build:backend`, `test`, `lint`, `clean`, `start:frontend`,
`start:backend`.

| Package | Scripts |
|---|---|
| `@oxypay/backend` | `dev`, `start`, `build`, `typecheck`, `lint`, `test`, `clean` |
| `@oxyhq/pay` | `build` (cjs, esm and types), `dev`, `typecheck`, `lint`, `test`, `clean` |
| `@oxypay/checkout` | `dev`, `build`, `preview`, `typecheck`, `test` |
| `@oxypay/frontend` | `dev`, `start`, `android`, `ios`, `web`, `electron`, `build`, `electron:build`, `typecheck`, `lint`, `test` |
| `@oxypay/shared-types` | same build trio as the SDK, plus `dev`, `typecheck`, `lint`, `test`, `clean` |

</details>

## Integrating

Install the SDK, not this repo.

```bash
bun add @oxyhq/pay
```

```ts
import { OxyPay } from '@oxyhq/pay';

const oxypay = new OxyPay({
  publicKey: process.env.OXY_APP_PUBLIC_KEY,
  secret: process.env.OXY_APP_SECRET,
});

const intent = await oxypay.paymentIntents.create(
  { amount: '2500', network: 'mainnet' },
  { idempotencyKey: crypto.randomUUID() },
);
```

Hand `intent.clientSecret` to the browser and mount the payer side widget from
`@oxyhq/pay/checkout`. Full walkthrough in
[`docs/integrating-oxy-pay.md`](docs/integrating-oxy-pay.md).

## Authentication

There is no bespoke Oxy Pay API key. The SDK is configured with the **same
`ApplicationCredential`** Oxy Console already issues, presents it to the Oxy API to mint a
short lived service token, and re mints when that token expires.

The backend verifies callers with `@oxyhq/core/server`, using `createOxyAuthMiddleware`,
`requireOxyAuth` and `getRequiredOxyUserId`. There is no app local bearer parser.

The payer side is different by design: a payer is anonymous and proves nothing except
possession of a payment intent's `clientSecret`, which travels in a request header rather
than a query string so it stays out of access logs.

See [`OxyHQ/oxy`](https://github.com/OxyHQ/oxy) for the identity platform behind all of
this.

## Gateway surface

| Route group | File |
|---|---|
| Payment intents | [`paymentIntents.ts`](packages/backend/src/routes/paymentIntents.ts) |
| Payment links | [`paymentLinks.ts`](packages/backend/src/routes/paymentLinks.ts) |
| Checkout sessions | [`checkoutSessions.ts`](packages/backend/src/routes/checkoutSessions.ts) |
| Merchants | [`merchants.ts`](packages/backend/src/routes/merchants.ts) |
| Webhook deliveries | [`webhookDeliveries.ts`](packages/backend/src/routes/webhookDeliveries.ts) |
| Dashboard | [`dashboard.ts`](packages/backend/src/routes/dashboard.ts) |
| Social send and receive | [`social.ts`](packages/backend/src/routes/social.ts) |
| Enrichment | [`enrich.ts`](packages/backend/src/routes/enrich.ts) |

Realtime intent updates go out over Socket.IO, which is what lets a checkout page move
from `confirming` to `settled` without polling.

## Documentation

- [Integrating Oxy Pay](docs/integrating-oxy-pay.md), the guide for merchants
- [Roadmap](docs/OXY-PAY-ROADMAP.md)

## Related

| Repo | What it is |
|---|---|
| [`OxyHQ/oxy`](https://github.com/OxyHQ/oxy) | The Oxy platform: identity, signed records, API and SDK |
| [`OxyHQ/OxyPaySDK`](https://github.com/OxyHQ/OxyPaySDK) | Landing page for `@oxyhq/pay`. The source is here, in `packages/sdk` |
