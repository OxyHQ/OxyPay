import type { Money } from './money';
import type { PaymentMethodId } from './paymentMethod';

export type PaymentStatus =
  | 'requires_action'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded';

/**
 * A payment intent, i.e. a single attempt to move money from a payer to a
 * merchant. One payment may settle an invoice or stand alone (peer-to-peer
 * transfers).
 */
export interface Payment {
  id: string;
  payerId: string;
  /** Merchant userId for merchant-payments. Absent for P2P transfers. */
  merchantId?: string;
  /** Recipient userId for P2P transfers. Absent for merchant payments. */
  recipientId?: string;
  invoiceId?: string;
  amount: Money;
  method: PaymentMethodId;
  status: PaymentStatus;
  description?: string;
  /** ISO date string. */
  createdAt: string;
  /** ISO date string. */
  updatedAt: string;
  /** ISO date string at which the payment succeeded. */
  succeededAt?: string;
  /** Last error code if `status === 'failed'`. */
  errorCode?: string;
  /** Free-text error message. */
  errorMessage?: string;
  /** Amount refunded so far (defaults to 0). */
  refundedAmount?: Money;
}
