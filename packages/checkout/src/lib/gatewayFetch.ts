// Thin fetch wrapper for the Gateway's plain REST routes that sit outside
// `@oxyhq/pay/checkout` — payment links and checkout sessions have no SDK
// client core (only payment intents do; see `intentClient.ts`), so
// LinkRoute/SessionRoute call the Gateway directly. Centralizes the base URL
// + error handling so neither route hand-rolls response checking.
import { GATEWAY_URL } from './config';

async function gatewayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${GATEWAY_URL}${path}`, init);
  if (!response.ok) {
    throw new Error(`Gateway request to ${path} failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export function gatewayGet<T>(path: string): Promise<T> {
  return gatewayFetch<T>(path);
}

export function gatewayPost<T>(path: string): Promise<T> {
  return gatewayFetch<T>(path, { method: 'POST' });
}
