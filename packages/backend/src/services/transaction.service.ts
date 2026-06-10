import { Transaction, type TransactionDocument } from '../models/Transaction';
import type { Currency, Paginated, Transaction as TransactionDto } from '@oxypay/shared-types';

export function toTransactionDto(doc: TransactionDocument): TransactionDto {
  return {
    id: doc._id,
    walletId: doc.walletId,
    userId: doc.userId,
    type: doc.type,
    status: doc.status,
    amount: { amount: doc.amount, currency: doc.currency },
    fee: doc.fee ? { amount: doc.fee, currency: doc.currency } : undefined,
    counterpartyUserId: doc.counterpartyUserId,
    counterpartyUsername: doc.counterpartyUsername,
    externalRef: doc.externalRef,
    note: doc.note,
    paymentId: doc.paymentId,
    invoiceId: doc.invoiceId,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    confirmedAt: doc.confirmedAt?.toISOString(),
  };
}

export interface ListTransactionsOptions {
  userId: string;
  walletId?: string;
  currency?: Currency;
  cursor?: string;
  limit?: number;
}

export async function listTransactions(opts: ListTransactionsOptions): Promise<Paginated<TransactionDto>> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const query: Record<string, unknown> = { userId: opts.userId };
  if (opts.walletId) query.walletId = opts.walletId;
  if (opts.currency) query.currency = opts.currency;
  if (opts.cursor) {
    const decoded = decodeCursor(opts.cursor);
    if (decoded) query.createdAt = { $lt: decoded };
  }
  const docs = await Transaction.find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .exec();
  const hasMore = docs.length > limit;
  const slice = hasMore ? docs.slice(0, limit) : docs;
  const nextCursor = hasMore ? encodeCursor(slice[slice.length - 1].createdAt) : undefined;
  return {
    items: slice.map(toTransactionDto),
    nextCursor,
  };
}

function encodeCursor(date: Date): string {
  return Buffer.from(String(date.getTime()), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): Date | null {
  try {
    const ts = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10);
    if (!Number.isFinite(ts)) return null;
    return new Date(ts);
  } catch {
    return null;
  }
}
