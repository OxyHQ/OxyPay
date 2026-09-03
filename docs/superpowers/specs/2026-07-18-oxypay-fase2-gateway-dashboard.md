# Oxy Pay — Fase 2 (Gateway platform): SDK, checkout, payment links, dashboard

> **Estado: FINAL — decisiones del owner incorporadas (aprobado 2026-07-18).** Sustituye al DRAFT del mismo nombre. Cada sección cita el código real de Track A (F1) o de OxyHQServices sobre el que se apoya. Invoices queda **fuera de alcance** de esta fase (ver §9).
> Nomenclatura ya fijada (F1): **Oxy Pay** (app monedero) · **Oxy Pay Gateway** (backend+API+SDK, este doc) · **Oxy Pay Terminal** (F3, fuera de alcance) · **Oxy Console** (registro apps/keys/tokens de todo el ecosistema Oxy, reutilizado — nunca duplicado).

## 0. Resumen de decisiones del owner (vinculantes, no se re-discuten en la ejecución)

1. **Dashboard = app Vite standalone** (mismo stack que Oxy Console: Vite + RN-Web + `@oxyhq/services`), **no** una pestaña de Console. Comparte el sistema de apps/tokens de Console (`Application`/`ApplicationCredential` vía oxy-api) pero tiene **su propio backend de datos de pago = el propio Gateway** (`api.pay.oxy.so`).
2. **Invoices queda diferido por completo** — no se diseña ni se construye en F2. Ver §9.
3. **Orden de build:** F2.0 (cierre de huecos) primero, prerequisito duro → F2.1 SDK server-side → F2.2 checkout hosteado + F2.3 payment links → F2.4 SDK embed browser → F2.5 dashboard (paralelizable en cuanto F2.0 aterriza).
4. **`addressindex` en el nodo del Explorer** es un prerequisito de infra de F2 (oxy-infra / config del nodo FairCoin), no una tarea de código del Gateway. Ver §4.
5. Llamadas técnicas ya aceptadas: test/live vía **dos documentos `Merchant` por Application**, uno por `environment` de la credencial (fix de seguridad top de F2.0); webhooks v1 = **endpoint único + nuevo modelo de log de entregas** (sin recurso `WebhookEndpoint` multi-endpoint todavía); **payment links como recurso propio** (importe fijo v1, reutiliza el checkout); checkout hosteado en un **paquete web nuevo, ligero, sin Expo/RN-web** — propuesto `checkout.oxy.so` (ver §6, host distinto de `pay.oxy.so` que ya está reservado para el frontend del monedero).

## 1. Qué existe hoy (Track A / F1 — completo, 65 tests backend)

Fase 1 entregó el **motor de liquidación no-custodial** sobre el que se apoya todo F2:

- **Modelos** (`packages/backend/src/models/`): `Merchant.ts` — `oxyAppId` único (`merchantSchema`, línea 26), `xpub` watch-only (firewall no-custodia en `pre('validate')`, líneas 45-55: deriva el índice 0 y rechaza cualquier clave privada), `nextDerivationIndex`, `webhookUrl`/`webhookSecret` (endpoint único), `requiredConfirmations`, `livemode` (campo vivo pero no aplicado — ver F2.0 §3). `PaymentIntent.ts` — `id`/`clientSecret`/`idempotencyKey` (índice único `{merchantId, idempotencyKey}`, línea 53), `amount` string base-unit, `metadata` como `Map`.
- **Rutas** (`routes/paymentIntents.ts`): `POST /v1/payment_intents` (merchant-authed vía `oxyClient.serviceAuth()`, `Idempotency-Key` obligatorio, líneas 114-200), `GET /v1/payment_intents/:id` (**merchant-authed únicamente**, líneas 202-219), `POST .../reject` (merchant-authed, 221-253), `POST .../submit_tx` (**payer-path — sin auth de servicio, autorizado por posesión del `client_secret`** vía `verifySecret`, 257-299).
- **Derivación watch-only** (`services/derivation.ts` + `reserveAddress.ts`): dirección fresca por intent vía `HDKey.fromExtendedKey` + `deriveChild`, atómica vía `findOneAndUpdate({$inc})` (`reserveAddress.ts:15-19`).
- **Máquina de estados** (`shared-types/src/paymentIntent.ts:23-37` + `services/intentState.ts`): tabla `ALLOWED`, más la excepción documentada de reorg (`settled → confirming`).
- **Watcher** (`services/settlementWatcher.ts`): tip-driven, polling cada 5s sobre intents `broadcast`/`confirming` con `txid`, verifica vía `explorer.ts` (`GET /api/transaction/:txid` — **no** `addressindex`, ver §4).
- **Webhooks** (`services/webhookSigner.ts` + `webhookDispatcher.ts`): HMAC estilo Stripe (`t=...,v1=...`), reintentos con backoff acotado (máx. 3 intentos), `safeFetch` anti-SSRF, **best-effort — nunca bloquea el settlement**.
- **Realtime** (`realtime/socket.ts`): `io.use(oxyClient.authSocket())` + join a `intent:<id>` gateado por `client_secret` (líneas 49-71).
- **Contrato** (`shared-types/src/`): `PaymentIntent`, `WebhookEvent<T>` con tipos punteados, `isBaseUnitString`. IDs prefijados `pi_`/`evt_` (`lib/ids.ts:13`, **solo esos dos prefijos hoy**).
- **Wiring** (`server.ts`): versión de API por header `Oxy-Pay-Version: 2026-07-18` (línea 43), `/health` sin auth para el ALB, `onIntentChange` (líneas 78-97) dispara socket + webhook por cada transición observada.

## 2. Invariante no-custodia + MiCA (el gate que no se negocia)

Cada superficie nueva de F2 hereda el invariante de F1 (spec F1, líneas 35-43) sin excepción: el SDK nunca transporta ni ve una clave privada (server-side solo habla `amount`/`network`/`metadata`; client-side solo un `client_secret` público y un socket de solo-lectura). El checkout hosteado, los payment links y el dashboard son, en el peor caso, una UI o un canal más sobre el mismo `PaymentIntent` — nunca un segundo camino de custodia.

Antes de que **cualquier** pieza de F2 toque dinero real (mainnet, `livemode:true`), pasa el mismo gate que F1 ya tiene pendiente:
- **`security-reviewer`** sobre el diff concreto de cada sub-spec antes de mergear a producción — no se asume que la auditoría de F1 cubre superficie nueva (SDK público, checkout en dominio público, payment links compartibles, dashboard con sesión humana).
- La opinión legal escrita ya pactada en el roadmap (`docs/OXY-PAY-ROADMAP.md:16`, aún sin marcar) sobre MiCA/AML — sigue bloqueando producción, no solo F1.

Esto aplica **en particular** a F2.0 tarea 1 (aislamiento test/live): un modo test que no aísla mainnet es exactamente el tipo de bug que convierte "no-custodia" en "custodia accidental" (el Gateway seguiría sin tocar claves privadas, pero movería fondos reales bajo una credencial que el merchant cree de "prueba").

## 3. F2.0 — Cierre de huecos del Gateway (prerequisito duro de TODO F2)

Ninguno de estos huecos es un defecto de F1 — F1 solo tenía que probar el flujo atómico. Pero son **requisitos duros**, no detalles de implementación, antes de construir SDK/checkout/dashboard encima.

### Tarea 1 — [SEGURIDAD, primero] Aislamiento test/live

**1a. Bug de integridad ya presente en el código de F1 (verificado, independiente del rediseño de abajo):** `POST /v1/payment_intents` acepta `network` en el body (`paymentIntents.ts:37`, `params.network`) y lo persiste tal cual en el intent (`paymentIntents.ts:169`) — pero la dirección watch-only se deriva usando el `network` **del merchant**, no el del request (`reserveAddress.ts:30`: `getNetwork(merchant.network)`). Los dos valores **nunca se cruzan**. Hoy un caller puede crear un intent etiquetado `network:"mainnet"` cuya dirección derivada es en realidad una codificación **testnet** del mismo xpub (o viceversa) — el label miente sobre la red real de la dirección. Fix: validar `params.network === merchant.network` en el handler de creación (422 si no coincide) **antes** de derivar la dirección. Esto se corrige ya, independientemente de 1b.

**1b. Rediseño aceptado por el owner: dos documentos `Merchant` por Application, uno por `environment`.** Hoy `resolveMerchant` (`paymentIntents.ts:80-96`) hace `findOne({oxyAppId})` — un único documento por Application, sin cruzar el `environment` (`development`/`staging`/`production`) de la `ApplicationCredential` (`OxyHQServices/packages/api/src/models/ApplicationCredential.ts:8-15`) que autenticó la llamada. Verificado en el propio JWT de servicio: `POST /auth/service-token` (`OxyHQServices/packages/api/src/routes/auth.ts:2435-2445`) firma `{type, appId, appName, credentialId, scopes}` — **`environment` no está en el payload**, y `OxyServiceAppContext` (`OxyHQServices/packages/core/src/server/auth.ts:13-18`) tampoco lo expone en `req.serviceApp`. Sin esto, nada distingue una llamada de una credencial `development` de una `production` a nivel del Gateway.

Cierre concreto:
- **Upstream (oxy-api, PR pequeño y aislado):** añadir `environment: credential.environment` al payload del `jwt.sign` en `routes/auth.ts` (service-token mint) y extender `OxyServiceAppContext` en `@oxyhq/core` (tipo + decodificación) para exponer `environment` en `req.serviceApp`. Publicar `@oxyhq/core` antes de tocar el Gateway (regla ya fijada: republicar dependencias primero).
- **Gateway — `Merchant.ts`:** sustituir el índice único `{oxyAppId}` (línea 26) por un índice compuesto único `{oxyAppId, environment}`; añadir campo `environment: ApplicationCredentialEnvironment`.
- **Gateway — `resolveMerchant()`:** resolver por `{oxyAppId, environment: req.serviceApp.environment}`, no solo `oxyAppId`.
- **Gateway — ruta de alta de merchant (tarea 2):** exige `environment` explícito al registrar; una credencial `development`/`staging` solo puede registrar un `Merchant` con `network:"testnet"` (rechazo 422 si intenta `mainnet`) — este es el firewall real que hace estructuralmente imposible que una credencial de prueba filtrada mueva fondos mainnet, no solo una convención de datos.

### Tarea 2 — Rutas de alta y gestión de `Merchant`

El modelo existe; no hay ninguna ruta expuesta hoy (el único artefacto es `scripts/gen-xpub-vector.ts`, que genera un vector de test, no registra nada). Nuevas rutas, autenticadas igual que la creación de intents (`oxyClient.serviceAuth()` — así `environment` está disponible desde el token, doblando como punto de aplicación de 1b):
- `POST /v1/merchants` — registra xpub watch-only + `webhookUrl`/`webhookSecret` + `requiredConfirmations`; corre el mismo firewall `pre('validate')` que ya existe en el modelo (rechaza cualquier clave privada).
- `GET /v1/merchants/me`, `PATCH /v1/merchants/me` — lectura/edición del propio merchant (config de webhook, confirmaciones requeridas).

Requiere un scope nuevo, no privilegiado (autoridad solo sobre los recursos de la propia app — mismo patrón que `files:write`/`updates:publish`), añadido a `APPLICATION_SCOPES` en `OxyHQServices/packages/api/src/utils/applicationScopes.ts:27-40`: **`payments:read`** / **`payments:write`**. No entra en `PRIVILEGED_APPLICATION_SCOPES` — no confiere autoridad cross-tenant.

### Tarea 3 — Lectura: `list` merchant-authed + `retrieve` payer-authed

Dos huecos distintos, cierre conjunto porque tocan la misma ruta:
- **No existe `GET /v1/payment_intents` (list).** Solo hay `retrieve` por id. Bloquea `.list()` del SDK y la tabla "Payments" del dashboard. Nueva ruta merchant-authed, paginación estilo Stripe (`starting_after`/`limit`), filtro por `status`.
- **No hay lectura payer-side del intent.** `GET .../:id` es 100% merchant-authed (`paymentIntents.ts:204`). El único acceso payer-side hoy es `submit_tx` (client_secret) y el socket `subscribe` (también client_secret) — una página de checkout no tiene snapshot REST inicial, dependería de una carrera de socket sin fallback. Añadir una variante payer de `GET /v1/payment_intents/:id`: si no hay credencial de servicio pero llega `client_secret` (query param o header), autorizar con el mismo `verifySecret(provided, intent.clientSecret)` que ya usa `submit_tx` (`paymentIntents.ts:277`) y el socket (`socket.ts:62`).

### Tarea 4 — Persistir entregas de webhook

`onIntentChange` en `server.ts:92` llama `await deliver(...)` y **descarta el resultado**. No hay modelo de log. Nuevo modelo `WebhookDelivery` (`merchantId`, `eventId`, `url`, `attempts`, `delivered`, `lastStatus`, timestamps) — clave por `merchantId`, **no** por "el" webhook, para que un futuro `WebhookEndpoint` multi-endpoint (fuera de v1, ver Tarea 5-nota) sea aditivo y no una reescritura. `onIntentChange` persiste el resultado de `deliver()` en vez de descartarlo. Nueva ruta `POST /v1/webhook_deliveries/:id/redeliver` para el botón "reenviar" del dashboard.

### Tarea 5 — Extender `newId()`

`newId()` solo conoce `pi_`/`evt_` (`lib/ids.ts:13`). Extender a `merch_` (tarea 2), `link_` y `cs_` (F2.3/F2.2) — `in_`/`sub_` no se necesitan (invoices/subscriptions fuera de alcance).

### Nota — qué NO se cierra en F2.0 (decisión explícita del owner)

- **Un solo endpoint de webhook por merchant** (`Merchant.webhookUrl`/`webhookSecret`, singular) se mantiene en v1. No se construye `WebhookEndpoint` (N por merchant, filtro de eventos) — la Tarea 4 ya deja el log preparado para que esa expansión sea aditiva cuando (si) se decida.
- **`addressindex`** no es una tarea de F2.0 — es un prerequisito de infra, ver §4.

## 4. Prerequisito de infra: `addressindex` en el nodo del Explorer

El backend no corre nodo propio; verifica pagos leyendo `GET /api/transaction/:txid` a partir de un `txid` reportado por el payer (`explorer.ts:1-35`). El nodo del Explorer tiene `addressindex` **desactivado** (`"limited data available"`, ya documentado en el spec F1). Sin vigilancia por-dirección, el backend solo puede confirmar un pago si alguien le reporta el `txid` — un pagador que paga desde una wallet externa (no Oxy Pay) no tiene forma automática de que el backend lo detecte.

**Decisión del owner: habilitar `addressindex` es un prerequisito de F2, trabajo de infra (oxy-infra / config del nodo FairCoin), paralelizable con el resto de F2.** No bloquea F2.0/F2.1 (que no dependen de detección por-dirección). Sí bloquea, específicamente, el modo "pagar desde cualquier wallet" del checkout hosteado (F2.2 modo B, §6) — debe aterrizar antes de que ese modo salga de detrás de cualquier flag, para no construir dos UX de checkout permanentes (con/sin Oxy Pay).

## 5. F2.1 — SDK `@oxyhq/pay` (server-side)

Nuevo paquete de workspace `packages/sdk` en el monorepo OxyPay, publicado a npm como `@oxyhq/pay`.

```ts
import { OxyPay } from '@oxyhq/pay';

const oxypay = new OxyPay({ publicKey: 'oxy_dk_...', secret: '...' }); // ApplicationCredential type:'service'

const intent = await oxypay.paymentIntents.create(
  { amount: '150000000', network: 'mainnet', metadata: { orderId: 'ord_123' } },
  { idempotencyKey: 'ord_123-attempt-1' },
);
await oxypay.paymentIntents.retrieve(intent.id);
await oxypay.paymentIntents.list({ status: 'settled', limit: 20 }); // requiere F2.0 tarea 3
await oxypay.paymentIntents.reject(intent.id);

const event = oxypay.webhooks.constructEvent(rawBody, signatureHeader, endpointSecret);
```

- **Auth = reutilizar, no reinventar.** Se configura exactamente como cualquier servicio interno Oxy: `publicKey`/`secret` de una `ApplicationCredential` `type:'service'`, minteando un JWT vía el mismo mecanismo que `oxyClient.serviceAuth()` ya valida (`paymentIntents.ts:111`). No hay "API key de Oxy Pay" nueva — es el mismo credential que Console ya emite, con los scopes `payments:read`/`payments:write` de F2.0 tarea 2.
- **`Idempotency-Key`** ya es un header real (`paymentIntents.ts:121`); el SDK solo lo expone ergonómicamente vía el segundo argumento de `.create()`.
- **Prerequisito de F2.1 — publicar `@oxypay/shared-types` a npm.** Hoy es un paquete de workspace no publicado; `@oxyhq/pay` es consumido por merchants **terceros**, así que no puede depender de un paquete workspace-only. Tratamiento idéntico al ya usado para `@oxyhq/contracts` (zero-dep, dual CJS+ESM+types, republicar antes que el consumidor). Con esto publicado, mover `signWebhook`/`verifyWebhook` de `services/webhookSigner.ts` (ya zero-dep, solo `node:crypto`) a `shared-types`, para que **el mismo código** firme (Gateway) y verifique (`webhooks.constructEvent` del SDK) — evita que el algoritmo de firma diverja entre "lo que el Gateway firma" y "lo que el SDK verifica".

## 6. F2.2 + F2.3 — Checkout hosteado + Payment Links

**Invariante no-custodial sin excepción:** el pagador paga desde SU wallet self-custody; la página de checkout nunca pide ni ve una clave privada. Mismo `PaymentIntent`, dos modos de entrada de pago:

- **(A) Payer con Oxy Pay** — la página detecta el deep link `oxypay://pay/<id>?client_secret=...` (mismo parser que `packages/frontend/app/pay/[intent].tsx`) y ofrece abrir/deep-link en móvil. El wallet corre el flujo ya construido: aprobar → firmar → `submit_tx` → estado en vivo.
- **(B) Payer sin Oxy Pay (wallet externa)** — dirección + QR + importe (patrón BTCPay), polling de estado. Bloqueado hasta que `addressindex` (§4) esté activo; hasta entonces, único camino es que el usuario pegue su `txid` manualmente (frágil, UX degradada — aceptable como fallback temporal, no como diseño final).

**Payment links** (recurso propio, `link_...`, importe fijo v1): en cada visita/pago crea (o reutiliza si hay uno abierto) un `PaymentIntent` fresco — no es una capa de datos nueva sobre `PaymentIntent`, es un generador de intents con URL estable. Reutiliza el checkout entero como su UI de pago.

Nuevas rutas en el Gateway (todas nuevas): `POST /v1/checkout_sessions` (`cs_...`), `POST /v1/payment_links` (`link_...`), más la variante payer de `GET /v1/payment_intents/:id` ya cubierta en F2.0 tarea 3.

**Host/paquete propuesto:** `pay.oxy.so` ya está reservado para el frontend Expo/RN del monedero (roadmap, `docs/OXY-PAY-ROADMAP.md:84`); cargar ese bundle completo para un pagador anónimo es malo para conversión/Lighthouse. Nuevo paquete de workspace **`packages/checkout`** — web ligero, **sin Expo/RN-web**, al estilo del propio Stripe Checkout — servido en **`checkout.oxy.so`** (host distinto, propuesto; pendiente de confirmación de infra/DNS, no bloquea el diseño). Payment links comparten el mismo host/paquete.

## 7. F2.4 — SDK embed (browser)

Segundo entry point del **mismo** paquete npm (`@oxyhq/pay/checkout`, patrón Stripe.js), para incrustar el botón de pago en la web de un merchant (WooCommerce, Mercaria):

```html
<script type="module">
  import { OxyPayCheckout } from '@oxyhq/pay/checkout';
  const checkout = OxyPayCheckout.mount('#pay-button', { clientSecret });
  checkout.on('settled', () => window.location.href = '/thank-you');
</script>
```

Reutiliza el socket contract que ya existe — el mismo `subscribe({intentId, clientSecret})` gateado en `realtime/socket.ts:49-71` que hoy usa el wallet. No hay backend nuevo que construir para el embed en sí: solo el cliente JS, apoyado en la variante payer de `GET /v1/payment_intents/:id` (F2.0 tarea 3) para el snapshot inicial antes de que el socket confirme la suscripción.

## 8. F2.5 — Dashboard (standalone)

**Decisión del owner (no se re-discute):** app Vite standalone, mismo stack que Console (Vite + RN-Web + `@oxyhq/services`), **no** una pestaña de Console. Nuevo paquete de workspace **`packages/dashboard`**, host propuesto **`dashboard.pay.oxy.so`** (pendiente confirmación de infra/DNS). Registra su propia `Application` Oxy oficial (mismo patrón que Console: `clientId` propio para montar `OxyProvider`) — **distinta** de la `Application` de cada merchant cuyos datos de pago gestiona.

### Cómo autoriza el Gateway una sesión de dashboard (humano, no servicio)

Hoy el Gateway solo conoce dos identidades: merchant (`ApplicationCredential` service-token) y payer (posesión de `client_secret`). Un humano logueado en el dashboard es una **tercera** identidad — un usuario Oxy con sesión, que necesita permiso de lectura/escritura sobre el `Merchant` ligado a una `Application` que no necesariamente creó él.

**Mecanismo (decisión del owner, §0.1):** el Gateway monta `requireOxyAuth` (`@oxyhq/core/server`) en una familia de rutas nueva `/v1/dashboard/*` (deliberadamente separada de `/v1/payment_intents/*`, que sigue siendo puramente service-auth para no mezclar dos estrategias de auth en el mismo handler). Por request, el Gateway reenvía el bearer token del usuario a `GET {OXY_API_URL}/applications/:applicationId` de oxy-api (`OxyHQServices/packages/api/src/routes/applications.ts:582-592`, gateada por `requireAppPermission('app:read')`), lee `callerMembership` de la respuesta, y exige que no sea `null` antes de resolver el `Merchant`/`PaymentIntent`s de esa `Application` (por `environment`, F2.0 tarea 1b). Zero duplicación de RBAC — el Gateway nunca reimplementa `AccountMember`/`ApplicationPermission`. `oxyClient` (`@oxyhq/core`) ya está configurado con el `OXY_API_URL` correcto (es el mismo cliente que hoy usa `serviceAuth()`/`authSocket()`), así que la llamada es una extensión natural, no una integración nueva. Cachear el resultado con TTL corto (por `userId:applicationId`) para no golpear oxy-api en cada request de dashboard.

Rutas propuestas: `GET /v1/dashboard/applications/:applicationId/merchant`, `PATCH /v1/dashboard/applications/:applicationId/merchant`, `GET /v1/dashboard/applications/:applicationId/payment_intents`, `GET /v1/dashboard/applications/:applicationId/webhook_deliveries` — todas internamente reutilizan los mismos modelos/servicios/serializers (`toPaymentIntentDTO`, etc.) que las rutas merchant-authed, solo con una estrategia de auth distinta.

### Contenido (estilo Stripe) y qué reutiliza

- **Payments** (lista + detalle) — necesita F2.0 tarea 3; reutiliza `toPaymentIntentDTO` (`lib/serialize.ts`) tal cual.
- **API keys** — **corrección respecto al draft:** al ser standalone (no una pestaña de Console), el componente React `credentials-section.tsx` de Console **no** es literalmente reutilizable (vive en el stack/routing/store internos de Console). Lo que SÍ se reutiliza sin cambios son las **rutas de oxy-api** (`/applications/:id/credentials` — crear/rotar/revocar, `applications.ts:723-927`). El dashboard construye su propio panel "Credentials" — UI nueva, cero lógica de backend nueva, mismas rutas.
- **Webhooks (config + logs)** — config = `PATCH /v1/dashboard/.../merchant` (F2.0 tarea 2). Logs = `GET /v1/dashboard/.../webhook_deliveries` + botón "reenviar" (F2.0 tarea 4).
- **Merchant setup (registro de xpub watch-only)** — pantalla nueva; llama a `POST /v1/merchants`/`PATCH /v1/merchants/me` (F2.0 tarea 2) a través de la ruta dashboard-authed equivalente.
- **Test/live toggle** — refleja los dos `Merchant` por `environment` (F2.0 tarea 1b); cambia qué credencial/entorno está viendo el dashboard, no un campo mutable en un único merchant.

## 9. Invoices — fuera de alcance de F2 (decisión del owner)

Diferido por completo. El propio spec de F1 ya catalogaba invoices como "F2/F4", no como núcleo de F2 (`2026-07-18-oxypay-phase1-foundation-design.md:24`). Ningún diseño de datos, ruta, ni UI de invoices se construye en esta fase. Si se retoma, es un doc de diseño aparte que decide su alcance desde cero — no asumir el borrador mínimo (`Invoice` envolviendo un `PaymentIntent`) del DRAFT anterior como punto de partida vinculante.

## 10. Orden de build y dependencias

```
F2.0  Gateway API gaps (tareas 1-5, §3) — prerequisito duro de TODO lo demás
        │
        ├── (paralelo, no bloqueante para F2.0/F2.1) Infra: addressindex (§4)
        │
F2.1  SDK @oxyhq/pay server-side (§5)
        │
        ├── F2.2 Checkout hosteado (§6, modo B espera a addressindex)
        │        │
        │        └── F2.3 Payment links (§6, reutiliza el checkout)
        │
        └── F2.4 SDK embed browser (§7) — depende de F2.0 tarea 3 (GET payer-authed)
                 │
        F2.5 Dashboard standalone (§8) — depende SOLO de F2.0 (tareas 1-4);
             arranca en paralelo a F2.1-F2.4 en cuanto F2.0 aterriza
```

Razonamiento (validado por el owner): el SDK server-side (F2.1) es el consumidor más simple de la API — la forma más barata de validar que F2.0 cerró los huecos correctos antes de construir UI encima. El checkout hosteado (F2.2) es el primer entregable con valor de producto real (Mercaria puede integrarlo). Payment links (F2.3) es checkout + persistencia, no una capa nueva. El embed (F2.4) depende de la lectura payer-authed pero no del resto de checkout. El dashboard (F2.5) es paralelo porque solo consume list/retrieve/merchant CRUD/webhook logs de F2.0 — no depende de que SDK/checkout/links estén terminados.

## 11. Descomposición en sub-specs (planes de implementación)

Cada bloque de abajo es un **plan de implementación separado** (`docs/superpowers/plans/...`), no una sección más de este doc de diseño:

1. **`oxypay-f2-0-gateway-gaps`** — F2.0 completo (§3): las 5 tareas del Gateway backend + el PR upstream aislado en oxy-api/@oxyhq/core (environment en el JWT de servicio) + el scope `payments:*` en `applicationScopes.ts`. Un solo plan porque las 5 tareas tocan el mismo router/modelos y comparten tests de integración. **Bloquea todo lo demás.**
2. **Infra — `addressindex`** — ticket/tarea de oxy-infra, dueño distinto del equipo de Track A. Se lanza en paralelo al plan 1 desde el día uno; su fecha de entrega solo bloquea la salida del modo B de F2.2, no el resto.
3. **`oxypay-f2-1-sdk-server`** — F2.1 (§5): paquete `packages/sdk`, incluida la publicación de `@oxypay/shared-types` a npm y el traslado de `webhookSigner`. Depende del plan 1.
4. **`oxypay-f2-2-f2-3-checkout-links`** — F2.2 + F2.3 combinados (§6): un solo plan porque payment links es una capa fina sobre el mismo paquete `packages/checkout`. Depende del plan 1 (y del plan 2 para el modo B completo, aunque puede salir con el modo A + fallback manual antes).
5. **`oxypay-f2-4-sdk-embed`** — F2.4 (§7): la segunda entry point del mismo paquete `packages/sdk`. Depende del plan 1 (tarea 3); puede desarrollarse en paralelo al plan 4 una vez el contrato del socket/GET payer-authed está congelado.
6. **`oxypay-f2-5-dashboard`** — F2.5 (§8): paquete `packages/dashboard` + las rutas `/v1/dashboard/*` del Gateway (parte de este plan, no del plan 1, porque son rutas nuevas de auth humana, no gaps de F1). Depende **solo** del plan 1 — arranca en paralelo a los planes 3-5.

**Paralelizable desde el día uno:** plan 1 (equipo Track A) + plan 2 (oxy-infra) simultáneamente. **En cuanto el plan 1 cierra:** planes 3, 4 (tras 3 o en paralelo si el contrato REST ya está congelado) y 6 pueden arrancar a la vez en equipos distintos; el plan 4 combina checkout+links y depende conceptualmente de que el contrato de creación de intents del plan 3 esté estable, pero no de que el paquete npm esté publicado (puede consumir la REST API directamente mientras el SDK madura en paralelo).

## Referencias

- Draft sustituido: `docs/superpowers/specs/2026-07-18-oxypay-fase2-gateway-dashboard-DRAFT.md` (mantener en el repo como registro histórico de las opciones sopesadas; no es la spec vigente).
- Spec F1: `docs/superpowers/specs/2026-07-18-oxypay-phase1-foundation-design.md`.
- Roadmap: `docs/OXY-PAY-ROADMAP.md`.
