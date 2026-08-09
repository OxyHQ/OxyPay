# Oxy Pay — Master Plan & Progress Tracker

> **Control de principio a fin.** Este es el tracker vivo: se **tacha** (`[x]`) según se completa. Detalle en los docs enlazados. Ejecución **subagent-driven** (un subagente por tarea, en **paralelo** donde las tareas son independientes).

> **Estado (2026-07-19):** código completo (sin desplegar a mainnet) en identidad/wallet (rediseño Oxy-identity-first, Track D), Pockets, multisig L1 genérico (`@fairco.in/core@0.3.1`, **probado en testnet real**), pago social por `@username` (WS-S, ⚠️ testnet-only) y los 13 gaps de gateway de Fase 2 (F2.0). Todo vive local en la rama `feat/oxypay-fase2-gateway` (no pusheada). Pendiente: verificación interactiva en dispositivo (bloqueada por el keystore compartido roto en el Pixel de prueba tras una sesión de debugging → espera rebuild EAS de Commons), **F-1** (fix upstream en `@oxyhq/core` de la desincronización de clave compartida al rotar — bloquea mainnet para WS-S), Multisig L2 Shared Pockets (diseño aprobado, sin implementar), toda la plataforma de Fase 2 (SDK, checkout, payment links, dashboard), infra (`app-oxypay.tf` escrito y pusheado, sin aplicar) y la opinión legal MiCA.

- **Spec (visión + Fase 1):** [`docs/superpowers/specs/2026-07-18-oxypay-phase1-foundation-design.md`](superpowers/specs/2026-07-18-oxypay-phase1-foundation-design.md)
- **Plan F1 Track A (backend):** [`docs/superpowers/plans/2026-07-18-oxypay-gateway-backend-f1a.md`](superpowers/plans/2026-07-18-oxypay-gateway-backend-f1a.md)
- **Spec Fase 2 (gateway + dashboard):** [`docs/superpowers/specs/2026-07-18-oxypay-fase2-gateway-dashboard.md`](superpowers/specs/2026-07-18-oxypay-fase2-gateway-dashboard.md)
- **Plan F2.0 (gateway gap closures):** [`docs/superpowers/plans/2026-07-18-fase2-f20-gateway-gaps.md`](superpowers/plans/2026-07-18-fase2-f20-gateway-gaps.md) — ✅ **13/13 DONE**
- **Plan WS-S (social send/receive + rich tx identity):** [`docs/superpowers/plans/2026-07-18-ws-s-social-send-receive.md`](superpowers/plans/2026-07-18-ws-s-social-send-receive.md) — ✅ **19/19 DONE (⚠️ testnet-only)**
- **Spec rediseño identity-first (WS-F):** [`docs/superpowers/specs/2026-07-18-oxypay-oxy-identity-social-redesign-design.md`](superpowers/specs/2026-07-18-oxypay-oxy-identity-social-redesign-design.md) — ✅ integrado
- **Plan WS-F (foundation identity onboarding):** [`docs/superpowers/plans/2026-07-18-ws-f-foundation-identity-onboarding.md`](superpowers/plans/2026-07-18-ws-f-foundation-identity-onboarding.md) — ✅ Tasks 1-7 DONE
- **Plan WS-P (Pockets):** [`docs/superpowers/plans/2026-07-18-ws-p-pockets-fairwallet.md`](superpowers/plans/2026-07-18-ws-p-pockets-fairwallet.md) — ✅ DONE (mecánica + UI Revolut)
- **Spec L2 Shared Pockets (multisig social):** [`docs/superpowers/specs/2026-07-19-oxypay-l2-shared-pockets.md`](superpowers/specs/2026-07-19-oxypay-l2-shared-pockets.md) — diseño aprobado por el owner, implementación pendiente

## Productos (nomenclatura)
- **Oxy Pay** — app monedero (consumer, self-custody + identidad Oxy) → `packages/frontend`
- **Oxy Pay Gateway** — pasarela: backend + API + SDK `@oxyhq/pay` + servicios Stripe → `packages/backend` + `shared-types` + `OxyPaySDK`
- **Oxy Pay Terminal** — TPV (NFC, móvil/PC) → `packages/terminal`
- Registro apps/keys/tokens = **Oxy Console** · Dashboard propio estilo Stripe

## Invariante (nunca romper)
- [x] **No-custodia (técnica)** verificada en cada capa — ✅ backend audit 0-findings + WS-S T19 on-device key audit (claves solo en dispositivo; backend jamás posee/deriva/loguea clave privada; usuario firma; del merchant solo xpub watch-only). Firewall técnico MiCA confirmado. _(La OPINIÓN LEGAL sigue pendiente → línea de abajo.)_
- [ ] **Legal:** opinión escrita de abogado cripto/fintech UE (CNMV) antes de producción.

---

## Fase 0 — Pre-flight
- [x] **(Usuario)** commitear+pushear FAIRWallet + subtree-ar → **hecho** (FAIRWallet Pockets subtree-pulled, git `7c2374c`; Track B desbloqueado).

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
- [x] T13 · Wiring del server (`createGateway`) + **e2e completo** (create→submit_tx→watcher→settled→socket+webhook, no-custodia) _(65 tests originales; backend suite ahora 162/162 tras F2.0+WS-S)_

### Track B — App monedero (Oxy Pay)  _(desbloqueado; en curso en rama `feat/oxy-pay-wallet`)_
- [x] Subtree de FAIRWallet `main` en `packages/frontend` (`git subtree pull` para mejoras) + rename a `@oxypay/frontend` + `bun install` OK
- [x] Wiring del monorepo (Expo auto-detecta el workspace; blockList backend/shared-types; root tsconfig solution-file; scripts dev/build) _(expo export web + tsc -b verdes)_
- [x] Alinear Expo SDK 55 → 57 — hecho **en FAIRWallet upstream** (`chore/expo-sdk-57`, pusheado) y traído vía `git subtree pull`. Web/JS verde (bundle + 234 tests wallet). **Follow-up nativo:** `@maplibre/maplibre-react-native` v10→v11 (breaking, `map.tsx`) + test SPV de `react-native-tcp-socket` en dispositivo
- [x] Montar `OxyProvider` (identidad Oxy) — dentro de Bloom, encima del BottomSheet, incondicional _(clientId reutilizado; tsc + expo export verdes)_
- [x] Cliente backend vía `createLinkedClient` (`gateway-client.submitTx`) + config env
- [x] Suscripción Socket.io al estado del intent (`gateway-socket.subscribeToIntent`, token en handshake)
- [x] **Pantalla aprobar-pago** (`app/pay/[intent].tsx`) + parser `oxypay://pay` + deep-link → aprobar → `sendTransaction` → `submitTx` → estado en vivo _(tsc + expo export + pay test verdes)_
- [x] **Rebrand a `so.oxy.pay`** + variante dev/prod (`app.config.js`, `APP_VARIANT`) + **dev build Android instalado en dispositivo** (`so.oxy.pay.dev`, standalone arm64, FAIRWallet intacto). Fix de raíz: dedup `lightningcss` 1.30.1 vía override en `package.json` RAÍZ (bun solo honra el override de la raíz del workspace)
- [x] **Runtime — arranque:** la app arranca en dispositivo sin crash. Bug encontrado y arreglado **de raíz**: `@oxyhq/core` publicaba Unicode property-escapes (`\p{scx=…}`, `\p{Zl}`, …) que el Hermes móvil (RN 0.86, `HERMES_ENABLE_UNICODE_REGEXP_PROPERTY_ESCAPES` OFF) rechaza en runtime → `Invalid RegExp: Invalid property name` al importar el barrel en boot. Fix en **@oxyhq/core@12.5.4** (regexpu-core transpila los `\p{}` a rangos en build; dist con 0 property-escapes; 979 tests + barrido de 1.1M code-points). OxyPay dedup a un único core 12.5.4 vía override en `package.json` raíz.
- [ ] **Runtime — flujos (interactivo, pendiente usuario):** verificar cold-boot de OxyProvider + `signIn()` + flujo aprobar-pago en el dispositivo. **Bloqueado:** el Pixel de prueba quedó con el SSO compartido Commons↔OxyPay roto (keystore compartido corrupto tras una sesión de debugging de shared-UID) — espera el rebuild EAS de Commons con el self-heal de vault v2 (ver Track E) antes de poder re-verificar.
- [ ] **Rebrand interno:** el nombre de la app ya es "Oxy Pay" (`app.config.js` → `APP_NAME`) y no quedan strings de cara al usuario; sí quedan restos internos no visibles (comentarios de código, `package.json` description, user-agent P2P) que aún dicen "FAIRWallet" — barrido final pendiente.
- [ ] Console: actualizar redirect URIs/scopes del client id reutilizado (acción en Console/oxy-api)

### Track C — Integración end-to-end
- [ ] Flujo completo testnet: cobro → push/QR → aprobar → firma → settle → webhook
- [x] Auditoría no-custodia (0 claves en backend) — ✅ **VERIFIED** (audit `.superpowers/sdd/audit-nocustody.md`, 0 findings): Merchant model has no privkey field, pre-validate firewall rejects xprv, derivación public-key-only ambos flujos, submit_tx solo txid, sin logging de claves. Cubre TODO el backend (T19 solo el path social).

### Track D — Rediseño Oxy-identity-first, Pockets y Multisig L1 — ✅ código completo, integrado
- [x] **WS-F · Rediseño identity-first** (spec ligada arriba): wallet derivado de la identidad Oxy (`KeyManager.deriveScopedSeed`), onboarding Oxy-first, cuenta keyless, entitlements nativos de shared-keychain (Android `sharedUserId` + `withSharedIdentityReader`). Tasks 1-7 completas y revisadas; integrado en `feat/oxy-pay-wallet` (merge `4fbdc0e`); UI multi-wallet legacy eliminada (Task 6, tras el subtree-pull de Pockets).
- [x] **WS-P · Pockets** (plan ligado arriba): mecánica base (cuentas BIP44 por Pocket, mover fondos entre Pockets, registro) + rediseño de UI estilo Revolut (mockup aprobado por diseño). Construido en FAIRWallet `feat/pockets`, subtree-pulled a OxyPay e integrado con WS-F.
- [x] **Multisig L1 — genérico m-of-n P2SH** (`@fairco.in/core@0.3.1`, faircoin-core `main@561ba26`): dirección multisig + sighash BIP16 + firma parcial + ensamblador de scriptSig + estimación de fee + `buildMultisigSpend`, exportado desde el barrel. Auditoría de seguridad (`sec-multisig`/`sec-t10`): SAFE-WITH-REQUIRED-FIXES, todos los fixes aplicados (derivar `m` del redeemScript, verificación UTXO↔script, exactly-m firmantes, `verifyPartialSignature`); hardening L1-L3 (validación de pubkey, límite maxMoney, versión P2SH por red) publicado en 0.3.1. **T10 — probado en testnet real:** gasto 2-de-3 P2SH construido→firmado por 2 cosigners→combinado→broadcast vía SPVClient P2P real→aceptado en mempool→minado (bloque 36, FairCoin Core v3.0.5). Integrado en FAIRWallet (`feat/multisig` → merged a `feat/pockets` @ `3f7e925`).
- [ ] **Multisig L2 — Shared Pockets** (spec ligada arriba): m-of-n entre usuarios Oxy vía `@username`, backend keyless (relay + broadcast de firmas parciales cifradas E2E; nunca combina — la finalización ocurre en el dispositivo del proponente), self-custodia preservada. Diseño **aprobado por el owner** (2026-07-19); **implementación aún no empezada**. Prerequisitos: WS-S en producción (resolución de pubkey por identidad), mini-diseño de derivación de clave por-Pocket, gate de security-reviewer.

### Track E — Identity Vault v2 (durabilidad, upstream `@oxyhq/core` / Commons)
- [x] Aislamiento de slots de keychain (primary/backup en distintos servicios de keystore) + marcador `IdentityMarker` tri-state (`lost`/`absent`/`ok`) + escalera `attemptIdentityRecovery()` + self-heal de `EncryptedSharedPreferences` corrupto + backfill de la migración al shared-slot en el boot de Commons. Publicado **`@oxyhq/core@12.10.0`** / **`@oxyhq/services@22.8.2`**.
- [ ] **Redundancia rung-3** (gap identificado y acotado, sin implementar): cubre el caso uninstall+reinstall sin 2º dispositivo ni frase de recuperación — necesita una copia durable del marcador+backup fuera del sandbox de Commons.
- [ ] **F-1 — bloqueante de mainnet para WS-S:** la rotación de clave de identidad desincroniza el slot compartido usado para derivar direcciones de pago social (el pagador deriva sobre la clave nueva, el receptor sigue viendo la vieja) → pérdida de fondos silenciosa. Fix en progreso upstream en `@oxyhq/core` (misma sesión identity-vault v2); WS-S se queda en testnet-only hasta que aterrice y se re-verifique.
- ⚠️ **Coordinación pendiente:** OxyPay sigue fijado a `@oxyhq/core@12.8.0` / `@oxyhq/services@^22.4.0` (root override) — no consume todavía 12.10.0/22.8.2; bump pendiente, coordinado con el aterrizaje de F-1.

## Fase 2 — Gateway platform

> ### ✅ F2.0 · Gateway gap closures (prereq duro de toda Fase 2) — COMPLETE (2026-07-19)
> Los 8 gaps backend que la spec §3 marca como prerequisito están cerrados en rama `feat/oxypay-fase2-gateway` (local, sin push). Backend **162/162**, tsc limpio. Publicado **`@oxyhq/core@12.8.0`** (`environment`+`iss`/`aud` en service-token). Incluye: aislamiento test/live real (2 `Merchant` docs por app keyed por `environment`), registro/gestión de merchant (`POST /v1/merchants`, `GET`/`PATCH /me`), list + payer-authed read, log de webhook-delivery + redeliver, firewall de red por intent. Descubrió+arregló 3 defectos reales de auth de service-token. **Follow-ups también hechos:** scope-gating (create/reject/redeliver→`payments:write`), índices `merchantId`/`address`, tests auth-default. → **desbloquea SDK / checkout / payment-links / dashboard (los bullets de abajo).**
>
> ### ✅ WS-S · Pay-by-`@username` + social-receive + rich transaction identity — CODE COMPLETE, ⚠️ TESTNET-ONLY (2026-07-19)
> Pagar a otro usuario Oxy por `@username` (deriva address fresca de la clave pública de identidad del recipiente, sin interacción), recibir en una default estable + addresses frescas per-pago, e historial de tx estilo Stripe/Revolut (nombre+logo del merchant / avatar+nombre del contraparte). 19/19 tasks, backend 162/162 + frontend 307/307. Publicado **`@fairco.in/core@0.3.0`** (crypto social-receive). **Gate de seguridad (T19) ejecutado → NOT MAINNET-ELIGIBLE:** bloqueador **F-1** (rotación de clave de identidad desincroniza el slot compartido → pérdida de fondos; fix upstream en `@oxyhq/core`, **routed a la sesión identity-vault v2**). Se queda **testnet-only** hasta que F-1 aterrice. Detalle: memoria `oxypay-social-receive-security-status`.
>
> **Pendiente (features de plataforma Fase 2, aún sin empezar):**

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
- [ ] `oxy-infra/terraform-uswest2/app-oxypay.tf` — **prereq duro**: crea ECR `oxy/oxypay` + servicio ECS `oxypay` (port 3001, target group apunta a `/health`) + SSM `/oxy/oxypay/*`. **Archivo ya escrito y pusheado** (rama `oxy-infra:feat/oxypay-infra`, sin mergear a `main`) — falta merge + `terraform apply` + secrets/DNS.
- [ ] GitHub repo secrets: `DATABASE_URL`, `OXY_ACCESS_TOKEN_SECRET` (= el que la Oxy API usa para firmar los service tokens; lo lee `config.ts` como `serviceJwtSecret`), `IP_HASH_SALT`, `DEVICE_ID_SALT`
- [ ] `pay.oxy.so` (CF Pages) + `api.pay.oxy.so` (ALB)
