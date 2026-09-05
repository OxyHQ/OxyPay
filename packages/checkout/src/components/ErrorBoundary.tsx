import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Wraps the whole app (main.tsx) so a render-time throw — e.g. `BigInt(amount)`
// on a malformed amount (PayWithPeable.tsx, LinkRoute.tsx) — shows a
// user-facing fallback instead of a blank white SPA. The amount is already
// server-validated, so this isn't attacker-reachable today; it's a defensive
// floor against whatever throws next.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[checkout] unhandled render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="checkout-page">
          <p className="checkout-page__pending">Something went wrong. Please refresh the page.</p>
        </main>
      );
    }
    return this.props.children;
  }
}
