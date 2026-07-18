import type { WebhookEventType } from './event';

export interface WebhookDelivery {
  id: string;
  object: 'webhook_delivery';
  merchantId: string;
  intentId: string;
  eventId: string;
  eventType: WebhookEventType;
  url: string;
  attempts: number;
  delivered: boolean;
  lastStatus: 'delivered' | 'failed';
  createdAt: string;
  updatedAt: string;
}
