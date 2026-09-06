import type { PaymentIntent } from '@peable.to/shared-types';

interface StatusVisual {
  title: string;
  subtitle: string;
  tone: 'primary' | 'warning' | 'danger';
  showSpinner: boolean;
}

// Mirrors the wallet's `describePaymentStatus` (packages/frontend/app/pay/
// [intent].tsx) — same statuses spin, same statuses are terminal, same tone
// (settled reuses the primary/brand color there, not a separate "success"
// green, so this does too) — so the checkout page and the wallet's approve
// screen read identically for the same intent. Icon GLYPHS differ (plain
// text/SVG here, not MaterialCommunityIcons — this is a web app with no icon
// library dependency), only the semantic mapping is shared.
function describeStatus(intent: PaymentIntent): StatusVisual {
  switch (intent.status) {
    case 'confirming':
      return {
        title: 'Confirming',
        subtitle: `${intent.confirmations} confirmation(s) so far...`,
        tone: 'primary',
        showSpinner: true,
      };
    case 'settled':
      return {
        title: 'Payment settled',
        subtitle: 'The merchant has received your payment.',
        tone: 'primary',
        showSpinner: false,
      };
    case 'failed':
      return {
        title: 'Payment failed',
        subtitle: 'This payment could not be completed.',
        tone: 'danger',
        showSpinner: false,
      };
    case 'expired':
      return {
        title: 'Payment request expired',
        subtitle: 'This request is no longer valid.',
        tone: 'warning',
        showSpinner: false,
      };
    case 'rejected':
      return {
        title: 'Payment rejected',
        subtitle: 'The merchant rejected this payment.',
        tone: 'danger',
        showSpinner: false,
      };
    // `broadcast`, and any other pre-broadcast status this panel might still
    // observe: the tx is on the network and waiting to be seen/confirmed.
    default:
      return {
        title: 'Payment sent',
        subtitle: 'Waiting to be seen on-chain...',
        tone: 'primary',
        showSpinner: true,
      };
  }
}

export function StatusPanel({
  intent,
  successUrl,
}: {
  intent: PaymentIntent;
  successUrl?: string;
}) {
  const visual = describeStatus(intent);
  return (
    <div className={`status-panel status-panel--${visual.tone}`} aria-live="polite">
      {visual.showSpinner ? (
        <span className="status-panel__spinner" aria-hidden="true" />
      ) : (
        <span className="status-panel__icon" aria-hidden="true">
          {intent.status === 'settled' ? '✓' : intent.status === 'expired' ? '!' : '✕'}
        </span>
      )}
      <p className="status-panel__title">{visual.title}</p>
      <p className="status-panel__subtitle">{visual.subtitle}</p>
      {intent.status === 'settled' && successUrl && (
        <a className="status-panel__cta" href={successUrl}>
          Continue
        </a>
      )}
    </div>
  );
}
