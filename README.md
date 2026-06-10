# Oxy Pay

Oxy Pay is the payments service of the Oxy ecosystem. It is a **custodial,
server-side payments platform** — think Google Pay or Apple Pay for the Oxy
account. Users hold a balance, send and receive payments, and pay merchants.
FairCoin top-ups and withdrawals are supported through a separate self-custodial
wallet (FairWallet, lives in its own repo).

This is a **bun + turbo monorepo** containing the Oxy Pay backend, the
Oxy Pay mobile/web app, and the shared types used by both.

```
OxyPay/
├── packages/
│   ├── shared-types/   @oxypay/shared-types   — TS types shared by backend and frontend
│   ├── backend/        @oxypay/backend        — Express API + MongoDB + FairCoin node integration
│   └── frontend/       @oxypay/frontend       — Expo app (iOS / Android / Web) with Bloom UI
└── package.json
```

The public **`@oxyhq/pay` SDK** (consumed by Mention, Allo, Homiio, TNP, etc. to
accept payments) lives in a separate repo: `OxyPaySDK/`. Both the app and the
SDK talk to the **same backend** in this repo.

## Quick start

```bash
bun install
bun run build:shared-types
bun run dev
```

- Backend: <http://localhost:3001>
- Frontend: <http://localhost:8081>

## Authentication

Oxy Pay authenticates users via their Oxy account. The backend trusts
`@oxyhq/core`'s `oxyClient.auth()` middleware for user JWTs and exposes
service-token endpoints (`oxyClient.serviceAuth()`) for internal Oxy services
that need to charge or query on behalf of a user.

## Payment methods

- **Oxy Pay balance** — custodial account balance held by the Oxy Pay
  backend. Instant debit, no on-chain confirmation needed.
- **FairCoin top-up / withdrawal** — connects to a FairCoin node (or a service
  bridge to the FairCoin chain) for funding and cashing out the balance.
- **Card** (future) — credit/debit card on/off ramp through a regulated
  provider. Disabled by default.

## Repos

- `OxyHQServices` — the Oxy core monorepo (`@oxyhq/core`, `@oxyhq/services`,
  `@oxyhq/auth`, Oxy API).
- `OxyPay` (this repo) — Oxy Pay backend and app.
- `OxyPaySDK` — `@oxyhq/pay` SDK for embedding Oxy Pay in any Oxy app.
- `FairWallet` — self-custodial FairCoin wallet app (separate ecosystem).
