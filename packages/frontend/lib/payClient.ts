import { oxyClient } from '@oxyhq/core';
import type {
  ApiError,
  ApiResponse,
  Currency,
  Invoice,
  Paginated,
  Payment,
  PaymentMethodId,
  Transaction,
  Wallet,
  WalletSummary,
} from '@oxypay/shared-types';
import { config } from './config';

const linkedPayClient = oxyClient.createLinkedClient({
  baseURL: config.payApiBaseUrl,
  requestTimeout: 10_000,
});

const client = linkedPayClient.client;

interface PayApiError extends Error {
  code?: string;
  status?: number;
}

interface HttpErrorShape {
  response?: {
    status?: number;
    data?: unknown;
  };
  status?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getHttpErrorShape(error: unknown): HttpErrorShape | null {
  if (!isRecord(error)) return null;
  const responseValue = error.response;
  return {
    status: typeof error.status === 'number' ? error.status : undefined,
    response: isRecord(responseValue)
      ? {
          status: typeof responseValue.status === 'number' ? responseValue.status : undefined,
          data: responseValue.data,
        }
      : undefined,
  };
}

function isApiErrorPayload(value: unknown): value is ApiError {
  return isRecord(value) && value.success === false && isRecord(value.error);
}

function toPayApiError(message: string, code?: string, status?: number): PayApiError {
  const error = new Error(message) as PayApiError;
  error.code = code;
  error.status = status;
  return error;
}

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  try {
    const data = await promise;
    if (!data || data.success === false) {
      throw toPayApiError(data?.error?.message ?? 'Request failed', data?.error?.code ?? 'http_error');
    }
    return data.data;
  } catch (err) {
    const httpError = getHttpErrorShape(err);
    const payload = httpError?.response?.data;
    if (isApiErrorPayload(payload)) {
      throw toPayApiError(payload.error.message, payload.error.code, httpError?.response?.status);
    }
    throw err;
  }
}

export const payApi = {
  // Wallets
  listWallets: () => unwrap<WalletSummary>(client.get<ApiResponse<WalletSummary>>('/wallets')),
  createWallet: (currency: Currency) => unwrap<Wallet>(client.post<ApiResponse<Wallet>>('/wallets', { currency })),
  devTopUp: (currency: Currency, amount: string) =>
    unwrap<Wallet>(client.post<ApiResponse<Wallet>>('/wallets/dev/top-up', { currency, amount })),

  // Transactions
  listTransactions: (params: { walletId?: string; currency?: Currency; cursor?: string; limit?: number } = {}) =>
    unwrap<Paginated<Transaction>>(client.get<ApiResponse<Paginated<Transaction>>>('/transactions', { params })),

  // Payments
  payInvoice: (invoiceId: string, method: PaymentMethodId) =>
    unwrap<Payment>(client.post<ApiResponse<Payment>>('/payments/pay-invoice', { invoiceId, method })),
  transfer: (toUserId: string, amount: { amount: string; currency: Currency }, note?: string) =>
    unwrap<Payment>(client.post<ApiResponse<Payment>>('/payments/transfer', { toUserId, amount, note })),
  getPayment: (paymentId: string) => unwrap<Payment>(client.get<ApiResponse<Payment>>(`/payments/${paymentId}`)),

  // Invoices
  createInvoice: (body: {
    amount: { amount: string; currency: Currency };
    customerId?: string;
    description?: string;
  }) => unwrap<Invoice>(client.post<ApiResponse<Invoice>>('/invoices', body)),

  // FairCoin
  getDepositAddress: () =>
    unwrap<{ address: string; issuedAt: string; live: boolean }>(
      client.get<ApiResponse<{ address: string; issuedAt: string; live: boolean }>>('/faircoin/deposit-address')
    ),
};

export type PayApi = typeof payApi;
