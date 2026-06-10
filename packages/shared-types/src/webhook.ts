import type { Invoice } from './invoice';
import type { Payment } from './payment';
import type { Transaction } from './transaction';

export type WebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded'
  | 'invoice.paid'
  | 'invoice.expired'
  | 'transaction.confirmed';

export interface WebhookEvent<TData = unknown> {
  id: string;
  type: WebhookEventType;
  /** ISO date string. */
  createdAt: string;
  /** Application identifier that should receive the event. */
  appId?: string;
  /** Resource that triggered the event. */
  data: TData;
}

export type PaymentWebhookEvent = WebhookEvent<Payment>;
export type InvoiceWebhookEvent = WebhookEvent<Invoice>;
export type TransactionWebhookEvent = WebhookEvent<Transaction>;
