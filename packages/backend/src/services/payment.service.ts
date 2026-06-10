import mongoose from 'mongoose';
import { Payment, type PaymentDocument } from '../models/Payment';
import { Invoice } from '../models/Invoice';
import { HttpError } from '../middleware/errorHandler';
import { newPaymentId } from '../utils/ids';
import { debitWallet, creditWallet } from './wallet.service';
import type {
  Currency,
  Money,
  Payment as PaymentDto,
  PaymentMethodId,
} from '@oxypay/shared-types';

export function toPaymentDto(doc: PaymentDocument): PaymentDto {
  return {
    id: doc._id,
    payerId: doc.payerId,
    merchantId: doc.merchantId,
    recipientId: doc.recipientId,
    invoiceId: doc.invoiceId,
    amount: { amount: doc.amount, currency: doc.currency },
    method: doc.method,
    status: doc.status,
    description: doc.description,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    succeededAt: doc.succeededAt?.toISOString(),
    errorCode: doc.errorCode,
    errorMessage: doc.errorMessage,
    refundedAmount: doc.refundedAmount ? { amount: doc.refundedAmount, currency: doc.currency } : undefined,
  };
}

export interface PayInvoiceOptions {
  payerId: string;
  invoiceId: string;
  method: PaymentMethodId;
}

/**
 * Pay an invoice with the user's Oxy balance. This atomically debits the
 * payer, credits the merchant, and marks the invoice paid.
 */
export async function payInvoice(opts: PayInvoiceOptions): Promise<PaymentDocument> {
  const invoice = await Invoice.findById(opts.invoiceId);
  if (!invoice) throw new HttpError(404, 'invoice_not_found', 'Invoice not found');
  if (invoice.status === 'paid') {
    const existing = await Payment.findOne({ invoiceId: invoice._id, status: 'succeeded' });
    if (existing) return existing;
  }
  if (invoice.status !== 'open') {
    throw new HttpError(409, 'invoice_not_open', `Invoice is ${invoice.status}`);
  }
  if (invoice.customerId && invoice.customerId !== opts.payerId) {
    throw new HttpError(403, 'wrong_customer', 'Invoice is for a different customer');
  }
  if (opts.method !== 'oxy_balance') {
    throw new HttpError(400, 'unsupported_method', `Payment method ${opts.method} is not yet implemented`);
  }

  const amount: Money = { amount: invoice.amount, currency: invoice.currency };
  const session = await mongoose.startSession();
  let payment!: PaymentDocument;
  try {
    await session.withTransaction(async () => {
      const created = await Payment.create(
        [
          {
            _id: newPaymentId(),
            payerId: opts.payerId,
            merchantId: invoice.merchantId,
            invoiceId: invoice._id,
            amount: invoice.amount,
            currency: invoice.currency,
            method: opts.method,
            status: 'processing',
            description: invoice.description,
          },
        ],
        { session }
      );
      payment = created[0];
      invoice.status = 'paid';
      invoice.paymentId = payment._id;
      await invoice.save({ session });
    });

    // Move money outside the txn so wallet sub-txns commit independently.
    // If either side fails, the payment is marked failed and the invoice
    // re-opened.
    try {
      await debitWallet({
        userId: opts.payerId,
        currency: amount.currency,
        amount,
        type: 'payment_out',
        paymentId: payment._id,
        invoiceId: invoice._id,
        counterpartyUserId: invoice.merchantId,
      });
      await creditWallet({
        userId: invoice.merchantId,
        currency: amount.currency,
        amount,
        type: 'payment_in',
        paymentId: payment._id,
        invoiceId: invoice._id,
        counterpartyUserId: opts.payerId,
      });
      payment.status = 'succeeded';
      payment.succeededAt = new Date();
      await payment.save();
    } catch (err) {
      payment.status = 'failed';
      payment.errorCode = err instanceof HttpError ? err.code : 'wallet_error';
      payment.errorMessage = err instanceof Error ? err.message : 'Wallet error';
      await payment.save();
      // Re-open the invoice so the customer can try again.
      invoice.status = 'open';
      invoice.paymentId = undefined;
      await invoice.save();
      throw err;
    }
    return payment;
  } finally {
    session.endSession();
  }
}

export interface TransferOptions {
  fromUserId: string;
  toUserId: string;
  amount: Money;
  note?: string;
}

/**
 * Peer-to-peer transfer. Same-currency only. The recipient's wallet is
 * created on demand.
 */
export async function transfer(opts: TransferOptions): Promise<PaymentDocument> {
  if (opts.fromUserId === opts.toUserId) {
    throw new HttpError(400, 'self_transfer', 'Cannot transfer to yourself');
  }
  const payment = await Payment.create({
    _id: newPaymentId(),
    payerId: opts.fromUserId,
    recipientId: opts.toUserId,
    amount: opts.amount.amount,
    currency: opts.amount.currency,
    method: 'oxy_balance',
    status: 'processing',
    description: opts.note,
  });
  try {
    await debitWallet({
      userId: opts.fromUserId,
      currency: opts.amount.currency,
      amount: opts.amount,
      type: 'transfer_out',
      paymentId: payment._id,
      counterpartyUserId: opts.toUserId,
      note: opts.note,
    });
    await creditWallet({
      userId: opts.toUserId,
      currency: opts.amount.currency,
      amount: opts.amount,
      type: 'transfer_in',
      paymentId: payment._id,
      counterpartyUserId: opts.fromUserId,
      note: opts.note,
    });
    payment.status = 'succeeded';
    payment.succeededAt = new Date();
    await payment.save();
  } catch (err) {
    payment.status = 'failed';
    payment.errorCode = err instanceof HttpError ? err.code : 'wallet_error';
    payment.errorMessage = err instanceof Error ? err.message : 'Wallet error';
    await payment.save();
    throw err;
  }
  return payment;
}

export async function getPayment(paymentId: string, requesterUserId: string): Promise<PaymentDocument> {
  const p = await Payment.findById(paymentId);
  if (!p) throw new HttpError(404, 'payment_not_found', 'Payment not found');
  if (
    p.payerId !== requesterUserId &&
    p.merchantId !== requesterUserId &&
    p.recipientId !== requesterUserId
  ) {
    throw new HttpError(403, 'forbidden', 'Not your payment');
  }
  return p;
}

export type { Currency };
