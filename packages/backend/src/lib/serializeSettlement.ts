/**
 * The wire shapes for connected accounts and transfers.
 *
 * Separate from `serialize.ts` because these two carry a rule the others do not
 * and which is easy to lose in a long file: **the provider's own ids never
 * reach the wire.** ADR 0001 D3 — a merchant integrates against Peable and does
 * not learn which acquirer sat behind their seller, because the day that
 * changes should be a Peable deploy and not a merchant migration.
 *
 * These DTOs are declared here rather than in `@peable.to/shared-types` for as
 * long as they are unstable. Publishing a shape is a promise, and the settling
 * half of this contract has not yet been exercised end to end.
 */
import type { ConnectedAccountRow } from '../db/accounts/connectedAccountRepository';
import type { TransferRow } from '../db/transfers/transferRepository';

export interface ConnectedAccountDTO {
  readonly id: string;
  readonly object: 'connected_account';
  /** The merchant's OWN id for this seller — how they address it. */
  readonly externalRef: string;
  readonly country: string;
  readonly defaultCurrency: string | null;
  /**
   * Whether this seller can receive a settlement right now.
   *
   * A CONVENIENCE, not the authority: the fields it is derived from are all
   * here, and a marketplace with its own readiness policy (Mercaria has one)
   * reads those instead. Offering only this boolean would make the gateway the
   * authority on a question its ADR 0009 D14 keeps with the merchant.
   */
  readonly payable: boolean;
  readonly payoutsEnabled: boolean;
  readonly chargesEnabled: boolean;
  readonly transfersCapability: string | null;
  readonly cardPaymentsCapability: string | null;
  readonly requirements: {
    readonly currentlyDue: number;
    readonly eventuallyDue: number;
    readonly pastDue: number;
    readonly pendingVerification: number;
  };
  readonly disabledReasonCodes: readonly string[];
  readonly lastSyncedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Serialize a connected account.
 *
 * `providerAccountId` and `provider` are absent, and that is the point of the
 * file. A reviewer checking this should be able to see it by what is NOT here.
 */
export function toConnectedAccountDTO(row: ConnectedAccountRow): ConnectedAccountDTO {
  return {
    id: row.publicId,
    object: 'connected_account',
    externalRef: row.externalRef,
    country: row.country,
    defaultCurrency: row.defaultCurrency,
    // Both halves, and `transfers` is the one that actually gates a settlement:
    // an account with payouts enabled but no transfers capability cannot
    // receive one, and the reverse cannot pay it out.
    payable: row.payoutsEnabled && row.transfersCapability === 'active',
    payoutsEnabled: row.payoutsEnabled,
    chargesEnabled: row.chargesEnabled,
    transfersCapability: row.transfersCapability,
    cardPaymentsCapability: row.cardPaymentsCapability,
    requirements: {
      currentlyDue: row.requirementsCurrentlyDue,
      eventuallyDue: row.requirementsEventuallyDue,
      pastDue: row.requirementsPastDue,
      pendingVerification: row.requirementsPendingVerification,
    },
    disabledReasonCodes: row.disabledReasonCodes,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface TransferDTO {
  readonly id: string;
  readonly object: 'transfer';
  /** The merchant's OWN id for what this settles. */
  readonly externalRef: string;
  /** The `ca_…` of the seller — never their `acct_…`. */
  readonly connectedAccountId: string;
  /** The `pi_…` this transfer was funded by — never the internal primary key. */
  readonly paymentIntentId: string;
  readonly amount: string;
  readonly currency: string;
  readonly amountReversed: string;
  readonly status: string;
  readonly failureMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Serialize a transfer.
 *
 * The two ids it references are the PUBLIC ones, and both are parameters rather
 * than fields of the row: the row stores internal primary keys, and a
 * serializer that reached for them would emit uuids onto a contract that
 * promises `ca_…` and `pi_…`. Requiring them explicitly is what makes that a
 * compile error rather than a wrong response.
 */
export function toTransferDTO(
  row: TransferRow,
  connectedAccountPublicId: string,
  paymentIntentPublicId: string
): TransferDTO {
  return {
    id: row.publicId,
    object: 'transfer',
    externalRef: row.externalRef,
    connectedAccountId: connectedAccountPublicId,
    paymentIntentId: paymentIntentPublicId,
    amount: row.amount,
    currency: row.currency,
    amountReversed: row.amountReversed,
    status: row.status,
    failureMessage: row.failureMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
