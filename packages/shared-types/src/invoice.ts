import type { Money } from './money';

export type InvoiceStatus = 'open' | 'paid' | 'expired' | 'cancelled';

export interface InvoiceLineItem {
  /** Free-form name for the line item (e.g. "Pro plan — monthly"). */
  name: string;
  description?: string;
  /** Unit price as Money; quantity defaults to 1. */
  price: Money;
  quantity?: number;
  /** Optional category — informational only. */
  type?: 'product' | 'subscription' | 'service' | 'fee';
}

/**
 * A merchant-issued invoice. The merchant creates the invoice via the SDK
 * (`createInvoice`) and the customer pays through Oxy Pay (`payInvoice`).
 */
export interface Invoice {
  id: string;
  /** Oxy userId of the merchant. */
  merchantId: string;
  /** Optional intended payer (when set, only this user can pay). */
  customerId?: string;
  /** Total amount due. Must equal sum of `items` if items are present. */
  amount: Money;
  /** Itemised breakdown for display. Optional. */
  items?: InvoiceLineItem[];
  description?: string;
  /** Application identifier that issued the invoice (Mention, Allo, …). */
  appId?: string;
  /** Idempotency key supplied by the merchant. */
  idempotencyKey?: string;
  /** Where to redirect the user after success. */
  successUrl?: string;
  /** Where to redirect the user on cancellation. */
  cancelUrl?: string;
  /** Webhook URL the merchant wants notified when status changes. */
  webhookUrl?: string;
  status: InvoiceStatus;
  /** ISO date string. */
  createdAt: string;
  /** ISO date string. */
  updatedAt: string;
  /** ISO date string at which an open invoice expires. */
  expiresAt?: string;
  /** Payment that settled this invoice (if any). */
  paymentId?: string;
}
