import { customAlphabet } from 'nanoid';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const nanoid = customAlphabet(ALPHABET, 24);

export const newId = (prefix: string): string => `${prefix}_${nanoid()}`;

export const newWalletId = () => newId('wlt');
export const newTransactionId = () => newId('txn');
export const newInvoiceId = () => newId('inv');
export const newPaymentId = () => newId('pay');
export const newWebhookId = () => newId('whe');
