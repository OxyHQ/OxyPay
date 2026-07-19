// `OxyPayCheckout.mount(...)` — the embeddable "Pay with Oxy Pay" button
// (Fase 2 SDK plan, Task 6). Plain DOM, no framework, so it embeds on any
// site. Renders a button into the host element, fetches + subscribes to the
// payment intent via the Task 5 payer client, drives a typed
// `settled`/`confirming`/`failed`/`error` event emitter, and on click either
// opens the `oxypay://pay` deep link (mobile) or shows a QR of it (desktop).
//
// Same `./core/*` boundary as `payerClient.ts`: the only import from `./core`
// is `core/errors.ts`, a pure status-mapper with no service-token/secret
// machinery, so it carries none of the merchant-authed code out of bounds for
// this browser bundle.
import createQrCode from 'qrcode-generator';
import type { PaymentIntent, PaymentIntentStatus } from '@oxypay/shared-types';
import { createOxyPayCheckout } from './payerClient';
import { OxyPayApiError, OxyPayError, OxyPayInvalidRequestError } from '../core/errors';

// ---------------------------------------------------------------------------
// Intent id derivation (pure, unit-tested independently of the DOM).
// ---------------------------------------------------------------------------

/**
 * `pi_` followed by ≥24 lowercase hex chars — the Gateway's payment-intent id
 * format. Mirrors `INTENT_ID_PATTERN` in the wallet's
 * `packages/frontend/src/pay/payment-request.ts` byte-for-byte, and matches
 * what `newId('pi')` in `packages/backend/src/lib/ids.ts` actually mints (12
 * random bytes → 24 hex chars).
 */
const INTENT_ID_PATTERN = /^pi_[0-9a-f]{24,}$/;

/**
 * Derive and validate the payment intent id for `mount()`. When `intentId` is
 * omitted, the id IS the prefix of `clientSecret` before `_secret_`
 * (`clientSecretFor` in `packages/backend/src/lib/ids.ts` mints
 * `${id}_secret_<hex>`, so `clientSecret.split('_secret_')[0]` recovers it).
 * Either way the result must look like a real Gateway-minted id AND
 * `clientSecret` must actually belong to it — a malformed or mismatched pair
 * is a caller integration bug, and `mount()` must never render a button
 * wired to a bogus id.
 */
export function deriveIntentId(clientSecret: string, intentId?: string): string {
  const id = intentId ?? clientSecret.split('_secret_')[0] ?? '';
  if (!INTENT_ID_PATTERN.test(id)) {
    throw new OxyPayInvalidRequestError(
      `OxyPayCheckout.mount: invalid or missing payment intent id ("${id}") — ` +
        'pass `intentId` explicitly or a well-formed `clientSecret`',
    );
  }
  if (!clientSecret.startsWith(`${id}_secret_`)) {
    throw new OxyPayInvalidRequestError(
      'OxyPayCheckout.mount: clientSecret does not belong to the given intentId',
    );
  }
  return id;
}

// ---------------------------------------------------------------------------
// Deep link (pure, unit-tested independently of the DOM).
// ---------------------------------------------------------------------------

/** The `oxypay://pay` deep-link scheme + host — mirrors `PAYMENT_REQUEST_PREFIX`
 * in the wallet's `packages/frontend/src/pay/payment-request.ts`. */
const PAYMENT_REQUEST_PREFIX = 'oxypay://pay';

export interface PayDeepLinkParams {
  intentId: string;
  clientSecret: string;
  address: string;
  /** Base-unit integer string (m⊜) — `PaymentIntent['amount']`'s own shape. */
  amount: string;
  network: PaymentIntent['network'];
}

/**
 * Build an `oxypay://pay?...` deep link. Param names AND percent-encoding
 * must match the wallet's parser byte-for-byte
 * (`packages/frontend/src/pay/payment-request.ts`'s `parseQuery`, which
 * splits on `&` then `=` and `decodeURIComponent`s each side raw) —
 * deliberately built by hand with `encodeURIComponent` rather than
 * `URLSearchParams`, whose `application/x-www-form-urlencoded` encoding
 * (e.g. space → `+`) is a different scheme than plain `decodeURIComponent`
 * expects on the other end.
 */
export function buildPayDeepLink(params: PayDeepLinkParams): string {
  const pairs: Array<[string, string]> = [
    ['intent', params.intentId],
    ['secret', params.clientSecret],
    ['address', params.address],
    ['amount', params.amount],
    ['network', params.network],
  ];
  const query = pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `${PAYMENT_REQUEST_PREFIX}?${query}`;
}

/** Only a phone can plausibly have the Oxy Pay wallet app installed to catch
 * the `oxypay://` deep link — desktop gets a QR to scan with it instead. */
const MOBILE_USER_AGENT_PATTERN = /Android|iPhone|iPad|iPod/i;

export function isMobileUserAgent(userAgent: string): boolean {
  return MOBILE_USER_AGENT_PATTERN.test(userAgent);
}

// ---------------------------------------------------------------------------
// Typed event emitter (pure, unit-tested independently of the DOM).
// ---------------------------------------------------------------------------

export interface OxyPayCheckoutEventMap {
  settled: PaymentIntent;
  confirming: PaymentIntent;
  failed: PaymentIntent;
  error: OxyPayError;
}

type CheckoutEventName = keyof OxyPayCheckoutEventMap;
type CheckoutEventHandler<K extends CheckoutEventName> = (
  payload: OxyPayCheckoutEventMap[K],
) => void;

interface CheckoutEmitter {
  on<K extends CheckoutEventName>(event: K, handler: CheckoutEventHandler<K>): void;
  emit<K extends CheckoutEventName>(event: K, payload: OxyPayCheckoutEventMap[K]): void;
  removeAll(): void;
}

/**
 * A minimal typed pub/sub. The public `on`/`emit` are fully type-checked per
 * event; the internal `Map` necessarily erases each handler's specific
 * payload type (it stores handlers for every event key in one collection),
 * so the single cast at the storage boundary is intentional, not a type-safety
 * hole — nothing outside this function ever sees the erased type.
 */
export function createEmitter(): CheckoutEmitter {
  const handlers = new Map<CheckoutEventName, Set<CheckoutEventHandler<CheckoutEventName>>>();

  return {
    on(event, handler) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler as CheckoutEventHandler<CheckoutEventName>);
      handlers.set(event, set);
    },
    emit(event, payload) {
      const set = handlers.get(event);
      if (!set) return;
      for (const handler of set) {
        (handler as CheckoutEventHandler<typeof event>)(payload);
      }
    },
    removeAll() {
      handlers.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// DOM rendering — exercised only by the real-browser Step 3 check (deferred;
// see the Task 6 report), not by the headless unit suite.
// ---------------------------------------------------------------------------

const BUTTON_CLASS = 'oxypay-checkout-button';
const OVERLAY_CLASS = 'oxypay-checkout-qr-overlay';

/** Statuses that still accept a payment — everything else disables the button. */
const PAYABLE_STATUSES: ReadonlySet<PaymentIntentStatus> = new Set([
  'created',
  'awaiting_approval',
  'approved',
]);

function resolveTarget(target: string | Element): Element {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (!(element instanceof Element)) {
    throw new OxyPayInvalidRequestError(
      typeof target === 'string'
        ? `OxyPayCheckout.mount: no element matches selector "${target}"`
        : 'OxyPayCheckout.mount: target is not a DOM Element',
    );
  }
  return element;
}

function renderButton(container: Element): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = BUTTON_CLASS;
  button.textContent = 'Pay with Oxy Pay';
  button.disabled = true; // enabled once the initial snapshot loads
  button.style.cssText =
    'padding:12px 24px;border-radius:8px;border:none;background:#5b21b6;' +
    'color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer;';
  container.replaceChildren(button);
  return button;
}

function updateButton(button: HTMLButtonElement, intent: PaymentIntent): void {
  button.disabled = !PAYABLE_STATUSES.has(intent.status);
  switch (intent.status) {
    case 'settled':
      button.textContent = 'Paid';
      break;
    case 'confirming':
      button.textContent = 'Confirming…';
      break;
    case 'broadcast':
      button.textContent = 'Payment received';
      break;
    case 'failed':
    case 'expired':
    case 'rejected':
      button.textContent = 'Payment unavailable';
      break;
    default:
      button.textContent = 'Pay with Oxy Pay';
  }
}

/**
 * Show a QR of the deep link for a desktop payer to scan with the wallet
 * app. `qr.createSvgTag()` is `qrcode-generator`'s own trusted output — a
 * grid of `<rect>` "modules" encoding `deepLink` as opaque data, never as
 * literal SVG text — so assigning it via `innerHTML` carries no injection
 * risk from `deepLink`'s content.
 */
function showQrOverlay(deepLink: string): void {
  const qr = createQrCode(0, 'M'); // type 0 = auto-sized, level M = 15% error correction
  qr.addData(deepLink);
  qr.make();

  const overlay = document.createElement('div');
  overlay.className = OVERLAY_CLASS;
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(0,0,0,0.5);';
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });

  const card = document.createElement('div');
  card.style.cssText =
    'background:#fff;border-radius:12px;padding:24px;display:flex;' +
    'flex-direction:column;align-items:center;gap:12px;';
  card.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });

  const caption = document.createElement('p');
  caption.textContent = 'Scan with the Oxy Pay app';
  caption.style.cssText = 'margin:0;font:500 14px system-ui,sans-serif;color:#111;';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.style.cssText =
    'padding:8px 16px;border-radius:6px;border:1px solid #d1d5db;background:#fff;' +
    'font:500 14px system-ui,sans-serif;cursor:pointer;';
  closeButton.addEventListener('click', () => overlay.remove());

  card.append(caption, closeButton);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

export interface OxyPayCheckoutMountOptions {
  /** The payment intent's `client_secret` — the payer's proof of possession. */
  clientSecret: string;
  /** Payment intent id. Derived from `clientSecret` when omitted — see {@link deriveIntentId}. */
  intentId?: string;
  /** Gateway base URL, forwarded to {@link createOxyPayCheckout}. Default `https://api.pay.oxy.so`. */
  gatewayUrl?: string;
}

export interface OxyPayCheckoutInstance {
  on<K extends CheckoutEventName>(event: K, handler: CheckoutEventHandler<K>): void;
  /** Unsubscribes from realtime updates and removes the button from the DOM. */
  destroy(): void;
}

function toOxyPayError(error: unknown): OxyPayError {
  if (error instanceof OxyPayError) return error;
  return new OxyPayApiError(error instanceof Error ? error.message : String(error));
}

/**
 * Render the "Pay with Oxy Pay" button into `target` and start tracking the
 * payment intent. Returns synchronously — before any network call resolves —
 * so a caller's `.on(...)` registrations (called immediately after `mount()`
 * returns, in the same synchronous tick) are always in place before the
 * first `settled`/`confirming`/`failed`/`error` event can fire on the
 * following microtask.
 */
function mount(
  target: string | Element,
  opts: OxyPayCheckoutMountOptions,
): OxyPayCheckoutInstance {
  const element = resolveTarget(target);
  const intentId = deriveIntentId(opts.clientSecret, opts.intentId);
  const clientSecret = opts.clientSecret;

  const emitter = createEmitter();
  const payerClient = createOxyPayCheckout({ gatewayUrl: opts.gatewayUrl });
  const button = renderButton(element);

  let latestIntent: PaymentIntent | null = null;
  let subscription: { unsubscribe(): void } | null = null;
  let destroyed = false;

  function handleIntentUpdate(intent: PaymentIntent): void {
    latestIntent = intent;
    updateButton(button, intent);
    if (intent.status === 'settled') {
      emitter.emit('settled', intent);
    } else if (intent.status === 'confirming') {
      emitter.emit('confirming', intent);
    } else if (
      intent.status === 'failed' ||
      intent.status === 'expired' ||
      intent.status === 'rejected'
    ) {
      emitter.emit('failed', intent);
    }
  }

  button.addEventListener('click', () => {
    if (!latestIntent) return; // initial snapshot hasn't loaded yet
    const deepLink = buildPayDeepLink({
      intentId,
      clientSecret,
      address: latestIntent.address,
      amount: latestIntent.amount,
      network: latestIntent.network,
    });
    if (isMobileUserAgent(navigator.userAgent)) {
      window.location.href = deepLink;
    } else {
      showQrOverlay(deepLink);
    }
  });

  // `destroyed` closes a race a caller CAN legitimately hit: calling
  // `destroy()` while `getPaymentIntent`/`subscribe` is still in flight (e.g.
  // the host page unmounts the widget immediately). Without this guard, a
  // subscription created AFTER `destroy()` ran would overwrite `subscription`
  // (still `null` at destroy time) and never get torn down — a leaked socket
  // connection for the rest of the tab's life.
  void payerClient
    .getPaymentIntent(intentId, clientSecret)
    .then((intent) => {
      if (destroyed) return null;
      handleIntentUpdate(intent);
      return payerClient.subscribe(intentId, clientSecret, handleIntentUpdate);
    })
    .then((sub) => {
      if (!sub) return;
      if (destroyed) {
        sub.unsubscribe();
        return;
      }
      subscription = sub;
    })
    .catch((error: unknown) => {
      if (destroyed) return;
      emitter.emit('error', toOxyPayError(error));
    });

  return {
    on(event, handler) {
      emitter.on(event, handler);
    },
    destroy() {
      destroyed = true;
      subscription?.unsubscribe();
      emitter.removeAll();
      button.remove();
    },
  };
}

export const OxyPayCheckout = { mount };
