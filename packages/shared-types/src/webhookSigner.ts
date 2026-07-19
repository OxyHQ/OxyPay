import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compute the hex HMAC-SHA256 of the signed payload `${timestamp}.${rawBody}`.
 * The signed payload binds the timestamp to the body so a captured signature
 * cannot be replayed against a different body or a shifted timestamp.
 */
function computeSignature(secret: string, rawBody: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/**
 * Produce a Stripe-style signature header for an outbound webhook:
 * `t=${timestamp},v1=${hexHmacSha256}`.
 */
export function signWebhook(secret: string, rawBody: string, timestamp: number): string {
  return `t=${timestamp},v1=${computeSignature(secret, rawBody, timestamp)}`;
}

interface ParsedHeader {
  timestamp: number;
  signature: string;
}

function parseHeader(header: string): ParsedHeader | null {
  let timestamp: number | null = null;
  let signature: string | null = null;
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (key === 't') {
      const parsed = Number(value);
      if (Number.isInteger(parsed)) timestamp = parsed;
    } else if (key === 'v1') {
      signature = value;
    }
  }
  if (timestamp === null || signature === null) return null;
  return { timestamp, signature };
}

/**
 * Constant-time hex-string comparison. Returns false for unequal-length inputs
 * (timingSafeEqual throws on mismatched buffer lengths) instead of throwing.
 */
function constantTimeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length === 0 || bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Verify a webhook signature header against the raw body.
 * - Parses `t` and `v1` from the header.
 * - Rejects if the timestamp drifts more than `toleranceSec` from `nowSec`.
 * - Recomputes the expected signature and compares it in constant time.
 */
export function verifyWebhook(
  secret: string,
  rawBody: string,
  header: string,
  toleranceSec: number,
  nowSec: number,
): boolean {
  const parsed = parseHeader(header);
  if (parsed === null) return false;
  if (Math.abs(nowSec - parsed.timestamp) > toleranceSec) return false;
  const expected = computeSignature(secret, rawBody, parsed.timestamp);
  return constantTimeEqualHex(expected, parsed.signature);
}
