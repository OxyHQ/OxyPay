import axios, { type AxiosInstance } from 'axios';
import { oxyClient } from '@oxyhq/core';
import type {
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

/**
 * Oxy Pay HTTP client.
 *
 * Mirrors the pattern used by Allo / Mention / Homiio (`packages/frontend/
 * utils/api.ts` in Allo): a dedicated axios instance pointing at the Oxy
 * Pay backend, with an interceptor that injects the Oxy access token read
 * synchronously from the `@oxyhq/core` singleton (`oxyClient`).
 *
 * Importing `oxyClient` directly avoids the per-component coupling of
 * passing an `OxyServices` instance into a hook, and matches how the rest
 * of the ecosystem authenticates against non-Oxy backends.
 */
const client: AxiosInstance = axios.create({
  baseURL: config.payApiBaseUrl,
  headers: { 'Content-Type': 'application/json' },
  timeout: 10_000,
});

client.interceptors.request.use((cfg) => {
  try {
    const token = oxyClient.getAccessToken();
    if (token) {
      cfg.headers.set?.('Authorization', `Bearer ${token}`);
    }
  } catch {
    // Ignore — request continues unauthenticated and the backend will 401.
  }
  return cfg;
});

async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  try {
    const { data } = await promise;
    if (!data || data.success === false) {
      const err = new Error(data?.error?.message ?? 'Request failed') as Error & {
        code?: string;
      };
      err.code = data?.error?.code ?? 'http_error';
      throw err;
    }
    return data.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const payload = err.response?.data as ApiResponse<unknown> | undefined;
      if (payload && payload.success === false) {
        const wrapped = new Error(payload.error.message) as Error & { code?: string; status?: number };
        wrapped.code = payload.error.code;
        wrapped.status = err.response?.status;
        throw wrapped;
      }
    }
    throw err;
  }
}

export const payApi = {
  // Wallets
  listWallets: () => unwrap<WalletSummary>(client.get('/wallets')),
  createWallet: (currency: Currency) => unwrap<Wallet>(client.post('/wallets', { currency })),
  devTopUp: (currency: Currency, amount: string) =>
    unwrap<Wallet>(client.post('/wallets/dev/top-up', { currency, amount })),

  // Transactions
  listTransactions: (params: { walletId?: string; currency?: Currency; cursor?: string; limit?: number } = {}) =>
    unwrap<Paginated<Transaction>>(client.get('/transactions', { params })),

  // Payments
  payInvoice: (invoiceId: string, method: PaymentMethodId) =>
    unwrap<Payment>(client.post('/payments/pay-invoice', { invoiceId, method })),
  transfer: (toUserId: string, amount: { amount: string; currency: Currency }, note?: string) =>
    unwrap<Payment>(client.post('/payments/transfer', { toUserId, amount, note })),
  getPayment: (paymentId: string) => unwrap<Payment>(client.get(`/payments/${paymentId}`)),

  // Invoices
  createInvoice: (body: {
    amount: { amount: string; currency: Currency };
    customerId?: string;
    description?: string;
  }) => unwrap<Invoice>(client.post('/invoices', body)),

  // FairCoin
  getDepositAddress: () =>
    unwrap<{ address: string; issuedAt: string; live: boolean }>(client.get('/faircoin/deposit-address')),
};

export type PayApi = typeof payApi;
