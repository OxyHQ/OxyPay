import { test, expect } from 'bun:test';
import { isValidStatusTransition } from '../paymentIntent';

test('allows created -> awaiting_approval', () => {
  expect(isValidStatusTransition('created', 'awaiting_approval')).toBe(true);
});
test('forbids settled -> confirming (except reorg handled separately)', () => {
  expect(isValidStatusTransition('settled', 'confirming')).toBe(false);
});
test('forbids skipping broadcast', () => {
  expect(isValidStatusTransition('awaiting_approval', 'settled')).toBe(false);
});
