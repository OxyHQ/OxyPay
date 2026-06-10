import type { Money } from './money';

export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'transfer_in'
  | 'transfer_out'
  | 'payment_in'
  | 'payment_out'
  | 'refund_in'
  | 'refund_out'
  | 'fee';

export type TransactionStatus =
  | 'pending'
  | 'processing'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

export interface Transaction {
  id: string;
  walletId: string;
  userId: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: Money;
  fee?: Money;
  /** Counterparty userId for transfers / payments, when known. */
  counterpartyUserId?: string;
  /** Counterparty Oxy username, when known. */
  counterpartyUsername?: string;
  /** External reference (FairCoin txid for on-chain transactions, etc). */
  externalRef?: string;
  /** Free-text note from the sender, max 280 chars. */
  note?: string;
  /** Reference to the payment, invoice, refund etc. that produced this. */
  paymentId?: string;
  invoiceId?: string;
  /** ISO date string. */
  createdAt: string;
  /** ISO date string. */
  updatedAt: string;
  /** ISO date string at which this was confirmed (settled). */
  confirmedAt?: string;
}
