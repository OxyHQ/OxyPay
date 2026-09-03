# Oxy Pay — Fase 2 (Gateway platform): SDK, checkout, payment links, invoices, dashboard

> **Estado: DRAFT — pendiente de brainstorm con el owner.** No es spec ejecutable todavía; su único objetivo es fundamentar la decisión. Cada sección cita el código real de Track A (F1) sobre el que se apoya. Fecha: 2026-07-18.
> Sigue la nomenclatura ya fijada en el roadmap y en el spec de F1 — no la reinventa: **Oxy Pay** (app monedero) · **Oxy Pay Gateway** (backend+API+SDK, este doc) · **Oxy Pay Terminal** (F3, fuera de alcance) · **Oxy Console** (registro apps/keys/tokens, reutilizado).

## 0. Qué existe hoy (Track A / F1 — completo, 65 tests backend)

Fase 1 entregó el **motor de liquidación no-custodial** sobre el que se apoya todo F2. Resumen con cita exacta:

- **Modelos** (`packages/backend/src/models/`): `Merchant.ts` — `oxyAppId` único, `xpub` watch-only (firewall no-custodia en el `pre('validate')` hook, líneas 45-55: deriva el índice 0 del xpub y rechaza cualquier clave privada), `nextDerivationIndex`, `webhookUrl`/`webhookSecret` (un único endpoint), `requiredConfirmations`, `livemode`. `PaymentIntent.ts` — `id`/`clientSecret`/`idempotencyKey` (índice único `{merchantId, idempotencyKey}`, línea 53), `amount` como string base-unit (nunca float), `metadata` como `Map`.
- **Rutas** (`routes/paymentIntents.ts`): `POST /v1/payment_intents` (merchant-authed vía `oxyClient.serviceAuth()`, `Idempotency-Key` obligatorio, líneas 114-200), `GET /v1/payment_intents/:id` (**merchant-authed únicamente**, líneas 202-219), `POST .../reject` (merchant-authed, 221-253), `POST .../submit_tx` (**payer-path, sin auth de servicio — autorizado por posesión del `client_secret`**, 257-299).
- **Derivación watch-only** (`services/derivation.ts` + `reserveAddress.ts`): dirección fresca por intent vía `HDKey.fromExtendedKey` + `deriveChild`, atómica vía `findOneAndUpdate({$inc})`.
- **Máquina de estados** (`shared-types/src/paymentIntent.ts` líneas 23-37 + `services/intentState.ts`): tabla `ALLOWED` de transiciones, más la excepción documentada de reorg (`settled → confirming`).
- **Watcher** (`services/settlementWatcher.ts`): tip-driven, polling cada 5s sobre intents `broadcast`/`confirming` con `txid`, verifica vía `explorer.ts` (`GET /api/transaction/:txid` — **no** `addressindex`, ver bloqueo #7 abajo).
- **Webhooks** (`services/webhookSigner.ts` + `webhookDispatcher.ts`): HMAC estilo Stripe (`t=...,v1=...`), reintentos con backoff acotado, `safeFetch` anti-SSRF, **best-effort — nunca bloquea el settlement**.
- **Realtime** (`realtime/socket.ts`): `io.use(oxyClient.authSocket())` + join a `intent:<id>` gateado por `client_secret` (líneas 49-71) — el mismo patrón que usará cualquier checkout embebido.
- **Contrato** (`shared-types/src/`): `PaymentIntent`, `WebhookEvent<T>` con tipos punteados (`payment_intent.settled`, etc.), `isBaseUnitString`. IDs prefijados `pi_`/`evt_` (`lib/ids.ts`, **solo esos dos prefijos hoy**).
- **Wiring** (`server.ts`): versión de API por header `Oxy-Pay-Version: 2026-07-18` (línea 43), `/health` sin auth para el ALB.

### Bloqueos / huecos reales que F2 hereda (verificados leyendo el código, no supuestos)

1. **No existe `GET /v1/payment_intents` (list).** Solo `retrieve` por id. Bloquea tanto el SDK (`.list()`) como el panel "Payments" del dashboard.
2. **No hay lectura pública/payer del intent.** `GET .../:id` es 100% merchant-authed (`paymentIntents.ts:204`). El único acceso payer-side es `submit_tx` (client_secret) y el socket `subscribe` (también client_secret, `socket.ts:52-70`). Una página de checkout hoy **no tiene snapshot REST inicial** — dependería enteramente de una carrera de socket sin fallback. Stripe resuelve esto con `retrieve` autorizado por `client_secret` (publishable key + secret); aquí falta el equivalente.
3. **No existe ruta de alta/gestión de `Merchant`.** El modelo existe; no hay `POST /v1/merchants` ni nada expuesto — el único artefacto es `scripts/gen-xpub-vector.ts` (genera un vector de test, no registra nada). Hoy el alta es manual-DB. **Esto bloquea cualquier onboarding self-service desde Console/dashboard.**
4. **Test/live mode no se aplica.** `Merchant.livemode` existe como campo pero `resolveMerchant` (`paymentIntents.ts:80-96`) hace `findOne({oxyAppId})` — un único documento por Application, sin cruce con el `environment` (`development`/`staging`/`production`) de la `ApplicationCredential` que autenticó la llamada. Hoy nada impide que una credencial "test" cree un intent en `mainnet` real. Esto rompe la promesa "test/live mode por app-key" que el propio spec de F1 ya se comprometió a dar (línea 56).
5. **La entrega de webhooks no se persiste.** `onIntentChange` en `server.ts:92` llama `await deliver(...)` y **descarta el resultado**. No hay modelo de log. Bloquea un panel "Webhook logs" en el dashboard y cualquier "reenviar evento".
6. **Un solo endpoint de webhook por merchant** (`Merchant.webhookUrl`/`webhookSecret`, singular). Stripe permite N endpoints con filtro de eventos por endpoint.
7. **El Explorer no tiene `addressindex`** (ya documentado en el spec de F1, líneas 100-106: `"limited data available"`). Sin vigilancia por-dirección, el backend **solo** puede confirmar un pago si alguien le reporta el `txid` (vía `submit_tx`). Un pagador que paga desde una wallet externa (no Oxy Pay) no tiene forma automática de que el backend lo detecte — bloquea materialmente la promesa "cualquiera puede pagar, con o sin Oxy Pay" del checkout hosteado.
8. **`newId()` solo conoce `pi_`/`evt_`** (`lib/ids.ts:13`). Necesita extenderse para `link_`/`cs_`/`in_`/`merch_` en cuanto esos recursos existan.

Ninguno de estos es un defecto de F1 — son huecos **esperados** de un cimiento que solo tenía que probar el flujo atómico. Pero el owner debe verlos antes de comprometerse a fechas de F2: #3, #4 y #7 en particular son requisitos duros, no detalles de implementación.

## 1. Descomposición en sub-specs + build order propuesto

F2 no es una spec — son al menos **cinco** entregables independientes que comparten un único primitivo (`PaymentIntent`). Propuesta de secuencia (cada uno bloquea al siguiente salvo que se indique "paralelo"):

```
F2.0  Gateway API gaps (bloqueos #1-#6 arriba) — prerequisito duro de TODO lo demás
        │
F2.1  SDK @oxyhq/pay (server-side) ──┬── F2.2 Hosted checkout (redirect, sin embed)
        │                            │
        └────────────────────────────┴── F2.3 Payment links (sobre checkout)
                     │
        F2.4 SDK embed (browser, checkout inline) ── paralelo a F2.3, reusa el mismo socket contract
                     │
        F2.5 Dashboard (Console tab "Payments") ── puede arrancar en paralelo a F2.2/F2.3
             una vez F2.0 (list + retrieve + merchant CRUD) está cerrado
                     │
        F2.6 Invoices ── DEFERIDO (ver decisión #7); último, y candidato a saltarse en v1
```

Razonamiento: el SDK server-side (F2.1) es el consumidor más simple de la API — es la forma más barata de validar que F2.0 cerró los huecos correctos antes de construir UI encima. El checkout hosteado (F2.2) es el primer entregable con valor de producto real (Mercaria puede integrarlo). Payment links (F2.3) es checkout + persistencia, no una capa nueva. El dashboard (F2.5) es paralelo porque consume la misma API que el SDK — no depende de checkout/links estar terminados, solo de F2.0. Invoices al final porque es el subsistema más especulativo (ver decisión #7) y el propio spec de F1 ya lo cataloga como "F2/F4" (línea 24), no como F2 puro.

## 2. SDK `@oxyhq/pay`

### Server-side (Node) — mapeo directo sobre las rutas existentes

```ts
import { OxyPay } from '@oxyhq/pay';

const oxypay = new OxyPay({ publicKey: 'oxy_dk_...', secret: '...' }); // ApplicationCredential type:'service'

const intent = await oxypay.paymentIntents.create({
  amount: '150000000', // base units, string — mismo contrato que CreatePaymentIntentParams
  network: 'mainnet',
  metadata: { orderId: 'ord_123' },
}, { idempotencyKey: 'ord_123-attempt-1' }); // mapea 1:1 al header Idempotency-Key

await oxypay.paymentIntents.retrieve(intent.id);
await oxypay.paymentIntents.list({ status: 'settled', limit: 20 }); // NUEVO — requiere F2.0 #1
await oxypay.paymentIntents.reject(intent.id);

const event = oxypay.webhooks.constructEvent(rawBody, signatureHeader, endpointSecret);
```

- **Auth = reutilizar, no reinventar.** El SDK server-side se configura EXACTAMENTE como cualquier servicio interno Oxy: `publicKey`/`secret` de una `ApplicationCredential` `type:'service'` (`OxyHQServices/packages/api/src/models/ApplicationCredential.ts:4`), mintando un JWT vía el mismo mecanismo que `oxyClient.serviceAuth()` ya valida en `paymentIntents.ts:111`. **No hay "API key de Oxy Pay" nueva** — es el mismo credential Console ya emite para cualquier Application, con `scopes` (posiblemente un scope nuevo `payments:write`/`payments:read` añadido a `APPLICATION_SCOPES`, `applicationScopes.ts:27-40`, siguiendo el mismo patrón que `files:write` o `updates:publish`).
- **`webhooks.constructEvent`** debe usar la MISMA lógica que `services/webhookSigner.ts::verifyWebhook` — recomendación: extraer ese archivo (ya es zero-dep, solo `node:crypto`) a `@oxypay/shared-types` o un paquete `@oxyhq/pay-crypto` diminuto, importado tanto por el backend (firma) como por el SDK (verifica) y por el dashboard si necesita re-verificar logs. Evita que el algoritmo de firma diverja entre "lo que el Gateway firma" y "lo que el SDK verifica" — el mismo tipo de bug que el proyecto ya evita en otros sitios con "una sola autoridad".
- **`Idempotency-Key`** ya es un header real hoy (`paymentIntents.ts:121`); el SDK solo lo expone ergonómicamente.

### Client-side (browser) — checkout embebible

Un segundo entry point del MISMO paquete npm (`@oxyhq/pay/checkout`, patrón Stripe.js), pensado para incrustar en la web de un merchant (ej. WooCommerce, Mercaria):

```html
<script type="module">
  import { OxyPayCheckout } from '@oxyhq/pay/checkout';
  const checkout = OxyPayCheckout.mount('#pay-button', { clientSecret });
  checkout.on('settled', () => window.location.href = '/thank-you');
</script>
```

Internamente **reutiliza el socket contract que ya existe** — el mismo `subscribe({intentId, clientSecret})` gateado en `realtime/socket.ts:49-71` que hoy usa el wallet. No hay backend nuevo que construir para el embed en sí, solo el cliente JS y (F2.0 #2) el `retrieve` público para el snapshot inicial antes de que el socket confirme la suscripción.

## 3. Hosted checkout + payment links

**Invariante no-custodial sin excepción:** el pagador paga desde SU wallet self-custody; la página de checkout **nunca** pide ni ve una clave privada. Dos modos, mismo `PaymentIntent` (principio ya fijado en el spec de F1, línea 162 — "PaymentIntent agnóstico al canal"):

- **(A) Payer CON Oxy Pay:** la página detecta el deep link `oxypay://pay/<id>?client_secret=...` (mismo parser que ya existe en `app/pay/[intent].tsx` del frontend F1) y ofrece "Abrir en Oxy Pay" / botón que dispara el deep link en móvil. El wallet hace exactamente el flujo ya construido: aprobar → firmar → `submit_tx` → estado en vivo.
- **(B) Payer SIN Oxy Pay (wallet externa o ninguna):** la página muestra dirección + QR + importe (patrón BTCPay) y ofrece polling de estado. **Bloqueado hoy** por el hueco #7 (sin `addressindex`) — sin eso, la página no puede detectar el pago sola; el único camino es pedirle al usuario que pegue su `txid` manualmente tras pagar, lo cual es frágil y no es la experiencia "Stripe sobre FairCoin" que el producto promete. Ver decisión #4.

**Payment links** son la versión persistente/reutilizable de lo anterior: un recurso `link_...` con importe fijo (v1) que, en cada visita/pago, crea (o reutiliza si hay uno abierto) un `PaymentIntent` fresco — igual que Stripe Payment Links. No es una capa de datos nueva sobre el `PaymentIntent`, es un generador de intents con una URL estable.

Nuevas rutas necesarias (todas nuevas — no existen hoy): `POST /v1/checkout_sessions`, `POST /v1/payment_links`, `GET /v1/payment_intents/:id` variante payer (client_secret).

## 4. Invoices

Diseño mínimo propuesto (si se construye — ver decisión #7): un `Invoice` envuelve **un** `PaymentIntent` (no varios, no recurrencia), añade `lineItems[]` (solo presentación — sin impuestos/descuentos server-side en v1), `dueDate`, y un `status` (`draft`/`open`/`paid`/`void`) derivado del estado del intent subyacente (`settled` → `paid`). Nada de pagos parciales ni recurrencia — eso es F4 (`Subscriptions` ya está marcado como R&D en el roadmap, línea 74).

## 5. Dashboard (estilo Stripe)

### ¿Extiende Oxy Console o es standalone?

Hay un precedente EXACTO en el propio Console: **Oxy Updates** (OTA) vive como pestaña por-app (`OxyHQServices/packages/console/src/routes/_layout/apps/$appId/updates.tsx` + `components/apps/updates-section.tsx`, 631 líneas) dentro de la página de detalle de cada `Application`, junto a "General"/"Credentials"/"Usage". La diferencia clave: **Updates guarda sus datos en la MISMA base de oxy-api** (`AppUpdate`/`UpdateAsset`/`UpdateChannel` en `packages/api/src/models/`), mientras que **Oxy Pay Gateway tiene su propia base Mongo separada** (`OxyPay/packages/backend`, host `api.pay.oxy.so` según el roadmap). Una pestaña "Payments" en Console tendría que llamar a un host distinto — es una llamada cross-service desde el frontend, no una ruta más de oxy-api.

Eso no descarta la pestaña — solo significa que hay que resolver explícitamente CÓMO autoriza el Gateway a un humano (ver más abajo), cosa que Updates no tuvo que resolver porque vive en la misma base y reutiliza el `requireAppPermission` de oxy-api directamente.

### Cómo autoriza el Gateway una sesión de dashboard (humano, no servicio)

Hoy el Gateway solo conoce DOS identidades: merchant (`ApplicationCredential` service-token, server-to-server) y payer (posesión de `client_secret`). Un dashboard visto por un humano logueado en Console es una TERCERA identidad — un usuario Oxy con sesión, que necesita permiso de lectura sobre el `Merchant` ligado a una `Application` que NO necesariamente creó él. La forma correcta de resolver "¿este usuario Oxy tiene permiso sobre esta Application?" ya existe en oxy-api (`GET /applications/:appId` devuelve `callerMembership` con el rol efectivo, derivado de `AccountMember` con herencia de árbol — `OxyHQServices/packages/api/src/routes/applications.ts`). El Gateway NO debería duplicar esa lógica de RBAC (violaría "una sola autoridad" / fix-upstream). Ver decisión #2.

### Contenido propuesto (Stripe-style, sobre lo que YA existe + lo que falta)

- **Payments** (lista + detalle) — necesita F2.0 #1 (list) y reutiliza `toPaymentIntentDTO` (`lib/serialize.ts`) tal cual.
- **API keys** — **no se construye en el Gateway.** Es exactamente `credentials-section.tsx` de Console, ya construido, reutilizado sin cambios (crear/rotar/revocar `ApplicationCredential`).
- **Webhooks (config + logs)** — config = editar `Merchant.webhookUrl`/`webhookSecret` (necesita F2.0 #3, la ruta de gestión de merchant, que hoy no existe). Logs = necesita F2.0 #5 (persistir entregas).
- **Merchant setup (registro de xpub watch-only)** — pantalla nueva, sin precedente en Console (Application no tiene nada parecido a un xpub). Necesita F2.0 #3.
- **Test/live toggle** — bloqueado por F2.0 #4 hasta que el modelo de merchant separe entornos.

## 6. No-custodia + MiCA — el gate que no se negocia

Cada superficie nueva de F2 hereda el invariante de F1 sin excepción (spec F1, líneas 35-43): el SDK nunca transporta ni ve una clave privada (server-side solo habla `amount`/`network`/`metadata`; client-side solo un `client_secret` público y un socket de solo-lectura de estado). El checkout hosteado y los payment links son, en el peor caso, una UI más sobre el mismo `PaymentIntent` — no un segundo camino de custodia. Antes de que CUALQUIER pieza de F2 toque dinero real (mainnet, `livemode:true`), debe pasar el mismo gate que F1 ya tiene pendiente: **`security-reviewer`** sobre el diff concreto, y la opinión legal escrita ya pactada en el roadmap (línea 16) — no asumir que "ya se auditó en F1" cubre superficie nueva (SDK público, checkout hosteado en un dominio público, payment links compartibles). Esto aplica en particular a F2.0 #3/#4: una ruta de alta de merchant mal protegida, o un modo test que no aísla mainnet, son exactamente el tipo de bug que convierte "no-custodia" en "custodia accidental".

---

## Decisiones del owner (para el brainstorm)

1. **¿Dashboard como pestaña de Console o app standalone?**
   (a) Pestaña "Payments" en la página de Application de Console — reutiliza RBAC/credentials UI existente, pero llama a un host distinto (api.pay.oxy.so) y necesita el puente de autorización de la decisión #2. (b) App standalone (ej. `pay.oxy.so/dashboard`) con su propio `OxyProvider` — libertad total de layout tipo Stripe Dashboard, pero duplica app-shell/auth que Console ya tiene resuelto. **Recomendación:** (a) para keys/webhook-config/merchant-setup (cero trabajo nuevo de RBAC), diseñando el módulo de payments como autocontenible para poder extraerlo a standalone más adelante si crece.

2. **¿Cómo autoriza el Gateway a un humano del dashboard (vs. el merchant service-token que ya existe)?**
   (a) El Gateway monta `requireOxyAuth` y, por request, verifica permiso llamando a `GET /applications/:id` de oxy-api (cacheable) — cero duplicación de RBAC. (b) Duplicar la lógica de `AccountMember`/`ApplicationPermission` dentro del Gateway — más rápido, pero dos codebases con lógica de seguridad que puede divergir. (c) Todas las lecturas de dashboard pasan por oxy-api, que hace de proxy hacia el Gateway — mantiene el RBAC en un solo sitio pero acopla oxy-api a la disponibilidad/esquema del Gateway. **Recomendación:** (a).

3. **Test/live mode:** hoy `Merchant.livemode` existe pero no se aplica (hueco #4) — ¿cómo se cierra?
   (a) Dos documentos `Merchant` por Application (uno testnet, uno mainnet), resueltos por el `environment` de la `ApplicationCredential` que autenticó — el más parecido a Stripe. (b) Dejarlo como está: un solo `Merchant`, `network` explícito en cada `create`, disciplina operativa como único freno. (c) Un `Merchant` con DOS xpubs (test/live). **Recomendación:** (a) — pero primero hay que confirmar si `req.serviceApp` ya expone `environment`/`credentialId` (el AGENTS.md de OxyHQServices dice que el JWT de servicio ya embebe `credentialId`); si no expone `environment` directamente, es un cambio upstream pequeño en `@oxyhq/core`, no en el Gateway.

4. **Pagador sin Oxy Pay (hueco #7 — sin `addressindex`):** ¿cómo se lanza el checkout hosteado mientras tanto?
   (a) Solo fallback manual "ya pagué, aquí mi txid" — sale ya, UX degradada. (b) Bloquear el flujo de wallet-externa hasta tener detección automática — mejor calidad, pero retrasa la promesa "cualquiera puede pagar" que vende el plugin WooCommerce/Mercaria. (c) Priorizar habilitar `addressindex` en el nodo del Explorer como prerequisito de F2 (trabajo de infra, paralelizable con SDK/dashboard). **Recomendación:** (c) — ya está señalado como deuda conocida en el propio spec de F1 (línea 106); cerrarlo ahora evita construir dos UX de checkout distintas (con/sin Oxy Pay) de forma permanente.

5. **Alcance de webhooks para v1:** ¿un endpoint por merchant (esquema actual) o multi-endpoint con filtro de eventos (Stripe real)?
   (a) Mantener endpoint único (`Merchant.webhookUrl`/`webhookSecret` tal cual), añadiendo solo el modelo de log de entregas (hueco #5) para el panel de dashboard + botón de reenvío. (b) Construir `WebhookEndpoint` como recurso propio (N por merchant, filtro de eventos) ya en F2 — paridad Stripe completa antes, pero más superficie de schema/migración para una necesidad que probablemente ningún merchant temprano pide. **Recomendación:** (a), diseñando el log de entregas ya desde ahora sin asumir singleton (`merchantId` como key, no "el" webhook), para que (b) sea aditivo después y no una reescritura.

6. **Payment Links: ¿recurso propio (`link_...`, reusable) o solo el nombre de marketing de una URL de checkout de un solo uso?**
   (a) Recurso propio persistente (Stripe real) — encaja con la ambición de plugin WooCommerce del roadmap (línea 63), permite un link fijo reusable tipo "cóbrame". (b) Sin recurso nuevo — "payment link" = la URL de checkout de un `PaymentIntent` puntual, no reusable. **Recomendación:** (a), pero acotado a importe fijo en v1 (sin importe editable por el pagador).

7. **Alcance de invoices en v1** — ¿se construyen en F2 o se difieren?
   (a) Versión mínima descrita en la sección 4 (un intent, líneas de ítem solo-presentación, sin recurrencia). (b) Diferir invoices por completo hasta que un merchant real lo pida — el propio spec de F1 ya cataloga invoices como "F2/F4" (línea 24), no como núcleo de F2. **Recomendación:** (b) — es el subsistema más especulativo de los cuatro, y "YAGNI estricto" es un principio que el propio proyecto ya se auto-impuso en F1.

8. **Hosting/dominio del checkout hosteado** — el roadmap ya reserva `pay.oxy.so` (CF Pages) para el FRONTEND del wallet (`packages/frontend`, la app Expo/RN completa). Una página de checkout anónima para un pagador externo no debería cargar el bundle entero del wallet.
   (a) Ruta dentro de `packages/frontend` (reutiliza `OxyProvider`/tema, pero envía todo el peso de la app Expo-web a un visitante anónimo — malo para conversión/Lighthouse). (b) Paquete web nuevo y ligero (`packages/checkout`, sin Expo/RN-web, al estilo del propio Stripe Checkout — una superficie dedicada y rápida) bajo su propio subdominio o ruta (`checkout.oxy.so` o `pay.oxy.so/c/:id`). **Recomendación:** (b) — el checkout hosteado es, por diseño de producto, la superficie que MÁS necesita cargar rápido para desconocidos.

9. **Orden de prioridad de build** (más allá de la secuencia técnica de la sección 1) — ¿qué quiere el owner ver primero en producción?
   La secuencia técnica propuesta es SDK+checkout hosteado → payment links → dashboard (paralelizable) → invoices (diferido/último). Pero el owner podría preferir el dashboard antes por visibilidad operativa, o Mercaria integrado antes que el plugin WooCommerce. **Recomendación:** confirmar con el owner si "primero SDK+checkout" (mi propuesta, porque desbloquea Mercaria y valida F2.0 más barato) sigue siendo la prioridad de negocio, o si hay una fecha/demo externa que reordene esto.
