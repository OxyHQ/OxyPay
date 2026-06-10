import { Invoice, type InvoiceDocument } from '../models/Invoice';
import { HttpError } from '../middleware/errorHandler';
import { newInvoiceId } from '../utils/ids';
import type {
  Currency,
  Invoice as InvoiceDto,
  InvoiceLineItem,
  Money,
} from '@oxypay/shared-types';

export function toInvoiceDto(doc: InvoiceDocument): InvoiceDto {
  return {
    id: doc._id,
    merchantId: doc.merchantId,
    customerId: doc.customerId,
    amount: { amount: doc.amount, currency: doc.currency },
    items: doc.items,
    description: doc.description,
    appId: doc.appId,
    idempotencyKey: doc.idempotencyKey,
    successUrl: doc.successUrl,
    cancelUrl: doc.cancelUrl,
    webhookUrl: doc.webhookUrl,
    status: doc.status,
    paymentId: doc.paymentId,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    expiresAt: doc.expiresAt?.toISOString(),
  };
}

export interface CreateInvoiceOptions {
  merchantId: string;
  customerId?: string;
  amount: Money;
  items?: InvoiceLineItem[];
  description?: string;
  appId?: string;
  idempotencyKey?: string;
  successUrl?: string;
  cancelUrl?: string;
  webhookUrl?: string;
  expiresInSeconds?: number;
}

export async function createInvoice(opts: CreateInvoiceOptions): Promise<InvoiceDocument> {
  if (opts.idempotencyKey && opts.appId) {
    const existing = await Invoice.findOne({ appId: opts.appId, idempotencyKey: opts.idempotencyKey });
    if (existing) return existing;
  }
  const expiresAt = opts.expiresInSeconds
    ? new Date(Date.now() + opts.expiresInSeconds * 1000)
    : new Date(Date.now() + 1000 * 60 * 60 * 24); // default 24h
  return Invoice.create({
    _id: newInvoiceId(),
    merchantId: opts.merchantId,
    customerId: opts.customerId,
    amount: opts.amount.amount,
    currency: opts.amount.currency,
    items: opts.items,
    description: opts.description,
    appId: opts.appId,
    idempotencyKey: opts.idempotencyKey,
    successUrl: opts.successUrl,
    cancelUrl: opts.cancelUrl,
    webhookUrl: opts.webhookUrl,
    status: 'open',
    expiresAt,
  });
}

export async function getInvoice(invoiceId: string): Promise<InvoiceDocument> {
  const inv = await Invoice.findById(invoiceId);
  if (!inv) throw new HttpError(404, 'invoice_not_found', 'Invoice not found');
  return inv;
}

export async function listMerchantInvoices(merchantId: string): Promise<InvoiceDto[]> {
  const docs = await Invoice.find({ merchantId }).sort({ createdAt: -1 }).limit(100).exec();
  return docs.map(toInvoiceDto);
}

export async function cancelInvoice(invoiceId: string, merchantId: string): Promise<InvoiceDocument> {
  const inv = await getInvoice(invoiceId);
  if (inv.merchantId !== merchantId) {
    throw new HttpError(403, 'forbidden', 'Not your invoice');
  }
  if (inv.status !== 'open') {
    throw new HttpError(409, 'invoice_not_open', `Invoice is ${inv.status}`);
  }
  inv.status = 'cancelled';
  await inv.save();
  return inv;
}

export async function expireOpenInvoices(): Promise<number> {
  const result = await Invoice.updateMany(
    { status: 'open', expiresAt: { $lt: new Date() } },
    { $set: { status: 'expired' } }
  );
  return result.modifiedCount ?? 0;
}

/** Used by Currency type signature in routes. */
export type { Currency };
