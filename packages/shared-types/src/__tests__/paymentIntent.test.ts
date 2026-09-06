import { test, expect } from 'bun:test';
import {
  PAYMENT_INTENT_STATUSES,
  canStillBePaid,
  isValidStatusTransition,
  type PaymentIntentStatus,
} from '../paymentIntent';

test('allows created -> awaiting_approval', () => {
  expect(isValidStatusTransition('created', 'awaiting_approval')).toBe(true);
});
test('forbids settled -> confirming (except reorg handled separately)', () => {
  expect(isValidStatusTransition('settled', 'confirming')).toBe(false);
});
test('forbids skipping broadcast', () => {
  expect(isValidStatusTransition('awaiting_approval', 'settled')).toBe(false);
});

/**
 * `canStillBePaid`, and the regression it exists because of.
 *
 * The hosted checkout used to decide reuse by asking whether a status was a
 * LEAF of the transition table. That answered correctly for `settled` right up
 * until `settled` gained `→ refunded | partially_refunded`, at which point a
 * settled payment stopped looking finished and the checkout began reusing a
 * remembered settled intent — showing a payer who had already paid their old
 * receipt forever, with no way to pay the link again. The table change was
 * correct; the question was wrong.
 *
 * Every status is listed below rather than the interesting few, because the
 * failure mode is a NEW status nobody classified, and a spot-check cannot see
 * one.
 */
const PAYABLE: Record<PaymentIntentStatus, boolean> = {
  created: true,
  awaiting_approval: true,
  approved: true,
  broadcast: true,
  confirming: true,
  requires_action: true,
  processing: true,
  // Where paying ENDS. Has outgoing edges, and none of them is the payer's.
  settled: false,
  partially_refunded: false,
  refunded: false,
  expired: false,
  failed: false,
  rejected: false,
};

test('says whether a payer can still complete a payment, for every status', () => {
  for (const status of PAYMENT_INTENT_STATUSES) {
    expect([status, canStillBePaid(status)]).toEqual([status, PAYABLE[status]]);
  }
});

test('classifies every status the table defines, and no others', () => {
  // Guards the table above against a status added to `ALLOWED` and forgotten
  // here — which would read as `undefined` and quietly assert nothing.
  expect([...PAYMENT_INTENT_STATUSES].sort()).toEqual(Object.keys(PAYABLE).sort());
});

/**
 * Reachability is TRANSITIVE, not one-step. `awaiting_approval` reaches
 * `settled` only through `approved → broadcast → confirming`, and a one-step
 * check would call it unpayable — abandoning a payer mid-flow.
 */
test('follows the chain path all the way to settled', () => {
  expect(isValidStatusTransition('awaiting_approval', 'settled')).toBe(false);
  expect(canStillBePaid('awaiting_approval')).toBe(true);
});
