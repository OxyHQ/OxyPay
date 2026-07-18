# Oxy Pay — Master Plan & Progress Tracker

> **Control de principio a fin.** Este es el tracker vivo: se **tacha** (`[x]`) según se completa. Detalle en los docs enlazados. Ejecución **subagent-driven** (un subagente por tarea, en **paralelo** donde las tareas son independientes).

- **Spec (visión + Fase 1):** [`docs/superpowers/specs/2026-07-18-oxypay-phase1-foundation-design.md`](superpowers/specs/2026-07-18-oxypay-phase1-foundation-design.md)
- **Plan F1 Track A (backend):** [`docs/superpowers/plans/2026-07-18-oxypay-gateway-backend-f1a.md`](superpowers/plans/2026-07-18-oxypay-gateway-backend-f1a.md)

## Productos (nomenclatura)
- **Oxy Pay** — app monedero (consumer, self-custody + identidad Oxy) → `packages/frontend`
- **Oxy Pay Gateway** — pasarela: backend + API + SDK `@oxyhq/pay` + servicios Stripe → `packages/backend` + `shared-types` + `OxyPaySDK`
- **Oxy Pay Terminal** — TPV (NFC, móvil/PC) → `packages/terminal`
- Registro apps/keys/tokens = **Oxy Console** · Dashboard propio estilo Stripe

## Invariante (nunca romper)
- [ ] **No-custodia** verificada en cada capa (claves solo en dispositivo; backend jamás posee fondos; usuario firma; del merchant solo xpub watch-only). Firewall legal MiCA.
- [ ] **Legal:** opinión escrita de abogado cripto/fintech UE (CNMV) antes de producción.

---

## Fase 0 — Pre-flight
- [ ] **(Usuario)** commitear+pushear FAIRWallet y pasar el **ref** a subtree-ar → desbloquea Track B.

## Fase 1 — Cimiento (flujo atómico no-custodial)

### Track A — Gateway backend + shared-types  _(independiente del ref; en curso)_
- [x] T1 · Repo prep: rama, archivar backend WIP, scaffold `@oxypay/backend` + reset `shared-types` _(bun-native/ESM; xpub testnet vector generado; typecheck limpio)_
- [x] T2 · `shared-types`: contrato `PaymentIntent` + eventos webhook _(3 tests, typecheck+build limpios)_
- [x] T3 · Generador de IDs prefijados (`pi_`, `evt_`) _(4 tests verdes)_
- [x] T4 · Derivación watch-only desde xpub del merchant _(vector testnet real, guard no-custodia, 3 tests verdes)_
- [x] T5 · Máquina de estados del intent (pura) _(reorg exception + idempotencia, 18 tests)_
- [x] T6 · Firmador HMAC de webhooks _(constant-time, 8 tests verdes)_
- [x] T7 · Modelos Mongoose (Merchant + PaymentIntent, watch-only enforced) _(reserva atómica, idempotency index, 8 tests)_
- [x] T8 · Cliente HTTP del Explorer (tip + `getTransaction`/`verifyPayment`, zod) _(8 tests + live mainnet)_
- [x] T9 · Settlement watcher (tip-driven, no-custodial) _(txid verify, deps inyectadas, 2 tests)_
- [x] T10 · Dispatcher de webhooks (safeFetch + reintentos) _(SSRF-safe, best-effort, 4 tests)_
- [x] T11 · Rutas REST (create/get/reject/**submit_tx**, serviceAuth + idempotencia) _(9 tests; usa serializer compartido)_
- [x] T12 · Realtime Socket.io (updates del intent, join gateado por client_secret)
- [x] T13 · Wiring del server (`createGateway`) + **e2e completo** (create→submit_tx→watcher→settled→socket+webhook, no-custodia) _(65 tests backend / 0 fail)_

### Track B — App monedero (Oxy Pay)  _(desbloqueado; en curso en rama `feat/oxy-pay-wallet`)_
- [x] Subtree de FAIRWallet `main` en `packages/frontend` (`git subtree pull` para mejoras) + rename a `@oxypay/frontend` + `bun install` OK
- [x] Wiring del monorepo (Expo auto-detecta el workspace; blockList backend/shared-types; root tsconfig solution-file; scripts dev/build) _(expo export web + tsc -b verdes)_
- [x] Alinear Expo SDK 55 → 57 — hecho **en FAIRWallet upstream** (`chore/expo-sdk-57`, pusheado) y traído vía `git subtree pull`. Web/JS verde (bundle + 234 tests wallet). **Follow-up nativo:** `@maplibre/maplibre-react-native` v10→v11 (breaking, `map.tsx`) + test SPV de `react-native-tcp-socket` en dispositivo
- [ ] Montar `OxyProvider` (identidad Oxy) — orden de providers Bloom
- [ ] Cliente backend vía `createLinkedClient`
- [ ] Pantalla aprobar-pago + bandeja de payment-requests + push
- [ ] Suscripción Socket.io al estado del intent

### Track C — Integración end-to-end
- [ ] Flujo completo testnet: cobro → push/QR → aprobar → firma → settle → webhook
- [ ] Auditoría no-custodia (0 claves en backend)

## Fase 2 — Gateway platform
- [ ] SDK `@oxyhq/pay` (`OxyPaySDK`): checkout / pay-button embebibles (`oxypay.paymentIntents.create()`)
- [ ] Payment links + hosted checkout
- [ ] Invoices
- [ ] Integración en **Mercaria** (`~/Mercaria`)
- [ ] **Plugin WordPress/WooCommerce** (tiendas en sus webs) + equivalentes (Shopify/PrestaShop)
- [ ] Dashboard developer estilo Stripe (UI Oxy Pay + backend de keys/tokens en **Oxy Console**)
- [ ] Webhooks configurables + logs en dashboard

## Fase 3 — Presencial / POS (Oxy Pay Terminal)
- [ ] App Expo `packages/terminal` (móvil + PC/Electron + lector USB NFC)
- [ ] NFC como 3er canal del mismo `PaymentIntent`
- [ ] Decisión dirección NFC + entitlement iOS (EEA)
- [ ] Aceptación 0-conf (bajo importe) / 1-conf (alto)

## Fase 4 — Amplitud Stripe
- [ ] Subscriptions (no-custodial: per-approval o pre-firma nLockTime — R&D)
- [ ] Refunds · Payouts · Antifraude · Disputas · Analítica

## Cross-cutting — Infra / CI  _(AWS, NO DigitalOcean)_
- [x] `Dockerfile` backend (2-stage, arm64, bun 1.3.14, hoisted, non-root) + `.dockerignore`
- [x] `.github/workflows/deploy-aws.yml` (OIDC, ECR→ECS rolling, SSM secret sync)
- [x] `GET /health` (liveness sin auth para el health check del ALB)
- [ ] `deploy-cloudflare.yml` (frontend — bloqueado con Track B)
- [ ] `oxy-infra/terraform-uswest2/app-oxypay.tf` — **prereq duro**: crea ECR `oxy/oxypay` + servicio ECS `oxypay` (port 3001, target group apunta a `/health`) + SSM `/oxy/oxypay/*`
- [ ] GitHub repo secrets: `MONGODB_URI`, `SERVICE_TOKEN_SECRET` (= el que la Oxy API usa para mintear service tokens), `IP_HASH_SALT`, `DEVICE_ID_SALT`, `OXY_API_URL`
- [ ] `pay.oxy.so` (CF Pages) + `api.pay.oxy.so` (ALB)
