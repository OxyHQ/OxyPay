import { test, expect, afterEach } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { App } from '../App';

afterEach(() => {
  cleanup();
});

test('renders the payment intent route shell, then falls back once the frozen @oxyhq/pay/checkout client rejects', async () => {
  window.history.pushState({}, '', '/i/pi_test123#client_secret=pi_test123_secret_abc');
  render(<App />);

  expect(screen.getByText(/loading payment intent pi_test123/i)).toBeDefined();
  // Deliberately unmocked — asserts against the REAL frozen `@oxyhq/pay/checkout`
  // stub (every method rejects with this exact message until the SDK plan's
  // Task 5 merges in), not a fixture. Await the settled state within this
  // same test so the `.catch()` state update (a microtask away from the
  // render above) can't leak past this test's completion and land
  // un-`act()`-wrapped on a later test.
  expect(await screen.findByText(/not implemented yet/i)).toBeDefined();
});

test('renders a not-found shell for an unknown route', () => {
  window.history.pushState({}, '', '/does-not-exist');
  render(<App />);

  expect(screen.getByText(/page not found/i)).toBeDefined();
});
