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
- [ ] T5 · Máquina de estados del intent (pura)
- [x] T6 · Firmador HMAC de webhooks _(constant-time, 8 tests verdes)_
- [ ] T7 · Modelos Mongoose (Merchant + PaymentIntent, watch-only enforced)
- [ ] T8 · Cliente HTTP del Explorer (tip + received por dirección) _(verificar/mejorar endpoint)_
- [ ] T9 · Settlement watcher (tip-driven, no-custodial)
- [ ] T10 · Dispatcher de webhooks (safeFetch + reintentos)
- [ ] T11 · Rutas REST (create/get/reject, serviceAuth + idempotencia)
- [ ] T12 · Realtime Socket.io (updates del intent)
- [ ] T13 · Wiring del server + smoke e2e en testnet

### Track B — App monedero (Oxy Pay)  _(bloqueado: necesita el ref de FAIRWallet)_
- [ ] Subtree de FAIRWallet en `packages/frontend`
- [ ] Wiring del monorepo (metro/tsconfig monorepo-aware)
- [ ] Alinear Expo SDK 55 → 57 (sub-fase previa)
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
- [ ] `Dockerfile` backend + `.dockerignore` (`**/node_modules`, `**/dist`)
- [ ] `.github/workflows/deploy-aws.yml` (ECR→ECS, OIDC, bun 1.3.14) + `deploy-cloudflare.yml`
- [ ] `oxy-infra/terraform-uswest2/app-oxypay.tf` + SSM `/oxy/oxypay/*`
- [ ] `pay.oxy.so` (CF Pages) + `api.pay.oxy.so` (ALB)
