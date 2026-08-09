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
| `packages/backend/` | `@oxypay/backend` | Express + Socket.IO gateway API. Mid-port from Mongoose to PostgreSQL — see below |
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

## PostgreSQL: the schema has landed, the routes have not

The backend is mid-port from Mongoose to PostgreSQL. **Both are present, and
that is not a dual-write** — Postgres carries the schema, the migrator, the test
harness and the two derivation-index reservations; every ROUTE still reads and
writes Mongo. Nothing in the request path touches Postgres yet, and
`DATABASE_URL` is optional for exactly that reason: `db/postgres.ts` refuses to
open a pool without it, with a named error, and nothing calls it at boot. The
change that moves the first route makes it required in `config.ts` and calls
`connectPostgres()` from `server.ts`.

Database `oxypay` on the shared `oxy-postgres` RDS instance, owned by role
`oxypay`. **No extensions** — measured, and stated as an explicit empty list in
`src/db/migrate.ts`.

- **Schema decisions live in `packages/backend/src/db/schema/CONVENTIONS.md`**
  and that file is binding. Read it before touching a table; it records what
  each decision is AND why the obvious alternative is wrong, including three
  CHECK constraints that look obvious and would refuse a legal write.
- **Migrations:** `bun run db:generate` writes the SQL, and every generated file
  needs exactly one `-- oxy:deploy-phase=pre|post` marker — there is no default.
  `bun run db:migrate -- --target-database=<name> --phase=<pre|post|all>` is the
  ONLY thing that applies it; `drizzle-kit migrate` is a devDependency and cannot
  reach the production image. `--phase=all` is for a from-zero genesis, never a
  normal release.
- **The runtime image runs TypeScript source under Bun**, so migrations live
  under `src/db/migrations/` and are copied into the image with everything else
  in `src/`. Do not move them to a package-root `drizzle/` folder without
  changing the Dockerfile.
- **Tests need a real server.** `docker compose -f docker-compose.postgres.yml
  up -d`, then `TEST_DATABASE_URL=postgres://oxypay:oxypay@localhost:5439/postgres`.
  They skip without it, and `db/__tests__/schemaGates.realdb.test.ts` turns that
  skip into a red build when `CI` is set.

### The reservation is the highest-risk thing in this repo

`db/merchants/derivationIndex.ts` and `db/social/receiveCursor.ts` decide which
address a payer sends money to. Both are ONE statement — `UPDATE … SET x = x + 1
… RETURNING x - 1`, and for the social cursor an `INSERT … ON CONFLICT DO UPDATE`
that folds the lazy create into the same statement. Never split either into a
read followed by a write: two callers reading the same value derive the same
address, and two payments land where the gateway can tell only one of them apart.

The counters are `integer` on purpose (see `CONVENTIONS.md` §Counters) — a
`bigint` column comes back from postgres.js as a STRING, and `"0" + 1` is `"01"`.
Any change there must keep the two-consecutive-reservation test, because a single
reservation cannot tell a number from a string that prints the same.

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
