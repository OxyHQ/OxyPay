import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

function ThrowingChild(): never {
  throw new Error('boom');
}

afterEach(() => {
  cleanup();
});

test('renders children normally when nothing throws', () => {
  render(
    <ErrorBoundary>
      <p>all good</p>
    </ErrorBoundary>,
  );

  expect(screen.getByText('all good')).toBeDefined();
});

test('renders a fallback — not a blank tree — when a child throws during render', () => {
  // React (and our own componentDidCatch) log the caught error to the
  // console by design; silence it here so the test output stays readable,
  // not to hide a real failure — the assertions below still verify the
  // fallback rendered.
  const consoleError = console.error;
  console.error = mock(() => undefined);
  try {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
  } finally {
    console.error = consoleError;
  }

  expect(screen.getByText(/something went wrong/i)).toBeDefined();
  expect(screen.queryByText('all good')).toBeNull();
});
