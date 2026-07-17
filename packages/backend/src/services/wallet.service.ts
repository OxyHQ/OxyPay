import mongoose from 'mongoose';
import { Wallet, type WalletDocument } from '../models/Wallet';
import { Transaction } from '../models/Transaction';
import { HttpError } from '../middleware/errorHandler';
import { newTransactionId, newWalletId } from '../utils/ids';
import { add, fromDecimal, gte, isPositive, sub, zero } from '../utils/money';
import type {
  Currency,
  Money,
  TransactionType,
  Wallet as WalletDto,
  WalletSummary,
} from '@oxypay/shared-types';

const SUPPORTED_CURRENCIES: Currency[] = ['FAIR', 'EUR', 'USD'];

/** True for a MongoDB duplicate-key (E11000) error, used for idempotency. */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 11000
  );
}

export function toWalletDto(doc: WalletDocument): WalletDto {
  return {
    id: doc._id,
    userId: doc.userId,
    currency: doc.currency,
    balance: { amount: doc.balance, currency: doc.currency },
    pending: { amount: doc.pending, currency: doc.currency },
    frozen: doc.frozen || undefined,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function getOrCreateWallet(userId: string, currency: Currency): Promise<WalletDocument> {
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    throw new HttpError(400, 'unsupported_currency', `Currency ${currency} is not supported`);
  }
  const existing = await Wallet.findOne({ userId, currency });
  if (existing) return existing;
  return Wallet.create({
    _id: newWalletId(),
    userId,
    currency,
    balance: '0',
    pending: '0',
    frozen: false,
  });
}

export async function listUserWallets(userId: string): Promise<WalletSummary> {
  const docs = await Wallet.find({ userId }).sort({ currency: 1 }).exec();
  const wallets = docs.map(toWalletDto);
  // Total equivalent in FAIR is left to the frontend for now (depends on FX
  // rate snapshot). Backend just returns the per-currency wallets.
  const totalEquivalent: Money = zero('FAIR');
  return { wallets, totalEquivalent };
}

export async function getWallet(userId: string, walletId: string): Promise<WalletDocument> {
  const doc = await Wallet.findOne({ _id: walletId, userId });
  if (!doc) {
    throw new HttpError(404, 'wallet_not_found', 'Wallet not found');
  }
  return doc;
}

interface CreditOptions {
  userId: string;
  currency: Currency;
  amount: Money;
  type: TransactionType;
  externalRef?: string;
  note?: string;
  paymentId?: string;
  invoiceId?: string;
  counterpartyUserId?: string;
  counterpartyUsername?: string;
}

interface DebitOptions extends CreditOptions {}

/**
 * Credit a wallet and create a confirmed transaction in a single Mongo
 * transaction. Returns the resulting wallet snapshot.
 */
export async function creditWallet(opts: CreditOptions): Promise<WalletDocument> {
  if (!isPositive(opts.amount)) {
    throw new HttpError(400, 'invalid_amount', 'Amount must be positive');
  }
  const session = await mongoose.startSession();
  try {
    let wallet!: WalletDocument;
    await session.withTransaction(async () => {
      wallet = await getOrCreateWallet(opts.userId, opts.currency);
      if (wallet.frozen) {
        throw new HttpError(409, 'wallet_frozen', 'Wallet is frozen');
      }
      // Insert the transaction FIRST: the unique partial index on `externalRef`
      // rejects a duplicate (e.g. the same on-chain txid:vout observed by two
      // ECS watcher instances) BEFORE any balance is moved, aborting the whole
      // Mongo transaction. This is the atomic guarantee against double-credit.
      await Transaction.create(
        [
          {
            _id: newTransactionId(),
            walletId: wallet._id,
            userId: opts.userId,
            type: opts.type,
            status: 'confirmed',
            amount: opts.amount.amount,
            currency: opts.currency,
            externalRef: opts.externalRef,
            note: opts.note,
            paymentId: opts.paymentId,
            invoiceId: opts.invoiceId,
            counterpartyUserId: opts.counterpartyUserId,
            counterpartyUsername: opts.counterpartyUsername,
            confirmedAt: new Date(),
          },
        ],
        { session }
      );
      const next = add({ amount: wallet.balance, currency: wallet.currency }, opts.amount);
      wallet.balance = next.amount;
      await wallet.save({ session });
    });
    return wallet;
  } catch (err) {
    // A duplicate `externalRef` means this credit was already applied — return
    // the current wallet snapshot as an idempotent no-op (no double-credit).
    if (opts.externalRef && isDuplicateKeyError(err)) {
      return getOrCreateWallet(opts.userId, opts.currency);
    }
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * Debit a wallet (instant, custodial). Throws `insufficient_funds` if the
 * balance is below `amount`. Idempotent if `paymentId` is set: a second debit
 * for the same `paymentId` is a no-op.
 */
export async function debitWallet(opts: DebitOptions): Promise<WalletDocument> {
  if (!isPositive(opts.amount)) {
    throw new HttpError(400, 'invalid_amount', 'Amount must be positive');
  }
  const session = await mongoose.startSession();
  try {
    let wallet!: WalletDocument;
    await session.withTransaction(async () => {
      wallet = await getOrCreateWallet(opts.userId, opts.currency);
      if (wallet.frozen) {
        throw new HttpError(409, 'wallet_frozen', 'Wallet is frozen');
      }
      if (opts.paymentId) {
        const dup = await Transaction.findOne({ paymentId: opts.paymentId, type: opts.type }).session(session);
        if (dup) return;
      }
      const current = { amount: wallet.balance, currency: wallet.currency };
      if (!gte(current, opts.amount)) {
        throw new HttpError(402, 'insufficient_funds', 'Insufficient funds');
      }
      const next = sub(current, opts.amount);
      wallet.balance = next.amount;
      await wallet.save({ session });
      await Transaction.create(
        [
          {
            _id: newTransactionId(),
            walletId: wallet._id,
            userId: opts.userId,
            type: opts.type,
            status: 'confirmed',
            amount: opts.amount.amount,
            currency: opts.currency,
            externalRef: opts.externalRef,
            note: opts.note,
            paymentId: opts.paymentId,
            invoiceId: opts.invoiceId,
            counterpartyUserId: opts.counterpartyUserId,
            counterpartyUsername: opts.counterpartyUsername,
            confirmedAt: new Date(),
          },
        ],
        { session }
      );
    });
    return wallet;
  } finally {
    session.endSession();
  }
}

/**
 * Dev/test helper: credit a wallet with an arbitrary amount. NEVER exposed
 * over HTTP in production.
 */
export async function devTopUp(userId: string, currency: Currency, decimalAmount: string): Promise<WalletDocument> {
  if (process.env.NODE_ENV === 'production') {
    throw new HttpError(403, 'forbidden', 'devTopUp is disabled in production');
  }
  return creditWallet({
    userId,
    currency,
    amount: fromDecimal(decimalAmount, currency),
    type: 'deposit',
    externalRef: `dev_topup_${Date.now()}`,
    note: 'Dev top-up',
  });
}
