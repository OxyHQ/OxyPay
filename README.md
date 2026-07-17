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

## Deployment

Oxy Pay follows the standard Oxy split: **frontend on Cloudflare Pages, backend
on AWS ECS Fargate** (us-west-2, account `237343248947`), fronted by the shared
ALB, with Cloudflare DNS-only records.

| Piece | Where | Domain |
| ----- | ----- | ------ |
| Frontend (Expo web export) | Cloudflare Pages project `oxypay` | `pay.oxy.so` |
| Backend (`@oxypay/backend`, port 3001) | ECS Fargate (`oxy-cluster`) → ALB | `api.pay.oxy.so` |

- **Infra as code:** `oxy-infra/terraform-uswest2/app-oxypay.tf` (ECS service +
  target group + ALB listener rule via the `app-service` module, ECR repo, SSM
  params). DNS records for `pay.oxy.so` (→ CF Pages) and `api.pay.oxy.so` (→ ALB)
  in Cloudflare zone `oxy.so`.
- **CI/CD:** `.github/workflows/deploy-aws.yml` (backend: arm64 → ECR →
  `ecs update-service`) and `.github/workflows/deploy-cloudflare.yml` (frontend:
  `expo export` → CF Pages). Pin `bun-version: 1.3.14` everywhere.
- **MongoDB:** self-hosted Mongo (shared cluster, same as the other backends),
  database `oxypay`, connection string in SSM `/oxy/oxypay/MONGODB_URI`.
- **Secrets:** GitHub Actions repo secrets → synced to SSM `/oxy/oxypay/*`. Never
  commit secret values.

### Oxy app registration

Oxy Pay is a registered Oxy application (console.oxy.so), id
`6a37c3013fde077ba053aa7d`, redirect URIs `pay.oxy.so` + `localhost:8081/8082`
(`/__oxy/sso-callback`). Two credentials:

- **Frontend client id** (public credential publicKey) —
  `oxy_dk_857cabdaba3f79ec5c931706424f439b67f3bc7b7bc34fca`. Wired in
  `packages/frontend/lib/config.ts` (`EXPO_PUBLIC_OXY_CLIENT_ID` override). Public,
  safe to commit.
- **Backend app key** (confidential credential publicKey) —
  `oxy_dk_7d550846edcc31a8ce3464a214be42eaad8dad8689d6d311` →
  `OXY_PAY_INTERNAL_APP_KEY`. Its **secret** (`OXY_PAY_INTERNAL_APP_SECRET`) is
  shown once at creation and lives only in SSM / GitHub secrets — NEVER in git.

## FairCoin integration

FairCoin stays on DigitalOcean (nodes `vps1`/`vps2.fairco.in`, public JSON-RPC
via `FairRPCAPIServer` / `seed1.fairco.in`); it is **not** migrated to AWS.

**Current status:** `packages/backend/src/services/faircoin.service.ts` runs in
**mock mode only**. Setting `FAIRCOIN_RPC_URL` makes deposit/withdrawal endpoints
return `503 faircoin_not_configured` on purpose — the live RPC client is not yet
implemented. Deploy with FairCoin in mock mode until the live client lands.

**Live client (to implement)** must build on the official FairCoin TypeScript
packages (both current, MIT, on npm):

- `@fairco.in/rpc-client` — JSON-RPC to `faircoind` (`getblockcount`,
  `listsinceblock`, `sendrawtransaction`, …).
- `@fairco.in/core` — BIP32/39/44 HD wallets, P2PKH, transaction building +
  signing (`deriveAddress`, `MAINNET`).

**Correct RPC env** (the official client's contract — note port **46373**, not
the `40404` placeholder in the old `.env.example`):

```
FAIRCOIN_RPC_HOST=seed1.fairco.in   # or vps1/vps2.fairco.in
FAIRCOIN_RPC_PORT=46373             # RPC port (46372 is the P2P port)
FAIRCOIN_RPC_USER=faircoinrpc
FAIRCOIN_RPC_PASS=<in SSM /oxy/oxypay/FAIRCOIN_RPC_PASS — never in git>
```

On-chain money handling (HD key custody, withdrawal signing, the deposit chain
watcher) is security-critical and must go through a security review before going
live.

## Repos

- `OxyHQServices` — the Oxy core monorepo (`@oxyhq/core`, `@oxyhq/services`,
  `@oxyhq/auth`, Oxy API).
- `OxyPay` (this repo) — Oxy Pay backend and app.
- `OxyPaySDK` — `@oxyhq/pay` SDK for embedding Oxy Pay in any Oxy app.
- `FairWallet` — self-custodial FairCoin wallet app (separate ecosystem).
