# @oxypay/backend

Express + MongoDB backend for Oxy Pay.

## HTTP surface

All endpoints require an Oxy user JWT (via `@oxyhq/core`'s `oxyClient.auth()`)
unless noted.

- `GET /health` — liveness probe (public)
- `GET /wallets` — list the caller's wallets
- `POST /wallets` `{ currency }` — create / fetch wallet for currency
- `GET /wallets/:walletId` — fetch a single wallet (must belong to caller)
- `POST /wallets/dev/top-up` `{ currency, amount }` — dev-only credit
- `GET /transactions?walletId&currency&cursor&limit` — paginated transactions
- `POST /invoices` `{ amount, items?, … }` — merchant creates invoice
- `GET /invoices` — list merchant's invoices
- `GET /invoices/:id` — fetch invoice
- `POST /invoices/:id/cancel` — merchant cancels open invoice
- `POST /payments/pay-invoice` `{ invoiceId, method }` — pay an open invoice
- `POST /payments/transfer` `{ toUserId, amount, note? }` — P2P transfer
- `GET /payments/:id` — fetch a payment (must be payer / merchant / recipient)
- `GET /faircoin/deposit-address` — FairCoin top-up address for the caller
- `POST /faircoin/estimate-fee` `{ amountFair }` — quote a withdrawal fee

## Dev quick start

```bash
cd packages/backend
cp .env.example .env
# edit .env with your local Mongo + OXY_API_BASE_URL
bun install
bun run dev
```

The FairCoin integration runs in **mock mode** when `FAIRCOIN_RPC_URL` is
unset: addresses are randomly-generated base58 strings and withdrawals are
disabled. See `src/services/faircoin.service.ts` for the live-mode contract.
