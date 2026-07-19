# Integrating Oxy Pay (`@oxyhq/pay`)

A Stripe-ergonomics SDK over the Oxy Pay Gateway. **Non-custodial**: the merchant
never holds keys or funds — the buyer pays from their own self-custody Oxy Pay
wallet (or an external FairCoin wallet), and settlement is watched on-chain from
the merchant's **watch-only** xpub. Your server never sees a private key.

> **This is the guide for integrating a merchant (e.g. Mercaria).** Everything
> here works on **testnet** first; mainnet is a credential/config flip once the
> merchant is live (see [Test vs live](#test-vs-live)).

---

## 0. Prerequisites (one-time, owner/Console)

1. Register an **Oxy Application** for the merchant in Oxy Console (`third_party` is fine).
2. Issue a **service credential** on it (`type: 'service'`) with scopes
   **`payments:read` + `payments:write`** → you get `{ publicKey, secret }`
   (e.g. `publicKey: oxy_dk_…`). This is the SAME credential mechanism Console
   already issues — there is no separate "Oxy Pay API key".
3. Register the merchant once against the Gateway (creates the watch-only
   `Merchant` from an **xpub** — never an xprv; the backend rejects an xprv):
   `POST https://api.pay.oxy.so/v1/merchants` (authed with the service token).

Keep `secret` server-side only. The browser never sees it.

---

## 1. Install

```bash
bun add @oxyhq/pay        # (npm/yarn work too)
```

Node 18+ (global `fetch`). Server entry is zero-runtime-dep; the browser entry
(`@oxyhq/pay/checkout`) pulls in `socket.io-client` for live status.

---

## 2. Server: create a Checkout Session (recommended for Mercaria)

A **Checkout Session** wraps exactly one payment and gives you a hosted URL to
redirect the buyer to — the least code, Stripe-Checkout parity.

```ts
import { OxyPay } from '@oxyhq/pay';

const oxypay = new OxyPay({
  publicKey: process.env.OXY_PAY_PUBLIC_KEY!, // oxy_dk_…
  secret:    process.env.OXY_PAY_SECRET!,     // credential secret
  // baseURL defaults to https://api.pay.oxy.so
  // oxyApiUrl defaults to https://api.oxy.so (service-token mint host)
});

// amount is in BASE UNITS (m⊜), integer string. 1 FAIR = 100_000_000 m⊜.
const session = await oxypay.checkout.sessions.create({
  amount:  '250000000',          // 2.5 FAIR
  network: 'testnet',            // 'testnet' | 'mainnet' — start on testnet
  metadata: { orderId: 'MERCARIA-ORDER-123' },
  successUrl: 'https://mercaria.example/checkout/success?order=123',
  cancelUrl:  'https://mercaria.example/cart',
});

// session.url  → redirect the buyer here (checkout.oxy.so/c/<id>#cs=…)
// session.id, session.paymentIntentId, session.clientSecret also returned
return redirect(session.url);
```

That's the whole happy path: create → redirect → the hosted page shows amount +
your merchant identity + a "Pay with Oxy Pay" deep link/QR + live status, and
sends the buyer to `successUrl` on settlement. You confirm fulfillment from the
**webhook** (§4), never from the redirect alone.

### Alternative: a raw PaymentIntent (build your own UI)

```ts
const intent = await oxypay.paymentIntents.create(
  { amount: '250000000', network: 'testnet', metadata: { orderId: '123' } },
  { idempotencyKey: 'order-123' },   // REQUIRED — safe retries, no double-charge
);
// intent.id, intent.clientSecret, intent.address, intent.status, intent.expiresAt
await oxypay.paymentIntents.retrieve(intent.id);
await oxypay.paymentIntents.list({ status: 'settled', limit: 20 });
await oxypay.paymentIntents.reject(intent.id);   // cancel an unpaid intent
```

### Payment Links (shareable, reusable price)

```ts
const link = await oxypay.paymentLinks.create({ amount: '250000000', network: 'testnet' });
// link.url → checkout.oxy.so/l/<id>, share anywhere; each visit mints a fresh intent
```

---

## 3. Frontend: two ways to collect the payment

### (A) Redirect to hosted checkout — simplest

Just `redirect(session.url)` (above). Nothing to build.

### (B) Embed the pay button inline — `@oxyhq/pay/checkout`

Pass the session's/intent's **public `clientSecret`** to the browser (never the
service secret):

```html
<div id="oxy-pay-button"></div>
<script type="module">
  import { OxyPayCheckout } from '@oxyhq/pay/checkout';

  const checkout = OxyPayCheckout.mount('#oxy-pay-button', {
    clientSecret: 'pi_…_secret_…',   // from the session/intent, safe to expose
  });
  checkout.on('confirming', () => showSpinner());
  checkout.on('settled',    () => (window.location.href = '/thank-you'));
  checkout.on('failed',     () => showError());
  checkout.on('error',      (e) => console.warn('realtime error', e));
</script>
```

The button opens `oxypay://pay?…` on mobile (the buyer's Oxy Pay app) or shows a
QR on desktop, and streams live status over the Gateway socket — **anonymously**,
no Oxy login required for the buyer. The `clientSecret` is a read + `submit_tx`
capability only; it can never move funds.

---

## 4. Webhooks — the source of truth for fulfillment

Point a Gateway webhook at your endpoint, then verify every delivery with the
**same** signer the Gateway uses (algorithm can't drift):

```ts
import { OxyPay, WEBHOOK_SIGNATURE_HEADER } from '@oxyhq/pay';

app.post('/webhooks/oxy-pay', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = oxypay.webhooks.constructEvent(
      req.body.toString('utf8'),               // the RAW body (not JSON-parsed)
      req.header(WEBHOOK_SIGNATURE_HEADER)!,    // 'Oxy-Pay-Signature'
      process.env.OXY_PAY_WEBHOOK_SECRET!,      // your endpoint secret
    );
  } catch {
    return res.status(400).send('bad signature');  // throws OxyPaySignatureVerificationError
  }

  switch (event.type) {
    case 'payment_intent.settled':    fulfillOrder(event.data.object.metadata.orderId); break;
    case 'payment_intent.confirming': markPending(event.data.object); break;
    case 'payment_intent.failed':
    case 'payment_intent.expired':
    case 'payment_intent.rejected':   releaseHold(event.data.object); break;
  }
  res.json({ received: true });
});
```

`event.data.object` is the full `PaymentIntent`. Status lifecycle:
`created → (awaiting_approval → approved →) broadcast → confirming → settled`,
with terminal `failed | expired | rejected`.

---

## 5. Amounts & networks

- **Amounts are base-unit integer strings** (`m⊜`), never floats. `1 FAIR = 100_000_000 m⊜`.
  Import `UNITS_PER_COIN` / `formatFair` from `@fairco.in/core` for display.
- **Network** is `'testnet'` or `'mainnet'`. The intent's network must match the
  merchant's registered network (the Gateway rejects a mismatch).

## Test vs live

The SDK **never sends a `livemode` flag**. Test vs live is decided entirely by
the **`environment`** on your service credential (`development`/`staging` → test,
`production` → live), which rides inside the minted service token. So: use a
**test-environment credential** while building; swap to a production-environment
credential to go live. Same code, different credential.

---

## Typed errors

Every non-2xx maps to a typed error — catch what you need:

```ts
import {
  OxyPayError, OxyPayAuthenticationError, OxyPayInvalidRequestError,
  OxyPayPermissionError, OxyPayApiError, OxyPaySignatureVerificationError,
} from '@oxyhq/pay';
```

---

## Mercaria integration checklist

- [ ] Owner: register Mercaria's Oxy Application + a `payments:read`/`payments:write`
      service credential (test environment) → `{ publicKey, secret }`.
- [ ] Owner: register Mercaria as a Gateway `Merchant` (watch-only xpub, testnet).
- [ ] Mercaria server: `OXY_PAY_PUBLIC_KEY` / `OXY_PAY_SECRET` / `OXY_PAY_WEBHOOK_SECRET` in env.
- [ ] Mercaria server: create a Checkout Session at checkout, redirect to `session.url`
      (or embed `@oxyhq/pay/checkout`).
- [ ] Mercaria server: webhook endpoint verifying `Oxy-Pay-Signature`, fulfill on `settled`.
- [ ] Test the full flow on **testnet** end-to-end.
- [ ] Go live: swap to a production-environment credential + `network: 'mainnet'`
      (gated on the mainnet items — see the roadmap).
```
